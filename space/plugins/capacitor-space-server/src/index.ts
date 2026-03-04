import { registerPlugin } from '@capacitor/core';
import type { SpaceServerPlugin } from './definitions';

const SpaceServer = registerPlugin<SpaceServerPlugin>('SpaceServer');

export * from './definitions';
export { SpaceServer };
