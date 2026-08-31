import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  // relatief pad is verplicht: Electron laadt via file://
  base: './',

  /*
   * Het versienummer uit package.json de app in.
   *
   * Stond hier eerst als vaste tekst in updates.ts, op '1.0.0', terwijl
   * package.json al veel verder was. Op Windows viel dat niet op, want
   * daar vraagt de app het aan Electron. Op een tablet is het wel erg:
   * daar vergelijkt de updater met dit nummer, en dan denkt hij altijd
   * dat er een nieuwere versie is.
   */
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // Zonder dit doorzoekt Vite ook android/ en ios/. Daar staat een kopie van
  // een eerdere build, en die probeert hij dan als broncode te behandelen --
  // met klachten over pakketten die alleen in die oude bundel voorkomen.
  optimizeDeps: {
    entries: ['index.html'],
  },

  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/android/**',
        '**/ios/**',
        '**/dist/**',
        '**/release/**',
      ],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
