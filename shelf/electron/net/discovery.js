const dgram = require('dgram');
const os = require('os');

const MULTICAST_ADDR = '239.255.0.1';
const MULTICAST_PORT = 41234;
const HEARTBEAT_INTERVAL = 3000;
const PEER_TIMEOUT = 10000;

class Discovery {
  constructor({ deviceId, deviceName, serverPort, platform, onPeerFound, onPeerLost }) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.serverPort = serverPort;
    this.platform = platform;
    this.onPeerFound = onPeerFound;
    this.onPeerLost = onPeerLost;

    this.peers = new Map(); // id -> { id, name, ip, port, platform, lastSeen }
    this.socket = null;
    this.heartbeatTimer = null;
    this.cleanupTimer = null;
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        this._handleMessage(data, rinfo);
      } catch {
        // Ignore malformed messages
      }
    });

    this.socket.on('error', (err) => {
      console.error('[Discovery] Socket error:', err.message);
    });

    this.socket.bind(MULTICAST_PORT, () => {
      this.socket.addMembership(MULTICAST_ADDR);
      this.socket.setMulticastTTL(128);
      this.socket.setBroadcast(true);
      console.log(`[Discovery] Listening on ${MULTICAST_ADDR}:${MULTICAST_PORT}`);

      // Start heartbeat
      this._sendHello();
      this.heartbeatTimer = setInterval(() => this._sendHello(), HEARTBEAT_INTERVAL);

      // Start peer cleanup
      this.cleanupTimer = setInterval(() => this._cleanupPeers(), HEARTBEAT_INTERVAL);
    });
  }

  stop() {
    // Send bye message
    this._sendBye();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);

    if (this.socket) {
      try {
        this.socket.dropMembership(MULTICAST_ADDR);
        this.socket.close();
      } catch {
        // Socket may already be closed
      }
    }
  }

  _sendHello() {
    const msg = JSON.stringify({
      type: 'hello',
      id: this.deviceId,
      name: this.deviceName,
      ip: this.getLocalIP(),
      port: this.serverPort,
      platform: this.platform,
    });

    this.socket.send(msg, MULTICAST_PORT, MULTICAST_ADDR);
  }

  _sendBye() {
    if (!this.socket) return;
    const msg = JSON.stringify({
      type: 'bye',
      id: this.deviceId,
    });

    try {
      this.socket.send(msg, MULTICAST_PORT, MULTICAST_ADDR);
    } catch {
      // Socket may be closed
    }
  }

  _handleMessage(data, rinfo) {
    // Ignore our own messages
    if (data.id === this.deviceId) return;

    if (data.type === 'hello') {
      const isNew = !this.peers.has(data.id);
      this.peers.set(data.id, {
        id: data.id,
        name: data.name,
        ip: data.ip || rinfo.address,
        port: data.port,
        platform: data.platform,
        lastSeen: Date.now(),
      });

      if (isNew && this.onPeerFound) {
        this.onPeerFound(this.peers.get(data.id));
      }
    } else if (data.type === 'bye') {
      if (this.peers.has(data.id)) {
        const peer = this.peers.get(data.id);
        this.peers.delete(data.id);
        if (this.onPeerLost) {
          this.onPeerLost(peer);
        }
      }
    }
  }

  _cleanupPeers() {
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        this.peers.delete(id);
        if (this.onPeerLost) {
          this.onPeerLost(peer);
        }
      }
    }
  }

  getPeers() {
    return Array.from(this.peers.values());
  }
}

module.exports = { Discovery };
