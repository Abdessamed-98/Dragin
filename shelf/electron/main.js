const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { Discovery } = require('./net/discovery');
const { FileServer } = require('./net/fileServer');
const { PeerManager } = require('./net/peerManager');

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
    onWsConnection: (ws) => {
      peerManager.handleIncomingConnection(ws);
    },
  });
  const port = await fileServer.start();

  peerManager = new PeerManager({
    deviceId: DEVICE_ID,
    localFiles: getLocalFilesList,
    onRemoteFilesChanged: () => {
      broadcastToRenderer('files-update', getAllFiles());
    },
  });

  discovery = new Discovery({
    deviceId: DEVICE_ID,
    deviceName: deviceName,
    serverPort: port,
    platform: process.platform,
    onPeerFound: (peer) => {
      peerManager.connectToPeer(peer);
      broadcastToRenderer('peers-update', discovery.getPeers());
    },
    onPeerLost: (peer) => {
      peerManager.disconnectPeer(peer.id);
      broadcastToRenderer('peers-update', discovery.getPeers());
    },
  });
  discovery.start();

  console.log(`[Shelf] Device: ${deviceName} (${DEVICE_ID})`);
  console.log(`[Shelf] Server: http://${getLocalIP()}:${port}`);
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

// Add files to the shelf
ipcMain.handle('add-files', async (_event, files) => {
  for (const file of files) {
    const fileId = crypto.randomBytes(6).toString('hex');
    const safeName = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const storageName = `${fileId}__${safeName}`;
    const destPath = path.join(UPLOADS_DIR, storageName);

    if (file.path && fs.existsSync(file.path)) {
      fs.copyFileSync(file.path, destPath);
    } else {
      continue;
    }

    const entry = {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      deviceId: DEVICE_ID,
      deviceName: os.hostname(),
      uploadedAt: Date.now(),
    };

    localFiles.set(fileId, entry);

    if (peerManager) {
      peerManager.broadcast({
        type: 'file-added',
        deviceId: DEVICE_ID,
        file: entry,
      });
    }
  }

  broadcastToRenderer('files-update', getAllFiles());
  updateTrayMenu();
});

// Remove a local file
ipcMain.handle('remove-file', async (_event, fileId) => {
  const entry = localFiles.get(fileId);
  if (!entry) return;

  const files = fs.readdirSync(UPLOADS_DIR);
  const match = files.find((f) => f.startsWith(fileId + '__'));
  if (match) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, match)); } catch {}
  }

  localFiles.delete(fileId);

  if (peerManager) {
    peerManager.broadcast({
      type: 'file-removed',
      deviceId: DEVICE_ID,
      fileId: fileId,
    });
  }

  broadcastToRenderer('files-update', getAllFiles());
  updateTrayMenu();
});

// Download a file from a remote peer
ipcMain.handle('download-file', async (_event, fileId, fileName, deviceIp, devicePort) => {
  const url = `http://${deviceIp}:${devicePort}/files/${fileId}`;

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: fileName || fileId,
  });

  if (result.canceled || !result.filePath) return;

  const http = require('http');
  const file = fs.createWriteStream(result.filePath);

  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(result.filePath, () => {});
      reject(err);
    });
  });
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
