const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // --- STATE ---
    onStateUpdate: (callback) => ipcRenderer.on('state-update', (e, state) => callback(state)),
    onDockHover: (callback) => ipcRenderer.on('dock-hover', (e, active) => callback(active)),
    dispatch: (action) => ipcRenderer.send('dispatch-action', action),

    // --- WINDOW MANAGEMENT ---
    openGallery: () => ipcRenderer.send('open-gallery'),
    closeGallery: () => ipcRenderer.send('close-gallery'),
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
    resizeDock: (width) => ipcRenderer.send('resize-dock', width),
    sendDockMode: (mode) => ipcRenderer.send('dock-mode', mode),
    ready: () => ipcRenderer.send('renderer-ready'),
    onClearDataConfirmed: (callback) => ipcRenderer.on('clear-data-confirmed', (e) => callback()),

    // --- SHELF PERSISTENCE ---
    shelfSave: (id, buffer, name) => ipcRenderer.invoke('shelf:save', id, buffer, name),
    shelfLoad: () => ipcRenderer.invoke('shelf:load'),
    shelfDelete: (itemIds) => ipcRenderer.invoke('shelf:delete', itemIds),

    // --- NATIVE FILE DRAG-OUT ---
    // sendSync keeps us inside the drag-event timing window so startDrag() fires in time
    startNativeDrag: (payload) => ipcRenderer.sendSync('native-drag-start', payload),

    // --- SYSTEM CLIPBOARD ---
    // Write items as CF_HDROP (like Explorer) so any app can paste all files at once
    clipboardWrite: (items) => ipcRenderer.invoke('clipboard:write', items),
    // Read clipboard — returns image data or Explorer-copied files
    clipboardRead: () => ipcRenderer.invoke('clipboard:read'),

    // --- LOGS ---
    openLogsFolder: () => ipcRenderer.invoke('OPEN_LOGS_FOLDER'),

    // --- SETTINGS (language, etc.) ---
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    onLanguageChange: (callback) => ipcRenderer.on('language-change', (_e, lang) => callback(lang)),
    onSettingChange: (callback) => ipcRenderer.on('setting-change', (_e, data) => callback(data)),
});
