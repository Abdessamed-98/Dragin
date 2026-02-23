const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // --- DEVICE INFO ---
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // --- STATE UPDATES (from main process) ---
  onPeersUpdate: (callback) => ipcRenderer.on('peers-update', (_e, peers) => callback(peers)),
  onFilesUpdate: (callback) => ipcRenderer.on('files-update', (_e, files) => callback(files)),

  // --- UTILS ---
  getFilePath: (file) => webUtils.getPathForFile(file),

  // --- FILE OPERATIONS ---
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  addFiles: (files) => ipcRenderer.invoke('add-files', files),
  removeFile: (fileId) => ipcRenderer.invoke('remove-file', fileId),
  downloadFile: (fileId, fileName, deviceIp, devicePort) =>
    ipcRenderer.invoke('download-file', fileId, fileName, deviceIp, devicePort),
});
