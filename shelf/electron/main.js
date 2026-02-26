const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, nativeImage } = require('electron');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { Discovery } = require('./net/discovery');
const { FileServer } = require('./net/fileServer');
const { PeerManager } = require('./net/peerManager');
const { ShelfStore } = require('./shelfStore');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// --- TEST PEER MODE ---
const isTestPeer = process.argv.includes('--test-peer');
if (isTestPeer) {
  app.setPath('userData', path.join(app.getPath('userData'), 'test-peer'));
}

// --- LATE-INIT PATHS (set in app.whenReady) ---
let DEVICE_ID = '';
let UPLOADS_DIR = '';
let shelfStore = null;

function initPaths() {
  const userData = app.getPath('userData');

  // Persistent device ID
  const idPath = path.join(userData, 'device-id');
  try {
    DEVICE_ID = fs.readFileSync(idPath, 'utf-8').trim();
  } catch {
    DEVICE_ID = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(idPath, DEVICE_ID);
  }

  // Uploads dir
  UPLOADS_DIR = path.join(userData, 'shelf-uploads');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  // Load saved peers
  loadSavedPeers();

  // Initialize shelf store
  shelfStore = new ShelfStore(userData, DEVICE_ID);
  shelfStore.ensureDefaults();
  shelfStore.migrateFromUploadsDir(UPLOADS_DIR);
  console.log(`[Shelf] Shelves: ${shelfStore.getShelves().map(s => s.name).join(', ')}`);

  // Hydrate in-memory localFiles from persisted shelf store
  for (const file of shelfStore.getAllLocalFiles()) {
    const sourcePath = file.localPath;
    // Only load files that still exist on disk
    if (sourcePath && fs.existsSync(sourcePath)) {
      localFiles.set(file.id, {
        id: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        deviceId: file.deviceId,
        deviceName: file.deviceName,
        uploadedAt: file.addedAt,
        localPath: file.localPath,
        thumbnail: file.thumbnail,
      });
    } else if (!sourcePath) {
      // Legacy file in uploads dir — check if it exists there
      try {
        const uploads = fs.readdirSync(UPLOADS_DIR);
        const match = uploads.find((f) => f.startsWith(file.id + '__'));
        if (match) {
          localFiles.set(file.id, {
            id: file.id,
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
            deviceId: file.deviceId,
            deviceName: file.deviceName,
            uploadedAt: file.addedAt,
            thumbnail: file.thumbnail,
          });
        }
      } catch {}
    }
  }
  console.log(`[Shelf] Local files loaded: ${localFiles.size}`);
}

// --- THUMBNAIL GENERATION ---
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'];

function generateThumbnail(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) return undefined;
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return undefined;
    const size = image.getSize();
    const maxDim = 200;
    let w = size.width, h = size.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
      else { w = Math.round(w * maxDim / h); h = maxDim; }
    }
    const resized = image.resize({ width: w, height: h });
    return `data:image/jpeg;base64,${resized.toJPEG(60).toString('base64')}`;
  } catch {
    return undefined;
  }
}

// --- SAVED PEERS (persistent across sessions) ---
let savedPeersPath = '';
const savedPeers = new Map(); // id -> { id, name, ip, port, platform }

function loadSavedPeers() {
  savedPeersPath = path.join(app.getPath('userData'), 'shelf-peers.json');
  try {
    const data = JSON.parse(fs.readFileSync(savedPeersPath, 'utf-8'));
    for (const p of data) {
      savedPeers.set(p.id, p);
    }
  } catch {
    // No saved peers yet
  }
}

function persistSavedPeers() {
  try {
    fs.writeFileSync(savedPeersPath, JSON.stringify(Array.from(savedPeers.values()), null, 2));
  } catch {}
  broadcastToRenderer('saved-peers-update', Array.from(savedPeers.values()));
}

