import type { Peer, SharedFile, Space, SpaceFile } from '@/types';
import { notifyPeers, notifyFiles } from './platform';

const DISCOVERY_PORT = 52384;
const SCAN_TIMEOUT = 1500;
const RESCAN_INTERVAL = 5000;
const SAVED_PEERS_KEY = 'space-known-peers';

type RemoteFiles = Map<string, SharedFile[]>;

let deviceId = '';
let localFilesList: SharedFile[] = [];
let remoteFiles: RemoteFiles = new Map();
let connections: Map<string, WebSocket> = new Map();
let scanTimer: ReturnType<typeof setInterval> | null = null;

// --- Local space state (persisted in localStorage) ---
const SPACES_KEY = 'space-local-spaces';
const SPACE_FILES_KEY = 'space-local-space-files';

let localSpaces: Space[] = [];
let localSpaceFiles: Map<string, SpaceFile[]> = new Map(); // spaceId -> files

function loadLocalSpaces() {
  try {
    const data = JSON.parse(localStorage.getItem(SPACES_KEY) || '[]');
    localSpaces = data;
  } catch { localSpaces = []; }
}

function persistLocalSpaces() {
  localStorage.setItem(SPACES_KEY, JSON.stringify(localSpaces));
}

function loadLocalSpaceFiles() {
  try {
    const data = JSON.parse(localStorage.getItem(SPACE_FILES_KEY) || '{}');
    localSpaceFiles = new Map(Object.entries(data));
  } catch { localSpaceFiles = new Map(); }
}

function persistLocalSpaceFiles() {
  const obj: Record<string, SpaceFile[]> = {};
  for (const [k, v] of localSpaceFiles) obj[k] = v;
  localStorage.setItem(SPACE_FILES_KEY, JSON.stringify(obj));
}

// Deletion tombstones (persisted forever)
const DELETED_SPACES_KEY = 'space-deleted-space-ids';
let deletedSpaceIds: string[] = [];

function loadDeletedSpaceIds() {
  try {
    deletedSpaceIds = JSON.parse(localStorage.getItem(DELETED_SPACES_KEY) || '[]');
  } catch { deletedSpaceIds = []; }
}

function persistDeletedSpaceIds() {
  localStorage.setItem(DELETED_SPACES_KEY, JSON.stringify(deletedSpaceIds));
}

function ensureDefaultSpace() {
  if (localSpaces.length === 0) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const now = Date.now();
    localSpaces.push({
      id,
      name: 'General',
      createdAt: now,
      updatedAt: now,
      createdBy: deviceId || 'mobile',
      autoPin: true,
    });
    persistLocalSpaces();
  }
}

/** Merge a peer's space list + their deleted IDs into our local state. */
function mergeRemoteSpaces(remoteSpaces: Space[], remoteDeletedIds: string[] = []) {
  let changed = false;

  // 1. Apply remote deletions locally
  for (const id of remoteDeletedIds) {
    const idx = localSpaces.findIndex(s => s.id === id);
    if (idx !== -1) {
      localSpaces.splice(idx, 1);
      localSpaceFiles.delete(id);
      changed = true;
    }
    if (!deletedSpaceIds.includes(id)) {
      deletedSpaceIds.push(id);
      changed = true;
    }
  }

  // 2. Add/update spaces from remote (skip tombstoned)
  for (const remote of remoteSpaces) {
    if (deletedSpaceIds.includes(remote.id)) continue;

    const local = localSpaces.find(s => s.id === remote.id);
    if (!local) {
      // Check for duplicate by name (e.g., both devices created "General" independently)
      const localByName = localSpaces.find(s => s.name === remote.name);
      if (localByName) {
        // Keep the older one's ID, retire the newer one
        const localTime = localByName.updatedAt || localByName.createdAt;
        const remoteTime = remote.updatedAt || remote.createdAt;
        if (remoteTime < localTime) {
          // Remote is older — adopt its ID, migrate our files
          const oldId = localByName.id;
          localByName.id = remote.id;
          localByName.createdAt = remote.createdAt;
          localByName.updatedAt = remote.updatedAt;
          localByName.createdBy = remote.createdBy;
          const oldFiles = localSpaceFiles.get(oldId);
          if (oldFiles) {
            localSpaceFiles.set(remote.id, oldFiles);
            localSpaceFiles.delete(oldId);
          }
        }
        // Either way, don't add as a new space
        changed = true;
        continue;
      }
      localSpaces.push({ ...remote });
      changed = true;
    } else {
      const remoteTime = remote.updatedAt || remote.createdAt;
      const localTime = local.updatedAt || local.createdAt;
      if (remoteTime > localTime) {
        local.name = remote.name;
        local.autoPin = remote.autoPin;
        local.updatedAt = remote.updatedAt;
        changed = true;
      }
    }
  }

  if (changed) {
    persistLocalSpaces();
    persistDeletedSpaceIds();
    persistLocalSpaceFiles();
    emitSpaces();
  }
  return changed;
}

