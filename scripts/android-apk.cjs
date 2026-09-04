/**
 * Bouwt een installeerbare Android-APK en legt hem klaar in de projectmap.
 *
 * Waarom dit script bestaat: de `gradlew`-starter heeft een JAVA_HOME nodig,
 * en de JDK die Android Studio meelevert (25) is te nieuw voor de Gradle-versie
 * die Capacitor gebruikt. Hieronder zoeken we daarom zelf een bruikbare JDK.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const androidDir = path.join(root, 'android')

/** Draait de java van een JDK-map en geeft het hoofdversienummer terug. */
function majorVersionOf(javaHome) {
  const exe = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!fs.existsSync(exe)) return null
  const out = spawnSync(exe, ['-version'], { encoding: 'utf8' })
  const text = (out.stderr || '') + (out.stdout || '')
  const m = text.match(/version "(\d+)/)
  return m ? Number(m[1]) : null
}

/** Gradle 8.13 draait op Java 17 t/m 24, maar Capacitor 8 compileert met Java 21. */
const usable = (v) => v !== null && v >= 21 && v <= 24

function findJdk() {
  const candidates = []

  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME)

  const jdksDir = path.join(os.homedir(), '.jdks')
  if (fs.existsSync(jdksDir)) {
    for (const name of fs.readdirSync(jdksDir)) {
      candidates.push(path.join(jdksDir, name))
    }
  }

  candidates.push(
    'C:/Program Files/Android/Android Studio/jbr',
    path.join(os.homedir(), 'AppData/Local/Programs/Android Studio/jbr'),
  )

  for (const c of candidates) {
    if (usable(majorVersionOf(c))) return c
  }
  return null
}

const { syncAndroidVersion } = require('./sync-android-version.cjs')

const appVersion = syncAndroidVersion()

const javaHome = findJdk()

if (!javaHome) {
  console.error(
    '\nGeen bruikbare JDK gevonden (nodig: Java 17 t/m 23).\n' +
    'Download er een van https://adoptium.net/temurin/releases/?version=21\n' +
    'en pak hem uit in: ' + path.join(os.homedir(), '.jdks') + '\n'
  )
  process.exit(1)
}

console.log('JDK: ' + javaHome + '  (Java ' + majorVersionOf(javaHome) + ')\n')

// Absoluut pad, want cmd.exe zoekt niet vanzelf in de werkmap. En op Windows
// moet een .bat via de shell draaien, dus quoten we zelf tegen spaties in het
// pad ("C:/Users/Contr Truckwash/...").
const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const win = process.platform === 'win32'

// Op Windows alles in één commandostring: args los meegeven naast shell:true
// levert een deprecation-waarschuwing op.
const build = win
  ? spawnSync(JSON.stringify(gradlew) + ' assembleDebug', {
      cwd: androidDir, stdio: 'inherit', shell: true,
      env: { ...process.env, JAVA_HOME: javaHome },
    })
  : spawnSync(gradlew, ['assembleDebug'], {
      cwd: androidDir, stdio: 'inherit',
      env: { ...process.env, JAVA_HOME: javaHome },
    })

if (build.status !== 0) process.exit(build.status ?? 1)

const apk = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk')
const target = path.join(root, 'Truckwash1-Dashboard-' + appVersion + '.apk')

if (fs.existsSync(apk)) {
  fs.copyFileSync(apk, target)
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1)
  console.log('\nKlaar. APK (' + mb + ' MB):\n  ' + target)
  console.log('\nZet dit bestand op een Android-toestel en tik erop om te installeren.')
  console.log('Sta daarbij eenmalig "installeren uit onbekende bron" toe.\n')
} else {
  console.error('\nBuild geslaagd, maar de APK is niet gevonden op:\n  ' + apk + '\n')
  process.exit(1)
}
