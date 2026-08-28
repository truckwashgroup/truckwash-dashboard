/**
 * Voert het databaseschema echt uit, in een PostgreSQL die in Node draait.
 *
 * Aanleiding: een migratie die alleen "er goed uitziet" is niet getest. Deze
 * test draait 0001, 0002 en de startgegevens tegen een echte Postgres, doet
 * dat twee keer om te bewijzen dat opnieuw draaien veilig is, en controleert
 * daarna of de beveiligingsregels doen wat ze moeten doen.
 *
 *   npm run sqltest
 */

import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sqlFile = (p) => readFileSync(join(root, p), 'utf8')

let passed = 0
let failed = 0

function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

async function run(db, label, sql) {
  try {
    await db.exec(sql)
    check(label, true)
    return true
  } catch (e) {
    check(label, false, String(e.message ?? e).split('\n')[0])
    return false
  }
}

/**
 * Supabase levert een auth-schema, rollen en auth.uid(). Die bootsen we na,
 * zodat het schema draait zoals het straks bij Supabase draait.
 */
const SUPABASE_STUB = `
create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb default '{}'::jsonb
);

-- auth.uid() leest normaal het ingelogde account uit de JWT. Hier uit een
-- sessie-instelling, zodat de test van gebruiker kan wisselen.
create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('test.uid', true), '')::uuid;
$fn$;

grant usage on schema public to anon, authenticated, service_role;
`

async function fresh() {
  const db = await PGlite.create()
  await db.exec(SUPABASE_STUB)
  return db
}

const asUser = (db, uid) => db.exec(`set test.uid = '${uid}';`)

/* ================================================================== */

console.log('\n1. Schema opbouwen zoals jij het plakt')

let db = await fresh()
await run(db, '0001_init.sql draait', sqlFile('supabase/migrations/0001_init.sql'))
await run(db, '0002_personeel_en_rooster.sql draait', sqlFile('supabase/migrations/0002_personeel_en_rooster.sql'))
await run(db, 'seed.sql draait', sqlFile('supabase/seed.sql'))

console.log('\n2. Opnieuw draaien mag geen schade doen')
await run(db, '0001 nogmaals', sqlFile('supabase/migrations/0001_init.sql'))
await run(db, '0002 nogmaals', sqlFile('supabase/migrations/0002_personeel_en_rooster.sql'))
await run(db, 'seed nogmaals', sqlFile('supabase/seed.sql'))

const bedrijven = await db.query('select count(*)::int as n from public.companies')
check('klanten niet gedupliceerd', bedrijven.rows[0].n === 4, String(bedrijven.rows[0].n))

console.log('\n3. Kolommen en tabellen staan er')

const cols = await db.query(`
  select column_name, data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'`)
const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type]))

check('profiles.id is text geworden', byName.id === 'text', byName.id)
check('profiles.auth_id bestaat', byName.auth_id === 'uuid', byName.auth_id)
for (const c of ['personnel_number', 'phone', 'job_title', 'contract_hours', 'start_date', 'notes']) {
  check(`profiles.${c} bestaat`, c in byName)
}

const tables = await db.query(`
  select table_name from information_schema.tables
   where table_schema = 'public' order by table_name`)
const names = tables.rows.map((r) => r.table_name)
for (const t of ['companies', 'profiles', 'wash_jobs', 'inventory_items',
                 'stock_movements', 'expenses', 'time_entries', 'shifts']) {
  check(`tabel ${t}`, names.includes(t))
}

console.log('\n4. Alles in een keer (setup.sql) op een lege database')
const db2 = await fresh()
await run(db2, 'setup.sql draait in een keer', sqlFile('supabase/setup.sql'))
await run(db2, 'setup.sql nog een keer', sqlFile('supabase/setup.sql'))
await db2.close()

console.log('\n5. Nieuw account koppelt aan een bestaand dossier')

// Het management maakt een dossier aan, nog zonder inlogaccount.
await db.exec(`
  insert into public.profiles (id, email, name, roles, personnel_number)
  values ('u_joris', 'joris@truckwash1group.nl', 'Joris Peters',
          array['employee']::text[], 'TW-024');`)

const { rows: [voor] } = await db.query(
  `select auth_id from public.profiles where id = 'u_joris'`)
check('dossier heeft nog geen inlogaccount', voor.auth_id === null)

