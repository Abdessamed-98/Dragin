const WebSocket = require('ws');

const RECONNECT_DELAY = 2000;

class PeerManager {
  constructor({ deviceId, localFiles, onRemoteFilesChanged }) {
    this.deviceId = deviceId;
    this.localFiles = localFiles; // () => SharedFile[]
    this.onRemoteFilesChanged = onRemoteFilesChanged;

    // Remote peer connections: peerId -> { ws, files: SharedFile[] }
    this.connections = new Map();
    this.reconnectTimers = new Map();
  }

  // Called when a new peer is discovered via UDP
  connectToPeer(peer) {
    if (this.connections.has(peer.id)) return;

    const url = `ws://${peer.ip}:${peer.port}`;
    console.log(`[PeerManager] Connecting to ${peer.name} at ${url}`);

    try {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        console.log(`[PeerManager] Connected to ${peer.name}`);
        this.connections.set(peer.id, { ws, peer, files: [] });

        // Send our file list
        ws.send(JSON.stringify({
          type: 'file-list',
          deviceId: this.deviceId,
          files: this.localFiles(),
        }));
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
        this.connections.delete(peer.id);
        this._notifyFilesChanged();
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
      this.connections.delete(peerId);
      this._notifyFilesChanged();
    }

    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
  }

  // Handle incoming WS connection (someone connected to our server)
  handleIncomingConnection(ws) {
    let remotePeerId = null;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.deviceId) {
          remotePeerId = msg.deviceId;
        }

        // If this peer connected to us (incoming), store their files
        if (remotePeerId && msg.type === 'file-list') {
          // Only store if we don't have an outgoing connection to this peer
          if (!this.connections.has(remotePeerId)) {
            this.connections.set(remotePeerId, { ws, peer: null, files: msg.files || [] });
          } else {
            // Update files on existing connection
            const conn = this.connections.get(remotePeerId);
            conn.files = msg.files || [];
          }
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
        // Only remove if this is the same ws
        if (conn.ws === ws) {
          this.connections.delete(remotePeerId);
          this._notifyFilesChanged();
        }
      }
    });

    // Send our file list to the connecting peer
    ws.send(JSON.stringify({
      type: 'file-list',
      deviceId: this.deviceId,
      files: this.localFiles(),
    }));
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

  // Get all remote files from connected peers
  getAllRemoteFiles() {
    const allFiles = [];
    for (const [, conn] of this.connections) {
      allFiles.push(...(conn.files || []));
    }
    return allFiles;
  }

  _handlePeerMessage(peerId, msg) {
    const conn = this.connections.get(peerId);
    if (!conn) return;

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
    }
  }

  _notifyFilesChanged() {
    if (this.onRemoteFilesChanged) {
      this.onRemoteFilesChanged(this.getAllRemoteFiles());
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
  }
}

module.exports = { PeerManager };
