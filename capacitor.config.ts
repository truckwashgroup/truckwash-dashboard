import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'nl.truckwash1group.dashboard',
  appName: 'Truckwash1 Dashboard',
  // dist/app: de app wordt sinds de verhuizing naar /app/ daarheen gebouwd.
  // Op het toestel verandert er niets -- Capacitor serveert de inhoud van
  // webDir op de wortel van zijn eigen scheme.
  webDir: 'dist/app',
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
