const WebSocket = require('ws');

class PeerManager {
  constructor({ deviceId, localFiles, getLocalShelves, getLocalShelfFiles, getShelfInfo, getDeletedShelfIds, onRemoteFilesChanged, onPeersChanged, onNewPeerConnected, onRemoteShelfEvent, onRemoteShelfFilesChanged }) {
    this.deviceId = deviceId;
    this.localFiles = localFiles; // () => SharedFile[]
    this.getLocalShelves = getLocalShelves || (() => []); // () => Shelf[]
    this.getLocalShelfFiles = getLocalShelfFiles || (() => []); // (shelfId) => ShelfFile[]
    this.getShelfInfo = getShelfInfo || (() => null); // (shelfId) => Shelf | null
    this.getDeletedShelfIds = getDeletedShelfIds || (() => []); // () => string[]
    this.onRemoteFilesChanged = onRemoteFilesChanged;
    this.onPeersChanged = onPeersChanged;
    this.onNewPeerConnected = onNewPeerConnected; // (peer) => void
    this.onRemoteShelfEvent = onRemoteShelfEvent || null; // (eventType, data) => void
    this.onRemoteShelfFilesChanged = onRemoteShelfFilesChanged || null; // (shelfId) => void

    // Remote peer connections: peerId -> { ws, peer, files, shelfFiles }
    this.connections = new Map();
    this.reconnectTimers = new Map();
    // Cooldown for connection attempts (peerId -> timestamp)
    this._connectCooldowns = new Map();
    // Pending WS file transfers: fileId -> { resolve, reject, onProgress, chunks, received, size }
    this.pendingTransfers = new Map();
    // Disconnected peer files: peerId -> Map<shelfId, ShelfFile[]> (available: false)
    this.disconnectedFiles = new Map();
  }

  // Called when a new peer is discovered via UDP
  connectToPeer(peer) {
    if (this.connections.has(peer.id)) return;

    // Cooldown: don't retry within 15 seconds of a failed attempt
    const lastAttempt = this._connectCooldowns.get(peer.id);
    if (lastAttempt && Date.now() - lastAttempt < 15000) return;
    this._connectCooldowns.set(peer.id, Date.now());

    const url = `ws://${peer.ip}:${peer.port}`;
    console.log(`[PeerManager] Connecting to ${peer.name} at ${url}`);

    try {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        console.log(`[PeerManager] Connected to ${peer.name}`);
        this._connectCooldowns.delete(peer.id); // Clear cooldown on success
        this.disconnectedFiles.delete(peer.id); // Clear retained files on reconnect
        this.connections.set(peer.id, { ws, peer, files: [], shelfFiles: new Map() });

        // Send our file list (v1 backward compat)
        ws.send(JSON.stringify({
          type: 'file-list',
          deviceId: this.deviceId,
          files: this.localFiles(),
        }));

        // Send shelf data (v2)
        this._sendShelfData(ws);

        this._notifyPeersChanged();
        if (this.onNewPeerConnected) this.onNewPeerConnected(peer);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handlePeerMessage(peer.id, msg);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        console.log(`[PeerManager] Disconnected from ${peer.name}`);
        this._handlePeerDisconnect(peer.id);
      });

