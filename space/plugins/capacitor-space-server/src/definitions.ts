import type { PluginListenerHandle } from '@capacitor/core';

export interface StartServerOptions {
  deviceId: string;
  deviceName: string;
  platform: string;
}

export interface StartServerResult {
  port: number;
}

export interface RegisterFileOptions {
  fileId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
}

export interface UnregisterFileOptions {
  fileId: string;
}

export interface SetDiscoveryInfoOptions {
  spaces: any[];
  pairPin?: string;
}

export interface SendToClientOptions {
  clientId: string;
  message: string;
}

export interface BroadcastMessageOptions {
  message: string;
}

export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface PickFilesResult {
  files: PickedFile[];
}

export interface PeerFoundEvent {
  id: string;
  name: string;
  ip: string;
  port: number;
  platform: string;
}

export interface PeerLostEvent {
  id: string;
}

export interface WsMessageEvent {
  clientId: string;
  message: string;
}

export interface WsClientEvent {
  clientId: string;
  remoteAddress: string;
}

export interface WsClientDisconnectedEvent {
  clientId: string;
}

export interface SpaceServerPlugin {
  startServer(options: StartServerOptions): Promise<StartServerResult>;
  stopServer(): Promise<void>;

  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;

  registerFile(options: RegisterFileOptions): Promise<void>;
  unregisterFile(options: UnregisterFileOptions): Promise<void>;

  setDiscoveryInfo(options: SetDiscoveryInfoOptions): Promise<void>;

  sendToClient(options: SendToClientOptions): Promise<void>;
  broadcastMessage(options: BroadcastMessageOptions): Promise<void>;

  pickFiles(): Promise<PickFilesResult>;

  addListener(
    eventName: 'peerFound',
    listener: (event: PeerFoundEvent) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'peerLost',
    listener: (event: PeerLostEvent) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'wsMessage',
    listener: (event: WsMessageEvent) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'wsClientConnected',
    listener: (event: WsClientEvent) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'wsClientDisconnected',
    listener: (event: WsClientDisconnectedEvent) => void,
  ): Promise<PluginListenerHandle>;
}
