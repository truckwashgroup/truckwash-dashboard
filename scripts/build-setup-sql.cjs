/**
 * Plakt alle migraties achter elkaar tot één bestand: supabase/setup.sql
 *
 * Dat bestand is wat je in de SQL-editor van Supabase plakt. Met de hand
 * bijhouden ging een keer mis -- een migratie stond er wel bij, maar in de
 * verkeerde volgorde -- dus doet dit script het.
 *
 *   node scripts/build-setup-sql.cjs
 */

const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const dir = join(root, 'supabase', 'migrations')

const KOP = `-- ===========================================================================
--  Truckwash1 Dashboard -- ALLES IN EEN KEER
--
--  Selecteer alles, plak het in de SQL Editor van Supabase en druk op Run.
--  Opnieuw draaien mag: het maakt niets dubbel aan en gooit niets weg.
--
--  Dit bestand wordt gemaakt door scripts/build-setup-sql.cjs. Wijzig de
--  migraties in supabase/migrations, niet dit bestand.
-- ===========================================================================

`

const bestanden = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const inhoud = KOP + bestanden
  .map((f) => readFileSync(join(dir, f), 'utf8').trimEnd())
  .join('\n\n')
  + '\n'

writeFileSync(join(root, 'supabase', 'setup.sql'), inhoud, 'utf8')

console.log(`setup.sql opgebouwd uit ${bestanden.length} migraties:`)
for (const f of bestanden) console.log('  ' + f)
