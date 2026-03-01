const { app, BrowserWindow, screen, ipcMain, shell, Menu, Tray, nativeImage, clipboard, powerMonitor } = require('electron');
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const uIOhook = require('uiohook-napi').uIOhook;
const log = require('electron-log');

let pyServer = null;
let tray = null;

// --- MIGRATE userData from old "demo" name to "dragin-flow" ---
(function migrateUserData() {
    const newDir = app.getPath('userData'); // %APPDATA%/dragin-flow
    const oldDir = path.join(path.dirname(newDir), 'demo');
    if (fs.existsSync(oldDir) && !fs.existsSync(path.join(newDir, 'settings.json'))) {
        try {
            fs.mkdirSync(newDir, { recursive: true });
            for (const item of fs.readdirSync(oldDir)) {
                const src = path.join(oldDir, item);
                const dest = path.join(newDir, item);
                if (!fs.existsSync(dest)) {
                    fs.cpSync(src, dest, { recursive: true });
                }
            }
            log.info('[Migration] Copied user data from', oldDir, 'to', newDir);
        } catch (err) {
            log.error('[Migration] Failed to migrate user data:', err);
        }
    }
})();

// --- PERSISTENCE ---
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        log.error('[Settings] Failed to load settings:', err);
    }
    return null;
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
        log.error('[Settings] Failed to save settings:', err);
    }
}

const createMenu = () => {
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
                { role: 'delete' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Open Logs Folder',
                    click: () => {
                        const logPath = log.transports.file.getFile().path;
                        shell.openPath(path.dirname(logPath));
                    }
                }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
};

// --- PYTHON BACKEND ---
function startPythonServer() {
    let executablePath;
    let args = [];

    if (!app.isPackaged) {
        // Dev mode: use venv python
        executablePath = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
        if (!fs.existsSync(executablePath)) {
            executablePath = 'python.exe';
        }
        args = [path.join(__dirname, 'app.py')];
    } else {
        // Production: use bundled executable
        executablePath = path.join(process.resourcesPath, 'app', 'app.exe');
    }

    log.info(`[Python] Starting backend from: ${executablePath}`);

    pyServer = spawn(executablePath, args, {
        env: {
            ...process.env,
            DRAGIN_TOOLS_DIR: getToolsDir(),
            ...(app.isPackaged ? {} : { DRAGIN_DEV_MEMORY_LOG: '1' }),
        },
    });

    pyServer.stdout.on('data', (data) => log.info(`[Python] ${data}`));
    pyServer.stderr.on('data', (data) => {
        const msg = data.toString();
        // Flask logs to stderr by default, so not all stderr is errors
        if (msg.includes('Error') || msg.includes('Traceback')) {
            log.error(`[Python Error] ${msg}`);
        } else {
            log.info(`[Python] ${msg}`);
        }
    });

    pyServer.on('close', (code) => {
        log.info(`[Python] Backend exited with code ${code}`);
    });
}

// --- SHELF PERSISTENCE ---
let SHELF_DIR = null; // Initialized lazily after app is ready

function getShelfDir() {
    if (!SHELF_DIR) {
        SHELF_DIR = path.join(app.getPath('userData'), 'shelf');
        if (!fs.existsSync(SHELF_DIR)) fs.mkdirSync(SHELF_DIR, { recursive: true });
    }
    return SHELF_DIR;
}

// Map common image extensions → MIME types
const MIME_MAP = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif',  webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp',  tiff: 'image/tiff', tif: 'image/tiff',
    mp4: 'video/mp4',  webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska', ogv: 'video/ogg',
    pdf: 'application/pdf',
};
function getMime(name) {
    const ext = path.extname(name).toLowerCase().slice(1);
    return MIME_MAP[ext] || 'application/octet-stream';
}
function toDataUrl(buf, name) {
    return `data:${getMime(name)};base64,${buf.toString('base64')}`;
}

ipcMain.handle('shelf:save', (_event, id, buffer, name) => {
    const dir = getShelfDir();
    const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const fileName = `${id}__${safeName}`;

    // Cap at 20 items: delete oldest if needed
    const existing = fs.readdirSync(dir);
    if (existing.length >= 20) {
        const oldest = existing
            .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => a.mtime - b.mtime)[0];
        if (oldest) try { fs.unlinkSync(path.join(dir, oldest.f)); } catch {}
    }

    const buf = Buffer.from(buffer);
    fs.writeFileSync(path.join(dir, fileName), buf);
    // Return a data URL so the renderer can display it without file:// cross-origin issues
    return toDataUrl(buf, name);
});