function savePeer(peer) {
  if (savedPeers.has(peer.id)) {
    // Update IP/port/name if changed
    const existing = savedPeers.get(peer.id);
    if (existing.ip !== peer.ip || existing.port !== peer.port || existing.name !== peer.name) {
      savedPeers.set(peer.id, { id: peer.id, name: peer.name, ip: peer.ip, port: peer.port, platform: peer.platform });
      persistSavedPeers();
    }
    return;
  }
  // Remove any old entry with the same IP (e.g., device got a new ID after reinstall)
  for (const [oldId, oldPeer] of savedPeers) {
    if (oldPeer.ip === peer.ip && oldId !== peer.id) {
      savedPeers.delete(oldId);
    }
  }
  savedPeers.set(peer.id, { id: peer.id, name: peer.name, ip: peer.ip, port: peer.port, platform: peer.platform });
  persistSavedPeers();
  console.log(`[Shelf] Saved peer: ${peer.name} (${peer.ip})`);
}

// --- LOCAL FILES (in-memory tracking) ---
const localFiles = new Map();

function getLocalFilesList() {
  return Array.from(localFiles.values());
}

function getAllFiles() {
  const local = getLocalFilesList();
  const remote = peerManager ? peerManager.getAllRemoteFiles() : [];
  return [...local, ...remote];
}

function broadcastToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// --- GET LOCAL IP ---
function getLocalIP() {
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

// --- NETWORKING ---
let discovery = null;
let fileServer = null;
let peerManager = null;

async function startNetworking() {
  const deviceName = os.hostname();

  fileServer = new FileServer({
    uploadsDir: UPLOADS_DIR,
    resolveFilePath: (fileId) => {
      const entry = localFiles.get(fileId);
      if (entry && entry.localPath && fs.existsSync(entry.localPath)) {
        return { path: entry.localPath, name: entry.name };
      }
      return null; // fallback to uploads dir scan
    },
    onWsConnection: (ws, req) => {
      const remoteAddress = req?.socket?.remoteAddress || '';
      peerManager.handleIncomingConnection(ws, remoteAddress);
    },
  });
  const port = await fileServer.start();

  fileServer.setDeviceInfo({
    id: DEVICE_ID,
    name: deviceName,
    platform: process.platform,
  });
  fileServer.setShelves(() => shelfStore.getShelves());
  fileServer.startDiscovery(52384);

  peerManager = new PeerManager({
    deviceId: DEVICE_ID,
    localFiles: getLocalFilesList,
    getLocalShelves: () => shelfStore.getShelves(),
    getLocalShelfFiles: (shelfId) => shelfStore.getFiles(shelfId),
    getShelfInfo: (shelfId) => shelfStore.getShelf(shelfId),
    onRemoteFilesChanged: () => {
      broadcastToRenderer('files-update', getAllFiles());
    },
    onPeersChanged: () => {
      broadcastToRenderer('peers-update', peerManager.getConnectedPeers());
    },
    onNewPeerConnected: (peer) => {
      savePeer(peer);
    },
    getDeletedShelfIds: () => shelfStore.getDeletedShelfIds(),
    onRemoteShelfEvent: (eventType, data) => {
      switch (eventType) {
        case 'sync': {
          const changed = shelfStore.mergeRemoteShelves(data.shelves, data.deletedShelfIds);
          if (changed) {
            broadcastToRenderer('shelves-update', shelfStore.getShelves());
            // Refresh shelf files for any new shelves
            for (const shelf of shelfStore.getShelves()) {
              const localShelfFiles = shelfStore.getFiles(shelf.id).map(f => ({
                ...f,
                available: f.localPath ? fs.existsSync(f.localPath) : true,
              }));
              const remoteFiles = peerManager ? peerManager.getRemoteShelfFiles(shelf.id) : [];
              broadcastToRenderer('shelf-files-update', {
                shelfId: shelf.id,
                files: [...localShelfFiles, ...remoteFiles],
              });
            }
          }
          break;
        }
        case 'created': {
          const added = shelfStore.applyRemoteShelfCreated(data.shelf);
          if (added) {
            broadcastToRenderer('shelves-update', shelfStore.getShelves());
          }
          break;
        }
        case 'updated': {
          const updated = shelfStore.applyRemoteShelfUpdated(data.shelfId, data);
          if (updated) {
            broadcastToRenderer('shelves-update', shelfStore.getShelves());
          }
          break;
        }
        case 'deleted': {
          shelfStore.applyRemoteShelfDeleted(data.shelfId);
          broadcastToRenderer('shelves-update', shelfStore.getShelves());
          break;
        }
      }
    },
    onRemoteShelfFilesChanged: (shelfId) => {
      const localShelfFiles = shelfStore.getFiles(shelfId).map(f => ({
        ...f,
        available: f.localPath ? fs.existsSync(f.localPath) : true,
      }));
      const remoteFiles = peerManager ? peerManager.getRemoteShelfFiles(shelfId) : [];
      broadcastToRenderer('shelf-files-update', {
        shelfId,
        files: [...localShelfFiles, ...remoteFiles],
      });
    },
  });

  discovery = new Discovery({
    deviceId: DEVICE_ID,
    deviceName: deviceName,
    serverPort: port,
    platform: process.platform,
    onPeerFound: (peer) => {
      peerManager.connectToPeer(peer);
    },
    onPeerLost: (peer) => {
      peerManager.disconnectPeer(peer.id);
    },
  });
  discovery.start();

  // Auto-reconnect to saved peers on startup
  for (const peer of savedPeers.values()) {
    if (peer.port > 0) {
      peerManager.connectToPeer(peer);
    }
  }

  console.log(`[Shelf] Device: ${deviceName} (${DEVICE_ID})`);
  console.log(`[Shelf] Server: http://${getLocalIP()}:${port}`);
  console.log(`[Shelf] Known peers: ${savedPeers.size}`);
}

function stopNetworking() {
  if (discovery) discovery.stop();
  if (peerManager) peerManager.stop();
  if (fileServer) fileServer.stop();
}

// --- TRAY ---
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Dragin Shelf');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Shelf',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: `Files: ${localFiles.size}`,
      enabled: false,
    },
    {
      label: `Peers: ${discovery ? discovery.getPeers().length : 0}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Shelf',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: `Files: ${localFiles.size}`,
      enabled: false,
    },
    {
      label: `Peers: ${discovery ? discovery.getPeers().length : 0}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// --- WINDOW ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    frame: true,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    title: isTestPeer ? 'Dragin Shelf (Peer 2)' : 'Dragin Shelf',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Block file:// navigations (caused by dropping files onto the window)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- MENU ---
function createMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- IPC HANDLERS ---
ipcMain.handle('get-device-info', () => {
  return {
    id: DEVICE_ID,
    name: os.hostname(),
    ip: getLocalIP(),
    platform: process.platform,
  };
});

ipcMain.handle('get-saved-peers', () => {
  return Array.from(savedPeers.values());
});

ipcMain.handle('remove-saved-peer', async (_event, peerId) => {
  savedPeers.delete(peerId);
  persistSavedPeers();
  // Also disconnect if currently connected
  if (peerManager) {
    peerManager.disconnectPeer(peerId);
  }
});

ipcMain.handle('get-connection-info', () => {
  return {
    ip: getLocalIP(),
    port: fileServer ? fileServer.getPort() : 0,
    id: DEVICE_ID,
    name: os.hostname(),
  };
});

ipcMain.handle('generate-pair-pin', () => {
  const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  if (fileServer) fileServer.setPairPin(pin);
  return pin;
});

ipcMain.handle('clear-pair-pin', () => {
  if (fileServer) fileServer.clearPairPin();
});

// Pick files using native dialog
ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return [];

  const picked = result.filePaths.map((fp) => {
    const stat = fs.statSync(fp);
    return {
      name: path.basename(fp),
      path: fp,
      size: stat.size,
      mimeType: 'application/octet-stream',
    };
  });
  return picked;
});