// Joris krijgt een account met hetzelfde e-mailadres.
await db.exec(`
  insert into auth.users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'Joris@Truckwash1Group.nl');`)

const { rows: [na] } = await db.query(
  `select auth_id from public.profiles where id = 'u_joris'`)
check('account gekoppeld aan het bestaande dossier',
  na.auth_id === '11111111-1111-1111-1111-111111111111', String(na.auth_id))

const { rows: [aantal] } = await db.query(
  `select count(*)::int as n from public.profiles where email ilike 'joris@%'`)
check('geen tweede dossier aangemaakt', aantal.n === 1, String(aantal.n))

// Iemand zonder bestaand dossier krijgt er wel een, met alleen de klantrol.
await db.exec(`
  insert into auth.users (id, email)
  values ('22222222-2222-2222-2222-222222222222', 'onbekend@example.com');`)
const { rows: [nieuw] } = await db.query(
  `select roles from public.profiles where email = 'onbekend@example.com'`)
check('onbekend account krijgt alleen de klantrol',
  Array.isArray(nieuw.roles) ? nieuw.roles.join() === 'customer' : String(nieuw.roles) === '{customer}',
  JSON.stringify(nieuw.roles))

console.log('\n6. updated_at wordt door de server gezet')

await db.exec(`
  insert into public.wash_jobs (id, company_id, plate, service, scheduled_at, updated_at)
  values ('job_test', 'co_jansen', '12-BND-4', 'combi', 0, 5);`)
const { rows: [job] } = await db.query(`select updated_at from public.wash_jobs where id = 'job_test'`)
check('client-waarde wordt overschreven', Number(job.updated_at) > 1_600_000_000_000,
  String(job.updated_at))

console.log('\n7. Beveiliging: een klant ziet geen andere klanten')

// Een klant van Transport Jansen, en een wasser.
await db.exec(`
  insert into auth.users (id, email) values
    ('33333333-3333-3333-3333-333333333333', 'klant@transportjansen.nl'),
    ('44444444-4444-4444-4444-444444444444', 'wasser@truckwash1group.nl');

  update public.profiles
     set roles = array['customer']::text[], company_id = 'co_jansen'
   where email = 'klant@transportjansen.nl';

  update public.profiles
     set roles = array['employee']::text[]
   where email = 'wasser@truckwash1group.nl';

  insert into public.wash_jobs (id, company_id, plate, service, scheduled_at) values
    ('job_jansen', 'co_jansen',  'AA-11-BB', 'combi', 0),
    ('job_bulk',   'co_bulk',    'CC-22-DD', 'combi', 0);

  insert into public.shifts (id, user_id, kind, start_at, end_at)
  values ('sh_1', 'u_joris', 'dienst', 0, 1);
`)

// PGlite draait als superuser; die negeert RLS. Even afdwingen dat de regels
// wel gelden, anders test je niets.
await db.exec(`
  alter table public.wash_jobs   force row level security;
  alter table public.shifts      force row level security;
  alter table public.inventory_items force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

async function countAs(uid, sql) {
  await asUser(db, uid)
  await db.exec('set role authenticated;')
  try {
    const r = await db.query(sql)
    return r.rows[0].n
  } finally {
    await db.exec('reset role;')
  }
}

const klant = '33333333-3333-3333-3333-333333333333'
const wasser = '44444444-4444-4444-4444-444444444444'

// job_test en job_jansen horen allebei bij Transport Jansen; job_bulk niet.
check('klant ziet alleen de eigen wasbeurten',
  (await countAs(klant, 'select count(*)::int as n from public.wash_jobs')) === 2)
check('werknemer ziet alle wasbeurten',
  (await countAs(wasser, 'select count(*)::int as n from public.wash_jobs')) === 3)
check('klant ziet de voorraad niet',
  (await countAs(klant, 'select count(*)::int as n from public.inventory_items')) === 0)
check('werknemer ziet de voorraad wel',
  (await countAs(wasser, 'select count(*)::int as n from public.inventory_items')) === 8)
check('klant ziet het rooster niet',
  (await countAs(klant, 'select count(*)::int as n from public.shifts')) === 0)
check('werknemer ziet het rooster wel',
  (await countAs(wasser, 'select count(*)::int as n from public.shifts')) === 1)

await db.close()

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
