/**
 * Start de desktop-app.
 *
 * VS Code (en sommige andere editors) zetten ELECTRON_RUN_AS_NODE=1 in de
 * omgeving van hun terminal. Electron start dan als kale Node en het venster
 * verschijnt nooit. Die variabele halen we hier weg voordat we starten.
 */

const { spawn } = require('node:child_process')
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

child.on('close', (code) => process.exit(code ?? 0))