ipcMain.handle('shelf:load', () => {
    const dir = getShelfDir();
    const files = fs.readdirSync(dir);
    return files
        .map(fileName => {
            const filePath = path.join(dir, fileName);
            const sepIdx = fileName.indexOf('__');
            const id   = sepIdx > 0 ? fileName.substring(0, sepIdx)  : fileName;
            const name = sepIdx > 0 ? fileName.substring(sepIdx + 2) : fileName;
            const buf  = fs.readFileSync(filePath);
            return { id, name, url: toDataUrl(buf, name), mtime: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime)
        .map(({ id, name, url }) => ({ id, name, url }));
});

ipcMain.handle('shelf:delete', (_event, itemIds) => {
    const dir = getShelfDir();
    const files = fs.readdirSync(dir);
    for (const itemId of (Array.isArray(itemIds) ? itemIds : [itemIds])) {
        const match = files.find(f => f.startsWith(itemId + '__'));
        if (match) try { fs.unlinkSync(path.join(dir, match)); } catch {}
    }
    return true;
});

// --- NATIVE FILE DRAG-OUT ---
const tempDragFiles = new Set();
// Initialized in app.whenReady using the real app icon (guaranteed to be a valid NativeImage)
let DRAG_ICON = null;

function findShelfFile(id) {
    try {
        const dir = getShelfDir();
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.startsWith(id + '__'));
        return match ? path.join(dir, match) : null;
    } catch { return null; }
}

// sendSync handler — must set event.returnValue so the renderer doesn't hang
ipcMain.on('native-drag-start', (event, { items }) => {
    try {
        const filePaths = [];

        for (const { id, name, dataUrl, filePath: srcPath } of (items || [])) {
            // Priority 1: shelf items already on disk
            let filePath = findShelfFile(id);

            // Priority 2: explicit file path from renderer (Electron exposes File.path for dropped files)
            if (!filePath && srcPath && fs.existsSync(srcPath)) {
                filePath = srcPath;
            }

            if (!filePath && dataUrl) {
                // Write a temp file from the data URL (for non-shelf tools)
                const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
                const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
                filePath = path.join(app.getPath('temp'), `drag_${Date.now()}_${safeName}`);
                fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
                tempDragFiles.add(filePath);
            }

            if (filePath) filePaths.push(filePath);
        }

        if (filePaths.length > 0 && DRAG_ICON) {
            event.sender.startDrag({ files: filePaths, icon: DRAG_ICON });
        }
    } catch (err) {
        log.error('[NativeDrag] Failed:', err);
    } finally {
        // Required for sendSync — without this the renderer hangs indefinitely
        event.returnValue = null;
    }
});

// --- STATE MANAGEMENT ---
const savedSettings = loadSettings();

// Default tool IDs (lightweight, ship with app)
const DEFAULT_TOOL_IDS = ['compressor', 'cropper', 'vectorizer', 'pdf', 'metadata', 'watermark', 'palette', 'shelf'];
// All known tool IDs (for migration)
const ALL_TOOL_IDS = ['remover', 'compressor', 'shelf', 'converter', 'vectorizer', 'ocr', 'palette', 'cropper', 'upscaler', 'pdf', 'metadata', 'watermark'];

// Download URLs for on-demand tools (mirrors toolRegistry.ts for main process)
const TOOL_DOWNLOAD_URLS = {
    remover:   'https://github.com/Abdessamed-98/flow-tools/releases/download/remover-v1/remover-win-x64.zip',
    upscaler:  'https://github.com/Abdessamed-98/flow-tools/releases/download/upscaler-v1/upscaler-win-x64.zip',
    ocr:       'https://github.com/Abdessamed-98/flow-tools/releases/download/ocr-v1/ocr-win-x64.zip',
    converter: 'https://github.com/Abdessamed-98/flow-tools/releases/download/converter-v1/converter-win-x64.zip',
};
const ON_DEMAND_TOOL_IDS = Object.keys(TOOL_DOWNLOAD_URLS);

// Determine installedToolIds with migration logic
let initialInstalledToolIds;
if (savedSettings && savedSettings.installedToolIds) {
    // Returning user with installedToolIds already saved
    initialInstalledToolIds = savedSettings.installedToolIds;
} else if (savedSettings && savedSettings.activeToolIds) {
    // Existing user upgrading — all tools were available before, mark all as installed
    initialInstalledToolIds = ALL_TOOL_IDS;
} else {
    // Brand new user — only default tools
    initialInstalledToolIds = [...DEFAULT_TOOL_IDS];
}

// Default tools ALWAYS count as installed (they ship with the app, no data to remove)
for (const id of DEFAULT_TOOL_IDS) {
    if (!initialInstalledToolIds.includes(id)) {
        initialInstalledToolIds.push(id);
    }
}

let state = {
    activeToolIds: (savedSettings && savedSettings.activeToolIds) || ['compressor', 'shelf', 'palette'],
    installedToolIds: initialInstalledToolIds,
    installProgress: {}, // { [toolId]: { toolId, status, progress, step, error } } — transient, not persisted
    sessions: {}, // { toolId: { id, items: [], status } }
    isDockEnabled: true,
    isGalleryOpen: false,
    isDockPinned: false
};

// --- TOOL INSTALLATION PATHS ---
function getToolsDir() {
    const dir = path.join(app.getPath('userData'), 'tools');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getToolDir(toolId) {
    return path.join(getToolsDir(), toolId);
}

function getTempDir() {
    const dir = path.join(getToolsDir(), '.tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function isToolDownloaded(toolId) {
    return fs.existsSync(path.join(getToolDir(toolId), 'version.json'));
}

// --- DOWNLOAD HELPER ---
/**
 * Download a file from URL with redirect following and progress tracking.
 * Streams to disk — safe for large files (100MB+).
 */
function downloadFile(url, destPath, onProgress, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const reqOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: { 'User-Agent': 'DraginFlow/1.0' },
        };

        const req = https.get(reqOptions, (res) => {
            // Follow redirects (GitHub 302 → CDN)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                downloadFile(res.headers.location, destPath, onProgress, options)
                    .then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
            let downloadedBytes = 0;
            const fileStream = fs.createWriteStream(destPath);

            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) onProgress(downloadedBytes, totalBytes);
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => { fileStream.close(); resolve(); });
            fileStream.on('error', (err) => {
                try { fs.unlinkSync(destPath); } catch {}
                reject(err);
            });
            res.on('error', (err) => {
                fileStream.destroy();
                try { fs.unlinkSync(destPath); } catch {}
                reject(err);
            });
        });

        req.on('error', (err) => {
            try { fs.unlinkSync(destPath); } catch {}
            reject(err);
        });

        // Cancellation support
        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                req.destroy();
                try { fs.unlinkSync(destPath); } catch {}
                reject(new Error('Download cancelled'));
            }, { once: true });
        }
    });
}

