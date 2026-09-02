/**
 * Zet de bestanden neer die op de WORTEL van de uitrol horen.
 *
 * Sinds de app naar /app/ is verhuisd, heeft dist/ twee bewoners:
 *
 *   dist/           de merksite -- 44 pagina's, robots.txt, sitemap, 404.html
 *   dist/app/       deze app, gebouwd door Vite
 *
 * Alles wat in public/ staat komt in dist/app/ terecht. Dat klopt voor het
 * manifest en de iconen, maar niet voor _headers: Cloudflare leest dat bestand
 * ALLEEN in de wortel van de uitrolmap. In dist/app/ zou het stilzwijgend niets
 * doen en tegelijk gewoon op /app/_headers te lezen zijn.
 *
 * Daarom staat het in uitrol/ en zet dit script het op zijn plek. Het draait
 * als laatste stap van "npm run build".
 *
 * Dit script verwijdert niets. Het bouwen van de app mag nooit pagina's van de
 * merksite opruimen die er misschien al staan.
 */
const fs = require('node:fs')
const path = require('node:path')

const wortel = path.join(__dirname, '..')
const dist = path.join(wortel, 'dist')
const app = path.join(dist, 'app')

function stop(bericht, uitleg) {
  console.error(`\n  ${bericht}\n`)
  if (uitleg) console.error(`  ${uitleg}\n`)
  process.exit(1)
}

/* 1. Heeft Vite werkelijk naar dist/app gebouwd? ------------------------- */

if (!fs.existsSync(path.join(app, 'index.html'))) {
  stop(
    'dist/app/index.html ontbreekt.',
    'Vite hoort naar dist/app te bouwen (build.outDir in vite.config.ts).\n' +
      '  Staat daar nog "dist", dan is de verhuizing naar /app/ half doorgevoerd.',
  )
}

/* 2. De merksite op de wortel -------------------------------------------- */

/*
 * site/ is de gecommitte kopie van projecten/truckwash-website, gezet door
 * "npm run site:ophalen". Die omweg is nodig omdat dat project geen git-repo
 * is: Cloudflare bouwt uit een kloon van DEZE repo, en wat daar niet in staat
 * bestaat op de bouwmachine niet.
 *
 * Vite maakt alleen dist/app leeg, dus deze bestanden overleven een app-bouw.
 * Toch wordt hier elke keer opnieuw gekopieerd: anders publiceer je op een
 * schone machine een lege wortel, en op je eigen laptop niet -- en dat verschil
 * ontdek je pas op het echte adres.
 */
const site = path.join(wortel, 'site')

if (!fs.existsSync(path.join(site, 'index.html'))) {
  stop(
    'site/index.html ontbreekt.',
    'Zonder de merksite is truckwash-workspace.com/ leeg en staat de app\n' +
      '  alleen nog op /app/. Draai:  npm run site:ophalen',
  )
}

let geplaatst = 0
;(function kopieer(van, naar) {
  fs.mkdirSync(naar, { recursive: true })
  for (const item of fs.readdirSync(van, { withFileTypes: true })) {
    const a = path.join(van, item.name)
    const b = path.join(naar, item.name)
    /*
     * dist/app is van Vite. Zou site/ ooit een map "app" krijgen, dan zou die
     * hier de zojuist gebouwde app overschrijven -- en dan staat er een
     * vestigingspagina op het adres waar de app hoort te staan.
     */
    if (naar === dist && item.name === 'app') {
      stop('site/app bestaat en zou de gebouwde app overschrijven.',
        'Hernoem die map in de merksite; /app/ is van het dashboard.')
    }
    if (item.isDirectory()) kopieer(a, b)
    else { fs.copyFileSync(a, b); geplaatst++ }
  }
})(site, dist)

if (!fs.existsSync(path.join(dist, '404.html'))) {
  stop(
    'dist/404.html ontbreekt.',
    'wrangler.jsonc staat op not_found_handling "404-page". Zonder dit\n' +
      '  bestand toont Cloudflare zijn eigen foutpagina bij elke tikfout.',
  )
}

/* 3. De kopregels op de wortel ------------------------------------------ */

const bron = path.join(wortel, 'uitrol', '_headers')
if (!fs.existsSync(bron)) {
  stop(
    'uitrol/_headers ontbreekt.',
    'Zonder dat bestand staat er na de uitrol geen enkele kopregel: geen\n' +
      '  noindex op /app/, geen X-Frame-Options, geen cachebeleid. Dat faalt\n' +
      '  stil -- je ziet het pas met curl na de uitrol.',
  )
}
fs.mkdirSync(dist, { recursive: true })
fs.copyFileSync(bron, path.join(dist, '_headers'))

/* 4. De stille valstrik: een robots.txt die alles verbiedt --------------- */

/*
 * De app bracht vroeger een eigen robots.txt mee met "Disallow: /". Die stond
 * in public/ en is daar weggehaald: hij zou nu op /app/robots.txt belanden,
 * waar niemand hem leest, en zou hij toch op de wortel komen dan haalt hij de
 * complete merksite uit de zoekresultaten. De app wordt afgeschermd met de
 * kopregel X-Robots-Tag op /app/*, en die staat in uitrol/_headers.
 *
 * De robots.txt op de wortel is van de merksite. Blijft er een oude van de app
 * liggen, dan meldt niets een fout -- je ziet het weken later terug in de
 * zoekresultaten. Vandaar deze controle.
 */
const robots = path.join(dist, 'robots.txt')
if (fs.existsSync(robots)) {
  const regels = fs
    .readFileSync(robots, 'utf8')
    .split('\n')
    .map((r) => r.trim())
  if (regels.some((r) => /^Disallow:\s*\/\s*$/i.test(r))) {
    stop(
      'dist/robots.txt verbiedt het hele domein ("Disallow: /").',
      'Dat is de oude robots.txt van de app, van voor de verhuizing. Op de\n' +
        '  wortel haalt hij ook de merksite uit de zoekresultaten. Verwijder\n' +
        '  dist/robots.txt; de merksite zet er zijn eigen versie neer.',
    )
  }
}

console.log(
  `  uitrol: ${geplaatst} bestanden merksite op de wortel, ` +
  'app in dist/app/, _headers geplaatst')
