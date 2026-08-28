/**
 * Ruimt de gekopieerde webbestanden in de native projecten op.
 *
 * `cap copy` schrijft de nieuwe build erbij maar haalt oude bestanden niet
 * weg. Omdat Vite elke build een nieuwe bestandsnaam met een hash geeft,
 * stapelen die zich op. Dat maakt de APK groter, en -- vervelender -- je
 * vindt bij het zoeken naar een fout oude code terug die allang vervangen is.
 */

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

const TARGETS = [
  'android/app/src/main/assets/public',
  'ios/App/App/public',
]

let removed = 0

for (const rel of TARGETS) {
  const dir = path.join(root, rel)
  if (!fs.existsSync(dir)) continue
  const before = countFiles(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  removed += before
  console.log(`opgeruimd: ${rel} (${before} bestanden)`)
}

if (removed === 0) console.log('niets op te ruimen')

function countFiles(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name))
    else n++
  }
  return n
}
