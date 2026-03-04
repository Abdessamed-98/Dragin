import { WebPlugin } from '@capacitor/core';
import type { SpaceServerPlugin, StartServerResult, PickFilesResult } from './definitions';

export class SpaceServerWeb extends WebPlugin implements SpaceServerPlugin {
  async startServer(): Promise<StartServerResult> {
    throw this.unimplemented('Not available on web.');
  }
  async stopServer(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async startDiscovery(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async stopDiscovery(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async registerFile(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async unregisterFile(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async setDiscoveryInfo(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async sendToClient(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async broadcastMessage(): Promise<void> { throw this.unimplemented('Not available on web.'); }
  async pickFiles(): Promise<PickFilesResult> { throw this.unimplemented('Not available on web.'); }
}
