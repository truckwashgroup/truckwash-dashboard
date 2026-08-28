/**
 * Haalt de Electron-binary op na een installatie.
 *
 * Waarom dit nodig is: npm 12 blokkeert install-scripts van pakketten, dus
 * Electron installeert zijn eigen binary niet meer. Zonder dit krijg je bij
 * het starten "Electron failed to install correctly".
 *
 * Waarom het nooit mag afbreken: op een bouwmachine die alleen de Android-
 * of iOS-app maakt is Electron niet nodig. Zou dit script daar de installatie
 * laten mislukken, dan valt de hele build om voor iets wat niet gebruikt wordt.
 */

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const electronDir = path.join(root, 'node_modules', 'electron')

if (!fs.existsSync(electronDir)) {
  console.log('Electron staat niet in dit project, overgeslagen')
  process.exit(0)
}

// Al aanwezig? Dan hoeven we niets te downloaden.
const pathTxt = path.join(electronDir, 'path.txt')
if (fs.existsSync(pathTxt)) {
  const exe = path.join(electronDir, 'dist', fs.readFileSync(pathTxt, 'utf8').trim())
  if (fs.existsSync(exe)) {
    console.log('Electron staat er al')
    process.exit(0)
  }
}

try {
  require(path.join(electronDir, 'install.js'))
} catch (err) {
  console.log('Electron ophalen lukte niet: ' + (err && err.message ? err.message : err))
  console.log('Dat is alleen een probleem als je de Windows-app wilt draaien.')
  console.log('Handmatig alsnog: node node_modules/electron/install.js')
}
