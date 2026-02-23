import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dragin.shelf',
  appName: 'Shelf',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
};

export default config;
