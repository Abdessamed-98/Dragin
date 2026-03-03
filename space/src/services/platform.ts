import type { Peer, SharedFile, SavedPeer, Space, SpaceFile } from '@/types';
import { Filesystem, Directory } from '@capacitor/filesystem';

export type Platform = 'electron' | 'android' | 'ios' | 'web';

declare global {
  interface Window {
    Capacitor?: { getPlatform(): string };
  }
}

export function getPlatform(): Platform {
  if (window.electron) return 'electron';
  if (window.Capacitor?.getPlatform() === 'android') return 'android';
  if (window.Capacitor?.getPlatform() === 'ios') return 'ios';
  return 'web';
}

export function isCapacitor(): boolean {
  const p = getPlatform();
  return p === 'android' || p === 'ios';
}

export function isElectron(): boolean {
  return getPlatform() === 'electron';
}

// ---------- Platform API ----------

export interface DeviceInfo {
  id: string;
  name: string;
  ip: string;
  platform: string;
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

export interface ConnectionInfo {
  ip: string;
  port: number;
  id: string;
  name: string;
}

type PeersCallback = (peers: Peer[]) => void;
type FilesCallback = (files: SharedFile[]) => void;

let peersListeners: PeersCallback[] = [];
let filesListeners: FilesCallback[] = [];
let localPeers: Peer[] = [];
let localFiles: SharedFile[] = [];

function notifyPeers(peers: Peer[]) {
  localPeers = peers;
  peersListeners.forEach((cb) => cb(peers));
}

function notifyFiles(files: SharedFile[]) {
  localFiles = files;
  filesListeners.forEach((cb) => cb(files));
}

// ---------- Electron implementation ----------

function electronAPI() {
  return {
    getDeviceInfo: () => window.electron.getDeviceInfo(),
    getConnectionInfo: (): Promise<ConnectionInfo | null> => window.electron.getConnectionInfo(),
    onPeersUpdate: (cb: PeersCallback) => {
      window.electron.onPeersUpdate(cb);
    },
    onFilesUpdate: (cb: FilesCallback) => {
      window.electron.onFilesUpdate(cb);
    },
    getFilePath: (file: File) => window.electron.getFilePath(file),
    pickFiles: () => window.electron.pickFiles(),
    addFiles: (files: FileEntry[]) => window.electron.addFiles(files),
    removeFile: (fileId: string) => window.electron.removeFile(fileId),
    downloadFile: async (
      fileId: string, fileName: string, peerId: string, ip: string, port: number,
      onProgress?: (progress: number) => void,
    ) => {
      let cleanup: (() => void) | undefined;
      if (onProgress) {
        cleanup = window.electron.onDownloadProgress((data) => {
          if (data.fileId === fileId) onProgress(data.progress);
        });
      }
      try {
        await window.electron.downloadFile(fileId, fileName, peerId, ip, port);
      } finally {
        cleanup?.();
      }
    },
    abortDownload: (fileId: string) => window.electron.abortDownload(fileId),
    generatePairPin: (): Promise<string> => window.electron.generatePairPin(),
    clearPairPin: (): Promise<void> => window.electron.clearPairPin(),
    getSavedPeers: () => window.electron.getSavedPeers(),
    removeSavedPeer: (peerId: string) => window.electron.removeSavedPeer(peerId),
    onSavedPeersUpdate: (cb: (peers: SavedPeer[]) => void) => window.electron.onSavedPeersUpdate(cb),

    // Space management (v2)
    getSpaces: () => window.electron.getSpaces(),
    createSpace: (name: string) => window.electron.createSpace(name),
    deleteSpace: (spaceId: string) => window.electron.deleteSpace(spaceId),
    renameSpace: (spaceId: string, newName: string) => window.electron.renameSpace(spaceId, newName),
    setSpaceAutoPin: (spaceId: string, autoPin: boolean) => window.electron.setSpaceAutoPin(spaceId, autoPin),
    getSpaceFiles: (spaceId: string) => window.electron.getSpaceFiles(spaceId),
    addFilesToSpace: (spaceId: string, files: FileEntry[]) => window.electron.addFilesToSpace(spaceId, files),
    pinFile: (fileId: string) => window.electron.pinFile(fileId),
    unpinFile: (fileId: string) => window.electron.unpinFile(fileId),
    onSpacesUpdate: (cb: (spaces: Space[]) => void) => window.electron.onSpacesUpdate(cb),
    onSpaceFilesUpdate: (cb: (data: { spaceId: string; files: SpaceFile[] }) => void) => window.electron.onSpaceFilesUpdate(cb),
  };
}

// ---------- Capacitor implementation ----------

// Active XHRs for abort support
const activeXHRs = new Map<string, XMLHttpRequest>();

// Pending File objects from pickFiles (keyed by "name-size")
const pendingFileObjects = new Map<string, File>();

// Generate a small JPEG thumbnail from a File object (mobile only)
function generateThumbnail(file: File, maxDim = 200): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const img = new globalThis.Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } else {
        resolve(undefined);
      }
      URL.revokeObjectURL(blobUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(undefined); };
    img.src = blobUrl;
  });
}

