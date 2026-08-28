import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  // relatief pad is verplicht: Electron laadt via file://
  base: './',
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
