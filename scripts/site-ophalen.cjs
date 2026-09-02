/**
 * Haalt de merksite op uit het buurproject.
 *
 * Waarom dit bestaat
 * ------------------
 *
 * De site wordt gemaakt in projecten/truckwash-website. Die map is geen
 * git-repo en staat dus nergens anders dan op deze ene laptop. Cloudflare
 * bouwt uit een kloon van de dashboard-repo, en wat daar niet in staat
 * bestaat voor de bouwmachine niet.
 *
 * Vandaar deze stap: hij zet een kopie van de gebouwde site in site/, die
 * meegaat in git en dus ook op de bouwmachine landt. Handmatig, niet
 * automatisch bij elke bouw -- dan zou een bouw op een andere machine stil
 * een oude of lege site publiceren.
 *
 * Draaien:  npm run site:ophalen
 *
 * Wat er NIET meegaat
 * -------------------
 *
 *   bouw/       de generator. Bevat template.html (de hele site nog een keer),
 *               site.json en beeld.json (3,4 MB aan foto's als base64). Samen
 *               3,7 MB die een bezoeker nooit opvraagt -- en Cloudflare
 *               serveert alles wat in de uitrolmap staat, ook dit. Dat is
 *               dezelfde site twee keer online, met de bron erbij.
 *   README.md   ontwikkeldocumentatie.
 *
 * De robots.txt van de site gaat WEL mee. Dat is met opzet: die staat op
 * "Allow: /", en de app wordt afgeschermd met de kopregel X-Robots-Tag op
 * /app/* uit uitrol/_headers. Zou hier een robots.txt met "Disallow: /"
 * belanden, dan haalt die de complete site uit Google -- scripts/
 * uitrol-bestanden.cjs breekt de bouw af als dat gebeurt.
 */

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const bron = process.env.SITE_BRON
  ? path.resolve(process.env.SITE_BRON)
  : path.resolve(root, '..', 'truckwash-website')
const doel = path.join(root, 'site')

/* Wat nooit meegaat. Namen in de wortel van de site. */
const OVERSLAAN = new Set(['bouw', 'README.md', '.git', 'node_modules'])

if (!fs.existsSync(path.join(bron, 'index.html'))) {
  console.error(`Geen site gevonden in ${bron}.`)
  console.error('Staat het project ergens anders? Geef het pad mee met SITE_BRON=...')
  process.exit(1)
}

/*
 * Eerst helemaal weg, dan opnieuw.
 *
 * Eroverheen kopieren laat pagina's staan die in de bron zijn verdwenen, en
 * die worden daarna gewoon gepubliceerd. Een verwijderde vestiging die op de
 * site blijft staan is precies het soort fout dat niemand ziet.
 */
fs.rmSync(doel, { recursive: true, force: true })

let bestanden = 0
let bytes = 0

function kopieer(van, naar) {
  fs.mkdirSync(naar, { recursive: true })
  for (const item of fs.readdirSync(van, { withFileTypes: true })) {
    if (naar === doel && OVERSLAAN.has(item.name)) continue
    const a = path.join(van, item.name)
    const b = path.join(naar, item.name)
    if (item.isDirectory()) kopieer(a, b)
    else {
      fs.copyFileSync(a, b)
      bestanden++
      bytes += fs.statSync(b).size
    }
  }
}

kopieer(bron, doel)

/*
 * De 404 is geen luxe maar een voorwaarde.
 *
 * wrangler.jsonc staat op "404-page": Cloudflare loopt vanaf het aangevraagde
 * pad omhoog tot hij een 404.html vindt. Is die er niet, dan valt hij terug op
 * zijn eigen kale foutpagina -- en dan ziet een bezoeker die zich vertypt geen
 * Truckwash meer maar Cloudflare.
 */
if (!fs.existsSync(path.join(doel, '404.html'))) {
  console.error('site/404.html ontbreekt. Draai in truckwash-website eerst:')
  console.error('  cd bouw && UIT=.. node webbouw.cjs')
  process.exit(1)
}

const pagina = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, i) => n + (i.isDirectory()
    ? pagina(path.join(d, i.name))
    : Number(i.name === 'index.html')), 0)

console.log(
  `site: ${bestanden} bestanden (${(bytes / 1024 / 1024).toFixed(1)} MB), ` +
  `${pagina(doel)} pagina's uit ${path.basename(bron)}`)
