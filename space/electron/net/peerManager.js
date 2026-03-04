const WebSocket = require('ws');

class PeerManager {
  constructor({ deviceId, deviceName, platform, serverPort, getLocalSpaces, getLocalSpaceFiles, getSpaceInfo, getDeletedSpaceIds, onPeersChanged, onNewPeerConnected, onRemoteSpaceEvent, onRemoteSpaceFilesChanged }) {
    this.deviceId = deviceId;
    this.deviceName = deviceName || 'Unknown Device';
    this.platform = platform || 'unknown';
    this.serverPort = serverPort || 0;
    this.getLocalSpaces = getLocalSpaces || (() => []);
    this.getLocalSpaceFiles = getLocalSpaceFiles || (() => []);
    this.getSpaceInfo = getSpaceInfo || (() => null);
    this.getDeletedSpaceIds = getDeletedSpaceIds || (() => []);
    this.onPeersChanged = onPeersChanged;
    this.onNewPeerConnected = onNewPeerConnected;
    this.onRemoteSpaceEvent = onRemoteSpaceEvent || null;
    this.onRemoteSpaceFilesChanged = onRemoteSpaceFilesChanged || null;

    // Remote peer connections: peerId -> { ws, peer, spaceFiles }
    this.connections = new Map();
    this.reconnectTimers = new Map();
    this._connectCooldowns = new Map();
    this.pendingTransfers = new Map();
    // Disconnected peer files: peerId -> Map<spaceId, SpaceFile[]> (available: false)
    this.disconnectedFiles = new Map();
  }

  // Called when a new peer is discovered via mDNS
  connectToPeer(peer) {
    if (this.connections.has(peer.id)) return;

    // Cooldown: skip if we recently tried the SAME port. Allow if port changed
    // (e.g., saved peer had stale port, mDNS found correct one).
    const lastAttempt = this._connectCooldowns.get(peer.id);
    if (lastAttempt && Date.now() - lastAttempt.time < 15000 && lastAttempt.port === peer.port) return;
    this._connectCooldowns.set(peer.id, { time: Date.now(), port: peer.port });

    const url = `ws://${peer.ip}:${peer.port}`;
    console.log(`[PeerManager] Connecting to ${peer.name} at ${url}`);

    try {
      const ws = new WebSocket(url);
      let opened = false;

      ws.on('open', () => {
        opened = true;
        this._connectCooldowns.delete(peer.id);

        // If an incoming connection from this peer already registered,
        // don't overwrite it — close this duplicate outgoing WS
        if (this.connections.has(peer.id)) {
          console.log(`[PeerManager] Already connected to ${peer.name} via incoming, closing duplicate outgoing`);
          ws.close();
          return;
        }

        console.log(`[PeerManager] Connected to ${peer.name}`);
        this.disconnectedFiles.delete(peer.id);
        this.connections.set(peer.id, { ws, peer, spaceFiles: new Map() });

        // Handshake + space data + peer list
        ws.send(JSON.stringify({
          type: 'handshake',
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          platform: this.platform,
          port: this.serverPort,
        }));
        this._sendSpaceData(ws);
        this._sendPeerList(ws, peer.id);

        // Tell existing peers about the new peer
        this._broadcastPeerList();

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
        if (!opened) {
          // Connection failed before opening — clear cooldown so next
          // mDNS/peer-exchange discovery can retry immediately
          this._connectCooldowns.delete(peer.id);
          return;
        }
        const conn = this.connections.get(peer.id);
        if (conn && conn.ws === ws) {
          console.log(`[PeerManager] Disconnected from ${peer.name}`);
          this._handlePeerDisconnect(peer.id);
        }
      });

      ws.on('error', () => {
        // Will trigger close event
      });
    } catch (err) {
      console.error(`[PeerManager] Failed to connect to ${peer.name}:`, err.message);
    }
  }

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

