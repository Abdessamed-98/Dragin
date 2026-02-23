const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

class FileServer {
  constructor({ uploadsDir, onWsConnection }) {
    this.uploadsDir = uploadsDir;
    this.onWsConnection = onWsConnection;
    this.server = null;
    this.wss = null;
    this.port = 0;
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
          this.onWsConnection(ws);
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

  stop() {
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
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

    res.writeHead(404);
    res.end('Not found');
  }

  _serveFile(fileId, res) {
    // Find the file in uploads dir by ID prefix
    try {
      const files = fs.readdirSync(this.uploadsDir);
      const match = files.find((f) => f.startsWith(fileId + '__'));

      if (!match) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      const filePath = path.join(this.uploadsDir, match);
      const stat = fs.statSync(filePath);

      // Extract original name from filename (id__originalname)
      const originalName = match.substring(match.indexOf('__') + 2);

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`,
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
