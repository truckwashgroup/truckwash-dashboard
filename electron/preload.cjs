const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  notify: (title, body) => ipcRenderer.invoke('notify:show', { title, body }),
  onUpdateStatus: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },

  /*
   * Het venster bedienen.
   *
   * Het venster heeft geen rand meer van Windows, dus de app tekent zijn
   * eigen knoppen -- en die moeten iets kunnen. Dit is de hele lijst; er is
   * met opzet niets bij om het venster te verplaatsen of van formaat te
   * veranderen, want dat doet Windows zelf al via het sleepgebied en de
   * randen.
   */
  venster: {
    minimaliseren: () => ipcRenderer.invoke('venster:minimaliseren'),
    maximaliseren: () => ipcRenderer.invoke('venster:maximaliseren'),
    sluiten: () => ipcRenderer.invoke('venster:sluiten'),
    isMax: () => ipcRenderer.invoke('venster:is-max'),
    onMax: (cb) => {
      const handler = (_e, max) => cb(max)
      ipcRenderer.on('venster:max', handler)
      return () => ipcRenderer.removeListener('venster:max', handler)
    },
  },
})
