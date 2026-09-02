/**
 * Veiligheidscontrole vóór elke build.
 *
 * Alles wat met VITE_ begint wordt door Vite letterlijk in de app-bundel
 * gezet en dus meegeleverd aan iedere gebruiker. Een geheime sleutel daar
 * neerzetten betekent dat elke wasser en elke klant volledige toegang tot de
 * database krijgt, langs alle beveiligingsregels heen.
 *
 * Deze controle laat de build mislukken zodra zo'n sleutel opduikt.
 */

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

/** Patronen die op een geheime sleutel wijzen. */
const SECRET_PREFIXES = [
  'sb_secret_',   // Supabase secret key (nieuwe stijl)
  'sk_',          // Stripe en veel andere diensten
  'service_role', // letterlijk in de waarde
]

/** Is dit een JWT met rol service_role? (Supabase, oude stijl) */
function isServiceRoleJwt(value) {
  const parts = value.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function parseEnv(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return {
        key: l.slice(0, i).trim(),
        value: l.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
      }
    })
}

const files = ['.env', '.env.local', '.env.production', '.env.production.local']
const problems = []

for (const name of files) {
  for (const { key, value } of parseEnv(path.join(root, name))) {
    if (!key.startsWith('VITE_') || !value) continue

    const prefix = SECRET_PREFIXES.find((p) => value.startsWith(p) || value.includes(p))
    if (prefix) problems.push({ name, key, why: `de waarde begint met "${prefix}"` })
    else if (isServiceRoleJwt(value)) problems.push({ name, key, why: 'het is een service_role-sleutel' })
  }
}

if (problems.length) {
  console.error('\n  BUILD GESTOPT — er staat een geheime sleutel in een VITE_-variabele\n')
  for (const p of problems) {
    console.error(`  ${p.name} -> ${p.key}`)
    console.error(`     ${p.why}\n`)
  }
  console.error('  Alles met VITE_ ervoor wordt in de app-bundel gebakken en meegeleverd')
  console.error('  aan iedere gebruiker. Een geheime sleutel geeft daarmee iedereen volledige')
  console.error('  toegang tot de database, langs de beveiligingsregels heen.\n')
  console.error('  Gebruik in plaats daarvan de publieke sleutel:')
  console.error('  Supabase -> Project Settings -> API Keys -> "publishable" (of de oude "anon").\n')
  process.exit(1)
}

/* ------------------------------------------------------------------ *
 *  En het omgekeerde: helemaal geen sleutel
 *
 *  Dit stopt de bouw niet -- een bouw voor de tests mag zonder. Maar een
 *  uitrol zonder deze twee levert een app op die er goed uitziet en waar
 *  niemand in kan, en dat merk je pas als de eerste persoon het probeert.
 *  Bij een bouwstraat zoals Cloudflare Pages komen ze uit de omgeving en
 *  niet uit een bestand, dus daar kijken we ook.
 * ------------------------------------------------------------------ */

const uitBestanden = new Set()
for (const name of files) {
  for (const { key, value } of parseEnv(path.join(root, name))) {
    if (value) uitBestanden.add(key)
  }
}

const NODIG = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const ontbreekt = NODIG.filter((k) => !process.env[k] && !uitBestanden.has(k))

if (ontbreekt.length && process.env.VITE_USE_MOCK !== '1') {
  console.warn('\n  LET OP — er wordt gebouwd zonder verbinding met de database\n')
  for (const k of ontbreekt) console.warn(`  ${k} is nergens gezet`)
  console.warn('\n  De app bouwt gewoon, maar er kan niemand inloggen: het inlogscherm')
  console.warn('  meldt dat Supabase niet is ingesteld. Zet ze in .env voor lokaal werk,')
  console.warn('  of als bouwvariabelen bij de plek waar je uitrolt.\n')
  console.warn('  Gebruik de publieke sleutel ("publishable" of de oude "anon"),')
  console.warn('  nooit de service-sleutel.\n')
}