      ws.on('error', () => {
        // Will trigger close event
      });
    } catch (err) {
      console.error(`[PeerManager] Failed to connect to ${peer.name}:`, err.message);
    }
  }

  // Called when a peer is lost (UDP timeout or bye)
  disconnectPeer(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) {
      try { conn.ws.close(); } catch {}
      this._handlePeerDisconnect(peerId);
    }

    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
  }

  // Handle peer disconnect: retain pinned files with available=false
  _handlePeerDisconnect(peerId) {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    // Process shelf files — keep based on pin settings
    if (conn.shelfFiles && conn.shelfFiles.size > 0) {
      const retained = new Map();
      for (const [shelfId, files] of conn.shelfFiles) {
        const shelf = this.getShelfInfo(shelfId);
        const autoPin = shelf ? shelf.autoPin : false;

        const kept = files.filter(f => {
          // Explicitly unpinned (pinned === false) → always remove
          if (f.pinned === false) return false;
          // Explicitly pinned → always keep
          if (f.pinned === true) return true;
          // No manual override → use shelf's autoPin
          return autoPin;
        }).map(f => ({ ...f, available: false }));

        if (kept.length > 0) retained.set(shelfId, kept);
      }
      if (retained.size > 0) {
        this.disconnectedFiles.set(peerId, retained);
      }
    }

    this.connections.delete(peerId);

    // Relay disconnect to remaining peers: send updated file lists
    // For retained (on-hold) files → send as available: false
    // For non-retained shelves → send empty list so peers clear them
    const retained = this.disconnectedFiles.get(peerId);
    if (conn.shelfFiles && conn.shelfFiles.size > 0) {
      for (const [shelfId] of conn.shelfFiles) {
        const retainedFiles = retained?.get(shelfId) || [];
        this._relayToOthers(peerId, {
          type: 'shelf-file-list',
          deviceId: peerId,
          shelfId,
          files: retainedFiles, // available: false already set
        });
      }
    }
    // Also relay empty v1 file list so peers clear the disconnected peer's flat files
    this._relayToOthers(peerId, {
      type: 'file-list',
      deviceId: peerId,
      files: [],
    });

    this._notifyFilesChanged();
    this._notifyPeersChanged();
  }

  // Handle incoming WS connection (someone connected to our server)
  handleIncomingConnection(ws, remoteAddress) {
    let remotePeerId = null;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.deviceId) {
          remotePeerId = msg.deviceId;
        }

        // If this peer connected to us (incoming), store their files
        if (remotePeerId && msg.type === 'file-list') {
          const ip = remoteAddress || '0.0.0.0';
          const isNew = !this.connections.has(remotePeerId);

          if (isNew) {
            const peer = {
              id: remotePeerId,
              name: msg.deviceName || 'Unknown Device',
              ip: ip.replace(/^::ffff:/, ''),
              port: 0,
              platform: msg.platform || 'unknown',
            };
            this.disconnectedFiles.delete(remotePeerId); // Clear retained files on reconnect
            this.connections.set(remotePeerId, { ws, peer, files: msg.files || [], shelfFiles: new Map() });
            console.log(`[PeerManager] Incoming peer: ${peer.name} (${peer.ip})`);
            this._notifyPeersChanged();
            if (this.onNewPeerConnected) this.onNewPeerConnected(peer);

            // Send existing peers' data to the new peer so it sees everyone
            this._sendExistingPeerData(remotePeerId, ws);
          } else {
            const conn = this.connections.get(remotePeerId);
            conn.files = msg.files || [];
          }

          // Relay this peer's file-list to all other peers
          this._relayToOthers(remotePeerId, msg);
          this._notifyFilesChanged();
        } else if (remotePeerId) {
          this._handlePeerMessage(remotePeerId, msg);
        }
      } catch {
        // Ignore
      }
    });

    ws.on('close', () => {
      if (remotePeerId && this.connections.has(remotePeerId)) {
        const conn = this.connections.get(remotePeerId);
        if (conn.ws === ws) {
          this._handlePeerDisconnect(remotePeerId);
        }
      }
    });

    // Send our file list to the connecting peer (v1 backward compat)
    ws.send(JSON.stringify({
      type: 'file-list',
      deviceId: this.deviceId,
      files: this.localFiles(),
    }));

    // Send shelf data (v2)
    this._sendShelfData(ws);
  }

  // Broadcast a message to all connected peers
  broadcast(message) {
    const msg = JSON.stringify(message);
    for (const [, conn] of this.connections) {
      try {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(msg);
        }
      } catch {
        // Ignore send errors
      }
    }
  }

  // Broadcast updated file list to all peers
  broadcastFileList() {
    this.broadcast({
      type: 'file-list',
      deviceId: this.deviceId,
      files: this.localFiles(),
    });
  }

  getAllRemoteFiles() {
    const allFiles = [];
    for (const [, conn] of this.connections) {
      allFiles.push(...(conn.files || []));
    }
    return allFiles;
  }

  // Get remote files scoped to a specific shelf (connected + disconnected)
  getRemoteShelfFiles(shelfId) {
    const allFiles = [];
    // Connected peers
    for (const [, conn] of this.connections) {
      const files = conn.shelfFiles?.get(shelfId) || [];
      allFiles.push(...files);
    }
    // Disconnected peers (retained pinned files)
    for (const [, shelfMap] of this.disconnectedFiles) {
      const files = shelfMap.get(shelfId) || [];
      allFiles.push(...files);
    }
    return allFiles;
  }

  // (removed getAllRemoteShelves — shelves are now shared state in shelfStore)

  getConnectedPeers() {
    const peers = [];
    for (const [, conn] of this.connections) {
      if (conn.peer) peers.push(conn.peer);
    }
    return peers;
  }

  // Request a file from a peer via WebSocket (for peers without HTTP servers)
  requestFile(peerId, fileId, onProgress) {
    const conn = this.connections.get(peerId);
    if (!conn?.ws || conn.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Peer not connected'));
    }

    return new Promise((resolve, reject) => {
      this.pendingTransfers.set(fileId, {
        resolve, reject, onProgress,
        chunks: [], received: 0, size: 0, fileName: '',
      });

      conn.ws.send(JSON.stringify({ type: 'file-request', fileId }));

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingTransfers.has(fileId)) {
          this.pendingTransfers.delete(fileId);
          reject(new Error('File transfer timed out'));
        }
      }, 300000);
    });
  }

  cancelTransfer(fileId) {
    const transfer = this.pendingTransfers.get(fileId);
    if (transfer) {
      transfer.reject(new Error('Cancelled'));
      this.pendingTransfers.delete(fileId);
    }
  }

  // Send existing peers' file/shelf data to a newly connected peer
  _sendExistingPeerData(newPeerId, ws) {
    // Connected peers
    for (const [id, conn] of this.connections) {
      if (id === newPeerId) continue;
      try {
        // Send v1 file list
        if (conn.files && conn.files.length > 0) {
          ws.send(JSON.stringify({
            type: 'file-list',
            deviceId: id,
            files: conn.files,
          }));
        }
        // Send v2 shelf files
        if (conn.shelfFiles) {
          for (const [shelfId, files] of conn.shelfFiles) {
            if (files.length > 0) {
              ws.send(JSON.stringify({
                type: 'shelf-file-list',
                deviceId: id,
                shelfId,
                files,
              }));
            }
          }
        }
      } catch {
        // Ignore send errors
      }
    }

    // Disconnected peers (on-hold files with available: false)
    for (const [id, shelfMap] of this.disconnectedFiles) {
      if (id === newPeerId) continue; // Don't send your own on-hold files back to you
      try {
        for (const [shelfId, files] of shelfMap) {
          if (files.length > 0) {
            ws.send(JSON.stringify({
              type: 'shelf-file-list',
              deviceId: id,
              shelfId,
              files,
            }));
          }
        }
      } catch {
        // Ignore send errors
      }
    }
  }

  // Relay a message to all connected peers EXCEPT the sender
  _relayToOthers(senderPeerId, msg) {
    const raw = JSON.stringify(msg);
    for (const [id, conn] of this.connections) {
      if (id === senderPeerId) continue;
      try {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(raw);
        }
      } catch {
        // Ignore relay errors
      }
    }
  }

  _handlePeerMessage(peerId, msg) {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    // Messages that should be relayed from one peer to all others
    // (PC acts as hub — mobile devices don't connect to each other)
    const RELAY_TYPES = new Set([
      'file-list', 'file-added', 'file-removed',
      'shelf-list', 'shelf-file-list', 'shelf-file-added', 'shelf-file-removed',
      'shelf-created', 'shelf-updated', 'shelf-deleted',
    ]);

    if (RELAY_TYPES.has(msg.type)) {
      this._relayToOthers(peerId, msg);
    }

    switch (msg.type) {
      case 'file-list':
        conn.files = msg.files || [];
        this._notifyFilesChanged();
        break;

      case 'file-added':
        if (msg.file) {
          conn.files.push(msg.file);
          this._notifyFilesChanged();
        }
        break;

      case 'file-removed':
        if (msg.fileId) {
          conn.files = conn.files.filter((f) => f.id !== msg.fileId);
          this._notifyFilesChanged();
        }
        break;

      // --- v2 shelf-aware messages ---
      case 'shelf-list':
        if (this.onRemoteShelfEvent) {
          this.onRemoteShelfEvent('sync', {
            shelves: msg.shelves || [],
            deletedShelfIds: msg.deletedShelfIds || [],
          });
        }
        break;

      case 'shelf-file-list':
        if (msg.shelfId) {
          if (!conn.shelfFiles) conn.shelfFiles = new Map();
          conn.shelfFiles.set(msg.shelfId, (msg.files || []).map(f => ({
            ...f,
            available: true,
          })));
          this._notifyShelfFilesChanged(msg.shelfId);
        }
        break;

      case 'shelf-file-added':
        if (msg.shelfId && msg.file) {
          if (!conn.shelfFiles) conn.shelfFiles = new Map();
          const files = conn.shelfFiles.get(msg.shelfId) || [];
          files.push({ ...msg.file, available: true });
          conn.shelfFiles.set(msg.shelfId, files);
          this._notifyShelfFilesChanged(msg.shelfId);
        }
        break;

      case 'shelf-file-removed':
        if (msg.shelfId && msg.fileId) {
          if (conn.shelfFiles) {
            const files = conn.shelfFiles.get(msg.shelfId) || [];
            conn.shelfFiles.set(msg.shelfId, files.filter(f => f.id !== msg.fileId));
            this._notifyShelfFilesChanged(msg.shelfId);
          }
          // Also remove from disconnected files if present
          this._removeDisconnectedFile(msg.deviceId || peerId, msg.shelfId, msg.fileId);
        }
        break;

      case 'shelf-created':
        if (msg.shelf && this.onRemoteShelfEvent) {
          this.onRemoteShelfEvent('created', { shelf: msg.shelf });
        }
        break;

      case 'shelf-updated':
        if (msg.shelfId && this.onRemoteShelfEvent) {
          this.onRemoteShelfEvent('updated', {
            shelfId: msg.shelfId,
            name: msg.name,
            autoPin: msg.autoPin,
            updatedAt: msg.updatedAt,
          });
        }
        break;

      case 'shelf-deleted':
        if (msg.shelfId) {
          if (conn.shelfFiles) conn.shelfFiles.delete(msg.shelfId);
          if (this.onRemoteShelfEvent) {
            this.onRemoteShelfEvent('deleted', { shelfId: msg.shelfId });
          }
        }
        break;

      // --- WS file transfer protocol ---
      case 'file-transfer-start': {
        const transfer = this.pendingTransfers.get(msg.fileId);
        if (transfer) {
          transfer.size = msg.size || 0;
          transfer.fileName = msg.fileName || '';
        }
        break;
      }

      case 'file-chunk': {
        const transfer = this.pendingTransfers.get(msg.fileId);
        if (transfer) {
          const buf = Buffer.from(msg.data, 'base64');
          transfer.chunks.push(buf);
          transfer.received += buf.length;
          if (transfer.onProgress && transfer.size > 0) {
            transfer.onProgress(Math.round((transfer.received / transfer.size) * 100));
          }
        }
        break;
      }

      case 'file-transfer-end': {
        const transfer = this.pendingTransfers.get(msg.fileId);
        if (transfer) {
          const data = Buffer.concat(transfer.chunks);
          transfer.resolve(data);
          this.pendingTransfers.delete(msg.fileId);
        }
        break;
      }

      case 'file-transfer-error': {
        const transfer = this.pendingTransfers.get(msg.fileId);
        if (transfer) {
          transfer.reject(new Error(msg.error || 'Transfer failed'));
          this.pendingTransfers.delete(msg.fileId);
        }
        break;
      }
    }
  }

  // Send shelf list + per-shelf files to a single peer
  _sendShelfData(ws) {
    const shelves = this.getLocalShelves();
    const deletedShelfIds = this.getDeletedShelfIds();
    ws.send(JSON.stringify({
      type: 'shelf-list',
      deviceId: this.deviceId,
      shelves,
      deletedShelfIds,
    }));
    for (const shelf of shelves) {
      ws.send(JSON.stringify({
        type: 'shelf-file-list',
        deviceId: this.deviceId,
        shelfId: shelf.id,
        files: this.getLocalShelfFiles(shelf.id),
      }));
    }
  }

  // Broadcast a shelf update (rename, autoPin) to all peers
  broadcastShelfUpdated(shelfId, updates) {
    this.broadcast({
      type: 'shelf-updated',
      deviceId: this.deviceId,
      shelfId,
      ...updates,
    });
  }

  // Broadcast a shelf's files to all peers
  broadcastShelfFiles(shelfId) {
    this.broadcast({
      type: 'shelf-file-list',
      deviceId: this.deviceId,
      shelfId,
      files: this.getLocalShelfFiles(shelfId),
    });
  }

  _removeDisconnectedFile(peerId, shelfId, fileId) {
    const shelfMap = this.disconnectedFiles.get(peerId);
    if (!shelfMap) return;
    const files = shelfMap.get(shelfId);
    if (!files) return;
    const filtered = files.filter(f => f.id !== fileId);
    if (filtered.length > 0) {
      shelfMap.set(shelfId, filtered);
    } else {
      shelfMap.delete(shelfId);
      if (shelfMap.size === 0) this.disconnectedFiles.delete(peerId);
    }
  }

  _notifyShelfFilesChanged(shelfId) {
    if (this.onRemoteShelfFilesChanged) {
      this.onRemoteShelfFilesChanged(shelfId);
    }
  }

  _notifyFilesChanged() {
    if (this.onRemoteFilesChanged) {
      this.onRemoteFilesChanged(this.getAllRemoteFiles());
    }
  }

  _notifyPeersChanged() {
    if (this.onPeersChanged) {
      this.onPeersChanged(this.getConnectedPeers());
    }
  }

  stop() {
    for (const [, conn] of this.connections) {
      try { conn.ws.close(); } catch {}
    }
    this.connections.clear();
    for (const [, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    for (const [, transfer] of this.pendingTransfers) {
      try { transfer.reject(new Error('PeerManager stopped')); } catch {}
    }
    this.pendingTransfers.clear();
  }
}

module.exports = { PeerManager };
