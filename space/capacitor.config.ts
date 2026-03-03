import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dragin.space',
  appName: 'Space',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
};

export default config;
