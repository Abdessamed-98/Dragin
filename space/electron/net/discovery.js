const { Bonjour } = require('bonjour-service');

const SERVICE_TYPE = 'space';
const SERVICE_PROTOCOL = 'tcp';
const HEALTH_INTERVAL = 5000; // 5s — check peer liveness
const PEER_TIMEOUT = 15000; // 15s — evict if not seen in browser's service list

class Discovery {
  constructor({ deviceId, deviceName, serverPort, platform, onPeerFound, onPeerLost }) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.serverPort = serverPort;
    this.platform = platform;
    this.onPeerFound = onPeerFound;
    this.onPeerLost = onPeerLost;

    this.peers = new Map(); // id -> { id, name, ip, port, platform, lastSeen }
    this.bonjour = null;
    this.service = null;
    this.browser = null;
    this.healthTimer = null;
  }

  start() {
    this.bonjour = new Bonjour(undefined, (err) => {
      console.error('[Discovery] Bonjour error:', err.message);
    });

    // Publish our service — name must be unique per instance
    this.service = this.bonjour.publish({
      name: `${this.deviceName}-${this.deviceId.slice(0, 8)}`,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.serverPort,
      txt: {
        id: this.deviceId,
        name: this.deviceName,
        platform: this.platform,
      },
    });

    console.log(`[Discovery] Published _space._tcp on port ${this.serverPort}`);

    // Start browsing for peers
    this.browser = this.bonjour.find({
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
    });

    this.browser.on('up', (service) => this._handleServiceUp(service));
    this.browser.on('down', (service) => this._handleServiceDown(service));

    // Health check: refresh lastSeen from browser's service list + timeout sweep
    this.healthTimer = setInterval(() => this._healthCheck(), HEALTH_INTERVAL);
  }

  stop() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }

    if (this.bonjour) {
      this.bonjour.unpublishAll(() => {
        this.bonjour.destroy();
        this.bonjour = null;
      });
    }

    this.service = null;
    this.peers.clear();
  }

  getPeers() {
    return Array.from(this.peers.values()).map(({ lastSeen, ...rest }) => rest);
  }

  // --- Internal ---

  _handleServiceUp(service) {
    const txt = service.txt || {};
    const peerId = txt.id;

    // Ignore our own service or malformed records
    if (!peerId || peerId === this.deviceId) return;

    const ip = this._extractIPv4(service);
    if (!ip) return;

    const peer = {
      id: peerId,
      name: txt.name || service.name,
      ip,
      port: service.port,
      platform: txt.platform || 'unknown',
      lastSeen: Date.now(),
    };

    const isNew = !this.peers.has(peerId);
    this.peers.set(peerId, peer);

    if (isNew) {
      console.log(`[Discovery] Peer found: ${peer.name} (${peer.ip}:${peer.port})`);
    }

    // Always fire — peerManager handles dedup/cooldown
    if (this.onPeerFound) {
      this.onPeerFound({ ...peer, lastSeen: undefined });
    }
  }

  _handleServiceDown(service) {
    const txt = service.txt || {};
    const peerId = txt.id;
    if (!peerId) return;

    const peer = this.peers.get(peerId);
    if (peer) {
      this.peers.delete(peerId);
      console.log(`[Discovery] Peer gone: ${peer.name}`);
      if (this.onPeerLost) {
        this.onPeerLost(peer);
      }
    }
  }

  _extractIPv4(service) {
    if (service.addresses && service.addresses.length > 0) {
      const v4 = service.addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      if (v4) return v4;
      return service.addresses[0];
    }
    return service.host || null;
  }

  _healthCheck() {
    // Refresh lastSeen for peers still in the browser's service list
    // (avoids recreating the browser which triggers false 'down' events)
    if (this.browser && this.browser.services) {
      for (const service of this.browser.services) {
        const txt = service.txt || {};
        const peerId = txt.id;
        if (peerId && peerId !== this.deviceId && this.peers.has(peerId)) {
          this.peers.get(peerId).lastSeen = Date.now();
        }
      }
    }

    // Timeout sweep — catch ungraceful shutdowns where 'down' never fires
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        this.peers.delete(id);
        console.log(`[Discovery] Peer timed out: ${peer.name}`);
        if (this.onPeerLost) {
          this.onPeerLost(peer);
        }
      }
    }
  }
}

module.exports = { Discovery };
