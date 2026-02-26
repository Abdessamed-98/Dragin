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
  blobUrl?: string;
  thumbnail?: string;
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

// Saved/known peer (persisted across sessions)
export interface SavedPeer {
  id: string;
  name: string;
  ip: string;
  port: number;
  platform: string;
}

// --- v2: Multi-shelf types ---

export interface Shelf {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  createdBy: string;
  autoPin: boolean;
  members?: string[];
}

export interface ShelfFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  deviceId: string;
  deviceName: string;
  addedAt: number;
  shelfId: string;
  thumbnail?: string;
  localPath?: string;
  pinned?: boolean | null;
  available: boolean;
  blobUrl?: string;
}

// Electron IPC bridge
export interface ElectronAPI {
  getDeviceInfo: () => Promise<{ id: string; name: string; ip: string; platform: string }>;
  getConnectionInfo: () => Promise<{ ip: string; port: number; id: string; name: string }>;
  getFilePath: (file: File) => string;
  onPeersUpdate: (callback: (peers: Peer[]) => void) => void;
  onFilesUpdate: (callback: (files: SharedFile[]) => void) => void;
  onDownloadProgress: (callback: (data: { fileId: string; progress: number }) => void) => () => void;
  generatePairPin: () => Promise<string>;
  clearPairPin: () => Promise<void>;
  getSavedPeers: () => Promise<SavedPeer[]>;
  removeSavedPeer: (peerId: string) => Promise<void>;
  onSavedPeersUpdate: (callback: (peers: SavedPeer[]) => void) => void;
  pickFiles: () => Promise<{ name: string; path: string; size: number; mimeType: string }[]>;
  addFiles: (files: { name: string; path: string; size: number; mimeType: string }[]) => Promise<void>;
  removeFile: (fileId: string) => Promise<void>;
  downloadFile: (fileId: string, fileName: string, peerId: string, deviceIp: string, devicePort: number) => Promise<void>;
  abortDownload: (fileId: string) => void;

  // Shelf management (v2)
  getShelves: () => Promise<Shelf[]>;
  createShelf: (name: string) => Promise<Shelf>;
  deleteShelf: (shelfId: string) => Promise<void>;
  renameShelf: (shelfId: string, newName: string) => Promise<void>;
  setShelfAutoPin: (shelfId: string, autoPin: boolean) => Promise<void>;
  getShelfFiles: (shelfId: string) => Promise<ShelfFile[]>;
  addFilesToShelf: (shelfId: string, files: { name: string; path: string; size: number; mimeType: string }[]) => Promise<void>;
  pinFile: (fileId: string) => Promise<void>;
  unpinFile: (fileId: string) => Promise<void>;
  onShelvesUpdate: (callback: (shelves: Shelf[]) => void) => void;
  onShelfFilesUpdate: (callback: (data: { shelfId: string; files: ShelfFile[] }) => void) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