// Add files to the shelf (link, not copy — store path reference)
ipcMain.handle('add-files', async (_event, files) => {
  const generalShelf = shelfStore.getShelves()[0]; // default shelf
  const shelfId = generalShelf ? generalShelf.id : 'general';

  for (const file of files) {
    if (!file.path || !fs.existsSync(file.path)) continue;

    const fileId = crypto.randomBytes(6).toString('hex');

    const entry = {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      deviceId: DEVICE_ID,
      deviceName: os.hostname(),
      uploadedAt: Date.now(),
      localPath: file.path,
      thumbnail: generateThumbnail(file.path),
    };

    localFiles.set(fileId, entry);

    // Persist in shelf store
    shelfStore.addFile(shelfId, {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      deviceId: DEVICE_ID,
      deviceName: os.hostname(),
      addedAt: entry.uploadedAt,
      localPath: file.path,
      thumbnail: entry.thumbnail,
    });

    if (peerManager) {
      peerManager.broadcast({
        type: 'file-added',
        deviceId: DEVICE_ID,
        file: entry,
      });
      peerManager.broadcast({
        type: 'shelf-file-added',
        deviceId: DEVICE_ID,
        shelfId,
        file: shelfStore.getFile(fileId),
      });
    }
  }

  broadcastToRenderer('files-update', getAllFiles());
  broadcastToRenderer('shelf-files-update', { shelfId, files: shelfStore.getFiles(shelfId) });
  updateTrayMenu();
});

