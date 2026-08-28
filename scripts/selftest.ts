/**
 * Zelftest van de offline-laag. Draait in Node met een nagebootste
 * IndexedDB, zodat de sync-motor echt getest wordt en niet alleen compileert.
 *
 *   npm run selftest
 */

import 'fake-indexeddb/auto'

/* ---- browsertoestand nabootsen -------------------------------------- */

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}

let onLine = true
// navigator is in Node alleen-lezen: eigenschap vervangen i.p.v. toewijzen
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => ({ onLine }),
})
const setOnline = (v: boolean) => { onLine = v }

;(globalThis as any).window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
}

/* ---- test-hulpjes --------------------------------------------------- */

let passed = 0
let failed = 0

function check(name: string, ok: boolean, extra = '') {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`)
  }
}

/* ---- modules ophalen na het opzetten van de globals ------------------ */

const { db } = await import('../src/lib/db')
const { api } = await import('../src/lib/api')
const { setForcedOffline } = await import('../src/lib/api/mockApi')
const { useSync } = await import('../src/lib/sync')
const { jobs, expenses, inventory } = await import('../src/lib/repo')

const sync = () => useSync.getState().sync()

/* ==================================================================== */

console.log('\n1. Eerste synchronisatie vult de lokale cache')
await sync()

const userCount = await db.users.count()
const jobCount = await db.washJobs.count()
const invCount = await db.inventory.count()
const expCount = await db.expenses.count()

check('gebruikers opgehaald', userCount === 8, `kreeg ${userCount}`)
check('wasopdrachten opgehaald', jobCount > 400, `kreeg ${jobCount}`)
check('voorraad opgehaald', invCount === 8, `kreeg ${invCount}`)
check('kostenposten opgehaald', expCount === 46, `kreeg ${expCount}`)
check('geen sync-fout', useSync.getState().lastError === null, String(useSync.getState().lastError))
check('wachtrij leeg', useSync.getState().pending === 0)

/* ==================================================================== */

console.log('\n2. Inloggen')
const good = await api.login('manager@truckwash1group.nl', 'manager')
const badPw = await api.login('manager@truckwash1group.nl', 'fout')
const noUser = await api.login('niemand@nergens.nl', 'x')

check('juist wachtwoord geeft sessie', good?.userId === 'u_manager')
check('fout wachtwoord wordt geweigerd', badPw === null)
check('onbekend account wordt geweigerd', noUser === null)

/* ==================================================================== */

console.log('\n3. Offline schrijven belandt in de wachtrij')
setOnline(false)
setForcedOffline(true)

const company = (await db.companies.toArray())[0]
const created = await jobs.create({
  companyId: company.id,
  companyName: company.name,
  plate: 'test-01',
  service: 'combi',
  scheduledAt: Date.now() + 3_600_000,
  createdBy: 'u_klant',
  discountPct: company.contractDiscountPct,
})

const localJob = await db.washJobs.get(created!.id)
check('afspraak staat direct in de lokale cache', !!localJob)
check('kenteken genormaliseerd', localJob?.plate === 'TEST-01', localJob?.plate)

await expenses.create({
  date: Date.now(),
  category: 'materiaal',
  supplier: 'Zelftest BV',
  description: 'Offline ingediend',
  amountExcl: 123.45,
  vatPct: 21,
  submittedBy: 'u_wasser',
  submittedByName: 'Tom Verhoeven',
})

const item = (await db.inventory.toArray())[0]
const stockBefore = item.stock
await inventory.adjust({
  itemId: item.id,
  qty: -5,
  reason: 'Zelftest verbruik',
  user: { id: 'u_wasser', name: 'Tom Verhoeven' },
})
const stockAfter = (await db.inventory.get(item.id))!.stock

check('voorraad direct bijgewerkt', stockAfter === stockBefore - 5, `${stockBefore} -> ${stockAfter}`)

const queued = await db.outbox.count()
check('wijzigingen staan in de wachtrij', queued === 4, `kreeg ${queued}`)

// een mislukte sync mag de wachtrij niet legen
await sync()
check('offline sync meldt een fout', useSync.getState().lastError !== null)
check('wachtrij blijft intact na mislukte sync', (await db.outbox.count()) === 4)

/* ==================================================================== */

console.log('\n4. Terug online: de wachtrij wordt verstuurd')
setOnline(true)
setForcedOffline(false)
await sync()

check('wachtrij is leeg', (await db.outbox.count()) === 0)
check('geen sync-fout meer', useSync.getState().lastError === null, String(useSync.getState().lastError))

// controleren dat het echt op de "server" staat: een lege client, opnieuw pullen
await db.washJobs.clear()
await db.meta.clear()
useSync.setState({ lastSyncAt: null })
await sync()

const fromServer = await db.washJobs.get(created!.id)
check('afspraak staat op de server', !!fromServer, 'niet teruggevonden na volledige pull')
check('server kent hetzelfde kenteken', fromServer?.plate === 'TEST-01')

/* ==================================================================== */

console.log('\n5. Laatste wijziging wint binnen de wachtrij')
setForcedOffline(true)
setOnline(false)

await jobs.setStatus(created!.id, 'wachtrij')
await jobs.setStatus(created!.id, 'bezig')
await jobs.setStatus(created!.id, 'gereed')

const collapsed = await db.outbox.where('recordId').equals(created!.id).count()
check('drie bewerkingen zijn tot één samengevoegd', collapsed === 1, `kreeg ${collapsed}`)

setForcedOffline(false)
setOnline(true)
await sync()

await db.washJobs.clear()
await db.meta.clear()
useSync.setState({ lastSyncAt: null })
await sync()

const finalJob = await db.washJobs.get(created!.id)
check('eindstatus correct doorgezet', finalJob?.status === 'gereed', finalJob?.status)

/* ==================================================================== */

console.log('\n6. Lokale wijziging wordt niet overschreven door een pull')
setForcedOffline(true)
setOnline(false)
await jobs.update(created!.id, { notes: 'lokaal, nog niet verstuurd' })

setForcedOffline(false)
setOnline(true)
// pull-only afdwingen door de outbox even te parkeren
const parked = await db.outbox.toArray()
check('wijziging staat nog in de wachtrij', parked.length === 1)

await sync()
const merged = await db.washJobs.get(created!.id)
check('notitie overleeft de synchronisatie', merged?.notes === 'lokaal, nog niet verstuurd', merged?.notes)

/* ==================================================================== */

console.log('\n7. Analyse-functies')
const { managementKpis, seriesByDay, staffPerformance, inventoryHealth } =
  await import('../src/lib/analytics')

const allJobs = await db.washJobs.toArray()
const allExp = await db.expenses.toArray()
const allUsers = await db.users.toArray()
const allTime = await db.timeEntries.toArray()
const allInv = await db.inventory.toArray()

const k = managementKpis(allJobs, allExp, 30)
const s = seriesByDay(allJobs, allExp, 30)
const staff = staffPerformance(allUsers, allJobs, allTime, 30)
const health = inventoryHealth(allInv)

check('omzet is positief', k.omzet.value > 0, String(k.omzet.value))
check('kosten zijn positief', k.kosten.value > 0, String(k.kosten.value))
check('marge klopt met omzet minus kosten',
  Math.abs(k.marge.value - (k.omzet.value - k.kosten.value)) < 0.01)
check('grafiekreeks heeft 30 dagen', s.length === 30, String(s.length))
check('reeks telt op tot de omzet-kpi',
  Math.abs(s.reduce((a, b) => a + b.omzet, 0) - k.omzet.value) < 1)
check('personeelsoverzicht gevuld', staff.length === 6, String(staff.length))
check('voorraadwaarde berekend', health.waarde > 0, String(health.waarde))
check('lage voorraad gedetecteerd', Array.isArray(health.low))

/* ==================================================================== */

console.log('\n8. Vertaallaag naar Postgres (Supabase-adapter)')
const { toRow, fromRow } = await import('../src/lib/api/supabaseApi')

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const job = {
  id: 'job_1', ticket: 'W1001', companyId: 'co_jansen', companyName: 'Jansen',
  plate: '12-BND-4', service: 'combi', status: 'gereed',
  assignedTo: 'u_1', assignedName: 'Tom', scheduledAt: 1_700_000_000_000,
  startedAt: 1_700_000_100_000, completedAt: undefined,
  priceExcl: 99, notes: undefined, createdBy: 'u_2', updatedAt: 123,
}
const row = toRow('washJobs', job)

check('camelCase wordt snake_case',
  row.company_id === 'co_jansen' && row.scheduled_at === job.scheduledAt)
check('undefined-velden gaan niet mee',
  !('completed_at' in row) && !('notes' in row))
check('updated_at laat de server zelf zetten', !('updated_at' in row))
check('heen en terug levert hetzelfde op',
  eq(
    fromRow('washJobs', row),
    Object.fromEntries(
      Object.entries(job).filter(([k, v]) => v !== undefined && k !== 'updatedAt'),
    ),
  ))

// Uitzonderingen: "end" is een gereserveerd woord in SQL, "date" een typenaam
const teRow = toRow('timeEntries', { id: 't1', userId: 'u1', start: 10, end: 20, note: 'x' })
check('timeEntries.start wordt started_at', teRow.started_at === 10 && !('start' in teRow))
check('timeEntries.end wordt ended_at', teRow.ended_at === 20 && !('end' in teRow))
check('en weer terug',
  eq(fromRow('timeEntries', teRow), { id: 't1', userId: 'u1', start: 10, end: 20, note: 'x' }))

const expRow = toRow('expenses', { id: 'e1', date: 555, amountExcl: 10, vatPct: 21 })
check('expenses.date wordt expense_date', expRow.expense_date === 555 && !('date' in expRow))
check('en weer terug', (fromRow('expenses', expRow) as Record<string, unknown>).date === 555)

check('null uit Postgres wordt weggelaten',
  !('notes' in fromRow('washJobs', { id: 'j', notes: null, price_excl: 5 })))

/* ==================================================================== */

console.log('\n9. Niet synchroniseren zonder sessie')
// Een echte backend geeft een niet-ingelogde bezoeker niets terug. Zou de app
// dan toch de teller bijzetten, dan denkt hij na het inloggen dat hij bij is
// en blijft de cache leeg -- precies de bug die dit voorkomt.
const { setSyncEnabled, LAST_SYNC } = await import('../src/lib/sync')
const { getMeta, setMeta } = await import('../src/lib/db')

setSyncEnabled(false)
await setMeta(LAST_SYNC, 0)

await jobs.update(created!.id, { notes: 'gemaakt terwijl uitgelogd' })
const queuedWhileLoggedOut = await db.outbox.count()
await sync()

check('sync doet niets zonder sessie', (await db.outbox.count()) === queuedWhileLoggedOut)
check('de teller blijft op nul staan', (await getMeta(LAST_SYNC, -1)) === 0,
  String(await getMeta(LAST_SYNC, -1)))

setSyncEnabled(true)
await sync()

check('na inloggen loopt de wachtrij alsnog leeg', (await db.outbox.count()) === 0)
check('en staat de teller op de servertijd', (await getMeta(LAST_SYNC, 0)) > 0)

// Volledige pull na het inloggen: teller op 0 en de cache moet weer vullen.
await db.washJobs.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('een volledige pull vult de cache opnieuw', (await db.washJobs.count()) > 400,
  String(await db.washJobs.count()))

/* ==================================================================== */

console.log('\n10. Rooster')
const { shifts: shiftRepo } = await import('../src/lib/repo')
const { shiftHours, weekStart, shiftsOnDay, totalHours } = await import('../src/lib/roster')

check('rooster opgehaald', (await db.shifts.count()) > 100, String(await db.shifts.count()))

// maandag 00:00 van deze week
const ws = weekStart(Date.now())
const wsDate = new Date(ws)
check('weekStart geeft maandag 00:00',
  wsDate.getDay() === 1 && wsDate.getHours() === 0 && wsDate.getMinutes() === 0,
  wsDate.toString())

// netto uren: 07:00-15:30 met 30 min pauze = 8 uur
check('uren tellen de pauze eraf',
  shiftHours({
    id: 'x', userId: 'u', userName: '', kind: 'dienst',
    startAt: ws + 7 * 3_600_000, endAt: ws + 15.5 * 3_600_000,
    breakMinutes: 30, createdBy: 'u', updatedAt: 0,
  }) === 8)

check('verlof telt niet als gewerkte uren',
  shiftHours({
    id: 'x', userId: 'u', userName: '', kind: 'verlof',
    startAt: ws, endAt: ws + 86_400_000, breakMinutes: 0, createdBy: 'u', updatedAt: 0,
  }) === 0)

// een dienst inplannen, offline, en kijken of hij aankomt
setForcedOffline(true)
setOnline(false)

const nieuweDienst = await shiftRepo.create({
  user: { id: 'u_wasser', name: 'Tom Verhoeven' },
  kind: 'dienst',
  startAt: ws + 21 * 86_400_000 + 7 * 3_600_000,
  endAt: ws + 21 * 86_400_000 + 15.5 * 3_600_000,
  breakMinutes: 30,
  note: 'Zelftest',
  createdBy: 'u_manager',
})

check('dienst staat direct in de lokale cache', !!(await db.shifts.get(nieuweDienst!.id)))
check('dienst wacht op verzending',
  (await db.outbox.where('recordId').equals(nieuweDienst!.id).count()) === 1)

setForcedOffline(false)
setOnline(true)
await sync()

await db.shifts.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('dienst staat op de server', !!(await db.shifts.get(nieuweDienst!.id)))

// dag- en weektotalen
const tomShifts = (await db.shifts.toArray()).filter((s) => s.userId === 'u_wasser')
const weekVanTom = tomShifts.filter((s) => s.startAt >= ws && s.startAt < ws + 7 * 86_400_000)
check('weektotaal is een redelijk aantal uren',
  totalHours(weekVanTom) >= 0 && totalHours(weekVanTom) <= 60,
  String(totalHours(weekVanTom)))
check('diensten per dag worden gefilterd',
  shiftsOnDay(tomShifts, ws).every((s) => s.startAt >= ws && s.startAt < ws + 86_400_000))

// verwijderen moet ook op de server doorkomen
await shiftRepo.remove(nieuweDienst!.id)
check('lokaal verwijderd', !(await db.shifts.get(nieuweDienst!.id)))
await sync()
await db.shifts.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('ook op de server verwijderd', !(await db.shifts.get(nieuweDienst!.id)))

/* ==================================================================== */

console.log('\n11. Medewerker toevoegen')
const { users: userRepo } = await import('../src/lib/repo')

const nieuw = await userRepo.create({
  name: 'Testpersoon Zelftest',
  email: 'Test.Persoon@Truckwash1group.NL',
  roles: ['employee'],
  personnelNumber: 'TW-999',
  phone: '06-11111111',
  function: 'Wasmedewerker',
  hourlyRate: 21.5,
  contractHours: 32,
  startDate: Date.now(),
})

check('e-mailadres wordt genormaliseerd',
  nieuw!.email === 'test.persoon@truckwash1group.nl', nieuw!.email)
check('nog geen inlogaccount gekoppeld', nieuw!.authId === undefined)
check('personeelsvelden bewaard',
  nieuw!.personnelNumber === 'TW-999' && nieuw!.contractHours === 32)

await sync()
await db.users.clear()
await setMeta(LAST_SYNC, 0)
await sync()

const opgehaald = await db.users.get(nieuw!.id)
check('medewerker staat op de server', !!opgehaald)
check('functie overleeft de rondgang', opgehaald?.function === 'Wasmedewerker', opgehaald?.function)

/* ==================================================================== */

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
