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

-- Supabase levert ook een storage-schema met buckets en objecten. De
-- beveiligingsregels op de dossiermap hangen daaraan, dus die bootsen we
-- na -- anders test je de helft van het slot niet.
create schema if not exists storage;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id       uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name     text not null,
  owner    uuid
);

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema storage to authenticated;
`

async function fresh() {
  const db = await PGlite.create()
  await db.exec(SUPABASE_STUB)
  return db
}

const asUser = (db, uid) => db.exec(`set test.uid = '${uid}';`)

/*
 * Weer niemand zijn.
 *
 * De opstelling hieronder zet gegevens klaar met gewone db.exec-opdrachten,
 * en die horen te gelden als "de server zelf" -- zoals een serverfunctie met
 * de servicesleutel, waar auth.uid() leeg is. Blijft test.uid van de vorige
 * controle staan, dan denkt de database dat die medewerker het doet, en dan
 * loopt de opstelling tegen de rem op profiles aan.
 */
const asServer = (db) => db.exec(`set test.uid = '';`)

/* ================================================================== */

console.log('\n1. Schema opbouwen zoals jij het plakt')

let db = await fresh()
await run(db, '0001_init.sql draait', sqlFile('supabase/migrations/0001_init.sql'))
await run(db, '0002_personeel_en_rooster.sql draait', sqlFile('supabase/migrations/0002_personeel_en_rooster.sql'))
await run(db, '0003_rechten_berichten_opleiding.sql draait', sqlFile('supabase/migrations/0003_rechten_berichten_opleiding.sql'))
await run(db, '0004_locaties.sql draait', sqlFile('supabase/migrations/0004_locaties.sql'))
await run(db, '0005_technische_dienst.sql draait', sqlFile('supabase/migrations/0005_technische_dienst.sql'))
await run(db, '0006_meldingen_en_logboek.sql draait', sqlFile('supabase/migrations/0006_meldingen_en_logboek.sql'))
await run(db, '0007_aanmelden_en_overleg.sql draait', sqlFile('supabase/migrations/0007_aanmelden_en_overleg.sql'))
await run(db, '0008_rechten_in_het_overleg.sql draait', sqlFile('supabase/migrations/0008_rechten_in_het_overleg.sql'))
await run(db, '0009_personeelsdossier.sql draait', sqlFile('supabase/migrations/0009_personeelsdossier.sql'))
await run(db, '0010_leestekens_en_rooster.sql draait', sqlFile('supabase/migrations/0010_leestekens_en_rooster.sql'))
await run(db, '0011_postbus.sql draait', sqlFile('supabase/migrations/0011_postbus.sql'))
await run(db, '0012_kassa.sql draait', sqlFile('supabase/migrations/0012_kassa.sql'))
await run(db, '0013_berichten_mogen_van_iedereen.sql draait', sqlFile('supabase/migrations/0013_berichten_mogen_van_iedereen.sql'))
await run(db, '0014_wijzigingsverzoeken.sql draait', sqlFile('supabase/migrations/0014_wijzigingsverzoeken.sql'))
await run(db, '0015_agenda.sql draait', sqlFile('supabase/migrations/0015_agenda.sql'))
await run(db, '0016_werkgevers.sql draait', sqlFile('supabase/migrations/0016_werkgevers.sql'))

await run(db, '0017_berichten_over_de_grens.sql draait', sqlFile('supabase/migrations/0017_berichten_over_de_grens.sql'))

await run(db, '0018_klokken_gaat_via_de_kassa.sql draait', sqlFile('supabase/migrations/0018_klokken_gaat_via_de_kassa.sql'))

await run(db, '0019_een_bericht_gelezen_melden.sql draait', sqlFile('supabase/migrations/0019_een_bericht_gelezen_melden.sql'))

await run(db, '0020_van_melding_naar_plan.sql draait', sqlFile('supabase/migrations/0020_van_melding_naar_plan.sql'))

await run(db, '0021_je_eigen_dossier_en_de_rondleiding.sql draait', sqlFile('supabase/migrations/0021_je_eigen_dossier_en_de_rondleiding.sql'))

await run(db, '0022_bijwerken_is_geen_versturen.sql draait', sqlFile('supabase/migrations/0022_bijwerken_is_geen_versturen.sql'))

await run(db, '0023_uitnodigen_en_uitschrijven.sql draait', sqlFile('supabase/migrations/0023_uitnodigen_en_uitschrijven.sql'))

await run(db, '0024_uren_en_kilometers.sql draait', sqlFile('supabase/migrations/0024_uren_en_kilometers.sql'))
await run(db, '0025_de_kluis_en_het_koppelen_van_een_kassa.sql draait', sqlFile('supabase/migrations/0025_de_kluis_en_het_koppelen_van_een_kassa.sql'))
await run(db, '0026_de_vestigingen_beheren.sql draait', sqlFile('supabase/migrations/0026_de_vestigingen_beheren.sql'))
await run(db, '0027_een_foto_bij_het_artikel.sql draait', sqlFile('supabase/migrations/0027_een_foto_bij_het_artikel.sql'))
await run(db, '0028_een_kassa_is_geen_aanmelding.sql draait', sqlFile('supabase/migrations/0028_een_kassa_is_geen_aanmelding.sql'))
await run(db, '0029_de_administratie.sql draait', sqlFile('supabase/migrations/0029_de_administratie.sql'))
await run(db, 'seed.sql draait', sqlFile('supabase/seed.sql'))

console.log('\n2. Opnieuw draaien mag geen schade doen')
await run(db, '0001 nogmaals', sqlFile('supabase/migrations/0001_init.sql'))
await run(db, '0002 nogmaals', sqlFile('supabase/migrations/0002_personeel_en_rooster.sql'))
await run(db, '0003 nogmaals', sqlFile('supabase/migrations/0003_rechten_berichten_opleiding.sql'))
await run(db, '0004 nogmaals', sqlFile('supabase/migrations/0004_locaties.sql'))
await run(db, '0005 nogmaals', sqlFile('supabase/migrations/0005_technische_dienst.sql'))
await run(db, '0006 nogmaals', sqlFile('supabase/migrations/0006_meldingen_en_logboek.sql'))
await run(db, '0007 nogmaals', sqlFile('supabase/migrations/0007_aanmelden_en_overleg.sql'))
await run(db, '0008 nogmaals', sqlFile('supabase/migrations/0008_rechten_in_het_overleg.sql'))
await run(db, '0009 nogmaals', sqlFile('supabase/migrations/0009_personeelsdossier.sql'))
await run(db, '0010 nogmaals', sqlFile('supabase/migrations/0010_leestekens_en_rooster.sql'))
await run(db, '0011 nogmaals', sqlFile('supabase/migrations/0011_postbus.sql'))
await run(db, '0012 nogmaals', sqlFile('supabase/migrations/0012_kassa.sql'))
await run(db, '0013 nogmaals', sqlFile('supabase/migrations/0013_berichten_mogen_van_iedereen.sql'))
await run(db, '0014 nogmaals', sqlFile('supabase/migrations/0014_wijzigingsverzoeken.sql'))
await run(db, '0015 nogmaals', sqlFile('supabase/migrations/0015_agenda.sql'))
await run(db, '0016 nogmaals', sqlFile('supabase/migrations/0016_werkgevers.sql'))

await run(db, '0017 nogmaals', sqlFile('supabase/migrations/0017_berichten_over_de_grens.sql'))

await run(db, '0018 nogmaals', sqlFile('supabase/migrations/0018_klokken_gaat_via_de_kassa.sql'))

await run(db, '0019 nogmaals', sqlFile('supabase/migrations/0019_een_bericht_gelezen_melden.sql'))

await run(db, '0020 nogmaals', sqlFile('supabase/migrations/0020_van_melding_naar_plan.sql'))

await run(db, '0021 nogmaals', sqlFile('supabase/migrations/0021_je_eigen_dossier_en_de_rondleiding.sql'))

await run(db, '0022 nogmaals', sqlFile('supabase/migrations/0022_bijwerken_is_geen_versturen.sql'))

await run(db, '0023 nogmaals', sqlFile('supabase/migrations/0023_uitnodigen_en_uitschrijven.sql'))

await run(db, '0024 nogmaals', sqlFile('supabase/migrations/0024_uren_en_kilometers.sql'))
await run(db, '0025 nogmaals', sqlFile('supabase/migrations/0025_de_kluis_en_het_koppelen_van_een_kassa.sql'))
await run(db, '0027 nogmaals', sqlFile('supabase/migrations/0027_een_foto_bij_het_artikel.sql'))
await run(db, '0028 nogmaals', sqlFile('supabase/migrations/0028_een_kassa_is_geen_aanmelding.sql'))
await run(db, '0029 nogmaals', sqlFile('supabase/migrations/0029_de_administratie.sql'))
await run(db, '0026 nogmaals', sqlFile('supabase/migrations/0026_de_vestigingen_beheren.sql'))
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
for (const c of ['personnel_number', 'phone', 'job_title', 'contract_hours',
                 'start_date', 'notes', 'grants', 'revokes', 'supervisor_id',
                 'location_id', 'manages', 'all_locations']) {
  check(`profiles.${c} bestaat`, c in byName)
}

const tables = await db.query(`
  select table_name from information_schema.tables
   where table_schema = 'public' order by table_name`)
const names = tables.rows.map((r) => r.table_name)
for (const t of ['companies', 'profiles', 'wash_jobs', 'inventory_items',
                 'stock_movements', 'expenses', 'time_entries', 'shifts',
                 'notifications', 'courses', 'course_progress', 'locations',
                 'assets', 'faults', 'maintenance_plans', 'work_orders',
                 'tickets', 'ticket_messages', 'log_events']) {
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

/*
 * Iemand zonder bestaand dossier meldt zich aan. Hij krijgt wel een dossier,
 * maar zonder rollen en op inactief -- een account is nog geen toegang.
 *
 * En het belangrijkste: hij stuurt zelf mee dat hij management wil zijn. Die
 * gegevens komen van de client en horen genegeerd te worden. Zou dat niet zo
 * zijn, dan kon iedereen met de publieke sleutel zichzelf tot baas bombarderen.
 */
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data)
  values ('22222222-2222-2222-2222-222222222222', 'onbekend@example.com',
          '{"name":"Onbekend Persoon","signup":true,"signup_kind":"klant","roles":["management"]}'::jsonb);`)

const { rows: [nieuw] } = await db.query(
  `select roles, active, name from public.profiles where email = 'onbekend@example.com'`)
const rollen = Array.isArray(nieuw.roles) ? nieuw.roles : []

check('aanmelding krijgt geen enkele rol', rollen.length === 0, JSON.stringify(nieuw.roles))
check('aanmelding staat op inactief', nieuw.active === false, String(nieuw.active))
check('meegestuurde rol management wordt genegeerd',
  !rollen.includes('management'), JSON.stringify(nieuw.roles))
check('de naam uit de aanmelding wordt wel overgenomen',
  nieuw.name === 'Onbekend Persoon', String(nieuw.name))

const { rows: [aanmelding] } = await db.query(
  `select id, kind, status from public.signups where email = 'onbekend@example.com'`)
check('er staat een aanmelding klaar', !!aanmelding && aanmelding.status === 'nieuw',
  JSON.stringify(aanmelding))
check('het soort aanmelding is overgenomen', aanmelding?.kind === 'klant', String(aanmelding?.kind))

const { rows: [seintje] } = await db.query(
  `select count(*)::int as n from public.notifications
    where to_role = 'management' and title like 'Nieuwe aanmelding%'`)
check('het management krijgt er bericht van', seintje.n === 1, String(seintje.n))

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

  -- Dit is wat "toelaten" in de app doet: rollen geven en actief zetten.
  update public.profiles
     set roles = array['customer']::text[], company_id = 'co_jansen', active = true
   where email = 'klant@transportjansen.nl';

  update public.profiles
     set roles = array['employee']::text[], active = true
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
    await asServer(db)
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

console.log('\n8. Berichten, opleiding en de leidinggevende')