// Remove a local file (link-not-copy: do NOT delete original file)
ipcMain.handle('remove-file', async (_event, fileId) => {
  const entry = localFiles.get(fileId);
  if (!entry) return;

  // Get shelf info before removal so we can notify
  const shelfFile = shelfStore.getFile(fileId);
  const affectedShelfId = shelfFile ? shelfFile.shelfId : null;

  // Remove legacy copy from uploads dir if it exists
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const match = files.find((f) => f.startsWith(fileId + '__'));
    if (match) fs.unlinkSync(path.join(UPLOADS_DIR, match));
  } catch {}

  localFiles.delete(fileId);
  shelfStore.removeFile(fileId);

  if (peerManager) {
    peerManager.broadcast({
      type: 'file-removed',
      deviceId: DEVICE_ID,
      fileId: fileId,
    });
    if (affectedShelfId) {
      peerManager.broadcast({
        type: 'shelf-file-removed',
        deviceId: DEVICE_ID,
        shelfId: affectedShelfId,
        fileId: fileId,
      });
    }
  }

  broadcastToRenderer('files-update', getAllFiles());
  if (affectedShelfId) {
    broadcastToRenderer('shelf-files-update', { shelfId: affectedShelfId, files: shelfStore.getFiles(affectedShelfId) });
  }
  updateTrayMenu();
});

// --- SHELF MANAGEMENT IPC ---

ipcMain.handle('get-shelves', () => {
  return shelfStore.getShelves();
});

ipcMain.handle('create-shelf', async (_event, name) => {
  const shelf = shelfStore.createShelf(name, DEVICE_ID);
  if (peerManager) {
    peerManager.broadcast({ type: 'shelf-created', deviceId: DEVICE_ID, shelf });
  }
  broadcastToRenderer('shelves-update', shelfStore.getShelves());
  return shelf;
});

ipcMain.handle('delete-shelf', async (_event, shelfId) => {
  shelfStore.deleteShelf(shelfId);
  if (peerManager) {
    peerManager.broadcast({ type: 'shelf-deleted', deviceId: DEVICE_ID, shelfId });
  }
  broadcastToRenderer('shelves-update', shelfStore.getShelves());
});

ipcMain.handle('rename-shelf', async (_event, shelfId, newName) => {
  const shelf = shelfStore.renameShelf(shelfId, newName);
  if (peerManager && shelf) {
    peerManager.broadcastShelfUpdated(shelfId, { name: newName, updatedAt: shelf.updatedAt });
  }
  broadcastToRenderer('shelves-update', shelfStore.getShelves());
});

ipcMain.handle('set-shelf-auto-pin', async (_event, shelfId, autoPin) => {
  const shelf = shelfStore.setAutoPin(shelfId, autoPin);
  if (peerManager && shelf) {
    peerManager.broadcastShelfUpdated(shelfId, { autoPin, updatedAt: shelf.updatedAt });
  }
  broadcastToRenderer('shelves-update', shelfStore.getShelves());
});


ipcMain.handle('get-shelf-files', async (_event, shelfId) => {
  const localShelfFiles = shelfStore.getFiles(shelfId).map(f => ({
    ...f,
    available: f.localPath ? fs.existsSync(f.localPath) : true,
  }));
  const remoteFiles = peerManager ? peerManager.getRemoteShelfFiles(shelfId) : [];
  return [...localShelfFiles, ...remoteFiles];
});

