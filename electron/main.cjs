const { app, BrowserWindow, ipcMain, shell, Menu, Notification } = require('electron')
const path = require('node:path')

// dev = vite-server; anders wordt de gebouwde dist/ geladen
const isDev = process.env.NODE_ENV === 'development'
let mainWindow = null
let autoUpdater = null

/* ------------------------------------------------------------------ */
/* Auto-update (Windows)                                               */
/* ------------------------------------------------------------------ */
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function initAutoUpdater() {
  if (!app.isPackaged) return // alleen een geïnstalleerde app kan updaten
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    send('update:status', { state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'up-to-date' }))
  autoUpdater.on('download-progress', (p) =>
    send('update:status', { state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) =>
    send('update:status', { state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) =>
    send('update:status', { state: 'error', message: String(err && err.message ? err.message : err) }))

  // direct checken + daarna elk half uur
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000)
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b1220',

    /*
     * Geen rand van Windows.
     *
     * De grijze balk met het kleine icoontje en het menu "Bestand / Beeld"
     * was het enige stuk van het scherm dat er niet uitzag alsof het bij
     * Truckwash1 hoorde. De app tekent nu zijn eigen balk; zie
     * src/components/Titelbalk.tsx.
     *
     * Slepen en van formaat veranderen blijven gewoon werken -- dat regelt
     * Windows nog steeds, via het sleepgebied in die balk en de randen van
     * het venster. Wat je wél kwijtraakt zijn de Snap Layouts: het menuutje
     * dat verschijnt als je op de knop Maximaliseren blijft hangen. Dat zit
     * vast aan de echte knop van Windows. Slepen naar een schermrand en de
     * sneltoetsen (Windows-toets met een pijl) doen het wel.
     */
    frame: false,

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  /*
   * De knop moet weten of het venster al groot is: verkleinen of vergroten
   * is niet hetzelfde plaatje. Maximaliseren kan ook zonder die knop -- door
   * te dubbelklikken of het venster naar de bovenrand te slepen -- dus komt
   * het van hier en niet van de klik.
   */
  const meldStand = () => send('venster:max', mainWindow.isMaximized())
  mainWindow.on('maximize', meldStand)
  mainWindow.on('unmaximize', meldStand)

  // externe links in de systeembrowser openen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('update:check', async () => {
  if (!autoUpdater) return { ok: false, reason: app.isPackaged ? 'unavailable' : 'dev' }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) }
  }
})
ipcMain.handle('notify:show', (_e, { title, body }) => {
  if (!Notification.isSupported()) return false
  const n = new Notification({
    title: String(title ?? 'Truckwash1'),
    body: String(body ?? ''),
    silent: false,
  })
  // Klikken op de melding brengt het venster naar voren.
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  n.show()
  return true
})

/* ---- het venster bedienen ---- */

ipcMain.handle('venster:minimaliseren', () => mainWindow && mainWindow.minimize())

ipcMain.handle('venster:maximaliseren', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})

ipcMain.handle('venster:sluiten', () => mainWindow && mainWindow.close())
ipcMain.handle('venster:is-max', () => !!mainWindow && mainWindow.isMaximized())

ipcMain.handle('update:install', () => {
  if (autoUpdater) autoUpdater.quitAndInstall(false, true)
})

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    /*
     * Het menu wordt niet meer getekend -- het venster heeft geen rand -- maar
     * het blijft wel staan. De sneltoetsen die eraan hangen werken namelijk
     * ook zonder zichtbare balk, en zonder menu zou Ctrl+R, F12 en Ctrl+plus
     * er opeens niet meer zijn.
     */
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Bestand',
          submenu: [{ role: 'quit', label: 'Afsluiten' }],
        },
        {
          label: 'Beeld',
          submenu: [
            { role: 'reload', label: 'Herladen' },
            { role: 'toggleDevTools', label: 'Ontwikkelaarstools' },
            { type: 'separator' },
            { role: 'resetZoom', label: 'Zoom herstellen' },
            { role: 'zoomIn', label: 'Inzoomen' },
            { role: 'zoomOut', label: 'Uitzoomen' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: 'Volledig scherm' },
          ],
        },
      ])
    )
    createWindow()
    initAutoUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
