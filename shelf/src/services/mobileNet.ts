import type { Peer, SharedFile, Shelf, ShelfFile } from '@/types';
import { notifyPeers, notifyFiles } from './platform';

const DISCOVERY_PORT = 52384;
const SCAN_TIMEOUT = 1500;
const RESCAN_INTERVAL = 5000;
const SAVED_PEERS_KEY = 'shelf-known-peers';

type RemoteFiles = Map<string, SharedFile[]>;

let deviceId = '';
let localFilesList: SharedFile[] = [];
let remoteFiles: RemoteFiles = new Map();
let connections: Map<string, WebSocket> = new Map();
let scanTimer: ReturnType<typeof setInterval> | null = null;

// --- Local shelf state (persisted in localStorage) ---
const SHELVES_KEY = 'shelf-local-shelves';
const SHELF_FILES_KEY = 'shelf-local-shelf-files';

let localShelves: Shelf[] = [];
let localShelfFiles: Map<string, ShelfFile[]> = new Map(); // shelfId -> files

function loadLocalShelves() {
  try {
    const data = JSON.parse(localStorage.getItem(SHELVES_KEY) || '[]');
    localShelves = data;
  } catch { localShelves = []; }
}

function persistLocalShelves() {
  localStorage.setItem(SHELVES_KEY, JSON.stringify(localShelves));
}

function loadLocalShelfFiles() {
  try {
    const data = JSON.parse(localStorage.getItem(SHELF_FILES_KEY) || '{}');
    localShelfFiles = new Map(Object.entries(data));
  } catch { localShelfFiles = new Map(); }
}

function persistLocalShelfFiles() {
  const obj: Record<string, ShelfFile[]> = {};
  for (const [k, v] of localShelfFiles) obj[k] = v;
  localStorage.setItem(SHELF_FILES_KEY, JSON.stringify(obj));
}

// Deletion tombstones (persisted forever)
const DELETED_SHELVES_KEY = 'shelf-deleted-shelf-ids';
let deletedShelfIds: string[] = [];

function loadDeletedShelfIds() {
  try {
    deletedShelfIds = JSON.parse(localStorage.getItem(DELETED_SHELVES_KEY) || '[]');
  } catch { deletedShelfIds = []; }
}

function persistDeletedShelfIds() {
  localStorage.setItem(DELETED_SHELVES_KEY, JSON.stringify(deletedShelfIds));
}

function ensureDefaultShelf() {
  if (localShelves.length === 0) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const now = Date.now();
    localShelves.push({
      id,
      name: 'General',
      createdAt: now,
      updatedAt: now,
      createdBy: deviceId || 'mobile',
      autoPin: true,
    });
    persistLocalShelves();
  }
}

/** Merge a peer's shelf list + their deleted IDs into our local state. */
function mergeRemoteShelves(remoteShelves: Shelf[], remoteDeletedIds: string[] = []) {
  let changed = false;

  // 1. Apply remote deletions locally
  for (const id of remoteDeletedIds) {
    const idx = localShelves.findIndex(s => s.id === id);
    if (idx !== -1) {
      localShelves.splice(idx, 1);
      localShelfFiles.delete(id);
      changed = true;
    }
    if (!deletedShelfIds.includes(id)) {
      deletedShelfIds.push(id);
      changed = true;
    }
  }

  // 2. Add/update shelves from remote (skip tombstoned)
  for (const remote of remoteShelves) {
    if (deletedShelfIds.includes(remote.id)) continue;

    const local = localShelves.find(s => s.id === remote.id);
    if (!local) {
      // Check for duplicate by name (e.g., both devices created "General" independently)
      const localByName = localShelves.find(s => s.name === remote.name);
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
          const oldFiles = localShelfFiles.get(oldId);
          if (oldFiles) {
            localShelfFiles.set(remote.id, oldFiles);
            localShelfFiles.delete(oldId);
          }
        }
        // Either way, don't add as a new shelf
        changed = true;
        continue;
      }
      localShelves.push({ ...remote });
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
    persistLocalShelves();
    persistDeletedShelfIds();
    persistLocalShelfFiles();
    emitShelves();
  }
  return changed;
}

// Remote shelf files only (files physically live on one device)
let remoteShelfFiles: Map<string, Map<string, ShelfFile[]>> = new Map(); // peerId -> Map<shelfId, files>
let shelvesListeners: ((shelves: Shelf[]) => void)[] = [];
let shelfFilesListeners: ((data: { shelfId: string; files: ShelfFile[] }) => void)[] = [];

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