ipcMain.handle('add-files-to-shelf', async (_event, shelfId, files) => {
  for (const file of files) {
    if (!file.path || !fs.existsSync(file.path)) continue;

    const fileId = crypto.randomBytes(6).toString('hex');

    const entry = {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      deviceId: DEVICE_ID,
      deviceName: os.hostname(),
      uploadedAt: Date.now(),
      localPath: file.path,
      thumbnail: generateThumbnail(file.path),
    };

    localFiles.set(fileId, entry);

    shelfStore.addFile(shelfId, {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      deviceId: DEVICE_ID,
      deviceName: os.hostname(),
      addedAt: entry.uploadedAt,
      localPath: file.path,
      thumbnail: entry.thumbnail,
    });

    // Broadcast v1 + v2
    if (peerManager) {
      peerManager.broadcast({ type: 'file-added', deviceId: DEVICE_ID, file: entry });
      peerManager.broadcast({ type: 'shelf-file-added', deviceId: DEVICE_ID, shelfId, file: shelfStore.getFile(fileId) });
    }
  }

  broadcastToRenderer('files-update', getAllFiles());
  broadcastToRenderer('shelf-files-update', { shelfId, files: shelfStore.getFiles(shelfId) });
  updateTrayMenu();
});

ipcMain.handle('pin-file', async (_event, fileId) => {
  shelfStore.pinFile(fileId);
  const file = shelfStore.getFile(fileId);
  if (file) {
    broadcastToRenderer('shelf-files-update', { shelfId: file.shelfId, files: shelfStore.getFiles(file.shelfId) });
  }
});

ipcMain.handle('unpin-file', async (_event, fileId) => {
  shelfStore.unpinFile(fileId);
  const file = shelfStore.getFile(fileId);
  if (file) {
    broadcastToRenderer('shelf-files-update', { shelfId: file.shelfId, files: shelfStore.getFiles(file.shelfId) });
  }
});

// --- DOWNLOAD MANAGEMENT ---
const activeDownloads = new Map(); // fileId -> { abort }

// Download a file from a remote peer
ipcMain.handle('download-file', async (_event, fileId, fileName, peerId, deviceIp, devicePort) => {
  const downloadsDir = path.join(app.getPath('downloads'), 'Shelf');
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  // Deduplicate filename
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let savePath = path.join(downloadsDir, fileName);
  let counter = 1;
  while (fs.existsSync(savePath)) {
    savePath = path.join(downloadsDir, `${base} (${counter})${ext}`);
    counter++;
  }

  if (devicePort > 0) {
    // HTTP download (peer has an HTTP server)
    return new Promise((resolve, reject) => {
      const url = `http://${deviceIp}:${devicePort}/files/${fileId}`;
      const file = fs.createWriteStream(savePath);
      let aborted = false;

      const req = http.get(url, (response) => {
        const total = parseInt(response.headers['content-length'] || '0', 10);
        let received = 0;

        response.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            broadcastToRenderer('download-progress', {
              fileId, progress: Math.round((received / total) * 100),
            });
          }
        });

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          activeDownloads.delete(fileId);
          broadcastToRenderer('download-progress', { fileId, progress: 100 });
          resolve();
        });
      });

      req.on('error', (err) => {
        fs.unlink(savePath, () => {});
        activeDownloads.delete(fileId);
        if (!aborted) reject(err);
      });

      activeDownloads.set(fileId, {
        abort: () => {
          aborted = true;
          req.destroy();
          file.close();
          fs.unlink(savePath, () => {});
        },
      });
    });
  } else {
    // WS download (peer has no HTTP server, e.g. mobile)
    try {
      const data = await peerManager.requestFile(peerId, fileId, (progress) => {
        broadcastToRenderer('download-progress', { fileId, progress });
      });
      fs.writeFileSync(savePath, data);
      activeDownloads.delete(fileId);
      broadcastToRenderer('download-progress', { fileId, progress: 100 });
    } catch (err) {
      activeDownloads.delete(fileId);
      throw err;
    }
  }
});

ipcMain.on('abort-download', (_event, fileId) => {
  const dl = activeDownloads.get(fileId);
  if (dl) {
    dl.abort();
    activeDownloads.delete(fileId);
  }
  if (peerManager) {
    peerManager.cancelTransfer(fileId);
  }
});

// --- APP LIFECYCLE ---
app.whenReady().then(async () => {
  initPaths();
  createMenu();
  createTray();
  createWindow();
  await startNetworking();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopNetworking();
});

app.on('window-all-closed', () => {
  // Keep app running in tray on all platforms
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