// Remote space files only (files physically live on one device)
let remoteSpaceFiles: Map<string, Map<string, SpaceFile[]>> = new Map(); // peerId -> Map<spaceId, files>
let spacesListeners: ((spaces: Space[]) => void)[] = [];
let spaceFilesListeners: ((data: { spaceId: string; files: SpaceFile[] }) => void)[] = [];

// --- Saved peers (localStorage) ---
type SavedPeerEntry = { id: string; name: string; ip: string; port: number; platform: string };
let savedPeersMap = new Map<string, SavedPeerEntry>();
let savedPeersListeners: ((peers: SavedPeerEntry[]) => void)[] = [];

function loadSavedPeers() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVED_PEERS_KEY) || '[]');
    for (const p of data) savedPeersMap.set(p.id, p);
  } catch { /* empty */ }
}

function persistSavedPeers() {
  localStorage.setItem(SAVED_PEERS_KEY, JSON.stringify([...savedPeersMap.values()]));
  savedPeersListeners.forEach(cb => cb([...savedPeersMap.values()]));
}

function savePeerEntry(peer: Peer) {
  const existing = savedPeersMap.get(peer.id);
  if (existing && existing.ip === peer.ip && existing.port === peer.port && existing.name === peer.name) return;
  // Remove any old entry with the same IP (e.g., device got a new ID after reinstall)
  for (const [oldId, oldPeer] of savedPeersMap) {
    if (oldPeer.ip === peer.ip && oldId !== peer.id) {
      savedPeersMap.delete(oldId);
    }
  }
  savedPeersMap.set(peer.id, { id: peer.id, name: peer.name, ip: peer.ip, port: peer.port, platform: peer.platform });
  persistSavedPeers();
}

export function getSavedPeers(): SavedPeerEntry[] {
  return [...savedPeersMap.values()];
}

export function removeSavedPeer(peerId: string) {
  savedPeersMap.delete(peerId);
  persistSavedPeers();
  // Disconnect if connected
  const ws = connections.get(peerId);
  if (ws) {
    ws.close();
    connections.delete(peerId);
    remoteFiles.delete(peerId);
    emitPeers();
    emitFiles();
  }
}

export function onSavedPeersChange(cb: (peers: SavedPeerEntry[]) => void) {
  savedPeersListeners.push(cb);
}

// Store File objects for WS file transfer to desktop
const localFileBlobs = new Map<string, File>();

export function storeFileBlob(fileId: string, file: File) {
  localFileBlobs.set(fileId, file);
}

function getAllSpaces(): Space[] {
  return [...localSpaces];
}

function getAllSpaceFiles(spaceId: string): SpaceFile[] {
  const all: SpaceFile[] = [];
  // Local space files
  const local = localSpaceFiles.get(spaceId) || [];
  all.push(...local);
  // Remote space files
  for (const spaceMap of remoteSpaceFiles.values()) {
    const files = spaceMap.get(spaceId) || [];
    all.push(...files);
  }
  return all;
}

function emitSpaces() {
  const spaces = getAllSpaces();
  spacesListeners.forEach(cb => cb(spaces));
}

