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

/*
 * Alleen op Windows, want daar wordt de desktop-app gebouwd (electron-builder
 * draait met --win en verder nergens).
 *
 * Dit is erbij gekomen nadat een bouw bij Cloudflare bleef hangen op precies
 * deze stap. Dat is ook logisch: dit haalt ruim honderd megabyte binary op,
 * op een machine die alleen een website bouwt en er nooit iets mee doet. Het
 * script vangt fouten af, maar het vangt geen trage download af -- en dan
 * staat er in het logboek alleen "postinstall" en verder niets.
 *
 * Moet het toch ergens anders: zet ELECTRON_OPHALEN=1.
 */
const wilElectron =
  process.platform === 'win32' || process.env.ELECTRON_OPHALEN === '1'

if (!wilElectron) {
  console.log(
    `Electron overgeslagen op ${process.platform} — die is alleen nodig voor ` +
    'de Windows-app. Forceren kan met ELECTRON_OPHALEN=1.')
  process.exit(0)
}

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