  _handlePeerDisconnect(peerId) {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    // Retain pinned/auto-pinned space files with available=false
    if (conn.spaceFiles && conn.spaceFiles.size > 0) {
      const retained = new Map();
      for (const [spaceId, files] of conn.spaceFiles) {
        const space = this.getSpaceInfo(spaceId);
        const autoPin = space ? space.autoPin : false;

        const kept = files.filter(f => {
          if (f.pinned === false) return false;
          if (f.pinned === true) return true;
          return autoPin;
        }).map(f => ({ ...f, available: false }));

        if (kept.length > 0) retained.set(spaceId, kept);
      }
      if (retained.size > 0) {
        this.disconnectedFiles.set(peerId, retained);
      }
    }

    this.connections.delete(peerId);
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

        // Handshake registers the connection
        if (remotePeerId && msg.type === 'handshake') {
          const ip = remoteAddress || '0.0.0.0';
          const isNew = !this.connections.has(remotePeerId);
          console.log(`[PeerManager] Incoming handshake from ${msg.deviceName} (${remotePeerId.slice(0,8)}), isNew=${isNew}`);

          if (isNew) {
            const peer = {
              id: remotePeerId,
              name: msg.deviceName || 'Unknown Device',
              ip: ip.replace(/^::ffff:/, ''),
              port: msg.port || 0,
              platform: msg.platform || 'unknown',
            };
            this.disconnectedFiles.delete(remotePeerId);
            this.connections.set(remotePeerId, { ws, peer, spaceFiles: new Map() });
            console.log(`[PeerManager] Incoming peer: ${peer.name} (${peer.ip})`);

            // Send peer list to the new peer + broadcast to existing peers
            this._sendPeerList(ws, remotePeerId);
            this._broadcastPeerList();

            this._notifyPeersChanged();
            if (this.onNewPeerConnected) this.onNewPeerConnected(peer);

            // Ask peer to re-send its space data
            try { ws.send(JSON.stringify({ type: 'request-space-data' })); } catch {}
          }
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

    // Send handshake + space data to the connecting peer
    ws.send(JSON.stringify({
      type: 'handshake',
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      platform: this.platform,
      port: this.serverPort,
    }));
    this._sendSpaceData(ws);
  }

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

  getRemoteSpaceFiles(spaceId) {
    const allFiles = [];
    for (const [, conn] of this.connections) {
      const files = conn.spaceFiles?.get(spaceId) || [];
      allFiles.push(...files);
    }
    for (const [, spaceMap] of this.disconnectedFiles) {
      const files = spaceMap.get(spaceId) || [];
      allFiles.push(...files);
    }
    return allFiles;
  }

  getConnectedPeers() {
    const peers = [];
    for (const [, conn] of this.connections) {
      if (conn.peer) peers.push(conn.peer);
    }
    return peers;
  }

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

  _handlePeerMessage(peerId, msg) {
    const conn = this.connections.get(peerId);
    if (!conn) {
      console.log(`[PeerManager] _handlePeerMessage: NO CONNECTION for ${peerId}, msg.type=${msg.type}`);
      return;
    }

    switch (msg.type) {
      case 'space-list':
        // Store the peer's space list for spaceId resolution
        conn.peerSpaces = msg.spaces || [];
        if (this.onRemoteSpaceEvent) {
          this.onRemoteSpaceEvent('sync', {
            spaces: msg.spaces || [],
            deletedSpaceIds: msg.deletedSpaceIds || [],
          });
        }
        break;

      case 'space-file-list':
        if (msg.spaceId) {
          const resolvedId = this._resolveSpaceId(conn, msg.spaceId);
          if (!conn.spaceFiles) conn.spaceFiles = new Map();
          conn.spaceFiles.set(resolvedId, (msg.files || []).map(f => ({
            ...f,
            available: true,
          })));
          this._notifySpaceFilesChanged(resolvedId);
        }
        break;

      case 'space-file-added':
        if (msg.spaceId && msg.file) {
          const resolvedId = this._resolveSpaceId(conn, msg.spaceId);
          if (!conn.spaceFiles) conn.spaceFiles = new Map();
          const files = conn.spaceFiles.get(resolvedId) || [];
          // Dedup by file ID — dual WS paths can deliver the same event twice
          if (!files.some(f => f.id === msg.file.id)) {
            files.push({ ...msg.file, available: true });
            conn.spaceFiles.set(resolvedId, files);
            this._notifySpaceFilesChanged(resolvedId);
          }
        }
        break;

      case 'space-file-removed':
        if (msg.spaceId && msg.fileId) {
          const resolvedId = this._resolveSpaceId(conn, msg.spaceId);
          if (conn.spaceFiles) {
            const files = conn.spaceFiles.get(resolvedId) || [];
            conn.spaceFiles.set(resolvedId, files.filter(f => f.id !== msg.fileId));
            this._notifySpaceFilesChanged(resolvedId);
          }
          this._removeDisconnectedFile(msg.deviceId || peerId, resolvedId, msg.fileId);
        }
        break;

      case 'space-created':
        if (msg.space && this.onRemoteSpaceEvent) {
          this.onRemoteSpaceEvent('created', { space: msg.space });
        }
        break;

      case 'space-updated':
        if (msg.spaceId && this.onRemoteSpaceEvent) {
          this.onRemoteSpaceEvent('updated', {
            spaceId: msg.spaceId,
            name: msg.name,
            autoPin: msg.autoPin,
            updatedAt: msg.updatedAt,
          });
        }
        break;

      case 'space-deleted':
        if (msg.spaceId) {
          if (conn.spaceFiles) conn.spaceFiles.delete(msg.spaceId);
          if (this.onRemoteSpaceEvent) {
            this.onRemoteSpaceEvent('deleted', { spaceId: msg.spaceId });
          }
        }
        break;

      case 'request-space-data':
        if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
          this._sendSpaceData(conn.ws);
        }
        break;

      case 'peer-list':
        if (msg.peers && Array.isArray(msg.peers)) {
          for (const p of msg.peers) {
            if (p.id && p.id !== this.deviceId && !this.connections.has(p.id) && p.port > 0) {
              console.log(`[PeerManager] Peer exchange: discovered ${p.name} (${p.ip}:${p.port}) via ${peerId}`);
              this.connectToPeer(p);
            }
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

  _sendSpaceData(ws) {
    const spaces = this.getLocalSpaces();
    const deletedSpaceIds = this.getDeletedSpaceIds();
    ws.send(JSON.stringify({
      type: 'space-list',
      deviceId: this.deviceId,
      spaces,
      deletedSpaceIds,
    }));
    for (const space of spaces) {
      ws.send(JSON.stringify({
        type: 'space-file-list',
        deviceId: this.deviceId,
        spaceId: space.id,
        files: this.getLocalSpaceFiles(space.id),
      }));
    }
  }

  broadcastSpaceUpdated(spaceId, updates) {
    this.broadcast({
      type: 'space-updated',
      deviceId: this.deviceId,
      spaceId,
      ...updates,
    });
  }

  broadcastSpaceFiles(spaceId) {
    this.broadcast({
      type: 'space-file-list',
      deviceId: this.deviceId,
      spaceId,
      files: this.getLocalSpaceFiles(spaceId),
    });
  }

  _removeDisconnectedFile(peerId, spaceId, fileId) {
    const spaceMap = this.disconnectedFiles.get(peerId);
    if (!spaceMap) return;
    const files = spaceMap.get(spaceId);
    if (!files) return;
    const filtered = files.filter(f => f.id !== fileId);
    if (filtered.length > 0) {
      spaceMap.set(spaceId, filtered);
    } else {
      spaceMap.delete(spaceId);
      if (spaceMap.size === 0) this.disconnectedFiles.delete(peerId);
    }
  }

  _sendPeerList(ws, excludePeerId) {
    const peers = [];
    for (const [, conn] of this.connections) {
      if (conn.peer && conn.peer.id !== excludePeerId) {
        peers.push({
          id: conn.peer.id,
          name: conn.peer.name,
          ip: conn.peer.ip,
          port: conn.peer.port,
          platform: conn.peer.platform,
        });
      }
    }
    if (peers.length > 0) {
      try {
        ws.send(JSON.stringify({
          type: 'peer-list',
          deviceId: this.deviceId,
          peers,
        }));
      } catch {}
    }
  }

  _broadcastPeerList() {
    for (const [peerId, conn] of this.connections) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        this._sendPeerList(conn.ws, peerId);
      }
    }
  }

  /**
   * Map a remote peer's spaceId to our local spaceId.
   * If the remote uses a different ID for the same space (matched by name),
   * return our local ID so files are stored correctly.
   */
  _resolveSpaceId(conn, remoteSpaceId) {
    // Direct match — most common case (IDs already converged)
    if (this.getLocalSpaces().find(s => s.id === remoteSpaceId)) {
      return remoteSpaceId;
    }
    // No direct match — peer has a different ID for a same-name space.
    // Look up the space name in the peer's last-known space list.
    const peerSpaces = conn.peerSpaces || [];
    const remoteSpace = peerSpaces.find(s => s.id === remoteSpaceId);
    if (remoteSpace) {
      const localMatch = this.getLocalSpaces().find(s => s.name === remoteSpace.name);
      if (localMatch) return localMatch.id;
    }
    // Fallback: store under raw remote ID (will converge after merge)
    return remoteSpaceId;
  }

  _notifySpaceFilesChanged(spaceId) {
    if (this.onRemoteSpaceFilesChanged) {
      this.onRemoteSpaceFilesChanged(spaceId);
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