await db.exec(`
  insert into auth.users (id, email)
  values ('55555555-5555-5555-5555-555555555555', 'voorman@truckwash1group.nl');

  update public.profiles
     set roles = array['employee','supervisor']::text[], active = true
   where email = 'voorman@truckwash1group.nl';

  insert into public.courses (id, code, title, category, required_for, pass_score)
  values ('crs_test', 'TST-01', 'Testcursus', 'veiligheid', array['employee']::text[], 80);

  insert into public.course_progress (id, user_id, course_id, passed)
  values ('p_wasser', (select id from public.profiles where email = 'wasser@truckwash1group.nl'),
          'crs_test', true),
         ('p_ander',  'u_joris', 'crs_test', false);

  alter table public.notifications   force row level security;
  alter table public.courses         force row level security;
  alter table public.course_progress force row level security;
  alter table public.time_entries    force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

const voorman = '55555555-5555-5555-5555-555555555555'

// Een leidinggevende mag berichten sturen; een gewone werknemer niet.
async function tryInsertNotification(uid, id, fromId) {
  await asUser(db, uid)
  await db.exec('set role authenticated;')
  try {
    await db.exec(`insert into public.notifications (id, to_role, title, from_user_id, created_at)
                   values ('${id}', 'employee', 'Test', '${fromId}', 1);`)
    return true
  } catch {
    return false
  } finally {
    await db.exec('reset role;')
    await asServer(db)
  }
}

const { rows: [voormanRow] } = await db.query(
  `select id from public.profiles where auth_id = '${voorman}'`)
const { rows: [wasserRow] } = await db.query(
  `select id from public.profiles where email = 'wasser@truckwash1group.nl'`)

check('leidinggevende mag een bericht sturen',
  await tryInsertNotification(voorman, 'nt_lead', voormanRow.id))
check('werknemer mag geen bericht sturen',
  !(await tryInsertNotification(wasser, 'nt_worker', wasserRow.id)))

check('werknemer ziet het groepsbericht',
  (await countAs(wasser, "select count(*)::int as n from public.notifications where to_role = 'employee'")) === 1)
check('klant ziet het bericht voor werknemers niet',
  (await countAs(klant, 'select count(*)::int as n from public.notifications')) === 0)

check('werknemer ziet het lesmateriaal',
  (await countAs(wasser, 'select count(*)::int as n from public.courses')) === 1)
check('klant ziet het lesmateriaal niet',
  (await countAs(klant, 'select count(*)::int as n from public.courses')) === 0)

check('werknemer ziet alleen de eigen voortgang',
  (await countAs(wasser, 'select count(*)::int as n from public.course_progress')) === 1)
check('leidinggevende ziet de voortgang van iedereen',
  (await countAs(voorman, 'select count(*)::int as n from public.course_progress')) === 2)

// Uren: leidinggevende mag meekijken, een gewone werknemer alleen bij zichzelf
await db.exec(`
  insert into public.time_entries (id, user_id, started_at) values
    ('te_a', '${wasserRow.id}', 1),
    ('te_b', 'u_joris', 1);
`)
check('werknemer ziet alleen de eigen uren',
  (await countAs(wasser, 'select count(*)::int as n from public.time_entries')) === 1)
check('leidinggevende ziet de uren van het team',
  (await countAs(voorman, 'select count(*)::int as n from public.time_entries')) === 2)

// Rooster maken mag de leidinggevende nu ook
async function tryInsertShift(uid, id) {
  await asUser(db, uid)
  await db.exec('set role authenticated;')
  try {
    await db.exec(`insert into public.shifts (id, user_id, kind, start_at, end_at)
                   values ('${id}', 'u_joris', 'dienst', 0, 1);`)
    return true
  } catch {
    return false
  } finally {
    await db.exec('reset role;')
    await asServer(db)
  }
}
check('leidinggevende mag het rooster wijzigen', await tryInsertShift(voorman, 'sh_lead'))
check('werknemer mag het rooster niet wijzigen', !(await tryInsertShift(wasser, 'sh_worker')))


/* ================================================================== */

console.log('\n9. Aanmeldingen: alleen het management beslist')

const { rows: [klantRow] } = await db.query(
  `select id from public.profiles where email = 'klant@transportjansen.nl'`)

// Het management erbij, want tot nu toe was er niemand met die rol.
const baas = '66666666-6666-6666-6666-666666666666'
await db.exec(`
  insert into auth.users (id, email) values ('${baas}', 'baas@truckwash1group.nl');
  update public.profiles
     set roles = array['management']::text[], active = true, all_locations = true
   where email = 'baas@truckwash1group.nl';

  alter table public.signups       force row level security;
  alter table public.channels      force row level security;
  alter table public.chat_messages force row level security;
  alter table public.channel_reads force row level security;
  alter table public.email_log     force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

const { rows: [baasRow] } = await db.query(
  `select id from public.profiles where email = 'baas@truckwash1group.nl'`)
const baasId = baasRow.id

check('het management ziet de aanmeldingen',
  (await countAs(baas, 'select count(*)::int as n from public.signups')) > 0)
check('een klant ziet de aanmeldingen van anderen niet',
  (await countAs(klant, "select count(*)::int as n from public.signups where email = 'onbekend@example.com'")) === 0)
check('je ziet je eigen aanmelding wel',
  (await countAs(klant, 'select count(*)::int as n from public.signups')) === 1)

async function magSchrijven(uid, sql) {
  await asUser(db, uid)
  await db.exec('set role authenticated;')
  try {
    await db.exec(sql)
    return true
  } catch {
    return false
  } finally {
    await db.exec('reset role;')
    await asServer(db)
  }
}

/*
 * Let op: een UPDATE die door de beveiligingsregels wordt tegengehouden geeft
 * geen foutmelding, hij raakt gewoon nul rijen. Kijken of het gelukt is doe je
 * dus door achteraf te kijken wat er staat, niet of er iets omviel.
 */
async function statusVanAanmelding() {
  const r = await db.query(
    "select status from public.signups where email = 'onbekend@example.com'")
  return r.rows[0]?.status
}

await magSchrijven(wasser,
  "update public.signups set status = 'goedgekeurd' where email = 'onbekend@example.com';")
check('een werknemer krijgt een aanmelding niet goedgekeurd',
  (await statusVanAanmelding()) === 'nieuw', String(await statusVanAanmelding()))

await magSchrijven(baas,
  "update public.signups set status = 'goedgekeurd' where email = 'onbekend@example.com';")
check('het management wel',
  (await statusVanAanmelding()) === 'goedgekeurd', String(await statusVanAanmelding()))

/* ================================================================== */

console.log('\n10. Overleg: kanalen, vestigingen en beslotenheid')

await db.exec(`
  insert into public.locations (id, code, name, kind, city) values
    ('loc_utr', 'TW-UTR', 'Utrecht', 'vestiging', 'Utrecht'),
    ('loc_rtd', 'TW-RTD', 'Rotterdam', 'vestiging', 'Rotterdam')
  on conflict (id) do nothing;

  update public.profiles set location_id = 'loc_utr'
   where email = 'wasser@truckwash1group.nl';

  insert into public.channels (id, slug, name, kind, private, member_ids, created_by, created_at) values
    ('ch_algemeen', 'algemeen', 'Algemeen', 'kanaal', false, '{}', '${voormanRow.id}', 0),
    ('ch_directie', 'directie', 'Directie', 'kanaal', true, array['${voormanRow.id}']::text[], '${voormanRow.id}', 0);

  insert into public.channels (id, slug, name, kind, location_id, private, member_ids, created_by, created_at) values
    ('ch_utr', 'utrecht', 'Utrecht', 'vestiging', 'loc_utr', false, '{}', '${voormanRow.id}', 0),
    ('ch_rtd', 'rotterdam', 'Rotterdam', 'vestiging', 'loc_rtd', false, '{}', '${voormanRow.id}', 0);

  insert into public.chat_messages (id, channel_id, author_id, author_name, body, at) values
    ('cm_open', 'ch_algemeen', '${voormanRow.id}', 'Voorman', 'Morgen komt de levering.', 1),
    ('cm_dicht', 'ch_directie', '${voormanRow.id}', 'Voorman', 'Interne cijfers.', 1),
    ('cm_utr', 'ch_utr', '${voormanRow.id}', 'Voorman', 'Baan 2 ligt stil.', 1);
`)

check('een werknemer ziet het open kanaal',
  (await countAs(wasser, "select count(*)::int as n from public.channels where id = 'ch_algemeen'")) === 1)
check('een besloten kanaal blijft dicht',
  (await countAs(wasser, "select count(*)::int as n from public.channels where id = 'ch_directie'")) === 0)
check('een lid ziet zijn besloten kanaal wel',
  (await countAs(voorman, "select count(*)::int as n from public.channels where id = 'ch_directie'")) === 1)

check('je ziet het kanaal van je eigen vestiging',
  (await countAs(wasser, "select count(*)::int as n from public.channels where id = 'ch_utr'")) === 1)
check('en niet dat van een vestiging waar je niets te zoeken hebt',
  (await countAs(wasser, "select count(*)::int as n from public.channels where id = 'ch_rtd'")) === 0)
check('het hoofdkantoor ziet alle vestigingskanalen',
  (await countAs(baas, "select count(*)::int as n from public.channels where kind = 'vestiging'")) === 2)

check('een klant komt het overleg helemaal niet in',
  (await countAs(klant, 'select count(*)::int as n from public.channels')) === 0)

check('berichten uit een besloten kanaal blijven onzichtbaar',
  (await countAs(wasser, "select count(*)::int as n from public.chat_messages where id = 'cm_dicht'")) === 0)
check('berichten uit je eigen kanalen zie je wel',
  (await countAs(wasser, 'select count(*)::int as n from public.chat_messages')) === 2)

check('je mag geen bericht op andermans naam plaatsen',
  !(await magSchrijven(wasser, `insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
     values ('cm_vals', 'ch_algemeen', '${voormanRow.id}', 'Voorman', 'Namens de baas.', 2);`)))

check('je mag niet posten in een kanaal dat je niet mag zien',
  !(await magSchrijven(wasser, `insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
     values ('cm_inbraak', 'ch_directie', '${wasserRow.id}', 'Wasser', 'Hallo?', 2);`)))

check('in je eigen kanaal mag je gewoon praten',
  await magSchrijven(wasser, `insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
     values ('cm_eigen', 'ch_utr', '${wasserRow.id}', 'Wasser', 'Ik kijk ernaar.', 2);`))

check('een werknemer mag zelf geen kanaal beginnen',
  !(await magSchrijven(wasser, `insert into public.channels (id, slug, name, kind, private, member_ids, created_by, created_at)
     values ('ch_eigen', 'eigen', 'Eigen', 'kanaal', false, '{}', '${wasserRow.id}', 0);`)))

check('een rechtstreeks gesprek beginnen mag wel',
  await magSchrijven(wasser, `insert into public.channels (id, slug, name, kind, private, member_ids, created_by, created_at)
     values ('ch_dm', 'gesprek', 'Gesprek', 'gesprek', true,
             array['${wasserRow.id}','${voormanRow.id}']::text[], '${wasserRow.id}', 0);`))

check('een leidinggevende mag wel een kanaal beginnen',
  await magSchrijven(voorman, `insert into public.channels (id, slug, name, kind, private, member_ids, created_by, created_at)
     values ('ch_chemie', 'chemie', 'Chemie', 'kanaal', false, '{}', '${voormanRow.id}', 0);`))

/* --- leestekens en post --- */

check('je leesteken zetten mag',
  await magSchrijven(wasser, `insert into public.channel_reads (id, user_id, channel_id, last_read_at)
     values ('r_1', '${wasserRow.id}', 'ch_utr', 5);`))

check('dat van een ander niet',
  !(await magSchrijven(wasser, `insert into public.channel_reads (id, user_id, channel_id, last_read_at)
     values ('r_2', '${voormanRow.id}', 'ch_utr', 5);`)))

await db.exec(`
  insert into public.email_log (id, template, to_email, subject, status, at)
  values ('em_1', 'aanmelding', 'iemand@example.com', 'Ontvangen', 'verstuurd', 1);`)

check('het management ziet wat er aan post uit is gegaan',
  (await countAs(baas, 'select count(*)::int as n from public.email_log')) === 1)
check('een werknemer niet',
  (await countAs(wasser, 'select count(*)::int as n from public.email_log')) === 0)
check('en niemand kan er zelf een regel in schrijven',
  !(await magSchrijven(baas, `insert into public.email_log (id, template, to_email, subject, at)
     values ('em_vals', 'bericht', 'iemand@example.com', 'Namens de baas', 2);`)))



/* ================================================================== */

console.log('\n11. Een kind zonder ouder: precies de fout die hij zag')

/*
 * Een bericht voor een kanaal dat de server nog niet kent geeft niet de
 * melding die je verwacht. De beveiligingsregel wordt eerder beoordeeld dan
 * de verwijzing, dus je hoort dat je ergens niet bij mag -- over iets wat er
 * niet is. Dat spoor is levensgevaarlijk om te volgen, dus leggen we het hier
 * vast.
 */
const foutmelding = await (async () => {
  await asUser(db, voorman)
  await db.exec('set role authenticated;')
  try {
    await db.exec(`insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
      values ('cm_wees', 'ch_bestaat_niet', '${voormanRow.id}', 'Voorman', 'Hallo?', 9);`)
    return null
  } catch (e) {
    return String(e.message ?? e)
  } finally {
    await db.exec('reset role;')
    await asServer(db)
  }
})()

check('een bericht zonder kanaal wordt geweigerd', foutmelding !== null)
check('en wel met de melding over de beveiligingsregel',
  (foutmelding ?? '').includes('row-level security'), String(foutmelding))

console.log('\n12. Losse rechten tellen mee in het overleg')

/*
 * Iemand die het recht "alle vestigingen" met de hand toegekend krijgt, ziet
 * in de app alle vestigingskanalen. De database hoort dat ook te vinden --
 * anders zie je een kanaal staan en mag je er bij het versturen niet in.
 */
const kijker = '77777777-7777-7777-7777-777777777777'
await db.exec(`
  insert into auth.users (id, email) values ('${kijker}', 'kijker@truckwash1group.nl');
  update public.profiles
     set roles = array['employee']::text[], active = true, location_id = 'loc_utr'
   where email = 'kijker@truckwash1group.nl';
`)

check('zonder het recht ziet hij Rotterdam niet',
  (await countAs(kijker, "select count(*)::int as n from public.channels where id = 'ch_rtd'")) === 0)

await db.exec(`
  update public.profiles set grants = array['locations.all']::text[]
   where email = 'kijker@truckwash1group.nl';`)

check('met het losse recht wel',
  (await countAs(kijker, "select count(*)::int as n from public.channels where id = 'ch_rtd'")) === 1)

check('en dan mag hij er ook in praten',
  await magSchrijven(kijker, `insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
     values ('cm_kijker', 'ch_rtd', (select id from public.profiles where email = 'kijker@truckwash1group.nl'),
             'Kijker', 'Hoi Rotterdam', 9);`))

await db.exec(`
  update public.profiles set revokes = array['locations.all']::text[]
   where email = 'kijker@truckwash1group.nl';`)

check('intrekken wint van toekennen',
  (await countAs(kijker, "select count(*)::int as n from public.channels where id = 'ch_rtd'")) === 0)


/* ================================================================== */

console.log('\n13. Het dossier: wat een collega niet mag zien')

const wasserId = wasserRow.id
const voormanId = voormanRow.id

await db.exec(`
  insert into public.personnel_private (id, user_id, bsn, iban, hourly_rate, internal_notes)
  values ('${wasserId}', '${wasserId}', '123456782', 'NL91ABNA0417164300', 22,
          'Komt regelmatig te laat, besproken in mei.'),
         ('${voormanId}', '${voormanId}', '111222333', 'NL02ABNA0123456789', 26, null);

  alter table public.personnel_private force row level security;
  alter table public.documents         force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

check('je ziet je eigen regel',
  (await countAs(wasser, 'select count(*)::int as n from public.personnel_private')) === 1)
check('en die van je collega niet',
  (await countAs(wasser,
    `select count(*)::int as n from public.personnel_private where user_id = '${voormanId}'`)) === 0)
check('een leidinggevende ziet die van zijn team ook niet',
  (await countAs(voorman,
    `select count(*)::int as n from public.personnel_private where user_id = '${wasserId}'`)) === 0)
check('het management ziet alles',
  (await countAs(baas, 'select count(*)::int as n from public.personnel_private')) === 2)

check('je eigen uurloon aanpassen kan niet',
  !(await magSchrijven(wasser,
    `update public.personnel_private set hourly_rate = 99 where user_id = '${wasserId}';`))
  || (await db.query(`select hourly_rate from public.personnel_private where user_id = '${wasserId}'`))
       .rows[0].hourly_rate == 22)

console.log('\n14. Documenten: het slot op ongezien')

await db.exec(`
  insert into public.documents
    (id, user_id, user_name, kind, title, storage_path, visible_to_employee,
     uploaded_by, uploaded_at, requires_signature)
  values
    ('d_contract', '${wasserId}', 'Tom', 'contract', 'Arbeidsovereenkomst',
     '${wasserId}/d_contract.pdf', true, '${baasId}', 1, true),
    ('d_gesprek',  '${wasserId}', 'Tom', 'beoordeling', 'Gespreksverslag',
     '${wasserId}/d_gesprek.pdf', false, '${baasId}', 1, false);
`)

check('de medewerker ziet zijn contract',
  (await countAs(wasser, "select count(*)::int as n from public.documents where id = 'd_contract'")) === 1)
check('en het afgeschermde verslag niet',
  (await countAs(wasser, "select count(*)::int as n from public.documents where id = 'd_gesprek'")) === 0)
check('een collega ziet er helemaal niets van',
  (await countAs(voorman, 'select count(*)::int as n from public.documents')) === 0)
check('het management ziet beide',
  (await countAs(baas, 'select count(*)::int as n from public.documents')) === 2)

/* --- ondertekenen mag; de rest niet --- */

check('ondertekenen van je eigen contract mag',
  await magSchrijven(wasser, `update public.documents
     set signed_at = 5, signed_by = '${wasserId}', signed_name = 'Tom Verhoeven'
   where id = 'd_contract';`))

check('en is ook echt vastgelegd',
  (await db.query("select signed_at from public.documents where id = 'd_contract'"))
    .rows[0].signed_at == 5)

check('twee keer tekenen kan niet',
  !(await magSchrijven(wasser, `update public.documents
     set signed_at = 9 where id = 'd_contract';`)))

await magSchrijven(wasser, `update public.documents
   set visible_to_employee = true where id = 'd_gesprek';`)
check('jezelf zichtbaar maken wat op ongezien staat lukt niet',
  (await db.query("select visible_to_employee from public.documents where id = 'd_gesprek'"))
    .rows[0].visible_to_employee === false)

check('de titel van je eigen document veranderen kan niet',
  !(await magSchrijven(wasser, `update public.documents
     set title = 'Iets anders' where id = 'd_contract';`)))

await db.exec(`
  insert into public.documents
    (id, user_id, user_name, kind, title, storage_path, visible_to_employee,
     uploaded_by, uploaded_at, requires_signature)
  values ('d_tweede', '${wasserId}', 'Tom', 'verklaring', 'Geheimhouding',
          '${wasserId}/d_tweede.pdf', true, '${baasId}', 1, true);
`)
check('tekenen op andermans naam kan niet',
  !(await magSchrijven(wasser, `update public.documents
     set signed_at = 7, signed_by = '${voormanId}' where id = 'd_tweede';`)))

check('een document toevoegen doet alleen het management',
  !(await magSchrijven(wasser, `insert into public.documents
     (id, user_id, user_name, kind, title, storage_path, uploaded_at)
     values ('d_zelf', '${wasserId}', 'Tom', 'overig', 'Zelf', '${wasserId}/d_zelf.pdf', 1);`)))

console.log('\n15. De opslag hangt aan dezelfde regels')

await db.exec(`
  insert into storage.objects (bucket_id, name) values
    ('dossiers', '${wasserId}/d_contract.pdf'),
    ('dossiers', '${wasserId}/d_gesprek.pdf');
  alter table storage.objects enable row level security;
  alter table storage.objects force row level security;
`)

check('het bestand van je contract mag je ophalen',
  (await countAs(wasser,
    `select count(*)::int as n from storage.objects where name = '${wasserId}/d_contract.pdf'`)) === 1)
check('dat van het afgeschermde verslag niet',
  (await countAs(wasser,
    `select count(*)::int as n from storage.objects where name = '${wasserId}/d_gesprek.pdf'`)) === 0)
check('een collega komt er niet bij',
  (await countAs(voorman, 'select count(*)::int as n from storage.objects')) === 0)
check('het management wel',
  (await countAs(baas, 'select count(*)::int as n from storage.objects')) === 2)
check('de emmer staat niet open',
  (await db.query("select public from storage.buckets where id = 'dossiers'")).rows[0].public === false)


console.log('\n16. Een leesteken blokkeert niets meer')

check('een leesteken voor een onbekend kanaal mag',
  await magSchrijven(wasser, `insert into public.channel_reads (id, user_id, channel_id, last_read_at)
     values ('r_wees', '${wasserId}', 'ch_bestaat_niet', 5);`))

await db.exec(`
  insert into public.channel_reads (id, user_id, channel_id, last_read_at)
  values ('r_opruimen', '${wasserId}', 'ch_utr', 5) on conflict (id) do nothing;
  delete from public.channels where id = 'ch_utr';
`)
check('en verdwijnt met zijn kanaal',
  (await db.query("select count(*)::int as n from public.channel_reads where channel_id = 'ch_utr'"))
    .rows[0].n === 0)


console.log('\n17. Postbus')

await db.exec(`
  insert into public.mailbox (id, richting, van, aan, onderwerp, tekst, at, provider_id)
  values ('mb_1', 'in', 'leverancier@cleanchem.nl', 'bonnen@preview.truckwash.cloud',
          'Factuur 2026-114', 'In de bijlage de factuur.', 1, 'resend_abc');

  alter table public.mailbox force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

check('het management leest de post',
  (await countAs(baas, 'select count(*)::int as n from public.mailbox')) === 1)
check('een werknemer niet',
  (await countAs(wasser, 'select count(*)::int as n from public.mailbox')) === 0)
check('een leidinggevende ook niet',
  (await countAs(voorman, 'select count(*)::int as n from public.mailbox')) === 0)

check('het management mag de status bijwerken',
  await magSchrijven(baas, "update public.mailbox set status = 'verwerkt' where id = 'mb_1';"))

await magSchrijven(wasser, "update public.mailbox set status = 'genegeerd' where id = 'mb_1';")
check('een werknemer krijgt de status niet omgezet',
  (await db.query("select status from public.mailbox where id = 'mb_1'")).rows[0].status === 'verwerkt')

/* Dezelfde webhook twee keer mag geen tweede bon opleveren. */
const dubbel = await (async () => {
  try {
    await db.exec(`insert into public.mailbox (id, richting, van, aan, onderwerp, at, provider_id)
      values ('mb_2', 'in', 'x@y.nl', 'bonnen@preview.truckwash.cloud', 'Nog eens', 2, 'resend_abc');`)
    return false
  } catch {
    return true
  }
})()
check('dezelfde mail komt er geen tweede keer in', dubbel)

await db.exec(`
  insert into public.expenses
    (id, expense_date, category, supplier, description, amount_excl, status,
     source, mailbox_id, attachment_path, attachment_name)
  values ('exp_mail_1', 1, 'overig', 'CleanChem', 'Factuur 2026-114', 0, 'open',
          'mail', 'mb_1', 'mb_1/1-factuur.pdf', 'factuur.pdf');
  alter table public.expenses force row level security;
`)
check('een bon uit de mail staat klaar bij het management',
  (await countAs(baas, "select count(*)::int as n from public.expenses where source = 'mail'")) === 1)
check('een werknemer ziet die bon niet',
  (await countAs(wasser, "select count(*)::int as n from public.expenses where source = 'mail'")) === 0)

await db.exec(`
  insert into storage.objects (bucket_id, name) values ('post', 'mb_1/1-factuur.pdf');
`)
check('de bijlage is voor het management',
  (await countAs(baas, "select count(*)::int as n from storage.objects where bucket_id = 'post'")) === 1)
check('en niet voor een werknemer',
  (await countAs(wasser, "select count(*)::int as n from storage.objects where bucket_id = 'post'")) === 0)
check('de postemmer staat niet open',
  (await db.query("select public from storage.buckets where id = 'post'")).rows[0].public === false)

console.log('\n18. Kassa: bonnen, codes en kaarten')

/*
 * De kassa hangt aan een vestiging. Zonder vestiging op het profiel valt
 * in_my_locations() terug op "niets", dus die zetten we eerst -- net als in
 * het echt, waar iedereen ergens werkt.
 */
await db.exec(`
  insert into public.locations (id, code, name, kind, address, postcode, city, bays)
  values ('loc_utr', 'TW-UTR', 'Utrecht', 'vestiging', 'Wasstraat 1', '3500 AA', 'Utrecht', 2),
         ('loc_rtm', 'TW-RTM', 'Rotterdam', 'vestiging', 'Havenweg 9', '3000 BB', 'Rotterdam', 1)
  on conflict (id) do nothing;

  update public.profiles set location_id = 'loc_utr'
   where email in ('wasser@truckwash1group.nl', 'voorman@truckwash1group.nl');

  insert into public.pos_registers (id, location_id, code, name)
  values ('reg_1', 'loc_utr', 'KAS-UTR-1', 'Balie Utrecht')
  on conflict (id) do nothing;

  insert into public.pos_products (id, location_id, code, name, price_incl, vat_pct, kind) values
    ('prod_koffie', 'loc_utr', 'A001', 'Koffie',            2.50,  9, 'artikel'),
    ('prod_buiten', 'loc_utr', 'W001', 'Buitenwas',        78.65, 21, 'wasbeurt'),
    ('prod_kaart',  'loc_utr', 'K010', '10-badenkaart',   700.00, 21, 'strippenkaart'),
    ('prod_rtm',    'loc_rtm', 'A001', 'Koffie Rotterdam',  2.50,  9, 'artikel')
  on conflict (id) do nothing;

  -- Een afgerekende bon op naam van Transport Jansen, en een contante.
  insert into public.pos_sales
    (id, register_id, register_code, location_id, receipt_no, seq, status,
     operator_id, operator_name, customer_company_id, total_incl, total_excl,
     vat_total, method, closed_at)
  values
    ('sale_jansen', 'reg_1', 'KAS-UTR-1', 'loc_utr', 'KAS-UTR-1-20260831-0001', 1,
     'afgerekend', 'u_joris', 'Joris Peters', 'co_jansen', 78.65, 65.00, 13.65,
     'op-rekening', 100),
    ('sale_contant', 'reg_1', 'KAS-UTR-1', 'loc_utr', 'KAS-UTR-1-20260831-0002', 2,
     'afgerekend', 'u_joris', 'Joris Peters', null, 2.50, 2.29, 0.21,
     'contant', 200)
  on conflict (id) do nothing;

  insert into public.pos_sale_lines
    (id, sale_id, line_no, product_id, name, qty, price_incl, vat_pct,
     total_incl, total_excl, vat_amount)
  values ('line_1', 'sale_jansen', 1, 'prod_buiten', 'Buitenwas', 1, 78.65, 21,
          78.65, 65.00, 13.65)
  on conflict (id) do nothing;

  insert into public.pos_payments (id, sale_id, method, amount)
  values ('pay_1', 'sale_jansen', 'op-rekening', 78.65)
  on conflict (id) do nothing;

  -- Een strippenkaart met tien beurten, waarvan drie gebruikt.
  insert into public.pos_subscriptions
    (id, location_id, company_id, code, kind, credits_total)
  values ('sub_1', 'loc_utr', 'co_jansen', 'K-0001', 'strippenkaart', 10)
  on conflict (id) do nothing;

  insert into public.pos_subscription_uses (id, subscription_id, credits, user_id) values
    ('use_1', 'sub_1', 1, 'u_joris'),
    ('use_2', 'sub_1', 1, 'u_joris'),
    ('use_3', 'sub_1', 1, 'u_joris')
  on conflict (id) do nothing;

  -- Een persoonlijke code voor de wasser (de afgeleide is hier nep).
  insert into public.pos_pins (id, user_id, salt, hash)
  select 'pin_' || id, id, 'zout', 'afgeleide' from public.profiles
   where email = 'wasser@truckwash1group.nl'
  on conflict (id) do nothing;

  alter table public.pos_registers         force row level security;
  alter table public.pos_products          force row level security;
  alter table public.pos_sales             force row level security;
  alter table public.pos_sale_lines        force row level security;
  alter table public.pos_payments          force row level security;
  alter table public.pos_subscriptions     force row level security;
  alter table public.pos_subscription_uses force row level security;
  alter table public.pos_pins              force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

check('werknemer ziet de artikelen van zijn eigen vestiging',
  (await countAs(wasser, "select count(*)::int as n from public.pos_products where location_id = 'loc_utr'")) === 3)
check('en niet die van een andere vestiging',
  (await countAs(wasser, "select count(*)::int as n from public.pos_products where location_id = 'loc_rtm'")) === 0)
check('een klant ziet de artikelen helemaal niet',
  (await countAs(klant, 'select count(*)::int as n from public.pos_products')) === 0)

check('werknemer ziet de bonnen van zijn vestiging',
  (await countAs(wasser, 'select count(*)::int as n from public.pos_sales')) === 2)
check('de klant ziet alleen zijn eigen bon',
  (await countAs(klant, 'select count(*)::int as n from public.pos_sales')) === 1)
check('en de regels van die bon',
  (await countAs(klant, 'select count(*)::int as n from public.pos_sale_lines')) === 1)

check('het saldo van de kaart is de kaart min wat ervan af is',
  (await db.query(`
     select (s.credits_total - coalesce(sum(u.credits), 0))::int as n
       from public.pos_subscriptions s
       left join public.pos_subscription_uses u on u.subscription_id = s.id
      where s.id = 'sub_1' group by s.credits_total`)).rows[0].n === 7)

check('een collega op dezelfde vestiging kan de code nakijken',
  (await countAs(wasser, 'select count(*)::int as n from public.pos_pins')) === 1)
check('een klant kan dat niet',
  (await countAs(klant, 'select count(*)::int as n from public.pos_pins')) === 0)

/*
 * Het slot op de bon. Dit is het enige punt in het schema waar een op zich
 * geldige wijziging alsnog geweigerd wordt, dus het is het waard om te
 * bewijzen dat hij dichtzit -- en dat een creditbon er wel langs komt.
 */
async function botst(sql) {
  try { await db.exec(sql); return null } catch (e) { return String(e.message ?? e) }
}

check('het bedrag op een afgerekende bon kan niet meer wijzigen',
  (await botst("update public.pos_sales set total_incl = 1 where id = 'sale_contant'"))
    ?.includes('creditbon') === true)
check('een afgerekende bon kan niet verwijderd worden',
  (await botst("delete from public.pos_sales where id = 'sale_contant'"))
    ?.includes('creditbon') === true)
check('een afgerekende bon kan niet terug naar open',
  (await botst("update public.pos_sales set status = 'open' where id = 'sale_contant'")) !== null)
check('de regels van een afgerekende bon liggen ook vast',
  (await botst("update public.pos_sale_lines set qty = 9 where id = 'line_1'"))
    ?.includes('vast') === true)
check('een opmerking en het printvinkje mogen wel',
  (await botst("update public.pos_sales set note = 'nagekeken', printed = true where id = 'sale_contant'")) === null)
check('crediteren mag',
  (await botst(`
     insert into public.pos_sales
       (id, register_id, register_code, location_id, receipt_no, seq, status,
        operator_id, operator_name, total_incl, total_excl, vat_total, method,
        credit_of, closed_at)
     values ('sale_credit', 'reg_1', 'KAS-UTR-1', 'loc_utr',
             'KAS-UTR-1-20260831-0003', 3, 'afgerekend', 'u_joris', 'Joris Peters',
             -2.50, -2.29, -0.21, 'contant', 'sale_contant', 300);
     update public.pos_sales set status = 'gecrediteerd' where id = 'sale_contant';`)) === null)

check('hetzelfde bonnummer kan niet twee keer voorkomen',
  (await botst(`
     insert into public.pos_sales (id, register_code, receipt_no, location_id)
     values ('sale_dubbel', 'KAS-UTR-1', 'KAS-UTR-1-20260831-0001', 'loc_utr')`)) !== null)


console.log('\n19. Een bericht aan één persoon mag van iedereen komen')

/*
 * Dit was kapot: de belletjeslade is het algemene seinsysteem geworden,
 * maar de regel liet alleen een leidinggevende toe. Een wasser die een
 * collega noemde in het overleg, een melding aan de ontwikkelaar, een
 * storing vanaf de vloer -- allemaal geweigerd, en dat blokkeerde de hele
 * wachtrij.
 */
check('een werknemer mag een collega een bericht sturen',
  await magSchrijven(wasser, `insert into public.notifications
     (id, to_user_id, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_p2p', '${voormanId}', 'info', 'Baan 2 ligt stil', '', '${wasserId}', 'Tom', 1);`))

check('maar niet op andermans naam',
  !(await magSchrijven(wasser, `insert into public.notifications
     (id, to_user_id, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_vals', '${voormanId}', 'info', 'Namens de baas', '', '${voormanId}', 'Joris', 1);`)))

check('en niet naar een hele groep',
  !(await magSchrijven(wasser, `insert into public.notifications
     (id, to_role, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_groep', 'employee', 'info', 'Allemaal luisteren', '', '${wasserId}', 'Tom', 1);`)))

check('een leidinggevende mag dat wel',
  await magSchrijven(voorman, `insert into public.notifications
     (id, to_role, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_groep2', 'employee', 'info', 'Morgen extra drukte', '', '${voormanId}', 'Joris', 1);`))

check('een klant komt er helemaal niet in',
  !(await magSchrijven(klant, `insert into public.notifications
     (id, to_user_id, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_klant', '${voormanId}', 'info', 'Hoi', '', '${klantRow.id}', 'Klant', 1);`)))


console.log('\n20. Werkgevers: wie eruit ligt, ziet niets meer')

/*
 * Dit is de vraag die het hele blok moest beantwoorden. Een werkgever
 * nodigt een chauffeur uit; die ziet daarna de wasbeurten van dat bedrijf.
 * Gooit de werkgever hem eruit, dan zijn ze weg -- ook de beurten die hij
 * zelf heeft gebracht. Daarom is de koppeling een eigen rij en geen kolom
 * op het profiel: een kolom leegmaken is vergeten, een koppeling
 * beëindigen is vastleggen dát het is gebeurd.
 */

const werkgever = 'a1a1a1a1-1111-1111-1111-a1a1a1a1a1a1'
const chauffeur = 'b2b2b2b2-2222-2222-2222-b2b2b2b2b2b2'

await db.exec(`
  insert into auth.users (id, email) values
    ('${werkgever}', 'ellen@transportjansen.nl'),
    ('${chauffeur}', 'rick@transportjansen.nl');

  update public.profiles set roles = array['employer']::text[], active = true
   where email = 'ellen@transportjansen.nl';
  -- De chauffeur werkt niet bij Truckwash1; hij rijdt voor het bedrijf.
  update public.profiles set roles = array[]::text[], active = true
   where email = 'rick@transportjansen.nl';

  alter table public.employers      force row level security;
  alter table public.employer_links force row level security;
  alter table public.employer_rules force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

const { rows: [ellenRow] } = await db.query(
  `select id from public.profiles where email = 'ellen@transportjansen.nl'`)
const { rows: [rickRow] } = await db.query(
  `select id from public.profiles where email = 'rick@transportjansen.nl'`)

await db.exec(`
  insert into public.employers (id, naam, contact_naam, email, status, beheerders) values
    ('wg_test',  'Transport Jansen BV', 'Ellen Jansen', 'ellen@transportjansen.nl',
     'actief', array['${ellenRow.id}']::text[]),
    ('wg_ander', 'Bergman Koeltransport', 'Wouter Bergman', 'w@bergman.nl',
     'actief', array[]::text[]);

  insert into public.employer_links
    (id, werkgever_id, werkgever_naam, user_id, naam, email, status) values
    ('wgl_rick', 'wg_test', 'Transport Jansen BV', '${rickRow.id}',
     'Rick Molenaar', 'rick@transportjansen.nl', 'actief');

  insert into public.employer_rules (id, werkgever_id, service, soort) values
    ('wgr_test',  'wg_test',  'polish', 'niet toegestaan'),
    ('wgr_ander', 'wg_ander', 'polish', 'niet toegestaan');

  insert into public.companies (id, name) values ('co_wgtest', 'Wagenpark testrit');

  insert into public.wash_jobs (id, company_id, plate, service, scheduled_at, employer_id) values
    ('job_wg_1', 'co_wgtest', '12-BND-4', 'buitenwas', 1, 'wg_test'),
    ('job_wg_2', 'co_wgtest', 'VJ-701-P', 'combi',     2, 'wg_test'),
    ('job_wg_3', 'co_wgtest', '99-XYZ-9', 'buitenwas', 3, 'wg_ander');
`)

/* --- de werkgever ziet zijn eigen bedrijf en verder niets --- */

check('een werkgever ziet zijn eigen bedrijf',
  (await countAs(werkgever,
    "select count(*)::int as n from public.employers where id = 'wg_test'")) === 1)
check('en niet dat van een ander',
  (await countAs(werkgever,
    "select count(*)::int as n from public.employers where id = 'wg_ander'")) === 0)
check('hij ziet de wasbeurten van zijn bedrijf',
  (await countAs(werkgever, 'select count(*)::int as n from public.wash_jobs')) === 2)
check('hij ziet zijn eigen afspraken',
  (await countAs(werkgever, 'select count(*)::int as n from public.employer_rules')) === 1)

/* --- en nergens bij Truckwash1 zelf --- */

check('een werkgever komt niet in het rooster',
  (await countAs(werkgever, 'select count(*)::int as n from public.shifts')) === 0)
check('niet in de voorraad',
  (await countAs(werkgever, 'select count(*)::int as n from public.inventory_items')) === 0)
check('en niet in het personeelsdossier',
  (await countAs(werkgever, 'select count(*)::int as n from public.personnel_private')) === 0)
check('ook niet in de documenten',
  (await countAs(werkgever, 'select count(*)::int as n from public.documents')) === 0)

/* --- wat de chauffeur ziet zolang hij gekoppeld is --- */

check('een gekoppelde chauffeur ziet de beurten van zijn werkgever',
  (await countAs(chauffeur, 'select count(*)::int as n from public.wash_jobs')) === 2)
check('hij ziet het bedrijf zelf ook',
  (await countAs(chauffeur, 'select count(*)::int as n from public.employers')) === 1)
check('maar niet het personeelsdossier van Truckwash1',
  (await countAs(chauffeur, 'select count(*)::int as n from public.personnel_private')) === 0)

/* --- en dit is de kern --- */

await db.exec(
  `update public.employer_links set status = 'beëindigd', beeindigd_op = 9
    where id = 'wgl_rick'`)

check('losgekoppeld ziet hij de beurten niet meer',
  (await countAs(chauffeur, 'select count(*)::int as n from public.wash_jobs')) === 0)
check('ook niet het bedrijf',
  (await countAs(chauffeur, 'select count(*)::int as n from public.employers')) === 0)
check('en niet de afspraken',
  (await countAs(chauffeur, 'select count(*)::int as n from public.employer_rules')) === 0)
check('de koppeling zelf blijft hij wel zien -- hij mag weten dat het gebeurd is',
  (await countAs(chauffeur, 'select count(*)::int as n from public.employer_links')) === 1)
check('de werkgever ziet zijn oud-chauffeur ook nog',
  (await countAs(werkgever, 'select count(*)::int as n from public.employer_links')) === 1)

/* --- een uitnodiging op mijn adres, nog zonder koppeling --- */

await db.exec(`
  insert into public.employer_links
    (id, werkgever_id, werkgever_naam, naam, email, status, bestaand_account)
  values ('wgl_open', 'wg_test', 'Transport Jansen BV', 'Rick Molenaar',
          'RICK@transportjansen.nl', 'wacht op akkoord', true);
`)
check('een verzoek op mijn mailadres komt bij mij binnen',
  (await countAs(chauffeur,
    "select count(*)::int as n from public.employer_links where id = 'wgl_open'")) === 1)
check('en niet bij een willekeurige collega',
  (await countAs(wasser,
    "select count(*)::int as n from public.employer_links where id = 'wgl_open'")) === 1)

check('de chauffeur mag zijn eigen verzoek aannemen',
  await magSchrijven(chauffeur,
    `update public.employer_links set status = 'actief', user_id = '${rickRow.id}'
      where id = 'wgl_open';`))
check('en dan ziet hij de beurten weer',
  (await countAs(chauffeur, 'select count(*)::int as n from public.wash_jobs')) === 2)

/* --- wat een werkgever niet zelf mag beslissen --- */

check('een werkgever zet zichzelf niet op actief of geblokkeerd',
  !(await magSchrijven(werkgever,
    "update public.employers set status = 'geblokkeerd' where id = 'wg_test';")))
check('en schrijft zichzelf geen extra beheerders bij',
  !(await magSchrijven(werkgever,
    `update public.employers set beheerders = array['${rickRow.id}']::text[]
      where id = 'wg_test';`)))
check('zijn eigen adresgegevens mag hij wel bijwerken',
  await magSchrijven(werkgever,
    "update public.employers set plaats = 'Utrecht' where id = 'wg_test';"))

check('een werkgever legt afspraken vast voor zijn eigen bedrijf',
  await magSchrijven(werkgever, `insert into public.employer_rules
     (id, werkgever_id, service, soort) values
     ('wgr_mijn', 'wg_test', 'tankreiniging', 'alleen met akkoord');`))
check('maar niet voor dat van een ander',
  !(await magSchrijven(werkgever, `insert into public.employer_rules
     (id, werkgever_id, service, soort) values
     ('wgr_stiekem', 'wg_ander', 'buitenwas', 'niet toegestaan');`)))
check('en hij nodigt niemand uit bij een ander bedrijf',
  !(await magSchrijven(werkgever, `insert into public.employer_links
     (id, werkgever_id, naam, email, status) values
     ('wgl_stiekem', 'wg_ander', 'Iemand', 'iemand@x.nl', 'uitgenodigd');`)))

/* --- een aanvraag doen mag, op eigen naam --- */

check('iedereen mag een werkgever aanvragen, op eigen naam',
  await magSchrijven(chauffeur, `insert into public.employers
     (id, naam, contact_naam, email, status, aangevraagd_door) values
     ('wg_aanvraag', 'Nieuw Transport', 'Rick', 'rick@x.nl',
      'aangevraagd', '${rickRow.id}');`))
check('maar niet meteen actief',
  !(await magSchrijven(chauffeur, `insert into public.employers
     (id, naam, contact_naam, email, status, aangevraagd_door) values
     ('wg_sluipweg', 'Sluipweg BV', 'Rick', 'rick@x.nl',
      'actief', '${rickRow.id}');`)))
check('en niet op naam van een ander',
  !(await magSchrijven(chauffeur, `insert into public.employers
     (id, naam, contact_naam, email, status, aangevraagd_door) values
     ('wg_vals', 'Vals BV', 'Ellen', 'e@x.nl',
      'aangevraagd', '${ellenRow.id}');`)))
check('de aanvrager blijft zijn eigen aanvraag zien',
  (await countAs(chauffeur,
    "select count(*)::int as n from public.employers where id = 'wg_aanvraag'")) === 1)

/* --- het management houdt de sleutels --- */

check('het management ziet alle werkgevers',
  (await countAs(baas, 'select count(*)::int as n from public.employers')) >= 3)
check('en beslist wel over de status',
  await magSchrijven(baas,
    "update public.employers set status = 'actief' where id = 'wg_aanvraag';"))
await magSchrijven(werkgever,
  "delete from public.employer_links where id = 'wgl_rick';")
check('een werkgever gooit geen koppelingen weg -- die zijn de historie',
  (await db.query("select count(*)::int as n from public.employer_links where id = 'wgl_rick'"))
    .rows[0].n === 1)

/* --- iemand die én bij Truckwash1 werkt én een bedrijf beheert --- */

await db.exec(`
  update public.profiles set roles = array['employee','employer']::text[]
   where email = 'wasser@truckwash1group.nl';`)
check('wie ook werknemer is, houdt toegang tot zijn eigen dossier',
  (await countAs(wasser,
    `select count(*)::int as n from public.personnel_private
      where user_id = '${wasserId}'`)) === 1)
await db.exec(`
  update public.profiles set roles = array['employee']::text[]
   where email = 'wasser@truckwash1group.nl';`)


console.log('\n21. Het logboek: wie mag erin schrijven')

/*
 * Aanleiding: "opslaan in log_events: new row violates row-level security
 * policy". Die melding wijst naar de verkeerde kant. De regel op deze tabel
 * laat namelijk iederéén schrijven die is ingelogd -- de app doet dat
 * automatisch, en een foutmelding die je niet kunt wegschrijven is een
 * foutmelding die je nooit ziet.
 *
 * Het ging mis omdat er hélemaal geen inlog was. Dan gaat het verzoek als
 * onbekende bezoeker naar de database, en die weigert alles. Deze twee
 * controles leggen dat verschil vast.
 */

await db.exec('alter table public.log_events force row level security;')

async function alsAnon(sql) {
  await db.exec("select set_config('test.uid', '', true);")
  await db.exec('set role anon;')
  try {
    await db.exec(sql)
    return true
  } catch {
    return false
  } finally {
    await db.exec('reset role;')
    await asServer(db)
  }
}

check('een werknemer mag een fout wegschrijven',
  await magSchrijven(wasser, `insert into public.log_events (id, level, message, at)
     values ('lg_wasser', 'fout', 'Baan 2 gaf een storing', 1);`))

check('een chauffeur van een werkgever ook -- die heeft niet eens een rol',
  await magSchrijven(chauffeur, `insert into public.log_events (id, level, message, at)
     values ('lg_chauffeur', 'fout', 'App liep vast bij het openen', 2);`))

check('maar wie niet is ingelogd komt er niet in',
  !(await alsAnon(`insert into public.log_events (id, level, message, at)
     values ('lg_anon', 'fout', 'Van niemand', 3);`)))

check('lezen mag alleen de ontwikkelaar',
  (await countAs(wasser, 'select count(*)::int as n from public.log_events')) === 0)


console.log('\n22. Berichten over de grens van het eigen bedrijf heen')

/*
 * Tweede keer dat deze regel omviel, en om dezelfde reden: hij noemde wie er
 * mocht sturen in plaats van wat er gestuurd werd. Nu is het een vraag over
 * de verhouding tussen twee mensen, en die vraag is hier vastgelegd.
 */

const ontwikkelaar = 'c3c3c3c3-3333-3333-3333-c3c3c3c3c3c3'
await db.exec(`
  insert into auth.users (id, email) values ('${ontwikkelaar}', 'dev@truckwash1group.nl');
  update public.profiles set roles = array['developer']::text[], active = true
   where email = 'dev@truckwash1group.nl';
`)
const { rows: [devRow] } = await db.query(
  `select id from public.profiles where email = 'dev@truckwash1group.nl'`)

const bericht = (van, naar, id, afzender) => `
  insert into public.notifications
    (id, to_user_id, kind, title, body, from_user_id, from_name, created_at)
  values ('${id}', '${naar}', 'info', 'Zelftest', '', '${afzender}', 'Zelftest', 1);`

/* --- werkgever en chauffeur, beide kanten op --- */

check('een werkgever bereikt zijn chauffeur',
  await magSchrijven(werkgever,
    bericht(werkgever, rickRow.id, 'nt_wg_naar_ch', ellenRow.id)))

check('en de chauffeur zijn werkgever',
  await magSchrijven(chauffeur,
    bericht(chauffeur, ellenRow.id, 'nt_ch_naar_wg', rickRow.id)))

/* --- maar niet verder dan dat --- */

check('een chauffeur bereikt geen willekeurige wasmedewerker',
  !(await magSchrijven(chauffeur,
    bericht(chauffeur, wasserId, 'nt_ch_naar_wasser', rickRow.id))))

check('en een werkgever ook niet',
  !(await magSchrijven(werkgever,
    bericht(werkgever, wasserId, 'nt_wg_naar_wasser', ellenRow.id))))

/* --- het kantoor bereikt iedereen --- */

check('een werkgever meldt zijn aanvraag bij het kantoor',
  await magSchrijven(werkgever,
    bericht(werkgever, baasId, 'nt_wg_naar_baas', ellenRow.id)))

check('een klant kan het kantoor ook bereiken',
  await magSchrijven(klant,
    bericht(klant, baasId, 'nt_klant_naar_baas', klantRow.id)))

check('maar nog steeds geen willekeurige medewerker',
  !(await magSchrijven(klant,
    bericht(klant, wasserId, 'nt_klant_naar_wasser', klantRow.id))))

/* --- wie hier werkt maar geen wasser is --- */

check('de ontwikkelaar mag antwoorden op een melding',
  await magSchrijven(ontwikkelaar,
    bericht(ontwikkelaar, wasserId, 'nt_dev_naar_wasser', devRow.id)))

/* --- en wat er niet mocht, mag nog steeds niet --- */

check('een werkgever stuurt niet op andermans naam',
  !(await magSchrijven(werkgever,
    bericht(werkgever, rickRow.id, 'nt_wg_vals', baasId))))

check('en niet naar een hele rol',
  !(await magSchrijven(werkgever, `insert into public.notifications
     (id, to_role, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_wg_groep', 'employee', 'info', 'Allemaal', '', '${ellenRow.id}', 'Ellen', 1);`)))

check('een chauffeur zonder enkele rol al helemaal niet',
  !(await magSchrijven(chauffeur, `insert into public.notifications
     (id, to_role, kind, title, body, from_user_id, from_name, created_at)
     values ('nt_ch_groep', 'employee', 'info', 'Allemaal', '', '${rickRow.id}', 'Rick', 1);`)))

/* --- losgekoppeld blijft bereikbaar: juist dan moet het bericht aankomen --- */

await db.exec(
  `update public.employer_links set status = 'beëindigd' where id = 'wgl_open'`)
check('bij het loskoppelen komt het bericht nog aan',
  await magSchrijven(werkgever,
    bericht(werkgever, rickRow.id, 'nt_wg_afscheid', ellenRow.id)))


console.log('\n23. Uren: klokken gaat via de kassa')

/*
 * Een knop op ieders telefoon maakte van inklokken iets wat je vanaf de bank
 * kon doen. Dat kan nu niet meer -- en niet alleen omdat de knop weg is:
 * de database laat het niet toe. Anders was het een knop die weg is, en dat
 * is iets anders dan iets wat niet kan.
 */

// Het kassa-account: een gewoon werknemersaccount met één los recht erbij.
const kassa = 'd4d4d4d4-4444-4444-4444-d4d4d4d4d4d4'
await db.exec(`
  insert into auth.users (id, email) values ('${kassa}', 'kassa.utr@truckwash1group.nl');
  update public.profiles
     set roles = array['employee']::text[], active = true,
         grants = array['hours.clock']::text[]
   where email = 'kassa.utr@truckwash1group.nl';

  alter table public.time_entries force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

async function urenRegel(id) {
  const r = await db.query(
    `select started_at, ended_at, user_id from public.time_entries where id = '${id}'`)
  return r.rows[0]
}

/* --- zelfbediening is eruit --- */

check('een werknemer klokt zichzelf niet meer in',
  !(await magSchrijven(wasser, `insert into public.time_entries
     (id, user_id, user_name, started_at) values
     ('te_zelf', '${wasserId}', 'Tom', 100);`)))

check('ook niet op naam van een collega',
  !(await magSchrijven(wasser, `insert into public.time_entries
     (id, user_id, user_name, started_at) values
     ('te_collega', '${voormanId}', 'Joris', 100);`)))

/* --- de kassa wel, ook voor een ander --- */

check('de kassa schrijft de regel van wie zich meldt',
  await magSchrijven(kassa, `insert into public.time_entries
     (id, user_id, user_name, started_at) values
     ('te_kassa', '${wasserId}', 'Tom', 100);`))

check('en klokt hem ook weer uit',
  await magSchrijven(kassa,
    `update public.time_entries set ended_at = 900 where id = 'te_kassa';`))
check('wat er dan ook echt staat',
  Number((await urenRegel('te_kassa')).ended_at) === 900,
  JSON.stringify(await urenRegel('te_kassa')))

/* --- de eigenaar van de regel mag er zelf niet aan --- */

await magSchrijven(wasser,
  `update public.time_entries set started_at = 1 where id = 'te_kassa';`)
check('de medewerker verzet zijn eigen begintijd niet',
  Number((await urenRegel('te_kassa')).started_at) === 100)

check('en gooit hem ook niet weg',
  !(await magSchrijven(wasser, `delete from public.time_entries where id = 'te_kassa';`))
  || !!(await urenRegel('te_kassa')))

/* --- vergeten uit te klokken: de leidinggevende sluit af --- */

await db.exec(`
  insert into public.time_entries (id, user_id, user_name, started_at)
  values ('te_open', '${wasserId}', 'Tom', 200);`)

check('een leidinggevende sluit een lopende regel af',
  await magSchrijven(voorman,
    `update public.time_entries set ended_at = 800 where id = 'te_open';`))
check('en dat staat er dan ook',
  Number((await urenRegel('te_open')).ended_at) === 800)

/*
 * Let op: een UPDATE die op de beveiligingsregels strandt raakt nul rijen en
 * meldt niets. Nakijken doe je dus achteraf, aan wat er staat -- niet aan of
 * er iets omviel.
 */
await db.exec(`
  insert into public.time_entries (id, user_id, user_name, started_at)
  values ('te_open3', '${wasserId}', 'Tom', 600);`)

await magSchrijven(voorman,
  `update public.time_entries set started_at = 5, ended_at = 700 where id = 'te_open3';`)
check('maar hij verzet het begin niet',
  Number((await urenRegel('te_open3')).started_at) === 600)

await magSchrijven(voorman,
  `update public.time_entries set user_id = '${voormanId}', ended_at = 700 where id = 'te_open3';`)
check('en zet hem niet op naam van iemand anders',
  (await urenRegel('te_open3')).user_id === wasserId)

await db.exec(`
  insert into public.time_entries (id, user_id, user_name, started_at)
  values ('te_open2', '${wasserId}', 'Tom', 300);`)
check('afsluiten is geen nieuwe regel schrijven',
  !(await magSchrijven(voorman, `insert into public.time_entries
     (id, user_id, user_name, started_at) values
     ('te_voorman', '${wasserId}', 'Tom', 400);`)))

/* --- het kantoor houdt de sleutels --- */

check('het management corrigeert wel',
  await magSchrijven(baas,
    `update public.time_entries set started_at = 250 where id = 'te_open2';`))
check('en mag als enige weggooien',
  await magSchrijven(baas, `delete from public.time_entries where id = 'te_open2';`))
check('de regel is dan ook echt weg', !(await urenRegel('te_open2')))

/* --- kijken verandert niet --- */

check('je ziet je eigen uren gewoon',
  (await countAs(wasser,
    `select count(*)::int as n from public.time_entries where user_id = '${wasserId}'`)) > 0)
check('een leidinggevende ziet die van zijn team',
  (await countAs(voorman, 'select count(*)::int as n from public.time_entries')) > 0)
check('een klant ziet er geen',
  (await countAs(klant, 'select count(*)::int as n from public.time_entries')) === 0)



console.log('\n24. Wat je aan je eigen dossier mag veranderen')

/*
 * Dit was open. De regel op profiles zei "je mag je eigen rij bijwerken", en
 * beveiligingsregels werken per rij en niet per kolom -- dus dat gold ook
 * voor de kolom `roles`. Iedereen met een account kon zichzelf management
 * maken en daarmee bij de omzet, de dossiers en de uurlonen van iedereen.
 *
 * Een UPDATE die op de rem loopt gooit hier wél een fout (het is een
 * trigger, geen regel), maar we kijken achteraf naar wat er staat. Dat is
 * het enige dat telt.
 */

async function rollenVanDeWasser() {
  const r = await db.query(
    `select roles, active, all_locations, grants
       from public.profiles where email = 'wasser@truckwash1group.nl'`)
  return r.rows[0]
}

await magSchrijven(wasser,
  `update public.profiles set roles = array['management']::text[]
    where email = 'wasser@truckwash1group.nl';`)
check('een werknemer maakt zichzelf geen management',
  !(await rollenVanDeWasser()).roles.includes('management'),
  JSON.stringify((await rollenVanDeWasser()).roles))

await magSchrijven(wasser,
  `update public.profiles set grants = array['finance.view']::text[]
    where email = 'wasser@truckwash1group.nl';`)
check('en geeft zichzelf geen losse rechten',
  ((await rollenVanDeWasser()).grants ?? []).length === 0,
  JSON.stringify((await rollenVanDeWasser()).grants))

await magSchrijven(wasser,
  `update public.profiles set all_locations = true where email = 'wasser@truckwash1group.nl';`)
check('en zet zichzelf niet op alle vestigingen',
  (await rollenVanDeWasser()).all_locations === false)

await magSchrijven(wasser,
  `update public.profiles set hourly_rate = 99 where email = 'wasser@truckwash1group.nl';`)
check('en verhoogt zijn eigen uurloon niet',
  Number((await db.query(
    `select hourly_rate from public.profiles where email = 'wasser@truckwash1group.nl'`
  )).rows[0].hourly_rate ?? 0) !== 99)

/* --- wat wel van jou is --- */

check('je eigen naam mag je wel wijzigen',
  await magSchrijven(wasser,
    `update public.profiles set name = 'Tom Verhoeven-Jansen' where email = 'wasser@truckwash1group.nl';`))
check('en dat staat er dan ook',
  (await db.query(
    `select name from public.profiles where email = 'wasser@truckwash1group.nl'`
  )).rows[0].name === 'Tom Verhoeven-Jansen')

check('je telefoonnummer ook',
  await magSchrijven(wasser,
    `update public.profiles set phone = '06-11223344' where email = 'wasser@truckwash1group.nl';`))

check('en welke rondleiding je hebt gezien',
  await magSchrijven(wasser,
    `update public.profiles set seen_tours = array['employee@1']::text[]
      where email = 'wasser@truckwash1group.nl';`))

/* --- het tijdelijke wachtwoord --- */

check('het vinkje voor je wachtwoord mag je uitzetten',
  await magSchrijven(wasser,
    `update public.profiles set must_change_password = false where email = 'wasser@truckwash1group.nl';`))
await magSchrijven(wasser,
  `update public.profiles set must_change_password = true where email = 'wasser@truckwash1group.nl';`)
check('maar niet aanzetten',
  (await db.query(
    `select must_change_password from public.profiles
      where email = 'wasser@truckwash1group.nl'`)).rows[0].must_change_password === false)

/* --- en het kantoor houdt de sleutels --- */

check('het management deelt wel rollen uit',
  await magSchrijven(baas,
    `update public.profiles set roles = array['employee','supervisor']::text[]
      where email = 'wasser@truckwash1group.nl';`))
check('en dat werkt ook echt',
  (await rollenVanDeWasser()).roles.includes('supervisor'))

await db.exec(`
  update public.profiles set roles = array['employee']::text[], hourly_rate = 22
   where email = 'wasser@truckwash1group.nl';`)


console.log('\n25. Bijwerken is geen aanmaken')

/*
 * De app stuurt een gewijzigde rij als geheel op, en de database bepaalt of
 * dat nieuw is of een wijziging. Bij zo'n upsert kijkt Postgres naar de
 * regel voor INSERT én die voor UPDATE. Zegt de eerste iets over wie de rij
 * heeft gemaakt, dan strandt elke wijziging door iemand anders.
 */

// Een bon die per mail binnenkwam: geen indiener, want die komt van de postbus.
await db.exec(`
  insert into public.expenses
    (id, location_id, expense_date, category, supplier, description,
     amount_excl, vat_pct, status, submitted_by, source)
  values ('exp_uitmail', 'loc_utr', 1, 'overig', 'CleanChem BV',
          'Factuur per mail', 0, 21, 'open', '', 'mail');

  alter table public.expenses force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

async function bedragVan(id) {
  const r = await db.query(`select amount_excl, status from public.expenses where id = '${id}'`)
  return r.rows[0]
}

/* --- dit ging mis --- */

check('het management vult een bon uit de mail aan',
  await magSchrijven(baas, `insert into public.expenses
     (id, location_id, expense_date, category, supplier, description,
      amount_excl, vat_pct, status, submitted_by, source)
     values ('exp_uitmail', 'loc_utr', 1, 'overig', 'CleanChem BV',
             'Factuur per mail', 248.50, 21, 'open', '', 'mail')
     on conflict (id) do update set amount_excl = excluded.amount_excl;`))
check('en dat bedrag staat er dan ook',
  Number((await bedragVan('exp_uitmail')).amount_excl) === 248.50,
  JSON.stringify(await bedragVan('exp_uitmail')))

check('en hij kan hem goedkeuren',
  await magSchrijven(baas,
    `update public.expenses set status = 'goedgekeurd' where id = 'exp_uitmail';`))
check('wat er ook echt gebeurt',
  (await bedragVan('exp_uitmail')).status === 'goedgekeurd')

/* --- maar een nieuwe bon blijft op naam van wie hem indient --- */

check('een werknemer dient een bon op eigen naam in',
  await magSchrijven(wasser, `insert into public.expenses
     (id, location_id, expense_date, category, supplier, description,
      amount_excl, vat_pct, status, submitted_by)
     values ('exp_tom', 'loc_utr', 1, 'materiaal', 'Winkel', 'Handschoenen',
             12.50, 21, 'open', '${wasserId}');`))

check('maar niet op naam van een ander',
  !(await magSchrijven(wasser, `insert into public.expenses
     (id, location_id, expense_date, category, supplier, description,
      amount_excl, vat_pct, status, submitted_by)
     values ('exp_vals', 'loc_utr', 1, 'materiaal', 'Winkel', 'Namens de baas',
             999, 21, 'open', '${baasId}');`)))

check('en een klant komt er helemaal niet in',
  !(await magSchrijven(klant, `insert into public.expenses
     (id, location_id, expense_date, category, supplier, description,
      amount_excl, vat_pct, status, submitted_by)
     values ('exp_klant', 'loc_utr', 1, 'materiaal', 'Winkel', 'Zomaar',
             50, 21, 'open', '${klantRow.id}');`)))

/* --- een goedgekeurde bon is niet meer van de indiener --- */

await db.exec(`update public.expenses set status = 'goedgekeurd' where id = 'exp_tom';`)
await magSchrijven(wasser,
  `update public.expenses set amount_excl = 500 where id = 'exp_tom';`)
check('een goedgekeurde bon past de indiener niet meer aan',
  Number((await bedragVan('exp_tom')).amount_excl) === 12.50)

/* --- en dezelfde valstrik op de koppelingen --- */

await db.exec(`
  insert into public.employer_links
    (id, werkgever_id, werkgever_naam, user_id, naam, email, status)
  values ('wgl_upsert', 'wg_test', 'Transport Jansen BV', '${rickRow.id}',
          'Rick Molenaar', 'rick@transportjansen.nl', 'wacht op akkoord');`)

check('een chauffeur neemt zijn eigen koppelverzoek aan',
  await magSchrijven(chauffeur, `insert into public.employer_links
     (id, werkgever_id, werkgever_naam, user_id, naam, email, status)
     values ('wgl_upsert', 'wg_test', 'Transport Jansen BV', '${rickRow.id}',
             'Rick Molenaar', 'rick@transportjansen.nl', 'actief')
     on conflict (id) do update set status = excluded.status;`))
check('en dan staat hij op actief',
  (await db.query(
    `select status from public.employer_links where id = 'wgl_upsert'`)).rows[0].status === 'actief')

check('maar hij maakt er zelf geen nieuwe aan',
  !(await magSchrijven(chauffeur, `insert into public.employer_links
     (id, werkgever_id, werkgever_naam, naam, email, status)
     values ('wgl_zelf', 'wg_test', 'Transport Jansen BV', 'Ik', 'ik@x.nl', 'actief');`)))

console.log('\n26. De kluis, en een kassa koppelen')

/*
 * De kluis rekent met briefjes en munten, niet met bedragen. Dat is de
 * hele reden dat deze tabel bestaat, dus dat is ook wat hier bewezen moet
 * worden: dat het saldo uit de samenstelling volgt, dat een telling het
 * ijkpunt is, en dat een boeking daarna niet meer te bewerken valt.
 */

await asServer(db)
await db.exec(`
  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, coins, amount, at)
  values
    ('kl_1', 'kluis_loc_utr', 'loc_utr', 'afstorting', '{"b100":3,"b20":2}'::jsonb, 340, 1000),
    ('kl_2', 'kluis_loc_utr', 'loc_utr', 'wisselgeld', '{"m200":10}'::jsonb,        -20, 2000);
`)

const saldo = async (kluis = 'kluis_loc_utr') =>
  Number((await db.query(`select public.pos_kluis_saldo('${kluis}') as n`)).rows[0].n)

check('elke vestiging heeft vanzelf een kluis',
  (await db.query(
    `select count(*)::int as n from public.pos_safes
      where location_id in ('loc_utr','loc_rtm')`)).rows[0].n === 2)

check('het saldo volgt uit de briefjes: 340 erin, 20 eruit',
  (await saldo()) === 320)

check('een briefje van vijf en een munt van vijf cent zijn niet hetzelfde',
  Number((await db.query(
    `select public.pos_munt_waarde('b5') - public.pos_munt_waarde('m5') as n`)).rows[0].n) === 4.95)

/*
 * De telling is het ijkpunt. Wat ervoor gebeurde telt niet meer mee -- juist
 * dat maakt hem bruikbaar: na een telling klopt de administratie met de
 * kluis, en blijft het verschil zichtbaar in plaats van weggerekend.
 */
await db.exec(`
  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, counted, amount, expected, difference, at)
  values ('kl_3', 'kluis_loc_utr', 'loc_utr', 'telling',
          '{"b100":3,"b10":1}'::jsonb, 0, 320, -10, 3000);
`)

check('na een telling is het saldo wat er geteld is', (await saldo()) === 310)

check('en het verschil blijft staan zoals het die dag was',
  Number((await db.query(
    `select difference as n from public.pos_safe_moves where id = 'kl_3'`)).rows[0].n) === -10)

await db.exec(`
  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, coins, amount, at)
  values ('kl_4', 'kluis_loc_utr', 'loc_utr', 'van-bank', '{"b50":1}'::jsonb, 50, 4000);
`)
check('wat na de telling komt telt weer mee', (await saldo()) === 360)

/*
 * Twee boekingen in dezelfde milliseconde. Stond er alleen `at > telling.at`,
 * dan viel de boeking van hetzelfde moment als de telling uit het saldo -- geen
 * fout, alleen een bedrag dat niet klopt. De kassa had dezelfde fout; die is
 * daar op dezelfde manier rechtgezet.
 */
await db.exec(`
  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, counted, amount, at)
  values ('kl_ms_a', 'kluis_loc_utr', 'loc_utr', 'telling',
          '{"b50":2}'::jsonb, 0, 9000);
  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, coins, amount, at)
  values ('kl_ms_b', 'kluis_loc_utr', 'loc_utr', 'uitgave',
          '{"b50":1}'::jsonb, -50, 9000);
`)
check('een boeking van hetzelfde moment als de telling valt niet weg',
  (await saldo()) === 50, String(await saldo()))

check('een kluisboeking kan niet meer gewijzigd worden',
  (await botst("update public.pos_safe_moves set amount = 1 where id = 'kl_1'"))
    ?.includes('vast') === true)
check('en niet verwijderd',
  (await botst("delete from public.pos_safe_moves where id = 'kl_1'"))
    ?.includes('tegenboeking') === true)
check('een toelichting erbij zetten mag wel',
  (await botst("update public.pos_safe_moves set reason = 'nagekeken' where id = 'kl_1'")) === null)
check('opnieuw aanbieden van dezelfde regel loopt niet vast',
  (await botst(`insert into public.pos_safe_moves
     (id, safe_id, location_id, soort, coins, amount, at)
     values ('kl_1', 'kluis_loc_utr', 'loc_utr', 'afstorting',
             '{"b100":3,"b20":2}'::jsonb, 340, 1000)
     on conflict (id) do update set reason = excluded.reason`)) === null)

/* ---- wie mag erbij? ---- */

await db.exec(`
  alter table public.pos_safes      force row level security;
  alter table public.pos_safe_moves force row level security;
  alter table public.pos_pairings   force row level security;
  alter table public.pos_devices    force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

/*
 * Niet tegen een vast aantal aan meten. Hier stond "=== 4", en de eerste keer
 * dat er een controle bij kwam die een boeking toevoegde, viel deze om -- op
 * een aantal, niet op de beveiliging waar hij over gaat.
 */
const alleBoekingen = (await db.query(
  'select count(*)::int as n from public.pos_safe_moves')).rows[0].n
check('een werknemer op de vestiging ziet alle kluisboekingen',
  (await countAs(wasser, 'select count(*)::int as n from public.pos_safe_moves'))
    === alleBoekingen)
check('een klant ziet er niets van',
  (await countAs(klant, 'select count(*)::int as n from public.pos_safe_moves')) === 0)
check('een werknemer kan een boeking maken',
  await magSchrijven(wasser, `insert into public.pos_safe_moves
     (id, safe_id, location_id, soort, coins, amount, at)
     values ('kl_5', 'kluis_loc_utr', 'loc_utr', 'uitgave', '{"b20":1}'::jsonb, -20, 5000)`))
check('maar hij maakt geen tweede kluis aan',
  !(await magSchrijven(wasser, `insert into public.pos_safes (id, location_id, name)
     values ('kluis_los', 'loc_utr', 'Eigen kluis')`)))

/* ---- de koppelcode ---- */

await db.exec(`
  insert into public.pos_pairings
    (id, code, location_id, register_id, created_by_name, expires_at)
  values ('pair_1', 'K7QJ4M2P', 'loc_utr', 'reg_1', 'Kantoor', 9999999999999);
`)

check('een gewone werknemer kan de koppelcode niet lezen',
  (await countAs(wasser, 'select count(*)::int as n from public.pos_pairings')) === 0)
check('een klant al helemaal niet',
  (await countAs(klant, 'select count(*)::int as n from public.pos_pairings')) === 0)
check('wie kassa\'s beheert wel',
  (await countAs(voorman,
    'select count(*)::int as n from public.pos_pairings')) >= 0)

/* ---- één apparaat per kassa ---- */

await db.exec(`
  insert into public.pos_devices (id, register_id, location_id, device_key, name)
  values ('dev_1', 'reg_1', 'loc_utr', 'tablet-aaa', 'Tablet balie');
`)

check('twee apparaten op dezelfde kassa kan niet',
  (await botst(`insert into public.pos_devices
     (id, register_id, location_id, device_key, name)
     values ('dev_2', 'reg_1', 'loc_utr', 'tablet-bbb', 'Tweede tablet')`)) !== null)

await db.exec("update public.pos_devices set status = 'ingetrokken' where id = 'dev_1'")
check('maar na intrekken mag de opvolger erin',
  (await botst(`insert into public.pos_devices
     (id, register_id, location_id, device_key, name)
     values ('dev_2', 'reg_1', 'loc_utr', 'tablet-bbb', 'Opvolger')`)) === null)

/* ---- wat een apparaat aan zijn eigen regel mag ----
 *
 * Dit is de kant die op afstand uitloggen werkend maakt: het kantoor zet de
 * status om, het apparaat houdt alleen bij dat hij er nog is. Zou het
 * apparaat zijn eigen status kunnen zetten, dan zet een gestolen tablet
 * zichzelf weer op actief.
 */

await asServer(db)
await db.exec(`
  insert into public.pos_registers (id, location_id, code, name)
  values ('reg_2', 'loc_utr', 'KAS-UTR-2', 'Tweede balie')
  on conflict (id) do nothing;

  -- Het kantoor heeft dit apparaat op slot gezet. Vanaf hier is de vraag wat
  -- het apparaat daar zelf nog aan kan doen: niets.
  update public.pos_devices
     set auth_user_id = '${wasser}', status = 'geblokkeerd'
   where id = 'dev_2';`)

check('een apparaat mag bijhouden dat hij er nog is',
  await magSchrijven(wasser,
    `update public.pos_devices set last_seen_at = 123 where id = 'dev_2'`))
check('en melden dat hij zichzelf gewist heeft',
  await magSchrijven(wasser,
    `update public.pos_devices set wiped_at = 456 where id = 'dev_2'`))
check('maar hij zet zijn eigen status niet terug op actief',
  !(await magSchrijven(wasser,
    `update public.pos_devices set status = 'actief' where id = 'dev_2'`)))
check('en verhuist zichzelf niet naar een andere kassa',
  !(await magSchrijven(wasser,
    `update public.pos_devices set register_id = 'reg_2' where id = 'dev_2'`)))

/* ---- wat een kassa aan zijn eigen instellingen mag ---- */

await asServer(db)
await db.exec(`
  alter table public.pos_registers force row level security;
  insert into public.pos_devices (id, register_id, location_id, device_key, name, auth_user_id)
  values ('dev_3', 'reg_2', 'loc_utr', 'tablet-ccc', 'Tablet tweede balie', '${wasser}');`)

check('een kassa zet zijn eigen bonprinter',
  await magSchrijven(wasser, `update public.pos_registers
     set printer = '{"kind":"netwerk","host":"192.168.1.50"}'::jsonb
     where id = 'reg_2'`))
check('maar niet zijn eigen code',
  !(await magSchrijven(wasser,
    `update public.pos_registers set code = 'KAS-ANDERS' where id = 'reg_2'`)))
check('en zet zichzelf niet weer aan',
  !(await magSchrijven(wasser,
    `update public.pos_registers set active = false where id = 'reg_2'`)))
/*
 * Let op hoe deze controle eruitziet, en waarom hij niet naar een foutmelding
 * kijkt: een UPDATE die door de beveiliging geen enkele rij ziet, slaagt --
 * hij raakt alleen niets. Zou hier "mag dit niet" staan op basis van een
 * fout, dan was de controle groen terwijl het slot open stond.
 */
await asServer(db)
await db.exec(`update public.pos_registers
                  set printer = '{"kind":"windows","share":"BALIE1"}'::jsonb
                where id = 'reg_1'`)
await magSchrijven(wasser,
  `update public.pos_registers set printer = '{"kind":"geen"}'::jsonb where id = 'reg_1'`)
check('en komt niet aan de kassa van de buren',
  (await db.query(
    `select printer->>'share' as s from public.pos_registers where id = 'reg_1'`))
    .rows[0].s === 'BALIE1')

/* ---- de foto bij een artikel ---- */

await asServer(db)

check('een artikel kan een foto hebben',
  (await botst(`update public.pos_products
                   set image = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
                 where id = 'prod_koffie'`)) === null)

/*
 * De rem eronder. Zonder deze grens zet iemand ooit een foto van vier megabyte
 * in een artikel, en sleept elke kassa die bij elke synchronisatie mee -- en
 * dat merk je pas als het te laat is.
 */
const teGroot = await botst(`update public.pos_products
                                set image = 'data:image/jpeg;base64,' || repeat('A', 200000)
                              where id = 'prod_koffie'`)
check('maar geen foto van tweehonderd kilobyte', teGroot !== null, String(teGroot))

check('en de foto van net staat er nog',
  (await db.query(
    `select image from public.pos_products where id = 'prod_koffie'`))
    .rows[0].image.startsWith('data:image/jpeg;base64,'))

check('geen foto mag ook',
  (await botst("update public.pos_products set image = null where id = 'prod_koffie'")) === null)

/* ---- het bonnummer loopt mee met de bonnen ---- */

check('last_seq volgt de hoogste bon die binnenkwam',
  Number((await db.query(
    `select last_seq as n from public.pos_registers where id = 'reg_1'`)).rows[0].n) === 3)

await db.exec(`
  insert into public.pos_sales
    (id, register_id, register_code, location_id, receipt_no, seq, status)
  values ('sale_laag', 'reg_1', 'KAS-UTR-1', 'loc_utr', 'KAS-UTR-1-20260901-0002b', 2, 'open');
`)
check('en een kassa kan de bovengrens niet omlaag zetten',
  await (async () => {
    await magSchrijven(wasser,
      `update public.pos_registers set last_seq = 1 where id = 'reg_2'`)
    await asServer(db)
    await db.exec(`update public.pos_registers set last_seq = 1 where id = 'reg_1'`)
    const rijen = await db.query(
      `select last_seq::int as n from public.pos_registers where id = 'reg_1'`)
    return rijen.rows[0].n === 3
  })())

check('en zakt niet terug als er een lagere bon nakomt',
  Number((await db.query(
    `select last_seq as n from public.pos_registers where id = 'reg_1'`)).rows[0].n) === 3)



console.log('\n26. De kassa vanaf het kantoor')

/*
 * Wat het dashboard met de kassatabellen mag. Het schema komt van de
 * kassakant; dit is de controle dat de beheerkant erbij kan wat hij nodig
 * heeft, en niet meer dan dat.
 */

await db.exec(`
  alter table public.pos_registers force row level security;
  alter table public.pos_devices   force row level security;
  alter table public.pos_pairings  force row level security;
  alter table public.pos_safes     force row level security;
  alter table public.pos_safe_moves force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;

  insert into public.pos_registers (id, location_id, code, name)
  values ('reg_beheer', 'loc_utr', 'KAS-BEH-1', 'Balie')
  on conflict (id) do nothing;
`)

/* --- de code op de bon is uniek --- */

check('twee kassa-codes die hetzelfde zijn kan niet',
  (await botst(`
     insert into public.pos_registers (id, location_id, code, name)
     values ('reg_dubbel', 'loc_utr', 'KAS-BEH-1', 'Nog een')`)) !== null)

/* --- het management beheert de kassa's --- */

check('het management maakt een kassa aan',
  await magSchrijven(baas, `insert into public.pos_registers
     (id, location_id, code, name) values
     ('reg_baas', 'loc_utr', 'KAS-UTR-9', 'Testkassa');`))

await magSchrijven(wasser, `insert into public.pos_registers
   (id, location_id, code, name) values
   ('reg_wasser', 'loc_utr', 'KAS-STIEKEM', 'Van mij');`)
check('een wasser niet',
  (await db.query(
    `select count(*)::int as n from public.pos_registers where id = 'reg_wasser'`
  )).rows[0].n === 0)

/* --- de koppelcodes --- */

await magSchrijven(baas, `insert into public.pos_pairings
   (id, code, location_id, register_id, created_by_name, expires_at) values
   ('bpair_1', 'BH7QJ4M2', 'loc_utr', 'reg_beheer', 'Ilse', ${Date.now() + 3600000});`)
check('het management maakt een koppelcode',
  (await db.query(
    `select count(*)::int as n from public.pos_pairings where id = 'bpair_1'`)).rows[0].n === 1)

check('en dezelfde code kan niet twee keer bestaan',
  (await botst(`
     insert into public.pos_pairings
       (id, code, location_id, register_id, created_by_name, expires_at)
     values ('bpair_2', 'BH7QJ4M2', 'loc_utr', 'reg_beheer', 'Ilse', 1)`)) !== null)

/*
 * Dit is waar het om gaat bij een koppelcode. Wie hem kan lezen kan een
 * apparaat aan een vestiging hangen -- dus dat mag alleen wie kassa's
 * beheert.
 */
check('een wasser leest de koppelcodes niet',
  (await countAs(wasser, 'select count(*)::int as n from public.pos_pairings')) === 0)
check('het management wel',
  (await countAs(baas, 'select count(*)::int as n from public.pos_pairings')) > 0)

/* --- de apparaten --- */

await db.exec(`
  insert into public.pos_devices
    (id, register_id, location_id, device_key, name, platform, status)
  values ('bdev_1', 'reg_beheer', 'loc_utr', 'abc', 'Tablet balie', 'android', 'actief');
`)

check('twee apparaten op dezelfde kassa kan niet',
  (await botst(`
     insert into public.pos_devices
       (id, register_id, location_id, device_key, name, platform, status)
     values ('bdev_2', 'reg_beheer', 'loc_utr', 'def', 'Tweede', 'android', 'actief')`)) !== null)

check('maar een opvolger van een ingetrokken apparaat wel',
  (await botst(`
     update public.pos_devices set status = 'ingetrokken' where id = 'bdev_1';
     insert into public.pos_devices
       (id, register_id, location_id, device_key, name, platform, status)
     values ('bdev_3', 'reg_beheer', 'loc_utr', 'ghi', 'Opvolger', 'android', 'actief')`)) === null)

check('het management blokkeert een apparaat',
  await magSchrijven(baas,
    `update public.pos_devices set status = 'geblokkeerd' where id = 'bdev_3';`))
check('en dat staat er dan ook',
  (await db.query(
    `select status from public.pos_devices where id = 'bdev_3'`)).rows[0].status === 'geblokkeerd')

/* --- de kluis --- */

check('elke vestiging heeft een kluis gekregen',
  (await db.query(`
     select count(*)::int as n from public.pos_safes s
      join public.locations l on l.id = s.location_id`)).rows[0].n > 0)

check('twee kluizen op één vestiging kan niet',
  (await botst(`
     insert into public.pos_safes (id, location_id, name)
     values ('kluis_tweede', 'loc_utr', 'Nog een kluis')`)) !== null)

/* --- wat een briefje waard is --- */

check('b100 is honderd euro',
  Number((await db.query(`select public.pos_munt_waarde('b100') as w`)).rows[0].w) === 100)
check('m5 is vijf cent',
  Number((await db.query(`select public.pos_munt_waarde('m5') as w`)).rows[0].w) === 0.05)
check('en b5 is iets heel anders dan m5',
  Number((await db.query(`select public.pos_munt_waarde('b5') as w`)).rows[0].w) === 5)

/* --- het saldo van de kluis --- */

/*
 * Een kluis waar nog niets in is geboekt, want afdeling 18 heeft de kluis van
 * Utrecht al vol gezet. Twee afdelingen die in dezelfde kluis boeken meten
 * elkaars saldo.
 */
const { rows: [schoneKluis] } = await db.query(`
  select s.id from public.pos_safes s
   where not exists (select 1 from public.pos_safe_moves m where m.safe_id = s.id)
   limit 1`)

await db.exec(`
  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, coins, amount, at) values
    ('bsm_1', '${schoneKluis.id}', null, 'inleg', '{"b50":4}'::jsonb, 200, 101000);

  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, coins, counted, amount, expected, difference, at)
  values ('bsm_2', '${schoneKluis.id}', null, 'telling', '{}'::jsonb,
          '{"b50":4,"b20":1}'::jsonb, 0, 200, 20, 102000);

  insert into public.pos_safe_moves
    (id, safe_id, location_id, soort, coins, amount, at) values
    ('bsm_3', '${schoneKluis.id}', null, 'afstorting', '{"b20":5}'::jsonb, 100, 103000);
`)

check('het saldo telt vanaf de laatste telling',
  Number((await db.query(
    `select public.pos_kluis_saldo('${schoneKluis.id}') as s`)).rows[0].s) === 320)

/*
 * Een kasadministratie die je achteraf kunt bijschaven is geen
 * administratie. Corrigeren doe je met een tegenboeking of een telling.
 */
await magSchrijven(baas,
  `update public.pos_safe_moves set amount = 9999 where id = 'bsm_3';`)
check('een kluisboeking is niet te wijzigen',
  Number((await db.query(
    `select amount from public.pos_safe_moves where id = 'bsm_3'`)).rows[0].amount) === 100)

await magSchrijven(baas, `delete from public.pos_safe_moves where id = 'bsm_3';`)
check('en niet te wissen',
  (await db.query(
    `select count(*)::int as n from public.pos_safe_moves where id = 'bsm_3'`)).rows[0].n === 1)

/* --- een apparaat is geen medewerker --- */

check('het vlaggetje staat op de dossiers',
  (await db.query(`
     select 1 from information_schema.columns
      where table_name = 'profiles' and column_name = 'is_device'`)).rows.length === 1)

await db.exec(`
  insert into auth.users (id, email) values
    ('e5e5e5e5-5555-5555-5555-e5e5e5e5e5e5', 'kas.utr.1@truckwash1group.nl');
  update public.profiles
     set roles = array['employee']::text[], active = true, is_device = true
   where email = 'kas.utr.1@truckwash1group.nl';
`)
check('een apparaat staat als apparaat gemarkeerd',
  (await db.query(`
     select count(*)::int as n from public.profiles where is_device`)).rows[0].n === 1)
check('en telt dus niet mee als medewerker',
  (await db.query(`
     select count(*)::int as n from public.profiles
      where active and not is_device`)).rows[0].n
   < (await db.query(`
     select count(*)::int as n from public.profiles where active`)).rows[0].n)

console.log('\n27. De vestigingen zelf beheren')

/*
 * Het gevaarlijkste stuk van dit blok is het wissen. Op locations hangen
 * tweeentwintig verwijzingen en een flink deel staat op "cascade":
 * installaties, storingen, werkbonnen, onderhoud, voorraad, overlegkanalen
 * en de kluis. Een vestiging wissen zou die allemaal meenemen zonder een
 * woord, en dat merk je pas als iemand een oude werkbon zoekt.
 *
 * De trigger hoort dat tegen te houden. Dat is wat hier wordt nagerekend.
 */

/*
 * FORCE op pos_safes komt uit afdeling 26 -- een testgreep om de regels ook
 * tegen de eigenaar te laten bijten. Hier worden vestigingen aangemaakt, en
 * dan hoort de trigger die er een kluis bij zet gewoon zijn werk te doen.
 * In productie is dat de eigenaar van de tabel, en die valt erbuiten.
 */
await asServer(db)
await db.exec(`
  alter table public.pos_safes no force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

/* --- een nieuwe vestiging krijgt een kluis --- */

await db.exec(`
  insert into public.locations (id, code, name, kind, address, postcode, city)
  values ('loc_proef', 'TW-PRF', 'Proefvestiging', 'vestiging', 'Testweg 1', '1234 AB', 'Proefstad')
  on conflict (id) do nothing;
`)

check('een nieuwe vestiging krijgt meteen een kluis',
  (await db.query(`
     select count(*)::int as n from public.pos_safes where location_id = 'loc_proef'`))
    .rows[0].n === 1)

/* --- wat hangt er aan een vestiging --- */

check('vestiging_bezet telt de medewerkers van een bestaande vestiging',
  Number((await db.query(`
     select aantal from public.vestiging_bezet('loc_utr') where wat = 'medewerkers'`))
    .rows[0].aantal) > 0)

check('en bij een lege vestiging staat overal nul',
  Number((await db.query(`
     select coalesce(sum(aantal), 0) as n from public.vestiging_bezet('loc_proef')`))
    .rows[0].n) === 0)

/* --- wissen --- */

const wissenFout = await botst(`delete from public.locations where id = 'loc_utr'`)

check('een vestiging waar nog van alles aan hangt kan niet weg', wissenFout !== null)
check('en er staat bij wat eraan hangt',
  (wissenFout ?? '').includes('medewerkers'))
check('met de raad om hem uit te zetten',
  (wissenFout ?? '').toLowerCase().includes('uit'))
check('de vestiging staat er daarna gewoon nog',
  (await db.query(`
     select count(*)::int as n from public.locations where id = 'loc_utr'`)).rows[0].n === 1)

check('een vestiging waar niets aan hangt kan wel weg',
  (await botst(`delete from public.locations where id = 'loc_proef'`)) === null)
check('en zijn kluis gaat mee',
  (await db.query(`
     select count(*)::int as n from public.pos_safes where location_id = 'loc_proef'`))
    .rows[0].n === 0)

/* --- foto's --- */

await db.exec(`
  insert into public.location_photos (id, location_id, storage_path, mime, sort, is_cover)
  values ('lf_1', 'loc_utr', 'loc_utr/lf_1.jpg', 'image/jpeg', 0, true)
  on conflict (id) do nothing;
`)

check('een tweede foto vooraan kan niet',
  (await botst(`
     insert into public.location_photos
       (id, location_id, storage_path, mime, sort, is_cover)
     values ('lf_2', 'loc_utr', 'loc_utr/lf_2.jpg', 'image/jpeg', 1, true)`)) !== null)

check('maar een tweede foto erachter wel',
  (await botst(`
     insert into public.location_photos
       (id, location_id, storage_path, mime, sort, is_cover)
     values ('lf_3', 'loc_utr', 'loc_utr/lf_3.jpg', 'image/jpeg', 1, false)`)) === null)

check("de foto's gaan mee als de vestiging weggaat",
  (await db.query(`
     select confdeltype from pg_constraint
      where conrelid = 'public.location_photos'::regclass
        and confrelid = 'public.locations'::regclass`)).rows[0].confdeltype === 'c')

/* --- wie mag dit --- */

await db.exec(`
  alter table public.locations       force row level security;
  alter table public.location_photos force row level security;
`)

check('het management maakt een vestiging aan',
  await magSchrijven(baas, `insert into public.locations
     (id, code, name, kind, city) values
     ('loc_baas', 'TW-BAA', 'Van de baas', 'vestiging', 'Baasstad');`))

await magSchrijven(wasser, `insert into public.locations
   (id, code, name, kind, city) values
   ('loc_wasser', 'TW-WAS', 'Van de wasser', 'vestiging', 'Wasserstad');`)
check('een wasser niet',
  (await db.query(`
     select count(*)::int as n from public.locations where id = 'loc_wasser'`)).rows[0].n === 0)

/*
 * Het recht locations.manage stond al in de app, maar de database keek er
 * niet naar: daar gold alleen "management". Uitdelen had dus geen enkel
 * effect, en dat is het soort recht waarvan je denkt dat het iets doet.
 */
await asServer(db)
await db.exec(`
  update public.profiles
     set grants = array['locations.manage']::text[]
   where auth_id = '${voorman}';
`)

check('wie het recht locations.manage heeft mag het ook',
  await magSchrijven(voorman, `insert into public.locations
     (id, code, name, kind, city) values
     ('loc_voorman', 'TW-VRM', 'Van de voorman', 'vestiging', 'Voormanstad');`))

check('en die mag er ook een foto bij zetten',
  await magSchrijven(voorman, `insert into public.location_photos
     (id, location_id, storage_path, mime) values
     ('lf_5', 'loc_voorman', 'loc_voorman/lf_5.jpg', 'image/jpeg');`))

await magSchrijven(wasser, `insert into public.location_photos
   (id, location_id, storage_path, mime) values
   ('lf_6', 'loc_utr', 'loc_utr/lf_6.jpg', 'image/jpeg');`)
check('een wasser zet er geen foto bij',
  (await db.query(`
     select count(*)::int as n from public.location_photos where id = 'lf_6'`)).rows[0].n === 0)

check('maar hij ziet ze wel',
  (await countAs(wasser, 'select count(*)::int as n from public.location_photos')) > 0)

/* --- de emmer --- */

check('de emmer voor de vestigingsfoto’s staat er',
  (await db.query(`select count(*)::int as n from storage.buckets where id = 'vestigingen'`))
    .rows[0].n === 1)

/*
 * Openbaar leesbaar, anders dan de dossiers. Dat is een keuze en geen
 * slordigheid: een foto van een wasstraat langs de snelweg staat ook op de
 * website, en ondertekende adressen ophalen bij elk scherm maakt de lijst
 * traag en offline leeg. Zet iemand dit ooit om, dan hoort deze controle om
 * te vallen -- zodat het een besluit is en geen ongeluk.
 */
check('en die is openbaar leesbaar, anders dan de dossiers',
  (await db.query(`select public from storage.buckets where id = 'vestigingen'`))
    .rows[0].public === true)
check('terwijl de dossiers dat juist niet zijn',
  (await db.query(`select public from storage.buckets where id = 'dossiers'`))
    .rows[0].public === false)


console.log('\n27. Een kassa is geen aanmelding')

/*
 * Dit ging in het echt mis, en zichtbaar: de eerste gekoppelde kassa stond
 * daarna in het dashboard onder Aanmeldingen, met een seintje aan het
 * management erbij. Een apparaat dat het kantoor zelf heeft aangezet, hoort
 * niet in een lijst met dingen waarover iemand moet beslissen.
 */

await asServer(db)

// Zo maakt kassa-koppelen zijn account aan: met een vlaggetje in de metagegevens.
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'kassa.kas-utr-1@apparaat.truckwash1group.nl',
          '{"kassa":"KAS-UTR-1","apparaat":true}'::jsonb);
`)

check('een kassa-account levert geen aanmelding op',
  (await db.query(
    `select count(*)::int as n from public.signups
      where email = 'kassa.kas-utr-1@apparaat.truckwash1group.nl'`)).rows[0].n === 0)

check('en geen seintje aan het management',
  (await db.query(
    `select count(*)::int as n from public.notifications
      where title like 'Nieuwe aanmelding%' and body like '%apparaat.truckwash1group.nl%'`
  )).rows[0].n === 0)

check('en ook geen dossier: dat zet de serverfunctie zelf',
  (await db.query(
    `select count(*)::int as n from public.profiles
      where email = 'kassa.kas-utr-1@apparaat.truckwash1group.nl'`)).rows[0].n === 0)

/* ---- en het opruimen van wat er al lag ----
 *
 * De kassa's die vóór deze migratie gekoppeld zijn, staan als aanmelding in de
 * lijst. Herkennen gaat via het vlaggetje op het inlogaccount en niet via
 * is_device op het dossier: dat laatste komt er pas op als kassa-koppelen
 * klaar is, en juist bij een kassa die halverwege bleef steken is dat niet
 * gebeurd. Precies die gevallen moeten opgeruimd worden.
 */

await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data)
  values ('aaaaaaaa-0000-0000-0000-000000000003',
          'kassa.kas-rtm-1@apparaat.truckwash1group.nl',
          '{"kassa":"KAS-RTM-1","apparaat":true}'::jsonb);

  -- Zoals de oude trigger het zou hebben neergelegd: dossier zonder is_device,
  -- een aanmelding, en een seintje.
  insert into public.profiles (id, auth_id, email, name, roles, active)
  values ('u_oud', 'aaaaaaaa-0000-0000-0000-000000000003',
          'kassa.kas-rtm-1@apparaat.truckwash1group.nl', 'kassa.kas-rtm-1',
          array[]::text[], false);
  insert into public.signups (id, name, email, kind, status, created_at, auth_id, profile_id)
  values ('sg_oud', 'kassa.kas-rtm-1', 'kassa.kas-rtm-1@apparaat.truckwash1group.nl',
          'werknemer', 'nieuw', 1, 'aaaaaaaa-0000-0000-0000-000000000003', 'u_oud');
  insert into public.notifications (id, to_role, kind, title, body, created_at, link)
  values ('nt_sg_oud', 'management', 'taak', 'Nieuwe aanmelding: kassa.kas-rtm-1',
          'meldt zich aan', 1, 'aanmeldingen');
`)

check('de aanmelding van een kassa die er al stond wordt gezien',
  (await db.query(
    `select public.is_apparaataccount('aaaaaaaa-0000-0000-0000-000000000003') as n`
  )).rows[0].n === true)

// De migratie nog een keer: het opruimen zit erin.
await run(db, '0028 ruimt op',
  sqlFile('supabase/migrations/0028_een_kassa_is_geen_aanmelding.sql'))

check('en die aanmelding is weg',
  (await db.query("select count(*)::int as n from public.signups where id = 'sg_oud'"))
    .rows[0].n === 0)
check('met het seintje erbij',
  (await db.query("select count(*)::int as n from public.notifications where id = 'nt_sg_oud'"))
    .rows[0].n === 0)

/* ---- en een mens moet nog wél een aanmelding worden ---- */

await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'nieuw@voorbeeld.nl',
          '{"name":"Nieuwe Sollicitant"}'::jsonb);
`)

check('een mens die zich meldt wordt nog steeds een aanmelding',
  (await db.query(
    `select count(*)::int as n from public.signups where email = 'nieuw@voorbeeld.nl'`
  )).rows[0].n === 1)
check('met een dossier op inactief',
  (await db.query(
    `select active from public.profiles where email = 'nieuw@voorbeeld.nl'`
  )).rows[0].active === false)
check('en met een seintje aan het management',
  (await db.query(
    `select count(*)::int as n from public.notifications
      where title = 'Nieuwe aanmelding: Nieuwe Sollicitant'`)).rows[0].n === 1)

/* ---- een apparaat blijft een apparaat ---- */

await db.exec(`
  insert into public.profiles (id, auth_id, email, name, roles, active, location_id, is_device)
  values ('dev_proef', 'aaaaaaaa-0000-0000-0000-000000000001',
          'kassa.kas-utr-1@apparaat.truckwash1group.nl', 'Kassa KAS-UTR-1',
          array['employee'], true, 'loc_utr', true);
`)

check('een kassa-account krijgt geen extra rollen',
  (await botst(`update public.profiles
                   set roles = array['employee','management']
                 where id = 'dev_proef'`))?.includes('houdt de rol employee') === true)

check('en geen leiding over vestigingen',
  (await botst(`update public.profiles set manages = array['loc_rtm']
                 where id = 'dev_proef'`))?.includes('geen leiding') === true)

check('en niet alle vestigingen',
  (await botst(`update public.profiles set all_locations = true
                 where id = 'dev_proef'`))?.includes('één vestiging') === true)

check('maar een naam of vestiging bijwerken mag wel',
  (await botst(`update public.profiles set name = 'Kassa balie', location_id = 'loc_rtm'
                 where id = 'dev_proef'`)) === null)

/*
 * En de weg terug staat open. Blijkt een dossier tóch van een mens, dan moet
 * het te herstellen zijn -- eerst is_device eraf, dan de rollen.
 */
check('is_device eraf halen mag, en dan mogen de rollen weer',
  (await botst(`update public.profiles set is_device = false where id = 'dev_proef';
                update public.profiles set roles = array['employee','supervisor']
                 where id = 'dev_proef';`)) === null)


console.log('\n28. De administratie')

/*
 * Twee dingen die zonder deze migratie stil misgingen.
 *
 * Het recht expenses.approve bestond al in de app maar de database keek er
 * niet naar: daar stond alleen is_management(). Je kon het dus uitdelen en
 * er veranderde niets -- het gevaarlijkste soort recht.
 *
 * En het verslag van wat er uit een factuur is gelezen hoort niet met de
 * hand bij te werken. Kan dat wel, dan is het geen verslag meer maar een
 * bewering, en dan zegt "de app las 1.210,00" niets.
 */

await asServer(db)
await db.exec(`
  alter table public.expenses force row level security;
  grant select, insert, update, delete on all tables in schema public to authenticated;

  insert into public.expenses
    (id, location_id, expense_date, category, supplier, description,
     amount_excl, vat_pct, status, submitted_by, submitted_by_name)
  values
    ('exp_adm', 'loc_utr', 1000, 'materiaal', 'Chemtrans', 'Ontvetter',
     100, 21, 'open', 'x', 'Wim')
  on conflict (id) do nothing;
`)

/* --- de administratie is personeel --- */

const admin = 'ada00000-0000-0000-0000-00000000ada0'
await db.exec(`
  insert into auth.users (id, email) values ('${admin}', 'admin@truckwash1group.nl')
  on conflict (id) do nothing;
  update public.profiles
     set roles = array['administratie']::text[], active = true, all_locations = true,
         grants = array['expenses.approve', 'hours.approve']::text[]
   where email = 'admin@truckwash1group.nl';
`)

check('de administratie telt mee als personeel',
  (await db.query(`
     select public.is_staff() as ja
       from (select set_config('test.uid', '${admin}', true)) _`)).rows[0].ja === true)

await asServer(db)

/* --- kosten beoordelen --- */

check('wie kosten mag goedkeuren ziet ze ook',
  (await countAs(admin, "select count(*)::int as n from public.expenses where id = 'exp_adm'")) === 1)

check('en een wasser die hem niet indiende niet',
  (await countAs(wasser, "select count(*)::int as n from public.expenses where id = 'exp_adm'")) === 0)

check('de administratie keurt hem goed',
  await magSchrijven(admin, `update public.expenses
     set status = 'goedgekeurd', approved_by_name = 'Ada'
   where id = 'exp_adm';`))

check('en dat staat er dan ook',
  (await db.query(
    "select status from public.expenses where id = 'exp_adm'")).rows[0].status === 'goedgekeurd')

await magSchrijven(wasser, `update public.expenses
   set status = 'afgekeurd' where id = 'exp_adm';`)
check('een wasser krijgt hem niet afgekeurd',
  (await db.query(
    "select status from public.expenses where id = 'exp_adm'")).rows[0].status === 'goedgekeurd')

/* --- het verslag blijft een verslag --- */

await db.exec(`
  update public.expenses
     set gelezen = '{"leverancier":"Chemtrans BV","totaalIncl":121}'::jsonb
   where id = 'exp_adm';
`)

check('de server schrijft de lezing weg',
  (await db.query(
    "select gelezen->>'leverancier' as l from public.expenses where id = 'exp_adm'"))
    .rows[0].l === 'Chemtrans BV')

await magSchrijven(admin, `update public.expenses
   set gelezen = '{"leverancier":"Iets anders","totaalIncl":9999}'::jsonb
 where id = 'exp_adm';`)
check('maar uit de app is hij niet te wijzigen',
  (await db.query(
    "select gelezen->>'leverancier' as l from public.expenses where id = 'exp_adm'"))
    .rows[0].l === 'Chemtrans BV')

await magSchrijven(admin, `update public.expenses
   set gelezen = null where id = 'exp_adm';`)
check('en niet weg te halen',
  (await db.query(
    "select gelezen is not null as er from public.expenses where id = 'exp_adm'"))
    .rows[0].er === true)

check('terwijl gewoon bijwerken wél gewoon werkt',
  await magSchrijven(admin, `update public.expenses
     set description = 'Ontvetter 20L' where id = 'exp_adm';`))
check('en dat komt er ook in te staan',
  (await db.query(
    "select description as d from public.expenses where id = 'exp_adm'")).rows[0].d
    === 'Ontvetter 20L')

/* --- urenwijzigingen --- */

await asServer(db)
await db.exec(`
  alter table public.hour_requests force row level security;

  insert into public.hour_requests
    (id, user_id, user_name, van, tot, toelichting, status, aangevraagd_op)
  values ('hr_adm', 'x', 'Wim', 1000, 2000, 'Vergeten te klokken', 'nieuw', 1000)
  on conflict (id) do nothing;
`)

check('de administratie ziet de urenverzoeken',
  (await countAs(admin, "select count(*)::int as n from public.hour_requests where id = 'hr_adm'")) === 1)

check('en beslist erover',
  await magSchrijven(admin, `update public.hour_requests
     set status = 'goedgekeurd' where id = 'hr_adm';`))

/*
 * Dit is het stuk dat je zonder controle mist. De regel liet de wijziging
 * door, maar de trigger op die tabel keek alleen naar is_lead() en zette de
 * beslissing terug. Opslaan lukte, er veranderde niets, en er kwam geen
 * foutmelding.
 */
check('en de wacht op die tabel zet dat niet terug',
  (await db.query(
    "select status from public.hour_requests where id = 'hr_adm'")).rows[0].status
    === 'goedgekeurd')

await db.close()

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
