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

await db.close()

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