function getAllShelves(): Shelf[] {
  return [...localShelves];
}

function getAllShelfFiles(shelfId: string): ShelfFile[] {
  const all: ShelfFile[] = [];
  // Local shelf files
  const local = localShelfFiles.get(shelfId) || [];
  all.push(...local);
  // Remote shelf files
  for (const shelfMap of remoteShelfFiles.values()) {
    const files = shelfMap.get(shelfId) || [];
    all.push(...files);
  }
  return all;
}

function emitShelves() {
  const shelves = getAllShelves();
  shelvesListeners.forEach(cb => cb(shelves));
}

function emitShelfFiles(shelfId: string) {
  const files = getAllShelfFiles(shelfId);
  shelfFilesListeners.forEach(cb => cb({ shelfId, files }));
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

    // Send our shelf data (including tombstones for sync)
    ws.send(JSON.stringify({
      type: 'shelf-list',
      deviceId,
      shelves: localShelves,
      deletedShelfIds,
    }));
    for (const shelf of localShelves) {
      const files = localShelfFiles.get(shelf.id) || [];
      ws.send(JSON.stringify({
        type: 'shelf-file-list',
        deviceId,
        shelfId: shelf.id,
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
    for (const [pid, shelfMap] of remoteShelfFiles) {
      for (const [shelfId, files] of shelfMap) {
        const shelf = localShelves.find(s => s.id === shelfId);
        const autoPin = shelf ? shelf.autoPin : false;

        const kept = files.filter(f => {
          if (f.pinned === false) return false;
          if (f.pinned === true) return true;
          return autoPin;
        }).map(f => ({ ...f, available: false }));

        if (kept.length > 0) {
          shelfMap.set(shelfId, kept);
        } else {
          shelfMap.delete(shelfId);
        }
      }
      if (shelfMap.size === 0) remoteShelfFiles.delete(pid);
    }

    // Clear v1 flat files (no pin concept in v1)
    remoteFiles.clear();

    emitPeers();
    emitFiles();
    for (const shelf of localShelves) {
      emitShelfFiles(shelf.id);
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
    // --- v2 shelf messages (shared state — persisted locally) ---
    case 'shelf-list':
      mergeRemoteShelves(msg.shelves || [], msg.deletedShelfIds || []);
      break;
    case 'shelf-file-list':
      if (msg.shelfId) {
        const pid = msg.deviceId || peerId;
        if (!remoteShelfFiles.has(pid)) remoteShelfFiles.set(pid, new Map());
        remoteShelfFiles.get(pid)!.set(msg.shelfId, (msg.files || []).map((f: ShelfFile) => ({ ...f, available: f.available !== false })));
        emitShelfFiles(msg.shelfId);
      }
      break;
    case 'shelf-file-added':
      if (msg.shelfId && msg.file) {
        const pid = msg.deviceId || peerId;
        if (!remoteShelfFiles.has(pid)) remoteShelfFiles.set(pid, new Map());
        const map = remoteShelfFiles.get(pid)!;
        const files = map.get(msg.shelfId) || [];
        files.push({ ...msg.file, available: true });
        map.set(msg.shelfId, files);
        emitShelfFiles(msg.shelfId);
      }
      break;
    case 'shelf-file-removed':
      if (msg.shelfId && msg.fileId) {
        const pid = msg.deviceId || peerId;
        const map = remoteShelfFiles.get(pid);
        if (map) {
          const files = map.get(msg.shelfId) || [];
          map.set(msg.shelfId, files.filter(f => f.id !== msg.fileId));
          emitShelfFiles(msg.shelfId);
        }
      }
      break;
    case 'shelf-created':
      if (msg.shelf && !deletedShelfIds.includes(msg.shelf.id) && !localShelves.find(s => s.id === msg.shelf.id)) {
        localShelves.push(msg.shelf);
        persistLocalShelves();
        emitShelves();
      }
      break;
    case 'shelf-updated':
      if (msg.shelfId) {
        const shelf = localShelves.find(s => s.id === msg.shelfId);
        if (shelf) {
          if (msg.name !== undefined) shelf.name = msg.name;
          if (msg.autoPin !== undefined) shelf.autoPin = msg.autoPin;
          if (msg.updatedAt !== undefined) shelf.updatedAt = msg.updatedAt;
          persistLocalShelves();
          emitShelves();
        }
      }
      break;
    case 'shelf-deleted':
      if (msg.shelfId) {
        const pid = msg.deviceId || peerId;
        remoteShelfFiles.get(pid)?.delete(msg.shelfId);
        localShelves = localShelves.filter(s => s.id !== msg.shelfId);
        localShelfFiles.delete(msg.shelfId);
        if (!deletedShelfIds.includes(msg.shelfId)) {
          deletedShelfIds.push(msg.shelfId);
        }
        persistLocalShelves();
        persistDeletedShelfIds();
        persistLocalShelfFiles();
        emitShelves();
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
  console.log(`[MobileNet] Scanning subnet ${subnet}.* for Shelf peers...`);

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
    const res = await fetch(`http://${ip}:${DISCOVERY_PORT}/shelf-discover`, {
      signal: controller.signal,
    });
    const data = await res.json();

    if (data.shelf && data.id && data.id !== deviceId) {
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

  // Load local shelves + files + tombstones
  loadLocalShelves();
  loadLocalShelfFiles();
  loadDeletedShelfIds();
  ensureDefaultShelf();

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

export function getMobileShelves(): Shelf[] {
  return getAllShelves();
}

export function getMobileShelfFiles(shelfId: string): ShelfFile[] {
  return getAllShelfFiles(shelfId);
}

export function onMobileShelvesUpdate(cb: (shelves: Shelf[]) => void) {
  shelvesListeners.push(cb);
}

export function onMobileShelfFilesUpdate(cb: (data: { shelfId: string; files: ShelfFile[] }) => void) {
  shelfFilesListeners.push(cb);
}

// --- Mobile shelf CRUD ---

export function mobileCreateShelf(name: string): Shelf {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const shelf: Shelf = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    createdBy: deviceId,
    autoPin: true,
  };
  localShelves.push(shelf);
  persistLocalShelves();
  emitShelves();
  broadcastMessage({ type: 'shelf-created', deviceId, shelf });
  return shelf;
}

export function mobileDeleteShelf(shelfId: string) {
  localShelves = localShelves.filter(s => s.id !== shelfId);
  localShelfFiles.delete(shelfId);
  if (!deletedShelfIds.includes(shelfId)) {
    deletedShelfIds.push(shelfId);
  }
  persistLocalShelves();
  persistDeletedShelfIds();
  persistLocalShelfFiles();
  emitShelves();
  broadcastMessage({ type: 'shelf-deleted', deviceId, shelfId });
}

export function mobileRenameShelf(shelfId: string, newName: string) {
  const shelf = localShelves.find(s => s.id === shelfId);
  if (shelf) {
    shelf.name = newName;
    const updatedAt = Date.now();
    shelf.updatedAt = updatedAt;
    persistLocalShelves();
    emitShelves();
    broadcastMessage({ type: 'shelf-updated', deviceId, shelfId, name: newName, updatedAt });
  }
}

export function mobileSetShelfAutoPin(shelfId: string, autoPin: boolean) {
  const shelf = localShelves.find(s => s.id === shelfId);
  if (shelf) {
    shelf.autoPin = autoPin;
    const updatedAt = Date.now();
    shelf.updatedAt = updatedAt;
    persistLocalShelves();
    emitShelves();
    broadcastMessage({ type: 'shelf-updated', deviceId, shelfId, autoPin, updatedAt });
  }
}

export function mobileAddFileToShelf(shelfId: string, file: ShelfFile) {
  const files = localShelfFiles.get(shelfId) || [];
  files.push(file);
  localShelfFiles.set(shelfId, files);
  persistLocalShelfFiles();
  emitShelfFiles(shelfId);
  broadcastMessage({ type: 'shelf-file-added', deviceId, shelfId, file });
}

export function mobileRemoveFileFromShelf(shelfId: string, fileId: string) {
  const files = localShelfFiles.get(shelfId) || [];
  localShelfFiles.set(shelfId, files.filter(f => f.id !== fileId));
  persistLocalShelfFiles();
  emitShelfFiles(shelfId);
  broadcastMessage({ type: 'shelf-file-removed', deviceId, shelfId, fileId });
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
    const res = await fetch(`http://${ip}:${PAIR_PORT}/shelf-pair?pin=${pin}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.shelf && data.id) {
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