function emitSpaceFiles(spaceId: string) {
  const files = getAllSpaceFiles(spaceId);
  spaceFilesListeners.forEach(cb => cb({ spaceId, files }));
}

function getAllFiles(): SharedFile[] {
  const remote: SharedFile[] = [];
  for (const files of remoteFiles.values()) {
    remote.push(...files);
  }
  return [...localFilesList, ...remote];
}

function emitFiles() {
  notifyFiles(getAllFiles());
}

function emitPeers() {
  const peers: Peer[] = [];
  for (const [, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN && (ws as any)._peerInfo) {
      peers.push((ws as any)._peerInfo);
    }
  }
  notifyPeers(peers);
}

// --- WebSocket connection to a desktop peer ---

function connectToPeer(peer: Peer) {
  if (connections.has(peer.id)) return;

  const url = `ws://${peer.ip}:${peer.port}`;
  console.log(`[MobileNet] Connecting to ${peer.name} at ${url}`);

  const ws = new WebSocket(url);
  (ws as any)._peerInfo = peer;

  ws.onopen = () => {
    console.log(`[MobileNet] Connected to ${peer.name}`);
    connections.set(peer.id, ws);
    savePeerEntry(peer);
    emitPeers();

    // Send our file list + device info
    ws.send(JSON.stringify({
      type: 'file-list',
      deviceId,
      deviceName: 'Android Device',
      platform: 'android',
      files: localFilesList,
    }));

    // Send our space data (including tombstones for sync)
    ws.send(JSON.stringify({
      type: 'space-list',
      deviceId,
      spaces: localSpaces,
      deletedSpaceIds,
    }));
    for (const space of localSpaces) {
      const files = localSpaceFiles.get(space.id) || [];
      ws.send(JSON.stringify({
        type: 'space-file-list',
        deviceId,
        spaceId: space.id,
        files,
      }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      handlePeerMessage(peer.id, msg);
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    console.log(`[MobileNet] Disconnected from ${peer.name}`);
    connections.delete(peer.id);

    // Retain pinned/auto-pinned files as on-hold, drop the rest
    // Same logic as PC's _handlePeerDisconnect — devices are equal
    for (const [pid, spaceMap] of remoteSpaceFiles) {
      for (const [spaceId, files] of spaceMap) {
        const space = localSpaces.find(s => s.id === spaceId);
        const autoPin = space ? space.autoPin : false;

        const kept = files.filter(f => {
          if (f.pinned === false) return false;
          if (f.pinned === true) return true;
          return autoPin;
        }).map(f => ({ ...f, available: false }));

        if (kept.length > 0) {
          spaceMap.set(spaceId, kept);
        } else {
          spaceMap.delete(spaceId);
        }
      }
      if (spaceMap.size === 0) remoteSpaceFiles.delete(pid);
    }

    // Clear v1 flat files (no pin concept in v1)
    remoteFiles.clear();

    emitPeers();
    emitFiles();
    for (const space of localSpaces) {
      emitSpaceFiles(space.id);
    }
  };

  ws.onerror = () => {
    // onclose will fire
  };
}

function handlePeerMessage(peerId: string, msg: any) {
  switch (msg.type) {
    case 'file-list':
      remoteFiles.set(msg.deviceId || peerId, msg.files || []);
      emitFiles();
      break;
    case 'file-added':
      if (msg.file) {
        const files = remoteFiles.get(msg.deviceId || peerId) || [];
        files.push(msg.file);
        remoteFiles.set(msg.deviceId || peerId, files);
        emitFiles();
      }
      break;
    case 'file-removed':
      if (msg.fileId) {
        const files = remoteFiles.get(msg.deviceId || peerId) || [];
        remoteFiles.set(
          msg.deviceId || peerId,
          files.filter((f) => f.id !== msg.fileId)
        );
        emitFiles();
      }
      break;
    // --- v2 space messages (shared state — persisted locally) ---
    case 'space-list':
      mergeRemoteSpaces(msg.spaces || [], msg.deletedSpaceIds || []);
      break;
    case 'space-file-list':
      if (msg.spaceId) {
        const pid = msg.deviceId || peerId;
        if (!remoteSpaceFiles.has(pid)) remoteSpaceFiles.set(pid, new Map());
        remoteSpaceFiles.get(pid)!.set(msg.spaceId, (msg.files || []).map((f: SpaceFile) => ({ ...f, available: f.available !== false })));
        emitSpaceFiles(msg.spaceId);
      }
      break;
    case 'space-file-added':
      if (msg.spaceId && msg.file) {
        const pid = msg.deviceId || peerId;
        if (!remoteSpaceFiles.has(pid)) remoteSpaceFiles.set(pid, new Map());
        const map = remoteSpaceFiles.get(pid)!;
        const files = map.get(msg.spaceId) || [];
        files.push({ ...msg.file, available: true });
        map.set(msg.spaceId, files);
        emitSpaceFiles(msg.spaceId);
      }
      break;
    case 'space-file-removed':
      if (msg.spaceId && msg.fileId) {
        const pid = msg.deviceId || peerId;
        const map = remoteSpaceFiles.get(pid);
        if (map) {
          const files = map.get(msg.spaceId) || [];
          map.set(msg.spaceId, files.filter(f => f.id !== msg.fileId));
          emitSpaceFiles(msg.spaceId);
        }
      }
      break;
    case 'space-created':
      if (msg.space && !deletedSpaceIds.includes(msg.space.id) && !localSpaces.find(s => s.id === msg.space.id)) {
        localSpaces.push(msg.space);
        persistLocalSpaces();
        emitSpaces();
      }
      break;
    case 'space-updated':
      if (msg.spaceId) {
        const space = localSpaces.find(s => s.id === msg.spaceId);
        if (space) {
          if (msg.name !== undefined) space.name = msg.name;
          if (msg.autoPin !== undefined) space.autoPin = msg.autoPin;
          if (msg.updatedAt !== undefined) space.updatedAt = msg.updatedAt;
          persistLocalSpaces();
          emitSpaces();
        }
      }
      break;
    case 'space-deleted':
      if (msg.spaceId) {
        const pid = msg.deviceId || peerId;
        remoteSpaceFiles.get(pid)?.delete(msg.spaceId);
        localSpaces = localSpaces.filter(s => s.id !== msg.spaceId);
        localSpaceFiles.delete(msg.spaceId);
        if (!deletedSpaceIds.includes(msg.spaceId)) {
          deletedSpaceIds.push(msg.spaceId);
        }
        persistLocalSpaces();
        persistDeletedSpaceIds();
        persistLocalSpaceFiles();
        emitSpaces();
      }
      break;

    case 'file-request': {
      // Desktop is requesting a file from us — send it via WS chunks
      const ws = connections.get(peerId);
      if (!ws || ws.readyState !== WebSocket.OPEN) break;
      const file = localFileBlobs.get(msg.fileId);
      if (!file) {
        ws.send(JSON.stringify({
          type: 'file-transfer-error', fileId: msg.fileId, error: 'File not found',
        }));
        break;
      }
      sendFileViaWS(ws, msg.fileId, file);
      break;
    }
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return btoa(parts.join(''));
}

async function sendFileViaWS(ws: WebSocket, fileId: string, file: File) {
  try {
    const CHUNK_SIZE = 256 * 1024; // 256KB
    const buffer = await file.arrayBuffer();
    const total = buffer.byteLength;

    ws.send(JSON.stringify({
      type: 'file-transfer-start', fileId, fileName: file.name, size: total,
    }));

    let offset = 0;
    while (offset < total) {
      const end = Math.min(offset + CHUNK_SIZE, total);
      const chunk = new Uint8Array(buffer.slice(offset, end));
      ws.send(JSON.stringify({
        type: 'file-chunk', fileId, data: uint8ToBase64(chunk), offset, total,
      }));
      offset = end;
    }

    ws.send(JSON.stringify({ type: 'file-transfer-end', fileId }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'file-transfer-error', fileId, error: (err as Error).message || 'Failed to read file',
    }));
  }
}

// --- Subnet scanning for desktop peers ---

async function getLocalIP(): Promise<string> {
  // Use WebRTC to detect local IP
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const match = event.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (match) {
          pc.close();
          resolve(match[1]);
        }
      };
      // Fallback after timeout
      setTimeout(() => {
        pc.close();
        resolve('192.168.1.1'); // common fallback
      }, 2000);
    } catch {
      resolve('192.168.1.1');
    }
  });
}