// --- ZIP EXTRACTION HELPER (streams via PowerShell — no memory bloat) ---
function extractZip(zipPath, targetDir, onProgress) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(targetDir, { recursive: true });
        onProgress(0, 1);

        const ps = spawn('powershell', [
            '-NoProfile', '-Command',
            `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`
        ]);

        ps.on('error', reject);
        ps.on('close', (code) => {
            if (code === 0) {
                onProgress(1, 1);
                resolve();
            } else {
                reject(new Error(`Expand-Archive exited with code ${code}`));
            }
        });
    });
}

// --- TOOL INSTALLATION (real download + extract) ---
let activeInstalls = {}; // { [toolId]: AbortController }

async function handleToolInstall(toolId) {
    if (state.installedToolIds.includes(toolId)) return;
    if (activeInstalls[toolId]) return;

    const downloadUrl = TOOL_DOWNLOAD_URLS[toolId];
    if (!downloadUrl) {
        log.error(`[Install] No download URL for tool: ${toolId}`);
        return;
    }

    const abortController = new AbortController();
    activeInstalls[toolId] = abortController;

    const toolDir = getToolDir(toolId);
    const tempPath = path.join(getTempDir(), `${toolId}-${Date.now()}.zip`);

    state.installProgress[toolId] = { toolId, status: 'installing', progress: 0, step: 'جاري التحضير...' };
    broadcastState();

    try {
        // --- Phase 1: Download (0% → 70%) ---
        let lastBroadcast = 0;
        await downloadFile(downloadUrl, tempPath, (downloaded, total) => {
            const now = Date.now();
            if (now - lastBroadcast < 100) return; // Throttle: max 10 updates/sec
            lastBroadcast = now;
            const pct = Math.round((downloaded / total) * 70);
            state.installProgress[toolId] = { toolId, status: 'installing', progress: pct, step: 'جاري التحميل...' };
            broadcastState();
        }, { signal: abortController.signal });

        // --- Phase 2: Extract (70% → 95%) ---
        state.installProgress[toolId] = { toolId, status: 'installing', progress: 70, step: 'جاري التثبيت...' };
        broadcastState();

        // Clean previous partial extraction
        if (fs.existsSync(toolDir)) fs.rmSync(toolDir, { recursive: true, force: true });

        await extractZip(tempPath, toolDir, (extracted, total) => {
            const pct = 70 + Math.round((extracted / total) * 25);
            state.installProgress[toolId] = { toolId, status: 'installing', progress: pct, step: 'جاري التثبيت...' };
            broadcastState();
        });

        // --- Phase 3: Finalize (95% → 100%) ---
        fs.writeFileSync(path.join(toolDir, 'version.json'), JSON.stringify({
            toolId,
            version: downloadUrl.match(/download\/([^/]+)\//)?.[1] || 'unknown',
            downloadUrl,
            installedAt: new Date().toISOString(),
            platform: process.platform,
            arch: process.arch,
        }, null, 2), 'utf-8');

        // Cleanup temp
        try { fs.unlinkSync(tempPath); } catch {}

        // Mark as installed
        state.installedToolIds.push(toolId);
        state.installProgress[toolId] = { toolId, status: 'installed', progress: 100, step: 'اكتمل التثبيت' };
        persistSettings();
        broadcastState();

        // Clear progress after short delay
        setTimeout(() => {
            delete state.installProgress[toolId];
            broadcastState();
        }, 2000);

    } catch (err) {
        log.error(`[Install] Failed for ${toolId}:`, err.message);

        // Cleanup partial downloads and extractions
        try { fs.unlinkSync(tempPath); } catch {}
        if (fs.existsSync(toolDir)) {
            try { fs.rmSync(toolDir, { recursive: true, force: true }); } catch {}
        }

        const isCancelled = err.message === 'Download cancelled';
        state.installProgress[toolId] = {
            toolId, status: 'error', progress: 0,
            step: isCancelled ? 'تم الإلغاء' : undefined,
            error: isCancelled ? 'تم إلغاء التحميل' : (err.message || 'فشل التثبيت'),
        };
        broadcastState();

        if (isCancelled) {
            setTimeout(() => {
                delete state.installProgress[toolId];
                broadcastState();
            }, 2000);
        }
    } finally {
        delete activeInstalls[toolId];
    }
}

// --- CROSS-WINDOW TOOL DRAG STATE ---
let galleryDraggedToolId = null;  // Tool being dragged FROM gallery TO dock
let dockDraggedToolId = null;     // Tool being dragged FROM dock TO gallery
let lastProposedIndex = 0;        // Last proposed dock insertion index

function broadcastState() {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
        try { win.webContents.send('state-update', state); } catch (_) {}
    });
}

