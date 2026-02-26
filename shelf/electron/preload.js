const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // --- DEVICE INFO ---
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
  getConnectionInfo: () => ipcRenderer.invoke('get-connection-info'),

  // --- STATE UPDATES (from main process) ---
  onPeersUpdate: (callback) => ipcRenderer.on('peers-update', (_e, peers) => callback(peers)),
  onFilesUpdate: (callback) => ipcRenderer.on('files-update', (_e, files) => callback(files)),
  onDownloadProgress: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

  // --- UTILS ---
  getFilePath: (file) => webUtils.getPathForFile(file),

  // --- PAIRING ---
  generatePairPin: () => ipcRenderer.invoke('generate-pair-pin'),
  clearPairPin: () => ipcRenderer.invoke('clear-pair-pin'),

  // --- SAVED PEERS ---
  getSavedPeers: () => ipcRenderer.invoke('get-saved-peers'),
  removeSavedPeer: (peerId) => ipcRenderer.invoke('remove-saved-peer', peerId),
  onSavedPeersUpdate: (callback) => ipcRenderer.on('saved-peers-update', (_e, peers) => callback(peers)),

  // --- FILE OPERATIONS ---
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  addFiles: (files) => ipcRenderer.invoke('add-files', files),
  removeFile: (fileId) => ipcRenderer.invoke('remove-file', fileId),
  downloadFile: (fileId, fileName, peerId, deviceIp, devicePort) =>
    ipcRenderer.invoke('download-file', fileId, fileName, peerId, deviceIp, devicePort),
  abortDownload: (fileId) => ipcRenderer.send('abort-download', fileId),

  // --- SHELF MANAGEMENT (v2) ---
  getShelves: () => ipcRenderer.invoke('get-shelves'),
  createShelf: (name) => ipcRenderer.invoke('create-shelf', name),
  deleteShelf: (shelfId) => ipcRenderer.invoke('delete-shelf', shelfId),
  renameShelf: (shelfId, newName) => ipcRenderer.invoke('rename-shelf', shelfId, newName),
  setShelfAutoPin: (shelfId, autoPin) => ipcRenderer.invoke('set-shelf-auto-pin', shelfId, autoPin),
  getShelfFiles: (shelfId) => ipcRenderer.invoke('get-shelf-files', shelfId),
  addFilesToShelf: (shelfId, files) => ipcRenderer.invoke('add-files-to-shelf', shelfId, files),
  pinFile: (fileId) => ipcRenderer.invoke('pin-file', fileId),
  unpinFile: (fileId) => ipcRenderer.invoke('unpin-file', fileId),
  onShelvesUpdate: (callback) => ipcRenderer.on('shelves-update', (_e, shelves) => callback(shelves)),
  onShelfFilesUpdate: (callback) => ipcRenderer.on('shelf-files-update', (_e, data) => callback(data)),
});
