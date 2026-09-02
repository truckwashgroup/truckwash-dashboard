/**
 * Het ijkpunt: een bevroren kopie van de site zoals hij er NU uitziet.
 *
 * Waarom dit bestaat
 * ------------------
 *
 * De achttien vestigingen staan sinds 0035 in de database, overgenomen uit
 * bouw/site.json van het merksiteproject. De volgende stap is dat de site zijn
 * gegevens daar ophaalt in plaats van uit site.json.
 *
 * Als die overname klopt, hoort daar exact dezelfde site uit te komen. Dat is
 * geen mening maar een meting: bouw de site opnieuw en leg hem naast deze
 * kopie. Elk verschil is of een vertaalfout (lng/lon, tel/telefoon,
 * straat/adres, extra/bereikbaar, diensten/punten) of iets wat de database
 * niet kan leveren. Allebei wil je zien, en allebei zie je alleen als je van
 * tevoren hebt vastgelegd waar je vandaan komt.
 *
 * Zonder deze kopie is de vergelijking straks onmogelijk: de eerste bouw uit
 * de database overschrijft site/ en truckwash-website/ allebei, en dan is er
 * niets meer om tegen te vergelijken.
 *
 * Wat er WEL in gaat
 * ------------------
 *
 *   *.html            alle 45 pagina's plus 404.html. De achttien
 *                     vestigingspagina's zijn de kern, maar de voettekst met
 *                     "Alle vestigingen" staat op elke pagina, /locaties/
 *                     nummert ze 01 t/m 18, de homepage zet ze in zijn
 *                     Organization-JSON-LD en webbouw.cjs:170 zet de EERSTE
 *                     ZES in de jobPosting van elke vacature. Een andere
 *                     volgorde uit de database verandert dus veel meer dan
 *                     achttien bestanden.
 *   assets/data.js    de postcodezoeker en de kaart. Wordt door
 *                     webbouw.cjs:341 uit dezelfde locaties geschreven.
 *   sitemap.xml       bevat de achttien locatie-URL's.
 *   robots.txt        klein, en uitrol-bestanden.cjs hangt eraan.
 *
 * Wat er NIET in gaat, en waarom
 * ------------------------------
 *
 *   assets/app.js     108 kB, geknipt uit brok.js door maakapp.py, en
 *   assets/style.css  handwerk. Allebei veranderen ze voortdurend om redenen
 *                     die niets met de vestigingen te maken hebben (3D-scenes,
 *                     opmaak). Een ijkpunt dat bij elke opmaakwijziging rood
 *                     wordt, wordt binnen twee weken blind opnieuw gezet -- en
 *                     dan bewaakt hij niets meer.
 *   assets/img/       foto's. Binair, komen uit beeld.json en niet uit de
 *                     database (gemeten: nul treffers op ".foto" in
 *                     webbouw.cjs en brok.js).
 *
 * Draaien
 * -------
 *
 *   node scripts/ijkpunt.mjs            zet het ijkpunt vanuit site/
 *   SITE_BRON=../pad node scripts/...   vanuit een andere map
 *
 * Opnieuw zetten mag, maar alleen bewust: het resultaat staat in git, dus een
 * herijking is een diff die iemand langsloopt. Dat is precies de bedoeling.
 * Herijk pas NADAT je de vergelijking hebt gedraaid en elk verschil hebt
 * uitgelegd -- niet ervoor.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WORTEL = path.resolve(HIER, '..')
const BRON = process.env.SITE_BRON
  ? path.resolve(process.env.SITE_BRON)
  : path.join(WORTEL, 'site')
const DOEL = path.join(HIER, 'ijkpunt')

/* Wat mee mag. Alles wat de generator schrijft en wat van de vestigingen
   afhangt -- en verder niets. */
const MEE = (rel) =>
  rel.endsWith('.html') ||
  rel === 'assets/data.js' ||
  rel === 'sitemap.xml' ||
  rel === 'robots.txt'

