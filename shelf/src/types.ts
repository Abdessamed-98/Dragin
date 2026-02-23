export interface DeviceInfo {
  id: string;
  name: string;
  ip: string;
  port: number;
  platform: string;
}

export interface SharedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  deviceId: string;
  deviceName: string;
  uploadedAt: number;
}

export interface Peer {
  id: string;
  name: string;
  ip: string;
  port: number;
  platform: string;
}

// WebSocket message types
export type WSMessage =
  | { type: 'file-list'; files: SharedFile[] }
  | { type: 'file-added'; file: SharedFile }
  | { type: 'file-removed'; fileId: string };

// UDP discovery message types
export type DiscoveryMessage =
  | { type: 'hello'; id: string; name: string; ip: string; port: number; platform: string }
  | { type: 'bye'; id: string };

// Electron IPC bridge
export interface ElectronAPI {
  getDeviceInfo: () => Promise<{ id: string; name: string; ip: string; platform: string }>;
  getFilePath: (file: File) => string;
  onPeersUpdate: (callback: (peers: Peer[]) => void) => void;
  onFilesUpdate: (callback: (files: SharedFile[]) => void) => void;
  pickFiles: () => Promise<{ name: string; path: string; size: number; mimeType: string }[]>;
  addFiles: (files: { name: string; path: string; size: number; mimeType: string }[]) => Promise<void>;
  removeFile: (fileId: string) => Promise<void>;
  downloadFile: (fileId: string, fileName: string, deviceIp: string, devicePort: number) => Promise<void>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