// Persist tool state
function persistSettings() {
    saveSettings({
        activeToolIds: state.activeToolIds,
        installedToolIds: state.installedToolIds,
    });
}

// Legacy alias
function persistToolOrder() {
    persistSettings();
}

// --- WINDOW MANAGEMENT ---
let dockWindow = null;
let galleryWindow = null;

const createDockWindow = () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    dockWindow = new BrowserWindow({
        width: 600, // Reduced from 800 to minimize footprint
        height: height,
        x: width - 600,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: !app.isPackaged ? true : false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    const devUrl = 'http://localhost:5173?window=dock';
    const prodPath = path.join(__dirname, 'dist/index.html');
    const prodUrl = `file://${prodPath}?window=dock`;

    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    log.info(`[Main] Window: Dock | Dev: ${isDev} | isPackaged: ${app.isPackaged}`);

    if (isDev) {
        dockWindow.loadURL(devUrl);
    } else {
        dockWindow.loadFile(prodPath, { search: 'window=dock' });
    }

    // Highest z-order so the dock stays above other always-on-top windows
    dockWindow.setAlwaysOnTop(true, 'screen-saver');

    // Re-assert on-top after Windows steals it (e.g. fullscreen apps, UAC dialogs)
    dockWindow.on('always-on-top-changed', (_e, isOnTop) => {
        if (!isOnTop) dockWindow.setAlwaysOnTop(true, 'screen-saver');
    });

    // Start in click-through mode
    dockWindow.setIgnoreMouseEvents(true, { forward: true });
};

// ============================================================
// uIOhook GLOBAL MOUSE DETECTION
// ============================================================
// Instead of polling or renderer-side toggling, we use uiohook-napi
// to detect global mouse button state + cursor position.
//
// Logic:
//   mousedown + cursor near right edge → enable events (drag detection)
//   mousemove while button down + near edge → enable events
//   mouseup → restore click-through (if dock is idle)
//
// This is flicker-free because:
//   - Regular mouse movement (no button) → NEVER enables events
//   - Only physical mouse-button-down triggers the enable
//   - mouseup is a definitive signal to restore click-through
// ============================================================
let dockMode = 'idle';   // 'idle' or 'active' — set by renderer via IPC
let isMouseDown = false; // Global mouse button state

function checkAndEnableEdge(x) {
    if (!dockWindow || dockWindow.isDestroyed() || dockMode !== 'idle') return;

    const display = screen.getPrimaryDisplay();
    const rightEdge = display.workAreaSize.width;

    // Is cursor within 16px of the right screen edge?
    if (x >= rightEdge - 16) {
        dockWindow.setIgnoreMouseEvents(false);
    }
}

// Helper: is x,y inside a BrowserWindow?
function isOverWindow(win, x, y) {
    if (!win || win.isDestroyed()) return false;
    const bounds = win.getBounds();
    return x >= bounds.x && x <= bounds.x + bounds.width &&
        y >= bounds.y && y <= bounds.y + bounds.height;
}

// Helper: calculate proposed dock index from global Y position
function calcProposedIndex(y) {
    if (!dockWindow || dockWindow.isDestroyed()) return 0;
    const bounds = dockWindow.getBounds();
    const toolCount = state.activeToolIds.length;
    if (toolCount === 0) return 0;
    // Each tool icon is ~80px + 16px gap, centered vertically
    const totalHeight = toolCount * 96;
    const startY = bounds.y + (bounds.height - totalHeight) / 2;
    const relativeY = y - startY;
    const index = Math.round(relativeY / 96);
    return Math.max(0, Math.min(index, toolCount));
}

const createGalleryWindow = () => {
    if (galleryWindow) {
        galleryWindow.show();
        galleryWindow.focus();
        return;
    }

    galleryWindow = new BrowserWindow({
        width: 700,
        height: 500,
        frame: true,
        transparent: false,
        backgroundColor: '#0f172a', // slate-900
        autoHideMenuBar: true,
        show: false, // Don't show until ready
        icon: path.join(__dirname, 'icon.png'),
        title: 'Dragin Flow',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: !app.isPackaged ? true : false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    galleryWindow.once('ready-to-show', () => {
        galleryWindow.show();
    });

    const devUrl = 'http://localhost:5173?window=gallery';
    const prodPath = path.join(__dirname, 'dist/index.html');

    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    if (isDev) {
        galleryWindow.loadURL(devUrl);
    } else {
        galleryWindow.loadFile(prodPath, { search: 'window=gallery' });
    }

    galleryWindow.on('closed', () => {
        galleryWindow = null;
        state.isGalleryOpen = false;
        broadcastState();
    });

    state.isGalleryOpen = true;
    broadcastState();
};

// --- APP LIFECYCLE ---
app.whenReady().then(() => {
    // --- Startup: verify on-demand tools exist on disk ---
    state.installedToolIds = state.installedToolIds.filter(id => {
        if (DEFAULT_TOOL_IDS.includes(id)) return true;           // default: always keep
        if (!ON_DEMAND_TOOL_IDS.includes(id)) return true;        // unknown: keep (forward compat)
        return isToolDownloaded(id);                               // on-demand: verify version.json exists
    });
    persistSettings();

    // Clean up stale temp files from crashed installs
    try {
        const tmpDir = path.join(app.getPath('userData'), 'tools', '.tmp');
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}

    // --- Dev-only memory logger (stripped in production) ---
    if (!app.isPackaged) {
        setInterval(() => {
            const mem = process.memoryUsage();
            log.info(`[Memory:Main] RSS: ${(mem.rss / 1024 / 1024).toFixed(0)}MB | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB | External: ${(mem.external / 1024 / 1024).toFixed(0)}MB`);
        }, 30000);
    }

    createMenu();
    createDockWindow();

    // --- DRAG ICON ---
    // Reuse the app icon so we have a guaranteed valid NativeImage for startDrag()
    DRAG_ICON = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 });

    // --- SYSTEM TRAY ---
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Antigravity');

    function buildTrayMenu() {
        const menu = Menu.buildFromTemplate([
            {
                label: state.isDockPinned ? 'إخفاء الشريط' : 'إظهار الشريط',
                click: () => {
                    state.isDockPinned = !state.isDockPinned;
                    broadcastState();
                    buildTrayMenu();
                }
            },
            {
                label: 'الإعدادات',
                click: () => createGalleryWindow()
            },
            { type: 'separator' },
            {
                label: 'إعادة تشغيل الشريط',
                click: () => {
                    if (dockWindow && !dockWindow.isDestroyed()) {
                        dockWindow.webContents.reload();
                    }
                }
            },
            {
                label: 'DevTools',
                click: () => {
                    if (dockWindow && !dockWindow.isDestroyed()) {
                        // Force dock visible + interactive so devTools panel is usable
                        dockWindow.setBounds({
                            x: dockWindow.getBounds().x,
                            y: 0,
                            width: 600,
                            height: dockWindow.getBounds().height
                        }, false);
                        dockWindow.setIgnoreMouseEvents(false);
                        dockWindow.webContents.openDevTools({ mode: 'detach' });
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'إنهاء',
                click: () => app.quit()
            }
        ]);
        tray.setContextMenu(menu);
    }

    buildTrayMenu();
    tray.on('click', () => {
        createGalleryWindow();
    });

    // Start Mouse Hook
    uIOhook.start();

    // Restart uIOhook after system sleep/wake — Windows drops native hooks on resume
    powerMonitor.on('resume', () => {
        isMouseDown = false; // missed the mouseup during sleep
        dockMode = 'idle';
        if (dockWindow && !dockWindow.isDestroyed()) {
            dockWindow.setIgnoreMouseEvents(true, { forward: true });
        }
        try { uIOhook.stop(); } catch {}
        uIOhook.start();
    });

    // Start Python backend
    startPythonServer();
});

app.on('window-all-closed', () => {
    // Kill Python server cleanly
    if (pyServer) {
        spawn('taskkill', ['/pid', pyServer.pid, '/f', '/t']);
    }
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    // Clean up any temp files written for native drag-out
    for (const f of tempDragFiles) try { fs.unlinkSync(f); } catch {}
});

// --- uIOhook EVENT HANDLERS ---
uIOhook.on('mousedown', (e) => {
    isMouseDown = true;
    // Don't checkAndEnableEdge here — only on mousemove.
    // This prevents interfering with scrollbar clicks at the right edge.
});

uIOhook.on('mousemove', () => {
    if (!isMouseDown) return; // Only care about drag (button held down)

    // Use Electron's logical (device-independent) cursor coords — these match
    // getBounds() and workAreaSize on every DPI setting. uIOhook e.x/e.y are
    // physical pixels on high-DPI displays which would cause coordinate mismatches.
    const cursor = screen.getCursorScreenPoint();
    checkAndEnableEdge(cursor.x);

    // --- GALLERY → DOCK: Track mouse position during external tool drag ---
    if (galleryDraggedToolId && dockWindow && !dockWindow.isDestroyed()) {
        const display = screen.getPrimaryDisplay();
        const rightEdge = display.workAreaSize.width;
        const nearDock = cursor.x >= rightEdge - 400; // Dock area

        if (nearDock) {
            const newIndex = calcProposedIndex(cursor.y);
            if (newIndex !== lastProposedIndex) {
                lastProposedIndex = newIndex;
            }
            dockWindow.webContents.send('external-tool-drag-move', {
                toolId: galleryDraggedToolId,
                proposedIndex: newIndex
            });
        } else {
            dockWindow.webContents.send('external-tool-drag-move', {
                toolId: galleryDraggedToolId,
                proposedIndex: null  // Not near dock, hide ghost
            });
        }
    }
});

uIOhook.on('mouseup', () => {
    isMouseDown = false;

    // Use logical (device-independent) coords so they match getBounds() and workAreaSize.
    const cursor = screen.getCursorScreenPoint();

    // --- GALLERY → DOCK: Finalize add on mouseup ---
    if (galleryDraggedToolId) {
        const display = screen.getPrimaryDisplay();
        const rightEdge = display.workAreaSize.width;
        const nearDock = cursor.x >= rightEdge - 400;

        if (nearDock && !state.activeToolIds.includes(galleryDraggedToolId)) {
            const insertIndex = calcProposedIndex(cursor.y);
            const newOrder = [...state.activeToolIds];
            newOrder.splice(insertIndex, 0, galleryDraggedToolId);
            state.activeToolIds = newOrder;
            broadcastState();
            persistToolOrder();
        }

        // Tell dock to clear external drag state
        if (dockWindow && !dockWindow.isDestroyed()) {
            dockWindow.webContents.send('external-tool-drag-end');
        }
        galleryDraggedToolId = null;
        lastProposedIndex = 0;
    }

    // --- DOCK → GALLERY: Finalize removal on mouseup ---
    if (dockDraggedToolId) {
        if (isOverWindow(galleryWindow, cursor.x, cursor.y)) {
            // Mouse released over gallery → remove tool
            state.activeToolIds = state.activeToolIds.filter(id => id !== dockDraggedToolId);
            broadcastState();
            persistToolOrder();
        }

        // Tell gallery to hide removal overlay
        if (galleryWindow && !galleryWindow.isDestroyed()) {
            galleryWindow.webContents.send('dock-tool-drag-end');
        }
        dockDraggedToolId = null;
    }

    // Restore click-through if dock is in idle mode
    if (dockMode === 'idle' && dockWindow && !dockWindow.isDestroyed()) {
        dockWindow.setIgnoreMouseEvents(true, { forward: true });
    }
});

// --- IPC HANDLERS ---

ipcMain.on('renderer-ready', (event) => {
    event.sender.send('state-update', state);
});

ipcMain.on('open-gallery', () => {
    createGalleryWindow();
});

ipcMain.on('close-gallery', () => {
    if (galleryWindow) galleryWindow.close();
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setIgnoreMouseEvents(ignore, options);
});

// Dock mode IPC: renderer tells us when it's active vs idle
ipcMain.on('dock-mode', (event, mode) => {
    dockMode = mode;
    if (mode === 'idle') {
        // Idle: restore click-through, uiohook handles edge detection
        if (dockWindow && !dockWindow.isDestroyed()) {
            dockWindow.setIgnoreMouseEvents(true, { forward: true });
        }
    }
    // For 'active': renderer controls via interactive islands
});

ipcMain.on('resize-dock', (event, width) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const currentBounds = win.getBounds();

    // Skip if width hasn't meaningfully changed (prevents jitter)
    if (Math.abs(currentBounds.width - width) < 2) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;

    // Position always anchored to right edge of screen
    const newX = workArea.width - width;

    win.setBounds({
        x: newX,
        y: 0,
        width: width,
        height: currentBounds.height
    }, false); // false = no animation, prevents shaking
});

ipcMain.on('dispatch-action', (event, action) => {
    // Redux-like handler in Main
    switch (action.type) {
        case 'ADD_TOOL':
            // Only allow adding tools that are installed
            if (state.installedToolIds.includes(action.payload) && !state.activeToolIds.includes(action.payload)) {
                state.activeToolIds.push(action.payload);
                broadcastState();
                persistToolOrder();
            }
            break;
        case 'REMOVE_TOOL':
            state.activeToolIds = state.activeToolIds.filter(id => id !== action.payload);
            broadcastState();
            persistToolOrder();
            break;
        case 'INSTALL_TOOL':
            handleToolInstall(action.payload);
            break;
        case 'UNINSTALL_TOOL': {
            // Only on-demand tools can be uninstalled (default tools ship with the app)
            if (DEFAULT_TOOL_IDS.includes(action.payload)) break;

            // Cancel active download if in progress
            if (activeInstalls[action.payload]) {
                activeInstalls[action.payload].abort();
            }

            // Remove from state
            state.installedToolIds = state.installedToolIds.filter(id => id !== action.payload);
            state.activeToolIds = state.activeToolIds.filter(id => id !== action.payload);
            delete state.installProgress[action.payload];

            // Delete extracted tool directory
            const toolDir = getToolDir(action.payload);
            if (fs.existsSync(toolDir)) {
                try {
                    fs.rmSync(toolDir, { recursive: true, force: true });
                    log.info(`[Install] Uninstalled ${action.payload}: deleted ${toolDir}`);
                } catch (err) {
                    log.error(`[Install] Failed to delete ${toolDir}:`, err);
                }
            }

            broadcastState();
            persistSettings();
            break;
        }
        case 'CANCEL_INSTALL':
            if (activeInstalls[action.payload]) {
                activeInstalls[action.payload].abort();
            }
            break;
        case 'REORDER_TOOLS':
            // Filter to only keep IDs that currently exist — prevents the race where
            // dragend (dock) sends REORDER_TOOLS with stale order AFTER mouseup (main)
            // already removed a tool that was dragged to the gallery.
            state.activeToolIds = action.payload.filter(id => state.activeToolIds.includes(id));
            broadcastState();
            persistToolOrder();
            break;
        case 'TOGGLE_DOCK':
            state.isDockEnabled = !state.isDockEnabled;
            broadcastState();
            // When re-enabling, reload the dock to revive it if it died
            if (state.isDockEnabled && dockWindow && !dockWindow.isDestroyed()) {
                dockWindow.webContents.reload();
            }
            break;
        case 'UPDATE_SESSION':
            const { toolId, session } = action.payload;
            state.sessions[toolId] = session;
            broadcastState();
            break;
        case 'CLEAR_SESSIONS':
            state.sessions = {};
            // Also wipe shelf files from disk
            try {
                const dir = getShelfDir();
                fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
            } catch {}
            broadcastState();
            if (dockWindow && !dockWindow.isDestroyed()) {
                dockWindow.webContents.send('clear-data-confirmed');
            }
            break;
        // ... Add more handlers as needed
    }
});

// --- CROSS-WINDOW TOOL DRAG IPC ---

// Gallery tells us: "User started dragging tool X from library"
ipcMain.on('tool-drag-start', (event, toolId) => {
    galleryDraggedToolId = toolId;
    lastProposedIndex = state.activeToolIds.length; // Default: append at end
    // Notify dock that an external tool is being dragged
    if (dockWindow && !dockWindow.isDestroyed()) {
        dockWindow.webContents.send('external-tool-drag', { toolId });
    }
});

// Gallery tells us: "User stopped dragging (dragend fired)"
ipcMain.on('tool-drag-end', () => {
    // If mouseup didn't already handle it, clean up
    if (galleryDraggedToolId) {
        if (dockWindow && !dockWindow.isDestroyed()) {
            dockWindow.webContents.send('external-tool-drag-end');
        }
        galleryDraggedToolId = null;
        lastProposedIndex = 0;
    }
});

// Dock tells us: "User started dragging tool X out of dock"
ipcMain.on('dock-tool-drag-start', (event, toolId) => {
    dockDraggedToolId = toolId;
    // Notify gallery to show removal overlay
    if (galleryWindow && !galleryWindow.isDestroyed()) {
        galleryWindow.webContents.send('dock-tool-drag-active', { toolId });
    }
});

// Dock tells us: "User stopped dragging tool (dragend fired)"
ipcMain.on('dock-tool-drag-end', () => {
    // NOTE: Do NOT clear dockDraggedToolId here!
    // The mouseup handler is responsible for checking isOverWindow() and
    // performing the actual removal + cleanup. If we clear dockDraggedToolId
    // here, the mouseup check fires after this and finds null — so removal never happens.
    // We only need to hide the gallery overlay if the drag ends without a mouseup
    // (e.g., Escape key cancels). In that case dockDraggedToolId remains set
    // until mouseup fires and cleans up.
    // Therefore, this handler is intentionally left as a no-op for cleanup;
    // the overlay stays visible until mouseup decides the outcome.
});

// --- CLIPBOARD IPC ---

// Parse a Windows CF_HDROP buffer back to an array of file paths
function parseCFHDROP(buf) {
    if (!buf || buf.length < 20) return [];
    const pFiles = buf.readUInt32LE(0);
    const fWide  = buf.readUInt32LE(16) !== 0;
    const paths  = [];
    let offset   = pFiles;

    if (fWide) {
        while (offset + 2 <= buf.length) {
            let end = offset;
            while (end + 2 <= buf.length && (buf[end] !== 0 || buf[end + 1] !== 0)) end += 2;
            if (end === offset) break;
            paths.push(buf.slice(offset, end).toString('utf16le'));
            offset = end + 2;
        }
    } else {
        while (offset < buf.length) {
            let end = offset;
            while (end < buf.length && buf[end] !== 0) end++;
            if (end === offset) break;
            paths.push(buf.slice(offset, end).toString('ascii'));
            offset = end + 1;
        }
    }
    return paths;
}

// Write items to clipboard as CF_HDROP (like Windows Explorer).
// items: Array<{ dataUrl: string, name: string }>
// This lets any Windows/Mac app (Figma, Explorer, Paint…) paste all files at once.
//
// NOTE: clipboard.writeBuffer('CF_HDROP', ...) in Electron calls RegisterClipboardFormat()
// which creates a CUSTOM format ID, NOT the built-in Windows CF_HDROP (#15).
// Other apps can't read it. Solution: delegate to PowerShell's .NET clipboard API which
// writes the real CF_HDROP that every Windows app understands.
ipcMain.handle('clipboard:write', async (_event, items) => {
    try {
        const filePaths = [];
        for (const { dataUrl, name } of (items || [])) {
            const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
            const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
            const tempPath = path.join(
                app.getPath('temp'),
                `clip_${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`
            );
            fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));
            tempDragFiles.add(tempPath); // cleaned up on app quit
            filePaths.push(tempPath);
        }

        if (filePaths.length === 0) return false;

        if (process.platform === 'win32') {
            // PowerShell Windows.Forms writes the real CF_HDROP (#15) that all apps read.
            // Single-quoted strings in PS don't need backslash escaping.
            const addLines = filePaths
                .map(p => `$col.Add('${p.replace(/'/g, "''")}') | Out-Null`)
                .join('\n');

            const script = [
                'Add-Type -AssemblyName System.Windows.Forms',
                '$col = New-Object System.Collections.Specialized.StringCollection',
                addLines,
                '[System.Windows.Forms.Clipboard]::SetFileDropList($col)',
            ].join('\n');

            const scriptPath = path.join(app.getPath('temp'), `clip_set_${Date.now()}.ps1`);
            fs.writeFileSync(scriptPath, script, 'utf8');

            await new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', [
                    '-ExecutionPolicy', 'Bypass',
                    '-NonInteractive',
                    '-NoProfile',
                    '-File', scriptPath,
                ], { windowsHide: true });

                ps.on('close', (code) => {
                    try { fs.unlinkSync(scriptPath); } catch {}
                    if (code === 0) resolve(true);
                    else reject(new Error(`PS exited ${code}`));
                });
                ps.on('error', reject);
            });
        } else {
            // macOS / Linux: write file paths as text (basic fallback)
            clipboard.writeText(filePaths.join('\n'));
        }

        return true;
    } catch (err) {
        log.error('[Clipboard] write failed:', err);
        return false;
    }
});

// Read clipboard content. Returns Array<{ dataUrl, name }> or [].
// Handles both: image data (screenshots, browser copies) and CF_HDROP (Explorer files).
ipcMain.handle('clipboard:read', () => {
    try {
        // Priority 1: image bitmap data (screenshot, browser right-click copy)
        const img = clipboard.readImage();
        if (!img.isEmpty()) {
            return [{ dataUrl: img.toDataURL(), name: 'pasted.png' }];
        }

        // Priority 2: CF_HDROP file list (files copied in Explorer/Finder)
        if (process.platform === 'win32') {
            const buf = clipboard.readBuffer('CF_HDROP');
            if (buf && buf.length >= 20) {
                const paths = parseCFHDROP(buf).filter(p => fs.existsSync(p));
                return paths.map(p => ({
                    dataUrl: toDataUrl(fs.readFileSync(p), path.basename(p)),
                    name: path.basename(p),
                }));
            }
        }

        return [];
    } catch (err) {
        log.error('[Clipboard] read failed:', err);
        return [];
    }
});

// --- LOGS FOLDER ---
ipcMain.handle('OPEN_LOGS_FOLDER', () => {
    const logPath = log.transports.file.getFile().path;
    shell.openPath(path.dirname(logPath));
});