if (!fs.existsSync(path.join(BRON, 'index.html'))) {
  console.error(`Geen gebouwde site in ${BRON}.`)
  console.error('Draai eerst in truckwash-website:  cd bouw && UIT=.. node webbouw.cjs')
  console.error('en daarna in dashboard:            npm run site:ophalen')
  process.exit(1)
}

function loop(map, prefix = '') {
  const uit = []
  for (const item of fs.readdirSync(map, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) uit.push(...loop(path.join(map, item.name), rel))
    else if (MEE(rel)) uit.push(rel)
  }
  return uit
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/* Eerst helemaal weg, dan opnieuw. Eroverheen kopieren laat een pagina staan
   die in de bron is verdwenen, en dan meldt de vergelijking straks niets over
   een vestiging die van de site af is gehaald. */
fs.rmSync(DOEL, { recursive: true, force: true })

const bestanden = {}
let bytes = 0
let crlf = 0

for (const rel of loop(BRON)) {
  const buf = fs.readFileSync(path.join(BRON, rel))
  const doel = path.join(DOEL, 'site', rel)
  fs.mkdirSync(path.dirname(doel), { recursive: true })
  fs.writeFileSync(doel, buf)
  bestanden[rel] = { bytes: buf.length, sha256: sha(buf) }
  bytes += buf.length
  /* Regeleindes. De generator schrijft LF; komt hier een CR binnen, dan heeft
     git of een editor eraan gezeten en is elke byte-vergelijking daarna
     waardeloos. Nu meten is beter dan straks een diff van 45 bestanden. */
  if (buf.includes(13)) crlf++
}

/* De herkomst. Zonder dit is het over een half jaar een map met HTML waarvan
   niemand meer weet waar hij vandaan komt of hoe oud hij is. */
const stil = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', cwd: WORTEL }).trim() }
  catch { return null }
}

const siteJson = path.resolve(WORTEL, '..', 'truckwash-website', 'bouw', 'site.json')

const herkomst = {
  gemaakt: new Date().toISOString(),
  waarvoor:
    'Bevroren kopie van de site zoals hij uit bouw/site.json komt. Dient als ' +
    'vergelijkingspunt voor de eerste bouw die zijn vestigingen uit de ' +
    'database haalt (website_vestigingen(), migratie 0033/0035).',
  bron: BRON,
  dashboard_commit: stil('git', ['rev-parse', 'HEAD']),
  dashboard_versie: JSON.parse(fs.readFileSync(path.join(WORTEL, 'package.json'), 'utf8')).version,
  site_json: fs.existsSync(siteJson)
    ? { pad: siteJson, bytes: fs.statSync(siteJson).size, sha256: sha(fs.readFileSync(siteJson)) }
    : null,
  aantal_bestanden: Object.keys(bestanden).length,
  aantal_paginas: Object.keys(bestanden).filter((r) => r.endsWith('.html')).length,
  /* locaties/<slug>/index.html, en dus NIET locaties/index.html -- dat is de
     overzichtspagina en geen vestiging. Vandaar de eis van drie stukken. */
  vestigingen: Object.keys(bestanden)
    .filter((r) => r.split('/').length === 3 && r.startsWith('locaties/') && r.endsWith('/index.html'))
    .map((r) => r.split('/')[1]),
  bestanden,
}

fs.writeFileSync(path.join(DOEL, 'herkomst.json'), JSON.stringify(herkomst, null, 1) + '\n')

console.log(`ijkpunt gezet: ${herkomst.aantal_bestanden} bestanden ` +
  `(${(bytes / 1024).toFixed(0)} kB), waarvan ${herkomst.aantal_paginas} pagina's`)
console.log(`  ${herkomst.vestigingen.length} vestigingen: ${herkomst.vestigingen.join(' ')}`)
console.log(`  in ${path.relative(WORTEL, DOEL)}`)
if (crlf) console.warn(`  LET OP: ${crlf} bestand(en) met CR erin -- byte-vergelijking wordt onbetrouwbaar`)
