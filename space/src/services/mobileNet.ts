import type { Peer, Space, SpaceFile } from '@/types';
import { notifyPeers } from './platform';
import { SpaceServer } from 'capacitor-space-server';

const SAVED_PEERS_KEY = 'space-known-peers';
const PAIR_PORT = 52384;

let deviceId = '';
let serverPort = 0;

// Outgoing WS connections (browser WebSocket → remote peer's server)
let connections: Map<string, WebSocket> = new Map();

// Incoming WS clients (remote peers connected to OUR native server)
const incomingClients = new Map<string, {
  clientId: string;
  peerId?: string;
  peerInfo?: Peer;
  remoteAddress: string;
}>();

// --- Local space state (persisted in localStorage) ---
const SPACES_KEY = 'space-local-spaces';
const SPACE_FILES_KEY = 'space-local-space-files';

let localSpaces: Space[] = [];
let localSpaceFiles: Map<string, SpaceFile[]> = new Map();

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

// Deletion tombstones
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

function mergeRemoteSpaces(remoteSpaces: Space[], remoteDeletedIds: string[] = []) {
  let changed = false;

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

  for (const remote of remoteSpaces) {
    if (deletedSpaceIds.includes(remote.id)) continue;

    const local = localSpaces.find(s => s.id === remote.id);
    if (!local) {
      const localByName = localSpaces.find(s => s.name === remote.name);
      if (localByName) {
        const localTime = localByName.updatedAt || localByName.createdAt;
        const remoteTime = remote.updatedAt || remote.createdAt;
        if (remoteTime < localTime) {
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
    // Emit files for all spaces so UI gets data under the correct (merged) IDs
    for (const space of localSpaces) {
      emitSpaceFiles(space.id);
    }
  }
  return changed;
}

// Remote space files (peerId -> Map<spaceId, files>)
let remoteSpaceFiles: Map<string, Map<string, SpaceFile[]>> = new Map();
let spacesListeners: ((spaces: Space[]) => void)[] = [];
let spaceFilesListeners: ((data: { spaceId: string; files: SpaceFile[] }) => void)[] = [];

// --- Saved peers ---
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
  // Map is keyed by deviceId — same device naturally overwrites its old entry.
  // No IP/name-based dedup: multiple devices can share the same IP and hostname
  // (e.g., two instances on the same machine).
  savedPeersMap.set(peer.id, { id: peer.id, name: peer.name, ip: peer.ip, port: peer.port, platform: peer.platform });
  persistSavedPeers();
}

export function getSavedPeers(): SavedPeerEntry[] {
  return [...savedPeersMap.values()];
}

export function removeSavedPeer(peerId: string) {
  savedPeersMap.delete(peerId);
  persistSavedPeers();
  const ws = connections.get(peerId);
  if (ws) {
    ws.close();
    connections.delete(peerId);
    emitPeers();
  }
}

export function onSavedPeersChange(cb: (peers: SavedPeerEntry[]) => void) {
  savedPeersListeners.push(cb);
}

// --- Helpers ---

function getAllSpaces(): Space[] {
  return [...localSpaces];
}

function getAllSpaceFiles(spaceId: string): SpaceFile[] {
  const all: SpaceFile[] = [];
  const local = localSpaceFiles.get(spaceId) || [];
  all.push(...local);
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

function emitPeers() {
  const peers: Peer[] = [];
  // Outgoing connections
  for (const [, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN && (ws as any)._peerInfo) {
      peers.push((ws as any)._peerInfo);
    }
  }
  // Incoming connections — use peerInfo stored at handshake time
  for (const client of incomingClients.values()) {
    if (client.peerInfo) {
      peers.push(client.peerInfo);
    }
  }
  notifyPeers(peers);
}

// --- Outgoing WebSocket connection to a peer ---

function connectToPeer(peer: Peer) {
  if (connections.has(peer.id)) return;
  // Don't connect outgoing if they already connected to us (incoming)
  for (const client of incomingClients.values()) {
    if (client.peerId === peer.id) return;
  }

  const url = `ws://${peer.ip}:${peer.port}`;
  console.log(`[MobileNet] Connecting to ${peer.name} at ${url}`);

  const ws = new WebSocket(url);
  (ws as any)._peerInfo = peer;

  ws.onopen = () => {
    console.log(`[MobileNet] Connected to ${peer.name}`);
    connections.set(peer.id, ws);
    savePeerEntry(peer);
    emitPeers();

    ws.send(JSON.stringify({
      type: 'handshake',
      deviceId,
      deviceName: 'Android Device',
      platform: 'android',
      port: serverPort,
    }));

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

    // Send peer list so this peer can connect to others in the mesh
    sendPeerListTo(ws, peer.id);
    broadcastPeerList();
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
    // Only treat as full peer disconnect if no incoming client is connected from this peer
    const hasIncoming = Array.from(incomingClients.values()).some(c => c.peerId === peer.id);
    if (!hasIncoming) {
      handlePeerDisconnect(peer.id);
    } else {
      emitPeers(); // Update peer count but keep files
    }
  };

  ws.onerror = () => {
    // onclose will fire
  };
}

// --- Incoming WebSocket clients (peers connecting to our native server) ---

function handleIncomingClientMessage(clientId: string, rawMessage: string) {
  const client = incomingClients.get(clientId);
  if (!client) return;

  let msg: any;
  try {
    msg = JSON.parse(rawMessage);
  } catch { return; }

  if (msg.type === 'handshake') {
    client.peerId = msg.deviceId;
    const peerInfo: Peer = {
      id: msg.deviceId,
      name: msg.deviceName || 'Unknown',
      ip: client.remoteAddress,
      port: msg.port || 0,
      platform: msg.platform || 'unknown',
    };
    client.peerInfo = peerInfo;
    savePeerEntry(peerInfo);

    // Send our handshake back
    SpaceServer.sendToClient({
      clientId,
      message: JSON.stringify({
        type: 'handshake',
        deviceId,
        deviceName: 'Android Device',
        platform: 'android',
        port: serverPort,
      }),
    });

    // Send our space data
    SpaceServer.sendToClient({
      clientId,
      message: JSON.stringify({
        type: 'space-list',
        deviceId,
        spaces: localSpaces,
        deletedSpaceIds,
      }),
    });
    for (const space of localSpaces) {
      const files = localSpaceFiles.get(space.id) || [];
      SpaceServer.sendToClient({
        clientId,
        message: JSON.stringify({
          type: 'space-file-list',
          deviceId,
          spaceId: space.id,
          files,
        }),
      });
    }

    // Send peer list so this peer can connect to others in the mesh
    sendPeerListToClient(clientId, msg.deviceId);
    broadcastPeerList();

    emitPeers();
    return;
  }

  if (client.peerId) {
    handlePeerMessage(client.peerId, msg);
  }
}

function handleIncomingClientDisconnect(clientId: string) {
  const client = incomingClients.get(clientId);
  incomingClients.delete(clientId);
  if (client?.peerId) {
    // Only treat as full peer disconnect if no other active connection exists
    const hasOutgoing = connections.has(client.peerId);
    const hasOtherIncoming = Array.from(incomingClients.values()).some(c => c.peerId === client.peerId);
    if (!hasOutgoing && !hasOtherIncoming) {
      handlePeerDisconnect(client.peerId);
    } else {
      emitPeers(); // Update peer count but keep files
    }
  }
}

// --- Peer space list tracking (for spaceId resolution) ---
const peerSpacesMap = new Map<string, Space[]>(); // peerId → last-known space list

/**
 * Map a remote peer's spaceId to our local spaceId.
 * If the remote uses a different ID for the same space (matched by name),
 * return our local ID so files are stored correctly.
 */
function resolveSpaceId(peerId: string, remoteSpaceId: string): string {
  // Direct match — most common case (IDs already converged)
  if (localSpaces.find(s => s.id === remoteSpaceId)) return remoteSpaceId;
  // No direct match — look up the space name in peer's last space-list
  const peerSpaces = peerSpacesMap.get(peerId) || [];
  const remoteSpace = peerSpaces.find(s => s.id === remoteSpaceId);
  if (remoteSpace) {
    const localMatch = localSpaces.find(s => s.name === remoteSpace.name);
    if (localMatch) return localMatch.id;
  }
  // Fallback: use raw remote ID
  return remoteSpaceId;
}

// --- Shared peer message handler ---

function handlePeerMessage(peerId: string, msg: any) {
  switch (msg.type) {
    case 'space-list': {
      // Store peer's space list for spaceId resolution
      peerSpacesMap.set(msg.deviceId || peerId, msg.spaces || []);
      const changed = mergeRemoteSpaces(msg.spaces || [], msg.deletedSpaceIds || []);
      if (changed) {
        // Re-send our space data with corrected (merged) IDs to all peers
        sendSpaceDataToAllPeers();
      }
      break;
    }
    case 'space-file-list':
      if (msg.spaceId) {
        const pid = msg.deviceId || peerId;
        const resolvedId = resolveSpaceId(pid, msg.spaceId);
        if (!remoteSpaceFiles.has(pid)) remoteSpaceFiles.set(pid, new Map());
        remoteSpaceFiles.get(pid)!.set(resolvedId, (msg.files || []).map((f: SpaceFile) => ({ ...f, available: f.available !== false })));
        emitSpaceFiles(resolvedId);
      }
      break;
    case 'space-file-added':
      if (msg.spaceId && msg.file) {
        const pid = msg.deviceId || peerId;
        const resolvedId = resolveSpaceId(pid, msg.spaceId);
        if (!remoteSpaceFiles.has(pid)) remoteSpaceFiles.set(pid, new Map());
        const map = remoteSpaceFiles.get(pid)!;
        const files = map.get(resolvedId) || [];
        // Dedup by file ID — dual WS paths can deliver the same event twice
        if (!files.some(f => f.id === msg.file.id)) {
          files.push({ ...msg.file, available: true });
          map.set(resolvedId, files);
          emitSpaceFiles(resolvedId);
        }
      }
      break;
    case 'space-file-removed':
      if (msg.spaceId && msg.fileId) {
        const pid = msg.deviceId || peerId;
        const resolvedId = resolveSpaceId(pid, msg.spaceId);
        const map = remoteSpaceFiles.get(pid);
        if (map) {
          const files = map.get(resolvedId) || [];
          map.set(resolvedId, files.filter(f => f.id !== msg.fileId));
          emitSpaceFiles(resolvedId);
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
    case 'peer-list':
      if (msg.peers && Array.isArray(msg.peers)) {
        for (const p of msg.peers) {
          if (p.id && p.id !== deviceId && !connections.has(p.id) && p.port > 0) {
            // Check incoming clients too
            let alreadyIncoming = false;
            for (const client of incomingClients.values()) {
              if (client.peerId === p.id) { alreadyIncoming = true; break; }
            }
            if (!alreadyIncoming) {
              console.log(`[MobileNet] Peer exchange: discovered ${p.name} (${p.ip}:${p.port})`);
              connectToPeer(p);
            }
          }
        }
      }
      break;
    case 'request-space-data':
      sendSpaceDataToPeer(peerId);
      break;
  }
}

function handlePeerDisconnect(peerId: string) {
  for (const [pid, spaceMap] of remoteSpaceFiles) {
    if (pid !== peerId) continue;
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

  emitPeers();
  for (const space of localSpaces) {
    emitSpaceFiles(space.id);
  }
}

// --- Broadcast to ALL connected peers (outgoing + incoming) ---

function broadcastMessage(msg: any) {
  const data = JSON.stringify(msg);

  // Outgoing connections (browser WebSocket)
  for (const ws of connections.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  // Incoming connections (native WS server clients)
  if (incomingClients.size > 0) {
    SpaceServer.broadcastMessage({ message: data });
  }
}

// --- Re-send space data helpers ---

function sendSpaceDataToOutgoingWs(ws: WebSocket) {
  ws.send(JSON.stringify({
    type: 'space-list',
    deviceId,
    spaces: localSpaces,
    deletedSpaceIds,
  }));
  for (const space of localSpaces) {
    ws.send(JSON.stringify({
      type: 'space-file-list',
      deviceId,
      spaceId: space.id,
      files: localSpaceFiles.get(space.id) || [],
    }));
  }
}

function sendSpaceDataToIncomingClient(clientId: string) {
  SpaceServer.sendToClient({
    clientId,
    message: JSON.stringify({
      type: 'space-list',
      deviceId,
      spaces: localSpaces,
      deletedSpaceIds,
    }),
  });
  for (const space of localSpaces) {
    SpaceServer.sendToClient({
      clientId,
      message: JSON.stringify({
        type: 'space-file-list',
        deviceId,
        spaceId: space.id,
        files: localSpaceFiles.get(space.id) || [],
      }),
    });
  }
}

function sendSpaceDataToPeer(peerId: string) {
  // Check outgoing connections
  const ws = connections.get(peerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendSpaceDataToOutgoingWs(ws);
    return;
  }
  // Check incoming clients
  for (const client of incomingClients.values()) {
    if (client.peerId === peerId) {
      sendSpaceDataToIncomingClient(client.clientId);
      return;
    }
  }
}

function sendSpaceDataToAllPeers() {
  for (const [, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      sendSpaceDataToOutgoingWs(ws);
    }
  }
  for (const client of incomingClients.values()) {
    if (client.peerId) {
      sendSpaceDataToIncomingClient(client.clientId);
    }
  }
}

// --- Peer exchange (gossip) helpers ---

function getKnownPeers(): { id: string; name: string; ip: string; port: number; platform: string }[] {
  const peers: { id: string; name: string; ip: string; port: number; platform: string }[] = [];

  // Outgoing connections
  for (const [, ws] of connections) {
    const info = (ws as any)._peerInfo;
    if (info) peers.push({ id: info.id, name: info.name, ip: info.ip, port: info.port, platform: info.platform });
  }

  // Incoming connections (only those that completed handshake and have a known port)
  for (const client of incomingClients.values()) {
    if (client.peerInfo && client.peerInfo.port > 0) {
      const p = client.peerInfo;
      peers.push({ id: p.id, name: p.name, ip: p.ip, port: p.port, platform: p.platform });
    }
  }

  return peers;
}

function sendPeerListTo(ws: WebSocket, excludePeerId: string) {
  const peers = getKnownPeers().filter(p => p.id !== excludePeerId);
  if (peers.length === 0) return;
  ws.send(JSON.stringify({ type: 'peer-list', deviceId, peers }));
}

function sendPeerListToClient(clientId: string, excludePeerId: string) {
  const peers = getKnownPeers().filter(p => p.id !== excludePeerId);
  if (peers.length === 0) return;
  SpaceServer.sendToClient({
    clientId,
    message: JSON.stringify({ type: 'peer-list', deviceId, peers }),
  });
}

function broadcastPeerList() {
  // Send to each outgoing connection
  for (const [peerId, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      sendPeerListTo(ws, peerId);
    }
  }

  // Send to each incoming client
  for (const client of incomingClients.values()) {
    if (client.peerId) {
      sendPeerListToClient(client.clientId, client.peerId);
    }
  }
}

// --- Public API ---

export { connectToPeer };

export async function initMobileNet(myDeviceId: string) {
  deviceId = myDeviceId;

  loadLocalSpaces();
  loadLocalSpaceFiles();
  loadDeletedSpaceIds();
  ensureDefaultSpace();
  loadSavedPeers();

  // Start native HTTP+WS server + mDNS
  try {
    const result = await SpaceServer.startServer({
      deviceId: myDeviceId,
      deviceName: 'Android Device',
      platform: 'android',
    });
    serverPort = result.port;
    console.log(`[MobileNet] Native server started on port ${serverPort}`);

    // Update discovery info with our spaces
    await SpaceServer.setDiscoveryInfo({ spaces: localSpaces });

    // Register all existing local files with the HTTP server
    for (const [, files] of localSpaceFiles) {
      for (const file of files) {
        if (file.localPath) {
          await SpaceServer.registerFile({
            fileId: file.id,
            filePath: file.localPath,
            fileName: file.name,
            mimeType: file.mimeType || 'application/octet-stream',
          });
        }
      }
    }

    // Start mDNS browsing
    await SpaceServer.startDiscovery();

    // Listen for mDNS-discovered peers
    SpaceServer.addListener('peerFound', (peer) => {
      if (peer.id === deviceId) return;
      console.log(`[MobileNet] mDNS peer found: ${peer.name} (${peer.ip}:${peer.port})`);
      // Delay slightly — when a peer connects to us (incoming), its handshake
      // hasn't arrived yet when mDNS fires. Without the delay, connectToPeer's
      // incoming-client check can't match by peerId, causing dual connections.
      setTimeout(() => connectToPeer(peer), 1500);
    });

    SpaceServer.addListener('peerLost', (event) => {
      console.log(`[MobileNet] mDNS peer lost: ${event.id}`);
      // Don't close active WS connections — mDNS can report peers as lost
      // spuriously while the TCP connection is still healthy.
      // Let the WS connection's own close event handle actual disconnects.
    });

    // Listen for incoming WS connections
    SpaceServer.addListener('wsClientConnected', (event) => {
      console.log(`[MobileNet] Incoming WS client: ${event.clientId} from ${event.remoteAddress}`);
      incomingClients.set(event.clientId, {
        clientId: event.clientId,
        remoteAddress: event.remoteAddress,
      });
    });

    SpaceServer.addListener('wsMessage', (event) => {
      handleIncomingClientMessage(event.clientId, event.message);
    });

    SpaceServer.addListener('wsClientDisconnected', (event) => {
      console.log(`[MobileNet] Incoming WS client disconnected: ${event.clientId}`);
      handleIncomingClientDisconnect(event.clientId);
    });
  } catch (err) {
    console.error('[MobileNet] Failed to start native server:', err);
  }

  // Try reconnecting to saved peers
  for (const peer of savedPeersMap.values()) {
    if (peer.port > 0) {
      connectToPeer(peer);
    }
  }

  // Delayed re-emit: peers may connect and send space data before UI listeners
  // are registered (Capacitor bridge async import timing). Re-emit all state
  // after a short delay to ensure the UI catches everything.
  setTimeout(() => {
    emitSpaces();
    for (const space of localSpaces) {
      emitSpaceFiles(space.id);
    }
  }, 2000);
}

export function getServerPort(): number {
  return serverPort;
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
  SpaceServer.setDiscoveryInfo({ spaces: localSpaces });
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
  SpaceServer.setDiscoveryInfo({ spaces: localSpaces });
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
  // Prevent duplicate: same file name+size already in this space
  if (files.some(f => f.name === file.name && f.size === file.size)) return;
  files.push(file);
  localSpaceFiles.set(spaceId, files);
  persistLocalSpaceFiles();
  emitSpaceFiles(spaceId);
  broadcastMessage({ type: 'space-file-added', deviceId, spaceId, file });

  // Register with native HTTP server for serving to peers
  if (file.localPath) {
    SpaceServer.registerFile({
      fileId: file.id,
      filePath: file.localPath,
      fileName: file.name,
      mimeType: file.mimeType || 'application/octet-stream',
    });
  }
}

export function mobileRemoveFileFromSpace(spaceId: string, fileId: string) {
  const files = localSpaceFiles.get(spaceId) || [];
  localSpaceFiles.set(spaceId, files.filter(f => f.id !== fileId));
  persistLocalSpaceFiles();
  emitSpaceFiles(spaceId);
  broadcastMessage({ type: 'space-file-removed', deviceId, spaceId, fileId });

  // Unregister from native HTTP server
  SpaceServer.unregisterFile({ fileId });
}

export async function stopMobileNet() {
  for (const ws of connections.values()) {
    ws.close();
  }
  connections.clear();
  incomingClients.clear();

  try {
    await SpaceServer.stopServer();
  } catch { /* ignore */ }
}

// --- PIN-based peer discovery (fallback for networks where mDNS fails) ---

async function getLocalIP(): Promise<string> {
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
      setTimeout(() => {
        pc.close();
        resolve('192.168.1.1');
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
  // 1. Check saved peers first
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
