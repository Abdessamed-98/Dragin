import type { Peer, SharedFile } from '@/types';

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
    downloadFile: (fileId: string, fileName: string, ip: string, port: number) =>
      window.electron.downloadFile(fileId, fileName, ip, port),
  };
}

// ---------- Capacitor implementation ----------

function generateDeviceId(): string {
  const stored = localStorage.getItem('shelf-device-id');
  if (stored) return stored;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  localStorage.setItem('shelf-device-id', id);
  return id;
}

function capacitorAPI() {
  const deviceId = generateDeviceId();

  return {
    getDeviceInfo: async (): Promise<DeviceInfo> => ({
      id: deviceId,
      name: 'Android Device',
      ip: '0.0.0.0',
      platform: 'android',
    }),
    onPeersUpdate: (cb: PeersCallback) => {
      peersListeners.push(cb);
      cb(localPeers);
    },
    onFilesUpdate: (cb: FilesCallback) => {
      filesListeners.push(cb);
      cb(localFiles);
    },
    getFilePath: (_file: File) => '',
    pickFiles: async (): Promise<FileEntry[]> => {
      // TODO: Use Capacitor FilePicker plugin
      return [];
    },
    addFiles: async (_files: FileEntry[]) => {
      // TODO: Implement mobile file sharing
    },
    removeFile: async (_fileId: string) => {
      // TODO: Implement mobile file removal
    },
    downloadFile: async (_fileId: string, _fileName: string, _ip: string, _port: number) => {
      // TODO: Implement mobile file download (fetch from desktop peer)
    },
  };
}

// ---------- Unified API ----------

export type ShelfAPI = ReturnType<typeof electronAPI>;

let _api: ShelfAPI | null = null;

export function getShelfAPI(): ShelfAPI {
  if (_api) return _api;
  _api = isElectron() ? electronAPI() : capacitorAPI();
  return _api;
}

// Export for mobile networking (called by the WebSocket client)
export { notifyPeers, notifyFiles };
