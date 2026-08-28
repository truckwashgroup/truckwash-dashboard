import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'nl.truckwash1group.dashboard',
  appName: 'Truckwash1 Dashboard',
  webDir: 'dist',
  android: { allowMixedContent: true },
  ios: { contentInset: 'always' },
  plugins: {
    // OTA live-updates voor iOS/Android (zie README: npm i @capgo/capacitor-updater)
    CapacitorUpdater: {
      autoUpdate: true,
      // updateUrl: 'https://updates.truckwash1group.nl/updates',
      resetWhenUpdate: true,
    },
  },
}

export default config