function getSubnet(ip: string): string {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

async function scanForPeers() {
  const localIp = await getLocalIP();
  const subnet = getSubnet(localIp);
  console.log(`[MobileNet] Scanning subnet ${subnet}.* for Space peers...`);

  // Scan common IPs in parallel (batch of 20 at a time for performance)
  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (ip !== localIp) ips.push(ip);
  }

  // Scan in batches
  for (let batch = 0; batch < ips.length; batch += 30) {
    const chunk = ips.slice(batch, batch + 30);
    const promises = chunk.map((ip) => probeHost(ip));
    await Promise.all(promises);
  }
}

async function probeHost(ip: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT);

  try {
    const res = await fetch(`http://${ip}:${DISCOVERY_PORT}/space-discover`, {
      signal: controller.signal,
    });
    const data = await res.json();

    if (data.space && data.id && data.id !== deviceId) {
      console.log(`[MobileNet] Found peer: ${data.name} at ${ip}:${data.port}`);
      connectToPeer({
        id: data.id,
        name: data.name,
        ip,
        port: data.port,
        platform: data.platform,
      });
    }
  } catch {
    // Host not responding — expected for most IPs
  } finally {
    clearTimeout(timeout);
  }
}

// --- Broadcast to connected peers ---

function broadcastMessage(msg: any) {
  const data = JSON.stringify(msg);
  for (const ws of connections.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// --- Public API ---

export { connectToPeer };

export function initMobileNet(myDeviceId: string) {
  deviceId = myDeviceId;

  // Load local spaces + files + tombstones
  loadLocalSpaces();
  loadLocalSpaceFiles();
  loadDeletedSpaceIds();
  ensureDefaultSpace();

  // Load saved peers and try reconnecting first
  loadSavedPeers();
  for (const peer of savedPeersMap.values()) {
    if (peer.port > 0) {
      connectToPeer(peer);
    }
  }

  // Start scanning after a brief delay (give saved peers time to connect)
  setTimeout(() => {
    if (connections.size === 0) scanForPeers();
  }, 2000);

  scanTimer = setInterval(() => {
    if (connections.size === 0) {
      scanForPeers();
    }
  }, RESCAN_INTERVAL);
}

export function setLocalFiles(files: SharedFile[]) {
  localFilesList = files;
  emitFiles();
}

export function addLocalFile(file: SharedFile) {
  localFilesList.push(file);
  emitFiles();
  broadcastMessage({
    type: 'file-added',
    deviceId,
    file,
  });
}

export function removeLocalFile(fileId: string) {
  localFilesList = localFilesList.filter((f) => f.id !== fileId);
  localFileBlobs.delete(fileId);
  emitFiles();
  broadcastMessage({
    type: 'file-removed',
    deviceId,
    fileId,
  });
}

export function getMobileSpaces(): Space[] {
  return getAllSpaces();
}

export function getMobileSpaceFiles(spaceId: string): SpaceFile[] {
  return getAllSpaceFiles(spaceId);
}

export function onMobileSpacesUpdate(cb: (spaces: Space[]) => void) {
  spacesListeners.push(cb);
}

export function onMobileSpaceFilesUpdate(cb: (data: { spaceId: string; files: SpaceFile[] }) => void) {
  spaceFilesListeners.push(cb);
}

// --- Mobile space CRUD ---

export function mobileCreateSpace(name: string): Space {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const space: Space = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    createdBy: deviceId,
    autoPin: true,
  };
  localSpaces.push(space);
  persistLocalSpaces();
  emitSpaces();
  broadcastMessage({ type: 'space-created', deviceId, space });
  return space;
}

export function mobileDeleteSpace(spaceId: string) {
  localSpaces = localSpaces.filter(s => s.id !== spaceId);
  localSpaceFiles.delete(spaceId);
  if (!deletedSpaceIds.includes(spaceId)) {
    deletedSpaceIds.push(spaceId);
  }
  persistLocalSpaces();
  persistDeletedSpaceIds();
  persistLocalSpaceFiles();
  emitSpaces();
  broadcastMessage({ type: 'space-deleted', deviceId, spaceId });
}

export function mobileRenameSpace(spaceId: string, newName: string) {
  const space = localSpaces.find(s => s.id === spaceId);
  if (space) {
    space.name = newName;
    const updatedAt = Date.now();
    space.updatedAt = updatedAt;
    persistLocalSpaces();
    emitSpaces();
    broadcastMessage({ type: 'space-updated', deviceId, spaceId, name: newName, updatedAt });
  }
}

export function mobileSetSpaceAutoPin(spaceId: string, autoPin: boolean) {
  const space = localSpaces.find(s => s.id === spaceId);
  if (space) {
    space.autoPin = autoPin;
    const updatedAt = Date.now();
    space.updatedAt = updatedAt;
    persistLocalSpaces();
    emitSpaces();
    broadcastMessage({ type: 'space-updated', deviceId, spaceId, autoPin, updatedAt });
  }
}

export function mobileAddFileToSpace(spaceId: string, file: SpaceFile) {
  const files = localSpaceFiles.get(spaceId) || [];
  files.push(file);
  localSpaceFiles.set(spaceId, files);
  persistLocalSpaceFiles();
  emitSpaceFiles(spaceId);
  broadcastMessage({ type: 'space-file-added', deviceId, spaceId, file });
}

export function mobileRemoveFileFromSpace(spaceId: string, fileId: string) {
  const files = localSpaceFiles.get(spaceId) || [];
  localSpaceFiles.set(spaceId, files.filter(f => f.id !== fileId));
  persistLocalSpaceFiles();
  emitSpaceFiles(spaceId);
  broadcastMessage({ type: 'space-file-removed', deviceId, spaceId, fileId });
}

export function stopMobileNet() {
  if (scanTimer) clearInterval(scanTimer);
  for (const ws of connections.values()) {
    ws.close();
  }
  connections.clear();
  remoteFiles.clear();
}

// --- PIN-based peer discovery ---

const PAIR_PORT = 52384;

async function probePairEndpoint(ip: string, pin: string): Promise<{ ip: string; port: number; id: string; name: string; platform: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`http://${ip}:${PAIR_PORT}/space-pair?pin=${pin}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.space && data.id) {
        return { ip, port: data.port, id: data.id, name: data.name || 'Desktop', platform: data.platform || 'win32' };
      }
    }
  } catch {
    // Expected for most IPs
  } finally {
    clearTimeout(timeout);
  }
  return null;
}

export async function findPeerByPin(pin: string): Promise<{ ip: string; port: number; id: string; name: string; platform: string } | null> {
  // 1. Check saved peers first (instant if one matches)
  const savedIps = [...savedPeersMap.values()].map(p => p.ip);
  if (savedIps.length > 0) {
    const savedResults = await Promise.all(savedIps.map(ip => probePairEndpoint(ip, pin)));
    const savedMatch = savedResults.find(r => r !== null);
    if (savedMatch) return savedMatch;
  }

  // 2. Full subnet scan
  const localIp = await getLocalIP();
  const subnet = getSubnet(localIp);
  const scannedIps = new Set(savedIps);

  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (!scannedIps.has(ip)) ips.push(ip);
  }

  for (let batch = 0; batch < ips.length; batch += 50) {
    const chunk = ips.slice(batch, batch + 50);
    const results = await Promise.all(chunk.map(ip => probePairEndpoint(ip, pin)));
    const match = results.find(r => r !== null);
    if (match) return match;
  }

  return null;
}
