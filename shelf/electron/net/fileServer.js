const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

class FileServer {
  constructor({ uploadsDir, resolveFilePath, onWsConnection }) {
    this.uploadsDir = uploadsDir;
    this.resolveFilePath = resolveFilePath || null;
    this.onWsConnection = onWsConnection;
    this.server = null;
    this.wss = null;
    this.port = 0;
    this.deviceInfo = null;
    this.discoveryServer = null;
    this.pairPin = null;
  }

  setDeviceInfo(info) {
    this.deviceInfo = info;
  }

  setShelves(getShelvesFn) {
    this._getShelves = getShelvesFn;
  }

  setPairPin(pin) {
    this.pairPin = pin;
  }

  clearPairPin() {
    this.pairPin = null;
  }

  start() {
    return new Promise((resolve) => {
      // Simple HTTP server for file downloads
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      // WebSocket server on same port
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws, req) => {
        console.log(`[FileServer] WebSocket connection from ${req.socket.remoteAddress}`);
        if (this.onWsConnection) {
          this.onWsConnection(ws, req);
        }
      });

      // Listen on random available port
      this.server.listen(0, () => {
        this.port = this.server.address().port;
        console.log(`[FileServer] HTTP + WS listening on port ${this.port}`);
        resolve(this.port);
      });
    });
  }

  // Start a fixed-port HTTP server for mobile discovery
  startDiscovery(port = 52384) {
    this.discoveryServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/shelf-discover') {
        const shelves = this._getShelves ? this._getShelves() : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          shelf: true,
          id: this.deviceInfo?.id || '',
          name: this.deviceInfo?.name || '',
          port: this.port,
          platform: this.deviceInfo?.platform || '',
          shelves,
        }));
      } else if (req.method === 'GET' && req.url.startsWith('/shelf-pair')) {
        const url = new URL(req.url, 'http://localhost');
        const pin = url.searchParams.get('pin');
        if (this.pairPin && pin === this.pairPin) {
          const shelves = this._getShelves ? this._getShelves() : [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            shelf: true,
            id: this.deviceInfo?.id || '',
            name: this.deviceInfo?.name || '',
            port: this.port,
            platform: this.deviceInfo?.platform || '',
            shelves,
          }));
        } else {
          res.writeHead(403);
          res.end();
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.discoveryServer.listen(port, () => {
      console.log(`[FileServer] Discovery HTTP on port ${port}`);
    });

    this.discoveryServer.on('error', (err) => {
      console.warn(`[FileServer] Discovery port ${port} unavailable:`, err.message);
    });
  }

  stop() {
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
    if (this.discoveryServer) this.discoveryServer.close();
  }

  getPort() {
    return this.port;
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(msg);
      }
    }
  }

  _handleRequest(req, res) {
    // CORS headers for local network
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /files/:fileId — download a file
    const match = req.url.match(/^\/files\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'GET' && match) {
      const fileId = match[1];
      this._serveFile(fileId, res);
      return;
    }

    // GET /health — health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // GET /shelf-discover — mobile discovery endpoint
    if (req.method === 'GET' && req.url === '/shelf-discover') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        shelf: true,
        id: this.deviceInfo?.id || '',
        name: this.deviceInfo?.name || '',
        port: this.port,
        platform: this.deviceInfo?.platform || '',
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  _serveFile(fileId, res) {
    try {
      // Try resolver first (link-not-copy: knows the original path)
      let filePath = null;
      let originalName = null;

      if (this.resolveFilePath) {
        const resolved = this.resolveFilePath(fileId);
        if (resolved) {
          filePath = resolved.path;
          originalName = resolved.name || path.basename(filePath);
        }
      }

      // Fallback: scan uploads dir by ID prefix (legacy files)
      if (!filePath && this.uploadsDir) {
        const files = fs.readdirSync(this.uploadsDir);
        const match = files.find((f) => f.startsWith(fileId + '__'));
        if (match) {
          filePath = path.join(this.uploadsDir, match);
          originalName = match.substring(match.indexOf('__') + 2);
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(originalName).toLowerCase();

      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.bmp': 'image/bmp', '.ico': 'image/x-icon',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.pdf': 'application/pdf', '.json': 'application/json',
        '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
        '.js': 'application/javascript',
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=3600',
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    } catch (err) {
      console.error('[FileServer] Error serving file:', err);
      res.writeHead(500);
      res.end('Server error');
    }
  }
}

module.exports = { FileServer };