function generateDeviceId(): string {
  const stored = localStorage.getItem('space-device-id');
  if (stored) return stored;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  localStorage.setItem('space-device-id', id);
  return id;
}

function capacitorAPI() {
  const deviceId = generateDeviceId();
  let mobileNetStarted = false;

  return {
    getDeviceInfo: async (): Promise<DeviceInfo> => ({
      id: deviceId,
      name: 'Android Device',
      ip: '0.0.0.0',
      platform: 'android',
    }),
    getConnectionInfo: async (): Promise<ConnectionInfo | null> => null,
    onPeersUpdate: (cb: PeersCallback) => {
      peersListeners.push(cb);
      cb(localPeers);
      if (!mobileNetStarted) {
        mobileNetStarted = true;
        import('./mobileNet').then((m) => m.initMobileNet(deviceId));
      }
    },
    onFilesUpdate: (cb: FilesCallback) => {
      filesListeners.push(cb);
      cb(localFiles);
    },
    getFilePath: (_file: File) => '',
    pickFiles: async (): Promise<FileEntry[]> => {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '*/*';
        input.onchange = () => {
          const picked = Array.from(input.files || []);
          const entries = picked.map((f) => {
            const blobUrl = URL.createObjectURL(f);
            // Store File object so we can send it via WS later
            pendingFileObjects.set(`${f.name}-${f.size}`, f);
            return {
              name: f.name,
              path: blobUrl,
              size: f.size,
              mimeType: f.type || 'application/octet-stream',
            };
          });
          resolve(entries);
        };
        input.oncancel = () => resolve([]);
        input.click();
      });
    },
    addFiles: async (files: FileEntry[]) => {
      const { addLocalFile, storeFileBlob } = await import('./mobileNet');
      for (const file of files) {
        const fileId = Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        // Store the original File object for WS transfer
        const key = `${file.name}-${file.size}`;
        const fileObj = pendingFileObjects.get(key);
        let thumbnail: string | undefined;
        if (fileObj) {
          storeFileBlob(fileId, fileObj);
          pendingFileObjects.delete(key);
          thumbnail = await generateThumbnail(fileObj);
        }

        addLocalFile({
          id: fileId,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          deviceId,
          deviceName: 'Android Device',
          uploadedAt: Date.now(),
          blobUrl: file.path.startsWith('blob:') ? file.path : undefined,
          thumbnail,
        });
      }
    },
    removeFile: async (fileId: string) => {
      const { removeLocalFile } = await import('./mobileNet');
      removeLocalFile(fileId);
    },
    downloadFile: async (
      fileId: string, fileName: string, _peerId: string, ip: string, port: number,
      onProgress?: (progress: number) => void,
    ) => {
      const url = `http://${ip}:${port}/files/${fileId}`;
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXHRs.set(fileId, xhr);

        xhr.open('GET', url);
        xhr.responseType = 'blob';

        xhr.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = async () => {
          activeXHRs.delete(fileId);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const blob: Blob = xhr.response;
              // Convert blob to base64 for Capacitor Filesystem
              const base64 = await new Promise<string>((res, rej) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const result = reader.result as string;
                  // Strip data URL prefix (data:mime;base64,)
                  res(result.split(',')[1]);
                };
                reader.onerror = () => rej(new Error('Failed to read blob'));
                reader.readAsDataURL(blob);
              });

              // Ensure Space directory exists
              try {
                await Filesystem.mkdir({
                  path: 'Space',
                  directory: Directory.Documents,
                  recursive: true,
                });
              } catch {
                // Directory may already exist
              }

              // Deduplicate filename
              let saveName = fileName;
              let counter = 1;
              const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
              const baseName = ext ? fileName.slice(0, -ext.length) : fileName;
              while (true) {
                try {
                  await Filesystem.stat({ path: `Space/${saveName}`, directory: Directory.Documents });
                  // File exists, increment counter
                  saveName = `${baseName} (${counter})${ext}`;
                  counter++;
                } catch {
                  break; // File doesn't exist, good to use this name
                }
              }

              await Filesystem.writeFile({
                path: `Space/${saveName}`,
                data: base64,
                directory: Directory.Documents,
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`Download failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          activeXHRs.delete(fileId);
          reject(new Error('Download failed'));
        };

        xhr.onabort = () => {
          activeXHRs.delete(fileId);
          reject(new Error('Download cancelled'));
        };

        xhr.send();
      });
    },
    abortDownload: (fileId: string) => {
      const xhr = activeXHRs.get(fileId);
      if (xhr) {
        xhr.abort();
        activeXHRs.delete(fileId);
      }
    },
    generatePairPin: async (): Promise<string> => '',
    clearPairPin: async (): Promise<void> => {},
    getSavedPeers: async (): Promise<SavedPeer[]> => {
      const { getSavedPeers } = await import('./mobileNet');
      return getSavedPeers();
    },
    removeSavedPeer: async (peerId: string) => {
      const { removeSavedPeer } = await import('./mobileNet');
      removeSavedPeer(peerId);
    },
    onSavedPeersUpdate: (cb: (peers: SavedPeer[]) => void) => {
      import('./mobileNet').then(({ onSavedPeersChange }) => onSavedPeersChange(cb));
    },

    // Space management (v2 — full peer on mobile)
    getSpaces: async (): Promise<Space[]> => {
      const { getMobileSpaces } = await import('./mobileNet');
      return getMobileSpaces();
    },
    createSpace: async (name: string): Promise<Space> => {
      const { mobileCreateSpace } = await import('./mobileNet');
      return mobileCreateSpace(name);
    },
    deleteSpace: async (spaceId: string) => {
      const { mobileDeleteSpace } = await import('./mobileNet');
      mobileDeleteSpace(spaceId);
    },
    renameSpace: async (spaceId: string, newName: string) => {
      const { mobileRenameSpace } = await import('./mobileNet');
      mobileRenameSpace(spaceId, newName);
    },
    setSpaceAutoPin: async (spaceId: string, autoPin: boolean) => {
      const { mobileSetSpaceAutoPin } = await import('./mobileNet');
      mobileSetSpaceAutoPin(spaceId, autoPin);
    },
    getSpaceFiles: async (spaceId: string): Promise<SpaceFile[]> => {
      const { getMobileSpaceFiles } = await import('./mobileNet');
      return getMobileSpaceFiles(spaceId);
    },
    addFilesToSpace: async (spaceId: string, files: FileEntry[]) => {
      const { addLocalFile, storeFileBlob, mobileAddFileToSpace } = await import('./mobileNet');
      for (const file of files) {
        const fileId = Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        // Store the original File object for WS transfer
        const key = `${file.name}-${file.size}`;
        const fileObj = pendingFileObjects.get(key);
        let thumbnail: string | undefined;
        if (fileObj) {
          storeFileBlob(fileId, fileObj);
          pendingFileObjects.delete(key);
          thumbnail = await generateThumbnail(fileObj);
        }

        const sharedFile: SharedFile = {
          id: fileId,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          deviceId,
          deviceName: 'Android Device',
          uploadedAt: Date.now(),
          blobUrl: file.path.startsWith('blob:') ? file.path : undefined,
          thumbnail,
        };

        addLocalFile(sharedFile);

        // Also track in space
        mobileAddFileToSpace(spaceId, {
          id: fileId,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          deviceId,
          deviceName: 'Android Device',
          addedAt: Date.now(),
          spaceId,
          thumbnail,
          available: true,
          blobUrl: file.path.startsWith('blob:') ? file.path : undefined,
        });
      }
    },
    pinFile: async (_fileId: string) => {},
    unpinFile: async (_fileId: string) => {},
    onSpacesUpdate: (cb: (spaces: Space[]) => void) => {
      import('./mobileNet').then(({ onMobileSpacesUpdate }) => onMobileSpacesUpdate(cb));
    },
    onSpaceFilesUpdate: (cb: (data: { spaceId: string; files: SpaceFile[] }) => void) => {
      import('./mobileNet').then(({ onMobileSpaceFilesUpdate }) => onMobileSpaceFilesUpdate(cb));
    },
  };
}

// ---------- Unified API ----------

export type SpaceAPI = ReturnType<typeof electronAPI>;

let _api: SpaceAPI | null = null;

export function getSpaceAPI(): SpaceAPI {
  if (_api) return _api;
  _api = isElectron() ? electronAPI() : capacitorAPI();
  return _api;
}

// Export for mobile networking (called by the WebSocket client)
export { notifyPeers, notifyFiles };
