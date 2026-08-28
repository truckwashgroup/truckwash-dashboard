/**
 * Zet de versie uit package.json in het Android-project.
 *
 * Android leest zijn versie uit build.gradle, niet uit package.json. Zonder
 * dit heet elke APK "1.0", en dan weigert een toestel de nieuwe over de oude
 * heen te installeren omdat het denkt dat het dezelfde versie is.
 *
 * versionCode moet een oplopend geheel getal zijn; 1.2.3 wordt 10203.
 */

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function syncAndroidVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const version = String(pkg.version)
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((n) => parseInt(n, 10) || 0)
  const code = major * 10000 + minor * 100 + patch

  const gradleFile = path.join(root, 'android', 'app', 'build.gradle')
  if (!fs.existsSync(gradleFile)) {
    console.log('geen Android-project gevonden, overgeslagen')
    return version
  }

  const before = fs.readFileSync(gradleFile, 'utf8')
  const after = before
    .replace(/versionCode\s+\d+/, 'versionCode ' + code)
    .replace(/versionName\s+"[^"]*"/, 'versionName "' + version + '"')

  if (after !== before) {
    fs.writeFileSync(gradleFile, after)
    console.log('Android-versie gezet op ' + version + ' (code ' + code + ')')
  } else {
    console.log('Android-versie stond al op ' + version)
  }
  return version
}

module.exports = { syncAndroidVersion }

if (require.main === module) syncAndroidVersion()
