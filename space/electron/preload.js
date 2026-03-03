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

  // --- SPACE MANAGEMENT (v2) ---
  getSpaces: () => ipcRenderer.invoke('get-spaces'),
  createSpace: (name) => ipcRenderer.invoke('create-space', name),
  deleteSpace: (spaceId) => ipcRenderer.invoke('delete-space', spaceId),
  renameSpace: (spaceId, newName) => ipcRenderer.invoke('rename-space', spaceId, newName),
  setSpaceAutoPin: (spaceId, autoPin) => ipcRenderer.invoke('set-space-auto-pin', spaceId, autoPin),
  getSpaceFiles: (spaceId) => ipcRenderer.invoke('get-space-files', spaceId),
  addFilesToSpace: (spaceId, files) => ipcRenderer.invoke('add-files-to-space', spaceId, files),
  pinFile: (fileId) => ipcRenderer.invoke('pin-file', fileId),
  unpinFile: (fileId) => ipcRenderer.invoke('unpin-file', fileId),
  onSpacesUpdate: (callback) => ipcRenderer.on('spaces-update', (_e, spaces) => callback(spaces)),
  onSpaceFilesUpdate: (callback) => ipcRenderer.on('space-files-update', (_e, data) => callback(data)),
});
