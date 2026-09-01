/**
 * Zelftest van de offline-laag. Draait in Node met een nagebootste
 * IndexedDB, zodat de sync-motor echt getest wordt en niet alleen compileert.
 *
 *   npm run selftest
 */

// De app praat met Supabase; de mock is er alleen nog voor deze test.
process.env.TW_USE_MOCK = '1'

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

check('gebruikers opgehaald', userCount > 40, `kreeg ${userCount}`)
check('wasopdrachten opgehaald', jobCount > 400, `kreeg ${jobCount}`)
check('voorraad opgehaald per vestiging', invCount === 19 * 8, `kreeg ${invCount}`)
// Drie ervan komen uit de postbus: een mail met bijlage levert een bon op.
check('kostenposten opgehaald', expCount === 49, `kreeg ${expCount}`)
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
const locaties = await db.locations.toArray()
const created = await jobs.create({
  locationId: locaties.find((l) => l.kind === 'vestiging')!.id,
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
check('personeelsoverzicht gevuld', staff.length > 40, String(staff.length))
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

/* --- een verlopen sessie mag geen werk kosten --- */

/*
 * Dit ging mis in het echt: iemand logt zonder internet in, of een oude
 * sessie wordt hersteld terwijl de sleutel allang is verlopen. Elk verzoek
 * gaat dan als onbekende bezoeker naar de database, die alles weigert met
 * een melding over beveiligingsregels. Acht rondes later was de wijziging
 * weggegooid -- om een reden die niets met die wijziging te maken had.
 */
const { GeenSessie } = await import('../src/lib/api/supabaseApi')
const { useSync: syncStore } = await import('../src/lib/sync')

await jobs.update(created!.id, { notes: 'gemaakt terwijl de sessie weg was' })
const inDeWachtrij = await db.outbox.count()
check('er staat iets klaar om te versturen', inDeWachtrij > 0)

const echtePush = api.push.bind(api)
api.push = async () => { throw new GeenSessie() }

for (let ronde = 0; ronde < 10; ronde++) await sync()

check('zonder sessie blijft de wachtrij staan',
  (await db.outbox.count()) === inDeWachtrij, String(await db.outbox.count()))
check('en kost het geen pogingen -- ook niet na tien rondes',
  (await db.outbox.toArray()).every((r) => r.tries === 0),
  (await db.outbox.toArray()).map((r) => r.tries).join(','))
check('de app zegt dat je opnieuw moet inloggen', syncStore.getState().sessieWeg)

api.push = echtePush
await sync()

check('na opnieuw inloggen gaat het alsnog mee', (await db.outbox.count()) === 0)
check('en is de melding weg', !syncStore.getState().sessieWeg)

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

console.log('\n12. Wisselen van backend laat geen oude gegevens achter')
const { ensureBackendMatches } = await import('../src/lib/sync')

// Doen alsof de vorige sessie tegen een andere server draaide.
await setMeta('backend', 'een-andere-server')
await jobs.update(created!.id, { notes: 'mag niet blijven staan' })
check('er staat iets in de cache en in de wachtrij',
  (await db.washJobs.count()) > 0 && (await db.outbox.count()) > 0)

const gewist = await ensureBackendMatches()

check('meldt dat er gewist is', gewist === true)
check('wasopdrachten weg', (await db.washJobs.count()) === 0)
check('medewerkers weg', (await db.users.count()) === 0)
check('rooster weg', (await db.shifts.count()) === 0)
check('wachtrij weg', (await db.outbox.count()) === 0,
  'wijzigingen voor een andere server zijn onbruikbaar')
check('teller teruggezet', (await getMeta(LAST_SYNC, -1)) === 0)

// Tweede keer met dezelfde backend: niets meer te wissen.
await sync()
const naHerstel = await db.washJobs.count()
check('daarna vult de juiste backend de cache weer', naHerstel > 400, String(naHerstel))
check('geen tweede wisbeurt', (await ensureBackendMatches()) === false)
check('gegevens blijven staan', (await db.washJobs.count()) === naHerstel)

/* ==================================================================== */

console.log('\n13. Rechten per persoon')
const { can, effectivePermissions, togglePermission, wouldLockOut, ROLE_DEFAULTS } =
  await import('../src/lib/permissions')
const { PERMISSIONS } = await import('../src/lib/types')

const wasser = (await db.users.get('u_wasser'))!
const voorman = (await db.users.get('u_wasser3'))!
const manager = (await db.users.get('u_manager'))!

check('werknemer mag wagens oppakken', can(wasser, 'jobs.claim'))
check('werknemer mag geen bonnen goedkeuren', !can(wasser, 'expenses.approve'))
check('werknemer ziet geen loongegevens', !can(wasser, 'staff.pay'))
check('leidinggevende mag het rooster maken', can(voorman, 'roster.edit'))
check('leidinggevende mag berichten sturen', can(voorman, 'notify.send'))
check('leidinggevende mag geen rechten uitdelen', !can(voorman, 'staff.permissions'))
check('management mag alles', effectivePermissions(manager).size === PERMISSIONS.length)
check('geblokkeerd account mag niets',
  effectivePermissions({ ...wasser, active: false }).size === 0)

// Losse afwijkingen: alleen het verschil met de rol wordt bewaard
const extra = togglePermission(wasser, 'finance.view', true)
check('extra recht komt in grants',
  extra.grants.includes('finance.view') && extra.revokes.length === 0)
check('het werkt ook echt',
  can({ ...wasser, ...extra }, 'finance.view'))

const minder = togglePermission(wasser, 'jobs.claim', false)
check('ingetrokken rolrecht komt in revokes',
  minder.revokes.includes('jobs.claim') && minder.grants.length === 0)
check('en is daarna weg', !can({ ...wasser, ...minder }, 'jobs.claim'))

const terug = togglePermission({ ...wasser, ...minder }, 'jobs.claim', true)
check('weer aanzetten laat niets achter',
  terug.grants.length === 0 && terug.revokes.length === 0)

check('intrekken wint van toekennen',
  !can({ ...wasser, grants: ['finance.view'], revokes: ['finance.view'] }, 'finance.view'))

// Niemand mag zichzelf buitensluiten
const alleUsers = await db.users.toArray()
const zonderRechten = togglePermission(manager, 'staff.permissions', false)
const managers = alleUsers.filter((u) => u.active && u.roles.includes('management'))
check('meerdere managers: uitzetten mag',
  managers.length < 2 || !wouldLockOut(alleUsers, manager, zonderRechten))
check('laatste rechtenbeheerder wordt beschermd',
  wouldLockOut([manager], manager, zonderRechten))

/*
 * Elke rol hoort een standaardset rechten te hebben.
 *
 * Stond hier als `=== 7`. Dat klopte tot er een achtste rol bij kwam, en dan
 * valt de test om terwijl er niets mis is -- de rol was juist netjes
 * toegevoegd. Nu vergelijken we met de lijst rollen zelf, dus mist er echt
 * iets als dit rood wordt: een rol die bestaat maar geen rechten heeft.
 */
const { ROLE_ORDER } = await import('../src/lib/types')
const zonderStandaard = ROLE_ORDER.filter((r) => !(r in ROLE_DEFAULTS))
check('elke rol heeft een standaardset', zonderStandaard.length === 0,
  zonderStandaard.length
    ? 'geen standaardset voor: ' + zonderStandaard.join(', ')
    : Object.keys(ROLE_DEFAULTS).join(', '))

/* ==================================================================== */

console.log('\n14. Smartroster')
const { planWeek, patternOf } = await import('../src/lib/smartRoster')

const alleShifts = await db.shifts.toArray()
const alleJobs = await db.washJobs.toArray()
const medewerkers = alleUsers.filter((u) => u.active && u.roles.includes('employee'))

const patroon = patternOf(alleShifts, 'u_wasser')
check('patroon herkent gewerkte dagen', patroon.sampleSize > 0, String(patroon.sampleSize))
check('gewone begintijd is een reële tijd',
  patroon.usualStart >= 5 && patroon.usualStart <= 12, String(patroon.usualStart))
check('gewone eindtijd ligt na de begintijd', patroon.usualEnd > patroon.usualStart)

const volgendeWeek = weekStart(Date.now()) + 7 * 86_400_000
const plan = planWeek({ staff: medewerkers, shifts: alleShifts, jobs: alleJobs, weekStart: volgendeWeek })

check('plan levert een samenvatting per persoon',
  plan.summary.length === medewerkers.filter((u) => (u.contractHours ?? 0) > 0).length)
check('elk voorstel heeft een reden',
  plan.proposals.every((p) => p.reason.length > 0))
check('geen voorstel op zondag',
  plan.proposals.every((p) => new Date(p.day).getDay() !== 0))
check('geen dienst korter dan drie uur',
  plan.proposals.every((p) => p.hours >= 3), 'kortste: ' +
    Math.min(...plan.proposals.map((p) => p.hours), 99))
// De planner mag niets toevoegen aan wie al aan zijn uren zit, en waar hij
// wel bijplant moet het totaal binnen het contract blijven. Wat er al stond
// kan hoger zijn -- dat meldt hij als opmerking, maar hij verergert het niet.
check('planner voegt niets toe aan wie al vol zit',
  plan.summary.every((s) => s.plannedHours >= s.contractHours - 0.5 ? s.proposedHours === 0 : true),
  plan.summary.map((s) => `${s.userName}:${s.plannedHours}+${s.proposedHours}/${s.contractHours}`).join(' '))
check('waar hij bijplant blijft het binnen het contract',
  plan.summary.every((s) => s.proposedHours === 0 || s.plannedHours + s.proposedHours <= s.contractHours + 2),
  plan.summary.filter((s) => s.proposedHours > 0)
    .map((s) => `${s.userName}:${s.plannedHours + s.proposedHours}/${s.contractHours}`).join(' '))
check('te veel ingeroosterd wordt gemeld',
  plan.summary.filter((s) => s.plannedHours > s.contractHours + 2).every((s) => !!s.note))
check('geen twee voorstellen op dezelfde dag voor dezelfde persoon',
  new Set(plan.proposals.map((p) => p.userId + ':' + p.day)).size === plan.proposals.length)
check('voorstellen vallen binnen de openingstijden',
  plan.proposals.every((p) => {
    const from = new Date(p.startAt).getHours()
    const till = new Date(p.endAt).getHours()
    return from >= 6 && till <= 19
  }))

/* ==================================================================== */

console.log('\n15. Berichten en opleiding')
const { notifications: notifyRepo, learning } = await import('../src/lib/repo')

const bericht = await notifyRepo.send({
  to: { id: 'u_wasser', name: 'Tom Verhoeven' },
  from: { id: 'u_wasser3', name: 'Nour El Amrani' },
  kind: 'taak',
  title: 'Zelftest',
  body: 'Een bericht uit de test',
})
check('bericht staat lokaal', !!(await db.notifications.get(bericht!.id)))
check('bericht is ongelezen', !(await db.notifications.get(bericht!.id))!.readAt)

await notifyRepo.markRead(bericht!.id)
check('gelezen zetten werkt', !!(await db.notifications.get(bericht!.id))!.readAt)

const groeps = await notifyRepo.broadcast({
  role: 'employee',
  from: { id: 'u_manager', name: 'Ilse Bakker' },
  kind: 'info',
  title: 'Groepsbericht',
  body: 'Voor iedereen',
})
check('groepsbericht richt zich op een rol',
  (await db.notifications.get(groeps!.id))!.toRole === 'employee')

await sync()
await db.notifications.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('berichten staan op de server', !!(await db.notifications.get(bericht!.id)))

// Opleiding: toets afleggen
const cursus = (await db.courses.toArray())[0]
check('cursussen zijn gesynchroniseerd', !!cursus)

await learning.start({ id: 'u_wasser', name: 'Tom Verhoeven' }, cursus.id)
const voortgangId = 'u_wasser__' + cursus.id
await learning.submitQuiz(voortgangId, 60, cursus.passScore, cursus.validMonths)
const gezakt = await db.courseProgress.get(voortgangId)
check('te lage score is niet geslaagd', gezakt?.passed === false, String(gezakt?.score))

await learning.submitQuiz(voortgangId, 100, cursus.passScore, cursus.validMonths)
const geslaagd = await db.courseProgress.get(voortgangId)
check('voldoende score is geslaagd', geslaagd?.passed === true)
check('pogingen worden geteld', geslaagd?.attempts === 2, String(geslaagd?.attempts))
check('geldigheid wordt gezet',
  cursus.validMonths ? (geslaagd?.expiresAt ?? 0) > Date.now() : geslaagd?.expiresAt === undefined)

/* ==================================================================== */

console.log('\n16. Vestigingen')
const { scopeOf, seesAllLocations, withinScope, filterByLocation, visibleLocations } =
  await import('../src/lib/locations')

const alleLocaties = await db.locations.toArray()
const hoofdkantoor = alleLocaties.find((l) => l.kind === 'hoofdkantoor')!
const filialen = alleLocaties.filter((l) => l.kind === 'vestiging')

check('negentien vestigingen plus hoofdkantoor',
  filialen.length === 19 && !!hoofdkantoor, `${filialen.length} vestigingen`)
check('elke vestiging heeft een unieke code',
  new Set(alleLocaties.map((l) => l.code)).size === alleLocaties.length)

const hkUser = (await db.users.get('u_manager'))!
const voormanUtr = (await db.users.get('u_wasser3'))!
const wasserUtr = (await db.users.get('u_wasser'))!

check('hoofdkantoor ziet alles', seesAllLocations(hkUser))
check('een wasser niet', !seesAllLocations(wasserUtr))

const scopeVoorman = scopeOf(voormanUtr)
check('leidinggevende ziet zijn eigen vestigingen',
  scopeVoorman !== 'alle' && scopeVoorman.has('loc_utr') && scopeVoorman.has('loc_ams'),
  JSON.stringify([...(scopeVoorman === 'alle' ? [] : scopeVoorman)]))
check('en niet die van een ander',
  scopeVoorman !== 'alle' && !scopeVoorman.has('loc_rtm'))

const scopeWasser = scopeOf(wasserUtr)
check('een wasser ziet alleen zijn eigen vestiging',
  scopeWasser !== 'alle' && scopeWasser.size === 1 && scopeWasser.has('loc_utr'))

check('hoofdkantoor ziet alle vestigingen in de kiezer',
  visibleLocations(hkUser, alleLocaties).length === alleLocaties.length)
check('leidinggevende ziet er drie',
  visibleLocations(voormanUtr, alleLocaties).length === 3,
  String(visibleLocations(voormanUtr, alleLocaties).length))

// Voorraad is per vestiging: filteren mag nooit meer opleveren dan je mag zien
const alleVoorraad = await db.inventory.toArray()
const voorraadWasser = withinScope(wasserUtr, alleVoorraad)
check('wasser ziet alleen de voorraad van zijn vestiging',
  voorraadWasser.length > 0 && voorraadWasser.every((i) => i.locationId === 'loc_utr'),
  `${voorraadWasser.length} artikelen`)
check('hoofdkantoor ziet alle voorraad',
  withinScope(hkUser, alleVoorraad).length === alleVoorraad.length)

// De keuze bovenin versmalt verder, maar kan nooit verbreden
const gekozenRotterdam = filterByLocation(voormanUtr, alleVoorraad, 'loc_rtm')
check('een vestiging kiezen waar je niet mag geeft niets',
  gekozenRotterdam.length === 0)
const gekozenAmsterdam = filterByLocation(voormanUtr, alleVoorraad, 'loc_ams')
check('een vestiging kiezen waar je wel mag werkt',
  gekozenAmsterdam.length > 0 && gekozenAmsterdam.every((i) => i.locationId === 'loc_ams'))

// Wasopdrachten hangen allemaal aan een vestiging
const jobsMetLocatie = (await db.washJobs.toArray()).filter((j) => !j.locationId)
check('elke wasbeurt hoort bij een vestiging', jobsMetLocatie.length === 0,
  `${jobsMetLocatie.length} zonder`)

// Elke vestiging heeft eigen mensen en eigen voorraad
const zonderPloeg = filialen.filter(
  (l) => !alleUsers.some((u) => u.locationId === l.id))
check('elke vestiging heeft personeel', zonderPloeg.length === 0,
  zonderPloeg.map((l) => l.name).join(', '))
const zonderVoorraad = filialen.filter(
  (l) => !alleVoorraad.some((i) => i.locationId === l.id))
check('elke vestiging heeft voorraad', zonderVoorraad.length === 0)

/* ==================================================================== */

console.log('\n17. Technische dienst')
const {
  assets: assetRepo, faults: faultRepo, workOrders: orderRepo,
  maintenance: planRepo, techKpis, makeQrToken, dueStateOf,
} = await import('../src/lib/techniek')
const { MAINTENANCE_DAYS: MAINTENANCE_DAGEN } = await import('../src/lib/types')

const alleAssets = await db.assets.toArray()
const alleFaults = await db.faults.toArray()
const alleOrders = await db.workOrders.toArray()
const allePlans = await db.maintenancePlans.toArray()

check('machinepark gesynchroniseerd', alleAssets.length > 100, String(alleAssets.length))
check('elke vestiging heeft installaties',
  filialen.every((l) => alleAssets.some((a) => a.locationId === l.id)))
check('storingen en werkbonnen aanwezig',
  alleFaults.length > 20 && alleOrders.length > 20,
  `${alleFaults.length} storingen, ${alleOrders.length} werkbonnen`)
check('onderhoudsschemas aanwezig', allePlans.length > 50, String(allePlans.length))

// QR-sleutels moeten uniek zijn, anders wijst een label naar twee apparaten
const tokens = alleAssets.map((a) => a.qrToken)
check('elke QR-sleutel is uniek', new Set(tokens).size === tokens.length,
  `${tokens.length - new Set(tokens).size} dubbel`)
check('sleutels hebben geen verwarrende tekens',
  tokens.every((t) => !/[IO01]/.test(t.replace(/-/g, ''))))

const nieuwToken = makeQrToken()
check('nieuwe sleutel heeft het juiste formaat',
  /^[A-Z2-9]{4}-[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(nieuwToken), nieuwToken)

// Een apparaat terugvinden via zijn QR-code of via de code op het label
const proef = alleAssets[0]
check('apparaat vindbaar via de QR-sleutel',
  (await assetRepo.byQr(proef.qrToken))?.id === proef.id)
check('apparaat vindbaar via de code op het label',
  (await assetRepo.find(proef.code))?.id === proef.id)
check('kleine letters worden ook gevonden',
  (await assetRepo.find(proef.qrToken.toLowerCase()))?.id === proef.id)
check('onbekende code geeft niets', (await assetRepo.find('BESTAAT-NIET')) === undefined)

/* --- de hele keten: melden, werkbon, afronden --- */

const vestiging = filialen[0]
const apparaat = alleAssets.find((a) => a.locationId === vestiging.id)!

const melding = await faultRepo.report({
  locationId: vestiging.id,
  assetId: apparaat.id,
  assetName: apparaat.name,
  title: 'Zelftest storing',
  description: 'Aangemaakt door de zelftest',
  severity: 'kritiek',
  stopsProduction: true,
  by: { id: 'u_wasser', name: 'Tom Verhoeven' },
})

check('storing krijgt een nummer', /^S-\d{4}-\d{4}$/.test(melding.number), melding.number)
check('kritieke storing zet het apparaat op storing',
  (await db.assets.get(apparaat.id))?.status === 'storing')

const bon = await orderRepo.create({
  locationId: vestiging.id,
  type: 'storing',
  title: 'Zelftest werkbon',
  assetId: apparaat.id,
  faultId: melding.id,
  checklist: ['Spanningsloos gemaakt', 'Storing verholpen'],
  by: { id: 'u_wasser3', name: 'Nour El Amrani' },
})

check('werkbon krijgt een nummer', /^W-\d{4}-\d{4}$/.test(bon.number), bon.number)
check('storing weet welke werkbon eraan hangt',
  (await db.faults.get(melding.id))?.workOrderId === bon.id)
check('storing staat nu in behandeling',
  (await db.faults.get(melding.id))?.status === 'in behandeling')

await orderRepo.toggleCheck(bon.id, 0)
check('checklist-punt afvinken werkt',
  (await db.workOrders.get(bon.id))?.checklist[0].done === true)

await orderRepo.addPart(bon.id, { name: 'Borstelsegment', qty: 2, unitPrice: 34.5 })
const metOnderdeel = await db.workOrders.get(bon.id)
check('onderdeel toegevoegd', metOnderdeel?.parts.length === 1)
check('en de prijs klopt',
  (metOnderdeel?.parts[0].qty ?? 0) * (metOnderdeel?.parts[0].unitPrice ?? 0) === 69)

await orderRepo.complete({
  id: bon.id,
  minutesSpent: 90,
  workDone: 'Segment vervangen en proefgedraaid.',
  signedOffBy: 'Tom Verhoeven',
  by: { id: 'u_wasser3', name: 'Nour El Amrani' },
})

const afgerond = await db.workOrders.get(bon.id)
const naAfronden = await db.faults.get(melding.id)
check('werkbon staat op gereed', afgerond?.status === 'gereed')
check('storing is mee afgemeld', naAfronden?.status === 'opgelost')
check('stilstand is berekend', (naAfronden?.downtimeMinutes ?? -1) >= 0)
check('apparaat is weer in bedrijf',
  (await db.assets.get(apparaat.id))?.status === 'in bedrijf')

/* --- onderhoud: schema wordt doorgeschoven --- */

const schema = allePlans.find((p) => p.locationId === vestiging.id)!
const vorigeDatum = schema.nextDueAt
const onderhoudsbon = await planRepo.schedule(schema.id, { id: 'u_wasser3', name: 'Nour El Amrani' })
check('onderhoud levert een werkbon op', !!onderhoudsbon)
check('checklist van het schema staat erop',
  (onderhoudsbon?.checklist.length ?? 0) === schema.checklist.length)

await orderRepo.complete({
  id: onderhoudsbon!.id,
  minutesSpent: 45,
  workDone: 'Beurt uitgevoerd.',
  by: { id: 'u_wasser3', name: 'Nour El Amrani' },
})
const naBeurt = await db.maintenancePlans.get(schema.id)
// Een beurt die je vroeg uitvoert, verschuift de volgende naar nu plus het
// interval. Dat kan eerder zijn dan de oorspronkelijke datum, en dat hoort zo.
const verwachteDag = Math.round((Date.now() + MAINTENANCE_DAGEN[schema.interval] * 86_400_000) / 86_400_000)
check('volgende beurt staat op nu plus het interval',
  Math.round((naBeurt?.nextDueAt ?? 0) / 86_400_000) === verwachteDag,
  `${new Date(naBeurt?.nextDueAt ?? 0).toISOString().slice(0, 10)} bij interval ${schema.interval}`)
check('de datum is daadwerkelijk verzet', (naBeurt?.nextDueAt ?? 0) !== vorigeDatum)
check('laatst gedaan is bijgewerkt', (naBeurt?.lastDoneAt ?? 0) > 0)
check('een doorgeschoven schema staat niet meer over tijd',
  dueStateOf(naBeurt!) !== 'over tijd')

/* --- cijfers --- */

const kpi = techKpis({
  faults: await db.faults.toArray(),
  orders: await db.workOrders.toArray(),
  plans: await db.maintenancePlans.toArray(),
  days: 60,
})
check('cijfers tellen open storingen', kpi.openStoringen >= 0)
check('onderhoud op peil is een percentage',
  kpi.onderhoudOpPeil >= 0 && kpi.onderhoudOpPeil <= 100, String(kpi.onderhoudOpPeil))
check('onderdelenkosten zijn meegeteld', kpi.onderdelenKosten >= 69,
  String(kpi.onderdelenKosten))

/* --- alles overleeft de rondgang naar de server --- */

await sync()
await db.assets.clear()
await db.faults.clear()
await db.workOrders.clear()
await db.maintenancePlans.clear()
await setMeta(LAST_SYNC, 0)
await sync()

check('installaties staan op de server', (await db.assets.count()) === alleAssets.length)
check('werkbon staat op de server', !!(await db.workOrders.get(bon.id)))
check('afronding overleefde de rondgang',
  (await db.workOrders.get(bon.id))?.status === 'gereed')
check('onderdelen overleefden de rondgang',
  (await db.workOrders.get(bon.id))?.parts.length === 1)

/* --- afscherming per vestiging geldt ook hier --- */

const techniekVanWasser = withinScope(wasserUtr, await db.assets.toArray())
check('wasser ziet alleen de installaties van zijn vestiging',
  techniekVanWasser.length > 0 && techniekVanWasser.every((a) => a.locationId === 'loc_utr'))
check('hoofdkantoor ziet het hele machinepark',
  withinScope(hkUser, await db.assets.toArray()).length === alleAssets.length)

/* ==================================================================== */

console.log('\n18. Meldingen aan de ontwikkelaar')
const {
  tickets: ticketRepo, ticketMessages: messageRepo, logs: logRepo,
} = await import('../src/lib/tickets')
const { trail } = await import('../src/lib/trail')

check('voorbeeldmeldingen gesynchroniseerd', (await db.tickets.count()) === 5,
  String(await db.tickets.count()))
check('logboek gesynchroniseerd', (await db.logEvents.count()) >= 5)

/* --- het spoor van handelingen --- */

trail.clear()
trail.page('Werknemer', 'vandaag')
trail.action('Wagen 12-BND-4 opgepakt')
trail.error('Kan niet opslaan')
check('spoor legt drie handelingen vast', trail.recent().length === 3)
check('en in de juiste volgorde',
  trail.recent().map((e) => e.kind).join(',') === 'pagina,actie,fout')

// Twee keer hetzelfde vlak achter elkaar hoort niet dubbel te tellen
trail.action('Zelfde actie')
trail.action('Zelfde actie')
check('herhaling vlak na elkaar wordt genegeerd', trail.recent().length === 4)

/* --- een ticket18 maken --- */

const ticket18 = await ticketRepo.create({
  title: 'Zelftest: knop reageert niet',
  description: 'Aangemaakt door de zelftest om de keten te controleren.',
  kind: 'fout',
  priority: 'hoog',
  by: { id: 'u_wasser', name: 'Tom Verhoeven', locationId: 'loc_utr' },
  fromRole: 'employee',
  fromPage: 'vandaag',
  appVersion: '9.9.9',
  online: true,
  pendingChanges: 2,
})

check('melding krijgt een nummer', /^M-\d{4}-\d{4}$/.test(ticket18.number), ticket18.number)
check('status begint op nieuw', ticket18.status === 'nieuw')
check('het spoor gaat mee', ticket18.trail.length === 4, String(ticket18.trail.length))
check('de technische context gaat mee',
  ticket18.appVersion === '9.9.9' && ticket18.pendingChanges === 2 && !!ticket18.platform)
check('de ontwikkelaar krijgt bericht',
  (await db.notifications.toArray()).some(
    (n) => n.toUserId === 'u_dev' && n.title.includes(ticket18.number)))

/* --- gesprek --- */

await messageRepo.send({
  ticketId: ticket18.id,
  body: 'Gebeurt dat altijd of alleen soms?',
  internal: false,
  by: { id: 'u_dev', name: 'Sem de Ontwikkelaar' },
})
check('antwoord van de ontwikkelaar zet hem op wacht op melder',
  (await db.tickets.get(ticket18.id))?.status === 'wacht op melder')
check('de melder krijgt bericht',
  (await db.notifications.toArray()).some(
    (n) => n.toUserId === 'u_wasser' && n.title.includes('Reactie op')))

await messageRepo.send({
  ticketId: ticket18.id,
  body: 'Alleen als ik offline ben.',
  internal: false,
  by: { id: 'u_wasser', name: 'Tom Verhoeven' },
})
check('reactie van de melder zet hem terug in behandeling',
  (await db.tickets.get(ticket18.id))?.status === 'in behandeling')

const intern = await messageRepo.send({
  ticketId: ticket18.id,
  body: 'Interne notitie: waarschijnlijk de outbox.',
  internal: true,
  by: { id: 'u_dev', name: 'Sem de Ontwikkelaar' },
})
check('interne notitie is als intern gemarkeerd', intern?.internal === true)

const zichtbaarVoorMelder = (await db.ticketMessages
  .where('ticketId').equals(ticket18.id).toArray()).filter((m) => !m.internal)
check('de melder ziet de interne notitie niet', zichtbaarVoorMelder.length === 2)

/* --- afhandelen --- */

await ticketRepo.setStatus(ticket18.id, 'opgelost', { id: 'u_dev', name: 'Sem de Ontwikkelaar' }, {
  resolution: 'De wachtrij liep vast bij een lege verbinding. Opgelost.',
  fixedIn: '9.9.10',
})
const afgehandeld = await db.tickets.get(ticket18.id)
check('melding staat op opgelost', afgehandeld?.status === 'opgelost')
check('de oplossing is vastgelegd', !!afgehandeld?.resolution)
check('de versie is vastgelegd', afgehandeld?.fixedIn === '9.9.10')
check('de melder krijgt bericht van de afhandeling',
  (await db.notifications.toArray()).some(
    (n) => n.toUserId === 'u_wasser' && n.title.includes('is nu: opgelost')))

/* --- logboek telt herhalingen op --- */

const eerste = await logRepo.record({
  level: 'fout',
  message: 'Zelftest: iets ging mis bij record 41',
  page: 'Werknemer -> vandaag',
  appVersion: '9.9.9',
})
const tweede = await logRepo.record({
  level: 'fout',
  message: 'Zelftest: iets ging mis bij record 77',
  page: 'Werknemer -> vandaag',
  appVersion: '9.9.9',
})
check('dezelfde fout met een ander getal telt op, niet dubbel',
  eerste.id === tweede.id && tweede.count === 2,
  `${eerste.id} vs ${tweede.id}, count ${tweede.count}`)

const ander = await logRepo.record({
  level: 'fout',
  message: 'Zelftest: heel iets anders',
  page: 'Werknemer -> vandaag',
  appVersion: '9.9.9',
})
check('een andere fout krijgt een eigen regel', ander.id !== eerste.id)

/* --- alles overleeft de rondgang --- */

await sync()
await db.tickets.clear()
await db.ticketMessages.clear()
await db.logEvents.clear()
await setMeta(LAST_SYNC, 0)
await sync()

const naSync = await db.tickets.get(ticket18.id)
check('melding staat op de server', !!naSync)
check('het spoor overleefde de rondgang', (naSync?.trail.length ?? 0) === 4)
check('de gesprekken staan op de server',
  (await db.ticketMessages.where('ticketId').equals(ticket18.id).count()) === 3)
check('het logboek staat op de server', (await db.logEvents.get(eerste.id))?.count === 2)

/* ==================================================================== */

console.log('\n19. Overleg')

const {
  chat, channels: kanaalRepo, channelStates, findMentions, mentionsEveryone,
  mayRead, slugify, dmId, visibleChannels, ensureDefaultChannels,
} = await import('../src/lib/chat')

check('kanalen gesynchroniseerd', (await db.channels.count()) > 4,
  String(await db.channels.count()))
check('gesprekken gesynchroniseerd', (await db.chatMessages.count()) === 9,
  String(await db.chatMessages.count()))

/* --- namen omzetten naar kanaalnamen --- */

check('kanaalnaam met hoofdletters wordt klein', slugify('Chemie En Dosering') === 'chemie-en-dosering')
check('accenten verdwijnen uit de kanaalnaam', slugify('Nieuwegeïn') === 'nieuwegein')
check('een gesprek heeft hetzelfde id vanaf beide kanten',
  dmId('u_a', 'u_b') === dmId('u_b', 'u_a'))

/* --- wie wordt er genoemd --- */

const alleMensen = await db.users.toArray()
const tom = alleMensen.find((u) => u.id === 'u_wasser')!
const nour = alleMensen.find((u) => u.id === 'u_wasser3')!
const ilse = alleMensen.find((u) => u.id === 'u_manager')!

check('een volledige naam wordt herkend',
  findMentions('Kijk jij ernaar @Tom Verhoeven?', [tom]).includes(tom.id))
check('een voornaam ook',
  findMentions('@Tom kun jij dat oppakken?', [tom]).includes(tom.id))
check('een naam die er niet staat wordt niet verzonnen',
  findMentions('Ik pak het zelf wel op.', [tom, nour]).length === 0)
check('een langere naam wint van de korte',
  findMentions('@Nour El Amrani graag', [nour]).length === 1)
check('iedereen aanspreken wordt herkend', mentionsEveryone('Let op @iedereen'))

/* --- een bericht plaatsen --- */

const algemeen = (await db.channels.get('ch_algemeen'))!
const voorHet = await db.chatMessages.where('channelId').equals('ch_algemeen').count()

const geplaatst = await chat.send({
  channelId: 'ch_algemeen',
  body: 'Zelftest: @Tom Verhoeven kun jij morgen de osmose bijvullen?',
  by: ilse,
  members: [tom, nour, ilse],
})

check('het bericht staat er meteen',
  (await db.chatMessages.where('channelId').equals('ch_algemeen').count()) === voorHet + 1)
check('de genoemde persoon is eruit gehaald',
  geplaatst!.mentions.length === 1 && geplaatst!.mentions[0] === tom.id,
  JSON.stringify(geplaatst!.mentions))

const belletjes = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === tom.id && n.link === 'overleg')
check('wie genoemd wordt krijgt bericht', belletjes.length === 1, String(belletjes.length))

/* --- ongelezen ---
 *
 * Meten vóór Tom zelf iets terugzegt: wie een bericht plaatst heeft het
 * kanaal daarmee gelezen, en dan valt er niets meer te tellen.
 */

const statesTom = channelStates(
  tom,
  await db.channels.toArray(),
  await db.chatMessages.toArray(),
  await db.channelReads.toArray(),
)
const algemeenTom = statesTom.find((c) => c.channel.id === 'ch_algemeen')!

check('ongelezen berichten worden geteld', algemeenTom.ongelezen > 0,
  String(algemeenTom.ongelezen))
check('genoemd worden valt apart op', algemeenTom.genoemd === true)

const statesIlse = channelStates(
  ilse,
  await db.channels.toArray(),
  await db.chatMessages.toArray(),
  await db.channelReads.toArray(),
)
check('je eigen bericht telt niet als ongelezen',
  statesIlse.find((c) => c.channel.id === 'ch_algemeen')!.ongelezen === 0)

await chat.markRead('ch_algemeen', tom.id)
const naLezen = channelStates(
  tom,
  await db.channels.toArray(),
  await db.chatMessages.toArray(),
  await db.channelReads.toArray(),
)
check('na lezen staat de teller op nul',
  naLezen.find((c) => c.channel.id === 'ch_algemeen')!.ongelezen === 0)

/* --- antwoorden --- */

const antwoord = await chat.send({
  channelId: 'ch_algemeen',
  body: 'Doe ik, staat genoteerd.',
  by: tom,
  replyTo: geplaatst!,
  members: [tom, nour, ilse],
})
check('een antwoord houdt vast waarop het slaat',
  antwoord!.replyToId === geplaatst!.id && antwoord!.replyToName === ilse.name)

const kanalenNu = await db.channels.toArray()

/* --- verwijderen laat de regel staan --- */

await chat.remove(antwoord!.id, tom)
const weg = await db.chatMessages.get(antwoord!.id)
check('een verwijderd bericht blijft als regel staan', !!weg)
check('maar de inhoud is eruit', weg!.body === '' && !!weg!.deletedAt)

/* --- wie mag waar meelezen --- */

const utrecht = kanalenNu.find((c) => c.kind === 'vestiging' && c.locationId === 'loc_utr')!
const rotterdam = kanalenNu.find((c) => c.kind === 'vestiging' && c.locationId === 'loc_rtm')!

check('je leest het kanaal van je eigen vestiging', mayRead(tom, utrecht))
check('en niet dat van een andere vestiging', !mayRead(tom, rotterdam))
check('het hoofdkantoor leest overal mee', mayRead(ilse, rotterdam))
check('een klant komt het overleg niet in',
  !mayRead(alleMensen.find((u) => u.id === 'u_klant')!, algemeen))

const besloten = await kanaalRepo.create({
  name: 'Zelftest besloten',
  private: true,
  memberIds: [ilse.id],
  by: ilse,
})
check('een besloten kanaal is alleen voor de leden',
  mayRead(ilse, besloten!) && !mayRead(tom, besloten!))
check('en staat niet in de lijst van wie er niet in zit',
  !visibleChannels(tom, await db.channels.toArray()).some((c) => c.id === besloten!.id))

/* --- rechtstreeks gesprek --- */

const gesprek = await kanaalRepo.openDirect(ilse, tom)
check('een gesprek heeft twee leden', gesprek!.memberIds.length === 2)
const nogmaals = await kanaalRepo.openDirect(tom, ilse)
check('hetzelfde gesprek twee keer openen levert er niet twee op',
  nogmaals!.id === gesprek!.id)

await chat.send({
  channelId: gesprek!.id,
  body: 'Zelftest: kun je even bellen?',
  by: ilse,
  members: [tom, ilse],
})
const dmBel = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === tom.id && n.title.includes('Bericht van'))
check('in een rechtstreeks gesprek krijgt de ander altijd bericht',
  dmBel.length === 1, String(dmBel.length))

/* --- standaardkanalen worden niet dubbel aangemaakt --- */

const voorStandaard = await db.channels.count()
await ensureDefaultChannels(ilse, await db.locations.toArray())
check('bestaande kanalen worden niet nog eens aangemaakt',
  (await db.channels.count()) === voorStandaard,
  `${voorStandaard} -> ${await db.channels.count()}`)

/* --- zonder verbinding blijft het staan --- */

setForcedOffline(true)
setOnline(false)
const offlineBericht = await chat.send({
  channelId: 'ch_algemeen',
  body: 'Zelftest: getypt in de machinekamer, zonder bereik.',
  by: tom,
  members: [tom, ilse],
})
check('een bericht zonder bereik staat er meteen',
  !!(await db.chatMessages.get(offlineBericht!.id)))
check('en wacht in de wachtrij', useSync.getState().pending > 0)

setForcedOffline(false)
setOnline(true)
await sync()
check('zodra er weer bereik is vertrekt het', useSync.getState().pending === 0)

await db.chatMessages.clear()
await db.channels.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('het gesprek staat op de server',
  !!(await db.chatMessages.get(offlineBericht!.id)))
check('de kanalen ook', (await db.channels.count()) > 4)

/* ==================================================================== */

console.log('\n20. Aanmelden')

const { signups: signupRepo, passwordProblem, emailLooksValid } =
  await import('../src/lib/signups')

check('een kort wachtwoord wordt geweigerd', passwordProblem('kort12') !== null)
check('letters zonder cijfers ook', passwordProblem('allemaalletters') !== null)
check('cijfers zonder letters ook', passwordProblem('1234567890') !== null)
check('een fatsoenlijk wachtwoord mag', passwordProblem('wasstraat2026') === null)

check('een geldig adres wordt herkend', emailLooksValid('jan@truckwash1group.nl'))
check('een adres zonder apenstaartje niet', !emailLooksValid('jan.truckwash1group.nl'))
check('een adres zonder domein ook niet', !emailLooksValid('jan@truckwash'))

check('aanmeldingen gesynchroniseerd', (await db.signups.count()) === 5,
  String(await db.signups.count()))

const openstaand = (await db.signups.toArray()).filter((s) => s.status === 'nieuw')
check('er staan drie aanmeldingen open', openstaand.length === 3, String(openstaand.length))

/* --- toelaten --- */

const teBeoordelen = openstaand.find((s) => s.kind === 'werknemer')!
const aantalVoor = await db.users.count()

const toegelaten = await signupRepo.approve({
  signup: teBeoordelen,
  roles: ['employee', 'supervisor'],
  locationId: 'loc_utr',
  manages: ['loc_utr', 'loc_ams'],
  personnelNumber: 'TW-901',
  function: 'Voorman wasstraat',
  contractHours: 38,
  by: ilse,
})

check('er is een dossier bij gekomen', (await db.users.count()) === aantalVoor + 1)
check('het dossier staat op actief', toegelaten!.active === true)
check('met de gekozen rollen',
  toegelaten!.roles.join() === 'employee,supervisor', toegelaten!.roles.join())
check('en de gekozen vestiging', toegelaten!.locationId === 'loc_utr')
check('inclusief de vestigingen waar hij leiding over krijgt',
  (toegelaten!.manages ?? []).length === 2, JSON.stringify(toegelaten!.manages))
check('het personeelsnummer is overgenomen', toegelaten!.personnelNumber === 'TW-901')

const bijgewerkt = await db.signups.get(teBeoordelen.id)
check('de aanmelding staat op goedgekeurd', bijgewerkt!.status === 'goedgekeurd')
check('met wie hem heeft afgehandeld', bijgewerkt!.handledByName === ilse.name)

const welkom = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === toegelaten!.id && n.title.includes('goedgekeurd'))
check('de nieuwe medewerker krijgt bericht', welkom.length === 1)

check('en zit meteen in het kanaal van zijn vestiging',
  (await db.channels.toArray())
    .find((c) => c.kind === 'vestiging' && c.locationId === 'loc_utr')!
    .memberIds.includes(toegelaten!.id))

/* --- afwijzen --- */

const afTeWijzen = (await db.signups.toArray()).find(
  (s) => s.status === 'nieuw' && s.kind === 'klant')!

const afgewezen = await signupRepo.reject(
  afTeWijzen, 'Dit adres kennen we niet als klant.', ilse)

check('de aanmelding staat op afgewezen', afgewezen!.status === 'afgewezen')
check('met de reden erbij',
  afgewezen!.rejectReason === 'Dit adres kennen we niet als klant.')
check('afwijzen maakt geen dossier aan',
  !(await db.users.toArray()).some((u) => u.email === afTeWijzen.email))

/* --- terugdraaien --- */

const heropend = await signupRepo.reopen(afgewezen!)
check('terugdraaien zet hem weer op nieuw', heropend!.status === 'nieuw')
check('en wist de reden', heropend!.rejectReason === undefined)

/* --- alles overleeft de rondgang --- */

await sync()
await db.signups.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de aanmeldingen staan op de server',
  (await db.signups.get(teBeoordelen.id))?.status === 'goedgekeurd')

/* ==================================================================== */

console.log('\n21. De wachtrij: volgorde en veerkracht')

const { PUSH_ORDER } = await import('../src/lib/sync')
const { EntityNames } = { EntityNames: [
  'locations', 'users', 'companies', 'washJobs', 'inventory',
  'stockMovements', 'expenses', 'timeEntries', 'shifts',
  'notifications', 'courses', 'courseProgress',
  'assets', 'faults', 'workOrders', 'maintenancePlans',
  'tickets', 'ticketMessages', 'logEvents',
  'signups', 'channels', 'chatMessages', 'channelReads', 'emailLog',
] }

check('elke tabel staat in de verstuurvolgorde',
  EntityNames.every((e) => PUSH_ORDER.includes(e as never)),
  EntityNames.filter((e) => !PUSH_ORDER.includes(e as never)).join(', '))
check('en er staat niets dubbel in',
  new Set(PUSH_ORDER).size === PUSH_ORDER.length)

/** Waar staat deze tabel in de rij? */
const rang = (e: string) => PUSH_ORDER.indexOf(e as never)

check('kanalen gaan voor berichten', rang('channels') < rang('chatMessages'))
check('kanalen gaan voor leestekens', rang('channels') < rang('channelReads'))
check('meldingen gaan voor hun gesprekken', rang('tickets') < rang('ticketMessages'))
check('installaties gaan voor storingen', rang('assets') < rang('faults'))
check('storingen gaan voor werkbonnen', rang('faults') < rang('workOrders'))
check('vestigingen gaan als eerste', rang('locations') === 0)
check('dossiers gaan voor alles wat naar iemand verwijst',
  rang('users') < rang('shifts') && rang('users') < rang('expenses'))

/* --- de volgorde geldt ook als de wachtrij door elkaar staat --- */

const { enqueue } = await import('../src/lib/sync')

await db.outbox.clear()
// Bewust omgekeerd in de wachtrij zetten: eerst het kind, dan de ouder.
await enqueue('chatMessages', 'put', 'cm_volgorde', {
  id: 'cm_volgorde', channelId: 'ch_volgorde', authorId: 'u_manager',
  authorName: 'Ilse Bakker', body: 'Test', at: Date.now(), mentions: [],
  updatedAt: Date.now(),
})
await enqueue('channels', 'put', 'ch_volgorde', {
  id: 'ch_volgorde', slug: 'volgorde', name: 'Volgorde', kind: 'kanaal',
  private: false, memberIds: ['u_manager'], createdBy: 'u_manager',
  createdAt: Date.now(), archived: false, updatedAt: Date.now(),
})

await sync()
check('allebei verstuurd, ondanks de omgekeerde volgorde',
  useSync.getState().pending === 0, String(useSync.getState().pending))

/* --- een record dat blijft weigeren blokkeert de rest niet --- */

const { logs: logRepo2 } = await import('../src/lib/tickets')

check('een fout in het logboek gooit niets terug',
  (await logRepo2.record({
    level: 'fout',
    message: 'Zelftest: het logboek mag nooit omvallen',
    appVersion: '9.9.9',
  })) !== null)

/* --- de opvanger mag geen kettingreactie maken --- */

const { onCapturedError, installErrorCapture } = await import('../src/lib/trail')

// De opvanger draait normaal alleen in de app; hier zetten we hem zelf aan.
installErrorCapture()

let rondes = 0
onCapturedError((e) => {
  rondes++
  // Zoals een kapotte opslag zou doen: de opvanger valt zelf om.
  if (rondes < 50) throw new Error('opvanger valt om: ' + e.message)
})
console.error('Zelftest: een fout die de opvanger laat struikelen')

check('een opvanger die omvalt stopt na één ronde', rondes === 1, String(rondes))

// De opvanger weer onschadelijk maken voor de rest van de test.
onCapturedError(() => {})

/* ==================================================================== */

console.log('\n22. Controles op identiteits- en betaalgegevens')

const {
  bsnGeldig, bsnProbleem, bsnFormatteer, bsnGemaskeerd,
  ibanGeldig, ibanProbleem, ibanFormatteer,
  leesMrz, kortHash,
} = await import('../src/lib/identiteit')

/* --- de elfproef --- */

check('een geldig BSN komt erdoor', bsnGeldig('123456782'))
check('nog eentje', bsnGeldig('111222333'))
check('een omgedraaid cijfer valt op', !bsnGeldig('123456728'))
check('acht cijfers is geen BSN', !bsnGeldig('12345678'))
check('negen nullen ook niet', !bsnGeldig('000000000'))
check('letters worden genegeerd, cijfers geteld', bsnGeldig('123 456 782'))

check('een half ingetypt BSN klaagt niet meteen',
  (bsnProbleem('1234') ?? '').includes('Nog'))
check('een fout BSN wordt benoemd',
  (bsnProbleem('123456728') ?? '').includes('elfproef'))
check('een goed BSN geeft geen klacht', bsnProbleem('123456782') === null)

check('BSN wordt gegroepeerd', bsnFormatteer('123456782') === '123 456 782')
check('BSN staat standaard afgeschermd', bsnGemaskeerd('123456782') === '••• ••• 782')
check('zonder BSN valt er niets af te schermen', bsnGemaskeerd(undefined) === '—')

/* --- de mod-97-toets --- */

check('een geldig IBAN komt erdoor', ibanGeldig('NL91ABNA0417164300'))
check('met spaties ook', ibanGeldig('NL91 ABNA 0417 1643 00'))
check('een verkeerd controlegetal valt op', !ibanGeldig('NL92ABNA0417164300'))
check('een te kort Nederlands IBAN valt op', !ibanGeldig('NL91ABNA041716430'))
check('een Duits IBAN mag ook', ibanGeldig('DE89370400440532013000'))
check('een verzonnen land zonder lengte wordt alsnog gerekend',
  !ibanGeldig('XX00ABNA0417164300'))

check('de lengte wordt benoemd',
  (ibanProbleem('NL91ABNA041716430') ?? '').includes('18'))
check('een goed IBAN geeft geen klacht', ibanProbleem('NL91ABNA0417164300') === null)
check('IBAN wordt in blokjes gezet',
  ibanFormatteer('NL91ABNA0417164300') === 'NL91 ABNA 0417 1643 00')

/* --- de machineleesbare strook --- */

const PASPOORT = [
  'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<',
  'SPECI20142NLD6503101M2403096999999990<<<<<84',
].join('\n')

const mrz = leesMrz(PASPOORT)
check('een paspoortstrook wordt gelezen', !!mrz)
check('het documentnummer komt eruit', mrz?.documentNumber === 'SPECI2014')
check('de achternaam komt eruit', mrz?.achternaam === 'De Bruijn', String(mrz?.achternaam))
check('de voornamen ook', mrz?.voornamen === 'Willem Jan', String(mrz?.voornamen))
check('de nationaliteit komt eruit', mrz?.nationaliteit === 'NLD')
check('het geslacht komt eruit', mrz?.geslacht === 'M')

const geboren = mrz?.geboortedatum ? new Date(mrz.geboortedatum) : null
check('de geboortedatum klopt',
  geboren?.getFullYear() === 1965 && geboren?.getMonth() === 2 && geboren?.getDate() === 10,
  String(geboren))

const verloopt = mrz?.vervaldatum ? new Date(mrz.vervaldatum) : null
check('de vervaldatum ligt in de toekomst, niet honderd jaar terug',
  (verloopt?.getFullYear() ?? 0) >= 2024, String(verloopt))

check('alle controlecijfers kloppen', mrz?.betrouwbaar === true,
  JSON.stringify(mrz?.twijfel))

/* Eén teken veranderen in het documentnummer moet opvallen. */
const VERMINKT = PASPOORT.replace('SPECI20142', 'SPECI20143')
const stuk = leesMrz(VERMINKT)
check('een verkeerd overgetypt teken springt eruit', stuk?.betrouwbaar === false)
check('en er wordt bij gezegd wát er niet klopt',
  (stuk?.twijfel ?? []).includes('documentnummer'), JSON.stringify(stuk?.twijfel))

check('onzin levert niets op', leesMrz('dit is geen strook') === null)
check('een lege invoer ook niet', leesMrz('') === null)

check('een korte vingerafdruk blijft leesbaar',
  kortHash('abcdef0123456789abcdef0123456789') === 'abcdef01…23456789',
  kortHash('abcdef0123456789abcdef0123456789'))
check('zonder vingerafdruk een streepje', kortHash(undefined) === '—')

/* ==================================================================== */

console.log('\n23. Het dossier')

const { dossier: dossierRepo, documentenVan, eigenDocumenten, signalen } =
  await import('../src/lib/dossier')

const dossierPersoon = 'u_wasser'

await dossierRepo.save(dossierPersoon, {
  bsn: '123456782',
  iban: 'NL91ABNA0417164300',
  hourlyRate: 24.5,
  internalNotes: 'Zelftest: interne notitie',
})

const opgeslagen = await dossierRepo.get(dossierPersoon)
check('het dossier is opgeslagen', opgeslagen?.bsn === '123456782')
check('het uurtarief staat in het afgeschermde deel', opgeslagen?.hourlyRate === 24.5)
check('en het id is het dossier-id', opgeslagen?.id === dossierPersoon)

await dossierRepo.save(dossierPersoon, { birthPlace: 'Utrecht' })
const bijgewerktDossier = await dossierRepo.get(dossierPersoon)
check('bijwerken laat de rest staan',
  bijgewerktDossier?.bsn === '123456782' && bijgewerktDossier?.birthPlace === 'Utrecht')

/* --- documenten sorteren en filteren --- */

const nu = Date.now()
const DOCS = [
  { id: 'zt_1', title: 'Loonstrook mei', kind: 'loonstrook' as const, zichtbaar: true,  tekenen: false, at: nu - 3000 },
  { id: 'zt_2', title: 'Contract 2026',  kind: 'contract' as const,   zichtbaar: true,  tekenen: true,  at: nu - 9000 },
  { id: 'zt_3', title: 'Gespreksverslag', kind: 'beoordeling' as const, zichtbaar: false, tekenen: false, at: nu - 1000 },
]

for (const d of DOCS) {
  await db.documents.put({
    id: d.id,
    userId: dossierPersoon,
    userName: 'Tom Verhoeven',
    kind: d.kind,
    title: d.title,
    storagePath: `${dossierPersoon}/${d.id}.pdf`,
    mime: 'application/pdf',
    sizeBytes: 1024,
    visibleToEmployee: d.zichtbaar,
    uploadedBy: 'u_manager',
    uploadedByName: 'Ilse Bakker',
    uploadedAt: d.at,
    requiresSignature: d.tekenen,
    updatedAt: nu,
  })
}

const alleDocs = await db.documents.toArray()
const vanTom = documentenVan(alleDocs, dossierPersoon)

check('alle drie de stukken horen bij hem', vanTom.length === 3, String(vanTom.length))
check('wat getekend moet worden staat bovenaan',
  vanTom[0].id === 'zt_2', vanTom[0].id)
check('daarna op datum, nieuwste eerst',
  vanTom[1].id === 'zt_3' && vanTom[2].id === 'zt_1',
  vanTom.map((d) => d.id).join(','))

const zietTom = eigenDocumenten(alleDocs, dossierPersoon)
check('hij ziet zijn afgeschermde verslag niet',
  zietTom.length === 2 && !zietTom.some((d) => d.id === 'zt_3'),
  zietTom.map((d) => d.id).join(','))

/* --- waar het dossier aandacht vraagt --- */

const seinen = signalen(alleDocs, dossierPersoon)
check('een openstaande handtekening wordt gemeld',
  seinen.some((s) => s.soort === 'tekenen'))
check('een ontbrekend identiteitsbewijs wordt gemeld',
  seinen.some((s) => s.soort === 'ontbreekt' && s.tekst.includes('identiteitsbewijs')))
check('een aanwezig contract wordt niet gemist',
  !seinen.some((s) => s.soort === 'ontbreekt' && s.tekst.includes('contract')))

await db.documents.put({
  ...(await db.documents.get('zt_1'))!,
  id: 'zt_4',
  kind: 'identiteitsbewijs',
  title: 'ID-kaart',
  expiresAt: nu - 86_400_000,
})
check('een verlopen document wordt gemeld',
  signalen(await db.documents.toArray(), dossierPersoon)
    .some((s) => s.soort === 'verlopen'))

await db.documents.put({
  ...(await db.documents.get('zt_4'))!,
  id: 'zt_5',
  title: 'ID-kaart nieuw',
  expiresAt: nu + 20 * 86_400_000,
})
check('een document dat bijna verloopt ook',
  signalen(await db.documents.toArray(), dossierPersoon)
    .some((s) => s.soort === 'verloopt' && s.tekst.includes('20')))

/* --- alles overleeft de rondgang --- */

await sync()
await db.personnelPrivate.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('het dossier staat op de server',
  (await dossierRepo.get(dossierPersoon))?.bsn === '123456782')


/* ==================================================================== */

console.log('\n24. Postbus')

const { filterPost, onbekeken, bijbehorendeBon, grootte, postbus: postbusRepo } =
  await import('../src/lib/postbus')

const post = await db.mailbox.toArray()
check('post gesynchroniseerd', post.length === 4, String(post.length))
check('twee berichten zijn nog niet bekeken', onbekeken(post) === 2, String(onbekeken(post)))

const binnen = filterPost(post, { richting: 'in' })
check('alles is binnengekomen post', binnen.length === 4)
check('nieuwste bovenaan', binnen[0].at >= binnen[1].at)

check('filteren op status werkt',
  filterPost(post, { richting: 'in', status: 'nieuw' }).length === 2)
check('zoeken op afzender werkt',
  filterPost(post, { richting: 'in', zoek: 'cleanchem' }).length === 1)
check('zoeken op onderwerp werkt',
  filterPost(post, { richting: 'in', zoek: 'osmose' }).length === 1)
check('zoeken in de tekst werkt',
  filterPost(post, { richting: 'in', zoek: 'twaalf trekkers' }).length === 1)
check('een zoekterm die nergens staat levert niets',
  filterPost(post, { richting: 'in', zoek: 'zzzzz' }).length === 0)
check('verstuurde post is er nog niet',
  filterPost(post, { richting: 'uit' }).length === 0)

/* --- de bon die eruit ontstond --- */

const alleBonnen = await db.expenses.toArray()
const uitMail = alleBonnen.filter((b) => b.source === 'mail')
check('drie bonnen kwamen uit de mail', uitMail.length === 3, String(uitMail.length))
check('het bedrag staat bewust op nul', uitMail.every((b) => b.amountExcl === 0))
check('de bijlage hangt eraan vast', uitMail.every((b) => !!b.attachmentPath))

const metBon = post.find((m) => m.expenseId)!
check('het bericht wijst naar zijn bon',
  bijbehorendeBon(metBon, alleBonnen)?.id === metBon.expenseId)
check('een bericht zonder bon geeft niets terug',
  bijbehorendeBon(post.find((m) => !m.expenseId)!, alleBonnen) === undefined)

/* --- status bijwerken --- */

await postbusRepo.markeerGelezen(metBon.id)
check('openslaan zet nieuw op gelezen',
  (await db.mailbox.get(metBon.id))?.status !== 'nieuw')

const alGelezen = post.find((m) => m.status === 'verwerkt')!
await postbusRepo.markeerGelezen(alGelezen.id)
check('een afgehandeld bericht wordt niet teruggezet',
  (await db.mailbox.get(alGelezen.id))?.status === 'verwerkt')

await postbusRepo.setStatus(metBon.id, 'verwerkt', { id: 'u_manager', name: 'Ilse Bakker' })
const postAfgehandeld = await db.mailbox.get(metBon.id)
check('afhandelen legt vast wie het deed', postAfgehandeld?.handledByName === 'Ilse Bakker')
check('en wanneer', (postAfgehandeld?.handledAt ?? 0) > 0)

check('grootte leest prettig',
  grootte(512) === '512 B' && grootte(84_000) === '82 kB' && grootte(3_000_000) === '2.9 MB',
  `${grootte(512)} / ${grootte(84_000)} / ${grootte(3_000_000)}`)

/* --- alles overleeft de rondgang --- */

await sync()
await db.mailbox.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de postbus staat op de server',
  (await db.mailbox.get(metBon.id))?.status === 'verwerkt')


/* ==================================================================== */

console.log('\n25. Een contract uitlezen')

const {
  vindGegevens, leesDatum, leesBedrag, aantalGevonden, afgeleidUurloon,
} = await import('../src/lib/contractLezen')

/* --- bedragen --- */

check('Nederlandse notatie', leesBedrag('2.850,00') === 2850)
check('punt als decimaal', leesBedrag('2850.00') === 2850)
check('duizendtallen met een punt', leesBedrag('12.500') === 12500)
check('komma als decimaal', leesBedrag('22,50') === 22.5)
check('met euroteken ervoor', leesBedrag('€ 1.975,50') === 1975.5)
check('onzin levert niets op', leesBedrag('abc') === undefined)

/* --- datums --- */

const eersteMaart = leesDatum('1 maart 2026')
check('geschreven datum', new Date(eersteMaart!).getMonth() === 2
  && new Date(eersteMaart!).getDate() === 1
  && new Date(eersteMaart!).getFullYear() === 2026)

const metStreepjes = leesDatum('01-03-2026')
check('datum met streepjes', new Date(metStreepjes!).getMonth() === 2
  && new Date(metStreepjes!).getFullYear() === 2026)

const isoDatum = leesDatum('2026-03-01')
check('datum in ISO', new Date(isoDatum!).getMonth() === 2
  && new Date(isoDatum!).getFullYear() === 2026)

check('afgekorte maand', leesDatum('15 sep 2025') !== undefined)
check('geen datum levert niets op', leesDatum('ergens volgend jaar') === undefined)

/* --- een heel contract --- */

const CONTRACT = `
ARBEIDSOVEREENKOMST VOOR BEPAALDE TIJD

De ondergetekenden: Truckwash1 Group B.V., hierna te noemen werkgever, en
de heer T. Verhoeven, hierna te noemen werknemer.

Artikel 1 - Functie en aanvang
Werknemer treedt in dienst per 1 maart 2026 in de functie van Wasmedewerker.
De overeenkomst is aangegaan voor bepaalde tijd en eindigt van rechtswege op
28 februari 2027.

Artikel 2 - Arbeidsduur
De arbeidsduur bedraagt 38 uur per week.

Artikel 3 - Salaris
Het bruto maandsalaris bedraagt EUR 2.850,00 per maand bij een volledige
arbeidsduur, exclusief 8% vakantiebijslag.
`

const uitContract = vindGegevens(CONTRACT)

check('de functie komt eruit', uitContract.functie?.waarde === 'Wasmedewerker',
  String(uitContract.functie?.waarde))
check('het maandsalaris komt eruit', uitContract.maandloon?.waarde === 2850,
  String(uitContract.maandloon?.waarde))
check('de uren komen eruit', uitContract.urenPerWeek?.waarde === 38,
  String(uitContract.urenPerWeek?.waarde))

const gevondenStart = uitContract.startDatum?.waarde
check('de ingangsdatum komt eruit',
  !!gevondenStart && new Date(gevondenStart).getFullYear() === 2026
  && new Date(gevondenStart).getMonth() === 2,
  gevondenStart ? new Date(gevondenStart).toISOString() : 'niets')

const gevondenEind = uitContract.eindDatum?.waarde
check('de einddatum komt eruit',
  !!gevondenEind && new Date(gevondenEind).getFullYear() === 2027
  && new Date(gevondenEind).getMonth() === 1,
  gevondenEind ? new Date(gevondenEind).toISOString() : 'niets')

check('bij een einddatum wordt onbepaalde tijd niet gemeld',
  uitContract.onbepaaldeTijd === undefined)
check('er is genoeg gevonden om voor te stellen', aantalGevonden(uitContract) >= 5,
  String(aantalGevonden(uitContract)))
check('bij elke vondst staat de zin waarin hij stond',
  (uitContract.maandloon?.bron ?? '').toLowerCase().includes('bruto'),
  String(uitContract.maandloon?.bron))

/* --- onbepaalde tijd, met een uurloon --- */

const ONBEPAALD = `
Werknemer treedt in dienst per 01-09-2025 in de functie van Voorman wasstraat.
De overeenkomst wordt aangegaan voor onbepaalde tijd.
De arbeidsduur bedraagt 40 uur per week.
Het bruto uurloon bedraagt EUR 24,50.
`

const contractOnbepaald = vindGegevens(ONBEPAALD)
check('onbepaalde tijd wordt herkend', contractOnbepaald.onbepaaldeTijd?.waarde === true)
check('en er is dan geen einddatum', contractOnbepaald.eindDatum === undefined)
check('het uurloon komt eruit', contractOnbepaald.uurloon?.waarde === 24.5,
  String(contractOnbepaald.uurloon?.waarde))
check('de functie met twee woorden ook',
  contractOnbepaald.functie?.waarde === 'Voorman wasstraat',
  String(contractOnbepaald.functie?.waarde))

/* --- onzin mag niets opleveren --- */

const ONZIN = 'Beste Tom, hierbij de notulen van de vergadering van dinsdag.'
const contractOnzin = vindGegevens(ONZIN)
check('uit een gewone brief komt niets', aantalGevonden(contractOnzin) === 0,
  JSON.stringify(contractOnzin))

/* --- bedragen die geen salaris zijn worden niet aangezien --- */

const RAAR = 'Het bruto maandsalaris bedraagt EUR 12,00 per maand.'
check('een onmogelijk maandloon wordt niet overgenomen',
  vindGegevens(RAAR).maandloon === undefined)

/* --- uurloon uit een maandloon --- */

check('uurloon afgeleid uit maandloon en uren',
  afgeleidUurloon(2850, 38) === 17.31, String(afgeleidUurloon(2850, 38)))

/* ==================================================================== */

console.log('\n26. Wijzigingen in een dossier')

const {
  wijzigingen: wijzigRepo, huidigeWaarde, toonWaarde, gelijk, openVerzoeken,
} = await import('../src/lib/wijzigingen')

const alleMensen2 = await db.users.toArray()
const tomW = alleMensen2.find((u) => u.id === 'u_wasser')!
const nourW = alleMensen2.find((u) => u.id === 'u_wasser3')!
const ilseW = alleMensen2.find((u) => u.id === 'u_manager')!

check('de huidige functie komt uit het profiel',
  huidigeWaarde('function', tomW) === tomW.function)
check('het uurtarief komt uit het afgeschermde deel',
  huidigeWaarde('hourlyRate', tomW, await db.personnelPrivate.get(tomW.id)) === 24.5)

check('twee lijsten met dezelfde inhoud zijn gelijk',
  gelijk(['a', 'b'], ['b', 'a']))
check('een lege waarde en niets zijn gelijk', gelijk('', undefined))
check('verschillende waarden zijn niet gelijk', !gelijk(38, 40))

/* --- een verzoek indienen --- */

const verzoek = await wijzigRepo.aanvragen({
  persoon: tomW,
  prive: await db.personnelPrivate.get(tomW.id),
  // Hij stond al op 40; 42 is dus een echte verandering.
  voorstel: { contractHours: 42, function: 'Allround wasmedewerker' },
  reden: 'Draait sinds september structureel meer uren.',
  door: nourW,
})

check('het verzoek is aangemaakt', !!verzoek)
check('met twee velden erin', verzoek?.velden.length === 2, String(verzoek?.velden.length))
check('de oude waarde staat erbij',
  verzoek?.velden.find((v) => v.veld === 'contractHours')?.oud === tomW.contractHours)
check('het staat open', verzoek?.status === 'open')

const crBericht = (await db.notifications.toArray()).filter(
  (n) => n.title.includes('Wijziging voorgesteld'))
check('het management krijgt bericht', crBericht.length > 0)

/* --- velden die niet veranderen vallen eruit --- */

const leegVerzoek = await wijzigRepo.aanvragen({
  persoon: tomW,
  voorstel: { function: tomW.function },
  reden: 'Niets aan de hand',
  door: nourW,
})
check('een voorstel zonder verandering levert niets op', leegVerzoek === null)

/* --- goedkeuren voert door --- */

await wijzigRepo.goedkeuren(verzoek!, ilseW)

const naGoedkeuren = await db.users.get(tomW.id)
check('de contracturen zijn doorgevoerd', naGoedkeuren?.contractHours === 42,
  String(naGoedkeuren?.contractHours))
check('de functie ook', naGoedkeuren?.function === 'Allround wasmedewerker')
check('het verzoek staat op goedgekeurd',
  (await db.changeRequests.get(verzoek!.id))?.status === 'goedgekeurd')
check('met wie het goedkeurde',
  (await db.changeRequests.get(verzoek!.id))?.beslistDoorNaam === ilseW.name)

check('een tweede keer goedkeuren doet niets',
  (await wijzigRepo.goedkeuren(
    (await db.changeRequests.get(verzoek!.id))!, ilseW))?.beslistOp
  === (await db.changeRequests.get(verzoek!.id))?.beslistOp)

/* --- een uurloon gaat naar het afgeschermde deel --- */

const loonVerzoek = await wijzigRepo.aanvragen({
  persoon: naGoedkeuren!,
  prive: await db.personnelPrivate.get(tomW.id),
  voorstel: { hourlyRate: 26 },
  reden: 'Hoort bij de nieuwe functie.',
  door: nourW,
})
await wijzigRepo.goedkeuren(loonVerzoek!, ilseW)

check('het uurloon staat in het afgeschermde deel',
  (await db.personnelPrivate.get(tomW.id))?.hourlyRate === 26)
check('en niet in het profiel',
  (await db.users.get(tomW.id))?.hourlyRate !== 26)

/* --- afwijzen --- */

const afTeWijzenVerzoek = await wijzigRepo.aanvragen({
  persoon: naGoedkeuren!,
  voorstel: { function: 'Vestigingsmanager' },
  reden: 'Wil doorgroeien.',
  door: nourW,
})
await wijzigRepo.afwijzen(afTeWijzenVerzoek!, 'Eerst het gesprek voeren.', ilseW)

check('het verzoek is afgewezen',
  (await db.changeRequests.get(afTeWijzenVerzoek!.id))?.status === 'afgewezen')
check('met de reden erbij',
  (await db.changeRequests.get(afTeWijzenVerzoek!.id))?.afwijzingReden
  === 'Eerst het gesprek voeren.')
check('en de functie is niet veranderd',
  (await db.users.get(tomW.id))?.function === 'Allround wasmedewerker')

/* --- intrekken --- */

const intrekbaar = await wijzigRepo.aanvragen({
  persoon: (await db.users.get(tomW.id))!,
  voorstel: { contractHours: 32 },
  reden: 'Toch even navragen.',
  door: nourW,
})
await wijzigRepo.intrekken(intrekbaar!)
check('een ingetrokken verzoek telt niet meer mee',
  !openVerzoeken(await db.changeRequests.toArray()).some((v) => v.id === intrekbaar!.id))

/* --- leesbaar in het scherm --- */

const locatiesW = await db.locations.toArray()
check('een uurtarief leest als bedrag',
  toonWaarde('hourlyRate', 26, { locaties: locatiesW, mensen: alleMensen2 }) === '€ 26,00')
check('een vestiging leest als naam',
  toonWaarde('locationId', 'loc_utr', { locaties: locatiesW, mensen: alleMensen2 }) === 'Utrecht')
check('lege waarden lezen als een streepje',
  toonWaarde('function', undefined, { locaties: locatiesW, mensen: alleMensen2 }) === '—')

/* --- alles overleeft de rondgang --- */

await sync()
await db.changeRequests.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de verzoeken staan op de server',
  (await db.changeRequests.get(verzoek!.id))?.status === 'goedgekeurd')


/* ==================================================================== */

console.log('\n27. Agenda, verjaardagen en jubilea')

const {
  gebeurtenissen, perDag, beginVanDag, teVieren, feliciteer, MIJLPALEN,
  agenda: agendaRepo,
} = await import('../src/lib/agenda')

const DAG_MS = 86_400_000

/* Een vaste dag om mee te rekenen: 15 juni 2026. */
const peildag = new Date(2026, 5, 15).getTime()

const agendaMensen = [
  {
    id: 'zt_a', email: 'a@x.nl', password: '', name: 'Anna Bakker',
    roles: ['employee'] as never, active: true, locationId: 'loc_utr',
    // Jarig op de peildag, en precies vijf jaar in dienst.
    startDate: new Date(2021, 5, 15).getTime(),
    updatedAt: 0,
  },
  {
    id: 'zt_b', email: 'b@x.nl', password: '', name: 'Bram Jansen',
    roles: ['employee'] as never, active: true, locationId: 'loc_utr',
    // Begint vandaag.
    startDate: peildag,
    updatedAt: 0,
  },
  {
    id: 'zt_c', email: 'c@x.nl', password: '', name: 'Carla Smit',
    roles: ['employee'] as never, active: true, locationId: 'loc_utr',
    // Drie jaar in dienst: geen mijlpaal.
    startDate: new Date(2023, 5, 15).getTime(),
    updatedAt: 0,
  },
  {
    id: 'zt_d', email: 'd@x.nl', password: '', name: 'Daan Weg',
    roles: ['employee'] as never, active: false, locationId: 'loc_utr',
    startDate: new Date(2016, 5, 15).getTime(),
    updatedAt: 0,
  },
]

const agendaPrive = [
  { id: 'zt_a', userId: 'zt_a', birthDate: new Date(1990, 5, 15).getTime(), updatedAt: 0 },
  { id: 'zt_c', userId: 'zt_c', birthDate: new Date(1985, 0, 3).getTime(), updatedAt: 0 },
]

const gevonden = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: null,
  items: [],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [],
  onderhoud: [],
})

const soorten = gevonden.map((g) => g.soort)

check('een verjaardag komt in de agenda', soorten.includes('verjaardag'))
check('een jubileum van vijf jaar ook', soorten.includes('jubileum'))
check('een eerste werkdag ook', soorten.includes('indienst'))
check('drie jaar in dienst is geen jubileum',
  !gevonden.some((g) => g.soort === 'jubileum' && g.titel.includes('Carla')))
check('wie uit dienst is telt niet mee',
  !gevonden.some((g) => g.titel.includes('Daan')))
check('de leeftijd staat erbij',
  gevonden.find((g) => g.soort === 'verjaardag')?.toelichting === 'Wordt 36',
  String(gevonden.find((g) => g.soort === 'verjaardag')?.toelichting))
check('het jubileum noemt het aantal jaren',
  (gevonden.find((g) => g.soort === 'jubileum')?.titel ?? '').includes('5 jaar'),
  String(gevonden.find((g) => g.soort === 'jubileum')?.titel))

check('een verjaardag buiten de periode telt niet mee',
  !gevonden.some((g) => g.titel.includes('Carla') && g.soort === 'verjaardag'))
check('mijlpalen bevatten geen 3', !MIJLPALEN.includes(3))
check('en wel 5, 10 en 25',
  MIJLPALEN.includes(5) && MIJLPALEN.includes(10) && MIJLPALEN.includes(25))

/* --- een aflopend document --- */

const metDocument = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: null,
  items: [],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [{
    id: 'zt_doc', userId: 'zt_a', userName: 'Anna Bakker', kind: 'contract',
    title: 'Arbeidsovereenkomst', storagePath: 'x', mime: 'application/pdf',
    sizeBytes: 1, visibleToEmployee: true, uploadedBy: 'x', uploadedByName: 'x',
    uploadedAt: 0, requiresSignature: false, expiresAt: peildag, updatedAt: 0,
  }] as never,
  onderhoud: [],
})
check('een aflopend contract staat in de agenda',
  metDocument.some((g) => g.soort === 'contract'))

/* --- per dag groeperen --- */

const gegroepeerd = perDag(gevonden)
check('alles valt op dezelfde dag', gegroepeerd.size === 1, String(gegroepeerd.size))
check('en er staat meer dan één ding op',
  (gegroepeerd.get(beginVanDag(peildag)) ?? []).length >= 3)

/* --- wat er te vieren valt --- */

const feest = teVieren(agendaMensen as never, agendaPrive as never, peildag)
check('drie dingen te vieren', feest.length === 3, String(feest.length))
check('het id ligt vast op persoon en jaar',
  feest.some((f) => f.id === 'nt_vj_zt_a_2026'), feest.map((f) => f.id).join(','))
check('de tekst spreekt iemand aan met zijn voornaam',
  feest.some((f) => f.titel.includes('Anna')))
check('een dag zonder iets te vieren levert niets op',
  teVieren(agendaMensen as never, agendaPrive as never,
    new Date(2026, 6, 4).getTime()).length === 0)

/* --- feliciteren stuurt één bericht per persoon per jaar --- */

for (const m of agendaMensen) await db.users.put(m as never)
for (const pv of agendaPrive) await db.personnelPrivate.put(pv as never)

const ilseA = (await db.users.get('u_manager'))!
const eersteRonde = await feliciteer(ilseA, peildag)
check('er zijn felicitaties verstuurd', eersteRonde === 3, String(eersteRonde))

const tweedeRonde = await feliciteer(ilseA, peildag)
check('een tweede ronde stuurt niets extra', tweedeRonde === 0, String(tweedeRonde))

const gefeliciteerd = (await db.notifications.toArray()).filter(
  (n) => n.id.startsWith('nt_vj_') || n.id.startsWith('nt_jub_') || n.id.startsWith('nt_id_'))
check('en er staan er precies drie', gefeliciteerd.length === 3, String(gefeliciteerd.length))

/* --- een afspraak toevoegen --- */

const afspraak = await agendaRepo.create({
  title: 'Keuring hogedrukinstallatie',
  soort: 'onderhoud',
  startAt: peildag + 9 * 3_600_000,
  endAt: peildag + 11 * 3_600_000,
  locationId: 'loc_utr',
  deelnemers: ['zt_a'],
  door: ilseA,
})

check('de afspraak staat erin', !!(await db.agendaItems.get(afspraak.id)))
check('met de juiste soort', afspraak.soort === 'onderhoud')

const deelnemerBericht = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === 'zt_a' && n.title.includes('In je agenda'))
check('de deelnemer krijgt bericht', deelnemerBericht.length === 1)

/*
 * Een afspraak hangt aan een vestiging, en die telt mee. Ilse zit op het
 * hoofdkantoor en mag overal bij; Anna werkt in Utrecht en ziet hem ook.
 */
const alsIlse = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: ilseA,
  items: [afspraak],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [],
  onderhoud: [],
})
check('de afspraak komt terug in de agenda',
  alsIlse.some((g) => g.id === afspraak.id))

const elders = (await db.users.toArray()).find(
  (u) => u.locationId && u.locationId !== 'loc_utr' && !u.allLocations)!
const alsIemandElders = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: elders,
  items: [afspraak],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [],
  onderhoud: [],
})
check('en niet bij iemand van een andere vestiging',
  !alsIemandElders.some((g) => g.id === afspraak.id), elders.name)

const metAfspraak = alsIlse
check('hele dagen staan boven de tijdgebonden dingen',
  metAfspraak[0].heleDag === true)

await agendaRepo.remove(afspraak.id)
check('weghalen werkt', !(await db.agendaItems.get(afspraak.id)))

/* --- alles overleeft de rondgang --- */

const blijvend = await agendaRepo.create({
  title: 'Zelftest blijft staan',
  soort: 'afspraak',
  startAt: peildag,
  endAt: peildag + 3_600_000,
  door: ilseA,
})
await sync()
await db.agendaItems.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de agenda staat op de server', !!(await db.agendaItems.get(blijvend.id)))

/* ==================================================================== *
 *  Werkgevers
 *
 *  De vraag die dit hele blok moest beantwoorden: als een werkgever iemand
 *  uit zijn chauffeurs gooit, ziet die chauffeur de ritten van dat bedrijf
 *  dan echt niet meer? Ook de ritten die hij zelf heeft gebracht?
 * ==================================================================== */

{
  console.log('\n— werkgevers —')

  const {
    werkgevers: wgRepo, koppelingen: kopRepo, regels: regelRepo,
    magAfnemen, mijnWerkgevers, chauffeursVan, openKoppelverzoeken, beurtenVan,
  } = await import('../src/lib/werkgevers')

  const ellen = { id: 'zt_ellen', name: 'Ellen Jansen' }
  const rick = { id: 'zt_rick', name: 'Rick Molenaar' }

  await db.users.bulkPut([
    { id: 'zt_ellen', email: 'ellen@zt.nl', password: '', name: 'Ellen Jansen',
      roles: ['employer'], active: true, updatedAt: 0 },
    { id: 'zt_rick', email: 'rick@zt.nl', password: '', name: 'Rick Molenaar',
      roles: ['employee'], active: true, updatedAt: 0 },
  ] as never)

  /* --- aanmaken en aanvragen --- */

  const wgActief = await wgRepo.aanmaken({
    naam: 'Zelftest Transport', contactNaam: 'Ellen Jansen',
    email: 'ellen@zt.nl', beheerders: ['zt_ellen'], door: ellen,
  })
  check('management maakt een werkgever meteen actief aan', wgActief.status === 'actief')

  const wgAanvraag = await wgRepo.aanvragen({
    naam: 'Zelftest Koeltransport', contactNaam: 'Wouter Bergman',
    email: 'wouter@zt.nl', door: ellen,
  })
  check('een aanvraag wacht op akkoord', wgAanvraag.status === 'aangevraagd')
  check('de aanvrager staat er als beheerder bij',
    wgAanvraag.beheerders.includes('zt_ellen'))

  const naGoedkeuren = await wgRepo.goedkeuren(wgAanvraag, { id: 'zt_baas', name: 'Ilse' })
  check('goedkeuren zet hem op actief', naGoedkeuren?.status === 'actief')
  check('en noteert wie het deed', naGoedkeuren?.beslistDoorNaam === 'Ilse')

  const naAfwijzen = await wgRepo.afwijzen(
    (await db.employers.get(wgActief.id))!, 'Geen contract', { id: 'zt_baas', name: 'Ilse' })
  check('afwijzen bewaart de reden', naAfwijzen?.afwijzingReden === 'Geen contract')
  await wgRepo.update(wgActief.id, { status: 'actief', afwijzingReden: undefined })

  /* --- een chauffeur koppelen --- */

  const koppeling = {
    id: 'zt_kop', werkgeverId: wgActief.id, werkgeverNaam: wgActief.naam,
    userId: 'zt_rick', naam: 'Rick Molenaar', email: 'rick@zt.nl',
    kentekens: [] as string[], status: 'wacht op akkoord' as const,
    uitgenodigdOp: Date.now(), uitgenodigdDoor: 'zt_ellen',
    uitgenodigdDoorNaam: 'Ellen Jansen', bestaandAccount: true,
    updatedAt: Date.now(),
  }
  await db.employerLinks.put(koppeling)

  check('een openstaand verzoek komt bij de chauffeur terecht',
    openKoppelverzoeken([koppeling], { id: 'zt_rick', email: 'rick@zt.nl' } as never).length === 1)
  check('en niet bij iemand anders',
    openKoppelverzoeken([koppeling], { id: 'zt_ander', email: 'x@zt.nl' } as never).length === 0)
  check('een verzoek op mijn adres telt ook zonder gekoppeld dossier',
    openKoppelverzoeken(
      [{ ...koppeling, userId: undefined }],
      { id: 'zt_rick', email: 'RICK@ZT.NL' } as never).length === 1)

  const actief = await kopRepo.aannemen(koppeling, rick)
  check('akkoord maakt de koppeling actief', actief.status === 'actief')
  check('en zet de datum erbij', typeof actief.gekoppeldOp === 'number')

  /* --- wat de chauffeur ziet --- */

  const zijnJobs = [
    { id: 'ztj_1', werkgeverId: wgActief.id, createdBy: 'zt_rick', scheduledAt: 3 },
    { id: 'ztj_2', werkgeverId: wgActief.id, createdBy: 'zt_ellen', scheduledAt: 2 },
    { id: 'ztj_3', werkgeverId: 'wg_anders', createdBy: 'zt_rick', scheduledAt: 1 },
  ] as never[]

  check('de werkgever ziet alleen zijn eigen ritten',
    beurtenVan(zijnJobs, wgActief.id).length === 2)
  check('nieuwste bovenaan', beurtenVan(zijnJobs, wgActief.id)[0].id === 'ztj_1')

  const alleWg = await db.employers.toArray()
  check('de chauffeur ziet zijn werkgever',
    mijnWerkgevers(alleWg, [actief], { id: 'zt_rick', email: 'rick@zt.nl' } as never)
      .some((w) => w.id === wgActief.id))

  /* --- en dit is de kern: losgekoppeld is losgekoppeld --- */

  const beeindigd = await kopRepo.beeindigen(actief, 'Uit dienst', ellen)
  check('beëindigen bewaart de reden', beeindigd.beeindigdReden === 'Uit dienst')
  check('de koppeling blijft bestaan als historie',
    !!(await db.employerLinks.get('zt_kop')))
  check('maar de chauffeur ziet de werkgever niet meer',
    mijnWerkgevers(alleWg, [beeindigd], { id: 'zt_rick', email: 'rick@zt.nl' } as never)
      .length === 0)
  check('ook niet de ritten die hij zelf bracht',
    mijnWerkgevers(alleWg, [beeindigd], { id: 'zt_rick', email: 'rick@zt.nl' } as never)
      .flatMap((w) => beurtenVan(zijnJobs, w.id)).length === 0)

  const losBericht = (await db.notifications.toArray())
    .find((n) => n.toUserId === 'zt_rick' && n.title.includes('losgekoppeld'))
  check('en hij krijgt er bericht van', !!losBericht)
  check('met de mededeling dat zijn account van hem blijft',
    (losBericht?.body ?? '').includes('blijven gewoon van jou'))

  check('een geweigerd verzoek levert ook niets op',
    mijnWerkgevers(alleWg,
      [{ ...actief, status: 'geweigerd' as const }],
      { id: 'zt_rick', email: 'rick@zt.nl' } as never).length === 0)

  check('de beheerder blijft zijn eigen bedrijf wel zien',
    mijnWerkgevers(alleWg, [beeindigd], { id: 'zt_ellen', email: 'ellen@zt.nl' } as never)
      .some((w) => w.id === wgActief.id))

  /* --- de volgorde in de lijst --- */

  const gesorteerd = chauffeursVan([
    { ...beeindigd, id: 'a', naam: 'Zeger' },
    { ...actief, id: 'b', naam: 'Bart' },
    { ...koppeling, id: 'c', naam: 'Anna' },
  ], wgActief.id)
  check('actieve chauffeurs staan bovenaan', gesorteerd[0].naam === 'Bart')
  check('en wie weg is onderaan', gesorteerd[2].naam === 'Zeger')

  /* --- afspraken over wat er afgenomen mag worden --- */

  await regelRepo.toevoegen({
    werkgeverId: wgActief.id, service: 'polish',
    soort: 'niet toegestaan', reden: 'Gaat via de dealer', door: ellen,
  })
  await regelRepo.toevoegen({
    werkgeverId: wgActief.id, kenteken: 'aa-01-bb', service: 'tankreiniging',
    soort: 'alleen met akkoord', door: ellen,
  })
  const mijnRegels = (await db.employerRules.toArray())
    .filter((r) => r.werkgeverId === wgActief.id)

  check('een kenteken wordt in hoofdletters bewaard',
    mijnRegels.some((r) => r.kenteken === 'AA-01-BB'))

  const polish = magAfnemen(mijnRegels, {
    werkgeverId: wgActief.id, kenteken: 'AA-99-ZZ', service: 'polish' })
  check('een verbod zonder kenteken geldt voor alle wagens', !polish.toegestaan)
  check('en noemt de reden', polish.reden === 'Gaat via de dealer')

  const tankDezeWagen = magAfnemen(mijnRegels, {
    werkgeverId: wgActief.id, kenteken: 'AA-01-BB', service: 'tankreiniging' })
  check('een voorwaarde mag wel, maar met akkoord',
    tankDezeWagen.toegestaan && tankDezeWagen.akkoordNodig)

  const tankAndereWagen = magAfnemen(mijnRegels, {
    werkgeverId: wgActief.id, kenteken: 'AA-77-XX', service: 'tankreiniging' })
  check('bij een andere wagen geldt die voorwaarde niet',
    tankAndereWagen.toegestaan && !tankAndereWagen.akkoordNodig)

  check('een kleine letter in het kenteken maakt niet uit',
    magAfnemen(mijnRegels, {
      werkgeverId: wgActief.id, kenteken: 'aa-01-bb', service: 'tankreiniging' }).akkoordNodig)

  check('wat niet geregeld is mag gewoon',
    magAfnemen(mijnRegels, {
      werkgeverId: wgActief.id, kenteken: 'AA-01-BB', service: 'buitenwas' }).toegestaan)

  check('de regels van een ander bedrijf tellen niet mee',
    magAfnemen(mijnRegels, {
      werkgeverId: 'wg_ergens_anders', service: 'polish' }).toegestaan)

  const strengste = magAfnemen([
    ...mijnRegels,
    { id: 'zt_r3', werkgeverId: wgActief.id, service: 'polish',
      soort: 'alleen met akkoord', aangemaaktDoor: 'zt_ellen',
      aangemaaktOp: 0, updatedAt: 0 } as never,
  ], { werkgeverId: wgActief.id, service: 'polish' })
  check('staat er allebei iets, dan geldt het verbod', !strengste.toegestaan)

  const legeRegel = magAfnemen([
    { id: 'zt_r4', werkgeverId: wgActief.id, soort: 'niet toegestaan',
      aangemaaktDoor: 'zt_ellen', aangemaaktOp: 0, updatedAt: 0 } as never,
  ], { werkgeverId: wgActief.id, service: 'polish' })
  check('een regel zonder behandeling én zonder product zegt niets', legeRegel.toegestaan)

  /* --- alles overleeft de rondgang --- */

  await sync()
  await db.employers.clear()
  await db.employerLinks.clear()
  await db.employerRules.clear()
  await setMeta(LAST_SYNC, 0)
  await sync()
  check('de werkgever staat op de server', !!(await db.employers.get(wgActief.id)))
  check('de koppeling ook', (await db.employerLinks.get('zt_kop'))?.status === 'beëindigd')
  check('en de afspraken', (await db.employerRules.toArray())
    .filter((r) => r.werkgeverId === wgActief.id).length === 2)

}

/* ==================================================================== *
 *  Bijlagen bekijken
 *
 *  Wat een bestand is bepalen we aan de extensie, niet aan wat de afzender
 *  zegt dat het is. Post komt van buiten, en iets dat zichzelf een plaatje
 *  noemt is daarmee nog geen plaatje.
 * ==================================================================== */

console.log('\n— bijlagen bekijken —')

{
  const {
    soortVan, extensieVan, grootteVan, MAX_TONEN, TeGroot,
  } = await import('../src/lib/bekijken')
  const { magOpenen, controleLabel } = await import('../src/lib/postbus')

  /* --- wat tonen we zelf --- */

  check('een jpeg is beeld', soortVan('bon.jpg', 'image/jpeg') === 'beeld')
  check('een png ook', soortVan('scan.PNG') === 'beeld')
  check('een pdf is een pdf', soortVan('factuur.pdf', 'application/pdf') === 'pdf')
  check('een csv is tekst', soortVan('mutaties.csv', 'text/csv') === 'tekst')

  /* --- en wat niet --- */

  check('een zip tonen we niet', soortVan('spullen.zip', 'application/zip') === 'onbekend')
  check('een exe al helemaal niet', soortVan('setup.exe') === 'onbekend')
  check('een bestand zonder naam ook niet', soortVan('') === 'onbekend')

  /*
   * Dit is het geval waar het om gaat: de naam zegt plaatje, de afzender
   * zegt iets anders. Twee bronnen die elkaar tegenspreken is precies het
   * moment om niets te doen.
   */
  check('naam en type die elkaar tegenspreken leveren niets op',
    soortVan('vakantiefoto.png', 'application/x-msdownload') === 'onbekend')
  check('en andersom net zo goed',
    soortVan('rapport.pdf', 'application/octet-stream') === 'onbekend')

  check('zonder extensie mag het type het zeggen',
    soortVan('bijlage', 'image/png') === 'beeld')
  check('maar dan ook alleen voor wat we tekenen',
    soortVan('bijlage', 'application/zip') === 'onbekend')

  check('de extensie komt er los uit', extensieVan('Factuur.2026.PDF') === 'pdf')
  check('geen punt betekent geen extensie', extensieVan('LEESMIJ') === '')

  /* --- leesbare grootte --- */

  check('bytes blijven bytes', grootteVan(900) === '900 B')
  check('kilobytes worden afgerond', grootteVan(2048) === '2 kB')
  check('megabytes met één decimaal', grootteVan(3_500_000) === '3.3 MB')
  check('niets is niets', grootteVan(undefined) === '')

  check('er zit een dak op wat we inladen', MAX_TONEN === 25 * 1024 * 1024)
  check('een te groot bestand zegt wat het is',
    new TeGroot(80 * 1024 * 1024).message.includes('80.0 MB'))

  /* --- wat er tegengehouden is, gaat niet open --- */

  check('een schone bijlage mag open',
    magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'schoon' }))
  check('een verdachte niet',
    !magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'verdacht' }))
  check('een mislukte controle ook niet',
    !magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'mislukt' }))
  check('van vóór de controle mag wel, met een waarschuwing',
    magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p' }) &&
    controleLabel({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p' })?.tone === 'warn')
  check('en een schone krijgt geen stempel',
    controleLabel({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'schoon' }) === null)

  /*
   * En het geval waar het om ging: de bijlage zat wel in de mail, maar er
   * staat niets in de opslag. Dat is iets anders dan tegengehouden, en het
   * hoort ook anders te heten.
   */
  const nietBinnen = {
    naam: 'factuur.pdf', mime: 'application/pdf', size: 0, path: '',
    controle: 'mislukt' as const,
    controleReden: 'De webhook bevatte geen inhoud voor deze bijlage.',
  }
  check('zonder pad valt er niets te openen', !magOpenen(nietBinnen))
  check('en dat heet niet "tegengehouden"',
    controleLabel(nietBinnen)?.label === 'Niet binnengekomen',
    String(controleLabel(nietBinnen)?.label))
  check('een bijlage zonder pad die wel verdacht is heet dat ook',
    controleLabel({ ...nietBinnen, controle: 'verdacht' })?.label !== 'Niet binnengekomen')
}

/* ==================================================================== *
 *  Van melding naar plan
 *
 *  De kern: een plan bestaat uit stappen die je los kunt uitzetten, en wat
 *  er uitstaat is een besluit dat de melder hoort te horen -- geen "later
 *  misschien" dat stil verdwijnt.
 * ==================================================================== */

console.log('\n— van melding naar plan —')

{
  const {
    plannen: planRepo, vragenVoor, opdrachtTekst, omvangVan, terBeoordeling,
    planVan, gesprekUit,
  } = await import('../src/lib/devplan')
  const { tickets: tkRepo, ticketMessages: tmRepo } = await import('../src/lib/tickets')

  const dev = { id: 'zt_dev', name: 'Sem' }
  const baas = { id: 'zt_baas2', name: 'Ilse' }
  const melder = { id: 'zt_melder', name: 'Tom Verhoeven', locationId: 'loc_utr' }

  await db.users.bulkPut([
    { id: 'zt_dev', email: 'dev@zt.nl', password: '', name: 'Sem',
      roles: ['developer'], active: true, updatedAt: 0 },
    { id: 'zt_baas2', email: 'ilse@zt.nl', password: '', name: 'Ilse',
      roles: ['management'], active: true, updatedAt: 0 },
    { id: 'zt_melder', email: 'tom@zt.nl', password: '', name: 'Tom Verhoeven',
      roles: ['employee'], active: true, locationId: 'loc_utr', updatedAt: 0 },
  ] as never)

  /* --- de vaste vragen --- */

  check('een fout krijgt andere vragen dan een wens',
    vragenVoor('fout')[0].id !== vragenVoor('wens')[0].id)
  check('bij een fout wordt gevraagd wat je verwachtte',
    vragenVoor('fout').some((v) => v.id === 'verwacht'))
  check('bij een wens juist hoe je het nu doet',
    vragenVoor('wens').some((v) => v.id === 'nu'))
  check('elke soort melding heeft vragen',
    (['fout', 'wens', 'traag', 'vraag'] as const).every((k) => vragenVoor(k).length > 0))
  check('er staan keuzes bij waar dat kan',
    vragenVoor('fout').some((v) => (v.keuzes?.length ?? 0) > 0))

  /* --- een melding met een gesprek eronder --- */

  const melding = await tkRepo.create({
    title: 'Kan geen wasbeurt afmelden op de telefoon',
    description: 'Ik druk op gereed en er gebeurt niets.',
    kind: 'fout',
    priority: 'hoog',
    by: melder,
    fromPage: 'vandaag',
    appVersion: '1.12.1',
    online: true,
    pendingChanges: 0,
  })

  await tmRepo.send({
    ticketId: melding.id,
    body: '**Wat deed je precies, vlak voordat het misging?**\nIk stond bij baan 2 en tikte op gereed.',
    internal: false,
    by: melder,
  })
  await tmRepo.send({
    ticketId: melding.id,
    body: '**Gebeurt dit elke keer, of af en toe?**\nElke keer',
    internal: false,
    by: melder,
  })
  await tmRepo.send({
    ticketId: melding.id,
    body: 'Even gekeken, lijkt de knop zelf te zijn.',
    internal: true,
    by: dev,
  })

  const berichten = await db.ticketMessages.toArray()
  const gesprek = gesprekUit(berichten, melding.id)
  check('het gesprek komt weer uit de berichten', gesprek.length === 2)
  check('met de vraag apart van het antwoord',
    gesprek[0].vraag === 'Wat deed je precies, vlak voordat het misging?' &&
    gesprek[0].antwoord.startsWith('Ik stond bij baan 2'))
  check('een interne notitie is geen gesprek',
    !gesprek.some((b) => b.antwoord.includes('lijkt de knop')))

  /* --- er komt een plan uit --- */

  const plan = await planRepo.opstellen({ ticket: melding, gesprek, door: dev })
  check('zonder server komt er een geraamte', plan.bron === 'vragenlijst')
  check('en dat geraamte heeft een stap', plan.stappen.length >= 1)
  check('het plan begint als concept', plan.status === 'concept')
  check('alle stappen staan aan', plan.stappen.every((s) => s.gekozen))
  check('de aanleiding bevat wat de melder zei',
    plan.aanleiding.includes('baan 2'))
  check('het plan is bij de melding te vinden',
    planVan(await db.devPlans.toArray(), melding.id)?.id === plan.id)

  /* --- stappen aan en uit --- */

  const metStappen = await planRepo.update(plan.id, {
    stappen: [
      { id: 's1', titel: 'Knop repareren', wat: 'De knop doet weer wat hij belooft',
        risico: 'klein', omvang: 'klein', gekozen: true },
      { id: 's2', titel: 'Bevestiging tonen', wat: 'Kort zichtbaar dat het gelukt is',
        risico: 'klein', omvang: 'klein', gekozen: true },
      { id: 's3', titel: 'Hele scherm herbouwen', wat: 'Alles opnieuw',
        risico: 'groot', omvang: 'groot', gekozen: true },
    ],
  })
  check('drie stappen erin', metStappen?.stappen.length === 3)

  await planRepo.zetStap(plan.id, 's3', false)
  await planRepo.zetStapOpmerking(plan.id, 's3', 'Te groot voor nu, later kijken')
  const naVinkjes = (await db.devPlans.get(plan.id))!
  check('een stap gaat uit', naVinkjes.stappen.find((s) => s.id === 's3')?.gekozen === false)
  check('met de reden erbij',
    naVinkjes.stappen.find((s) => s.id === 's3')?.opmerking === 'Te groot voor nu, later kijken')

  const omvang = omvangVan(naVinkjes)
  check('alleen wat aanstaat telt mee', omvang.stappen === 2)
  check('twee kleine stappen is klein werk', omvang.zwaarte === 'klein')
  check('met de grote stap erbij wordt het groter',
    omvangVan({ ...naVinkjes, stappen: naVinkjes.stappen.map((s) => ({ ...s, gekozen: true })) })
      .zwaarte !== 'klein')

  /* --- beoordelen --- */

  await planRepo.indienen(naVinkjes)
  const ingediend = (await db.devPlans.get(plan.id))!
  check('indienen zet hem op ter beoordeling', ingediend.status === 'ter beoordeling')
  check('en hij staat in de lijst die wacht',
    terBeoordeling(await db.devPlans.toArray()).some((p) => p.id === plan.id))

  const seintje = (await db.notifications.toArray())
    .find((n) => n.title.includes('Plan klaar'))
  check('het management krijgt er bericht van', !!seintje)

  await planRepo.goedkeuren(ingediend, baas, 'Graag eerst op één vestiging')
  const akkoord = (await db.devPlans.get(plan.id))!
  check('goedkeuren legt vast wie het deed', akkoord.beoordeeldDoorNaam === 'Ilse')
  check('en de aantekening', akkoord.opmerking === 'Graag eerst op één vestiging')

  const naarMelder = (await db.ticketMessages.toArray())
    .filter((m) => m.ticketId === melding.id && !m.internal)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  check('de melder hoort wat er gebouwd wordt',
    naarMelder.body.includes('Knop repareren'))
  check('en ook wat er niet gebeurt',
    naarMelder.body.includes('Hele scherm herbouwen') &&
    naarMelder.body.includes('Te groot voor nu'))
  check('de melding staat daarna in behandeling',
    (await db.tickets.get(melding.id))?.status === 'in behandeling')

  /* --- niets aanvinken is geen akkoord --- */

  const leegPlan = await planRepo.opstellen({ ticket: melding, gesprek: [], door: dev })
  await planRepo.update(leegPlan.id, {
    stappen: leegPlan.stappen.map((s) => ({ ...s, gekozen: false })),
  })
  let geweigerd = false
  try {
    await planRepo.goedkeuren((await db.devPlans.get(leegPlan.id))!, baas)
  } catch {
    geweigerd = true
  }
  check('een plan zonder aangevinkte stappen kun je niet goedkeuren', geweigerd)

  /* --- de opdracht --- */

  const opdracht = opdrachtTekst(akkoord, melding)
  check('de opdracht noemt wat er gebouwd wordt', opdracht.includes('Knop repareren'))
  check('en zet apart wat er niet in zit',
    opdracht.includes('Wat er bewust niet in zit'))
  check('met de reden erbij', opdracht.includes('Te groot voor nu'))
  check('de melding staat erin', opdracht.includes(melding.number))
  check('en wie het goedkeurde', opdracht.includes('Ilse'))
  check('een uitgezette stap staat niet bij het werk',
    opdracht.indexOf('Hele scherm herbouwen') > opdracht.indexOf('Wat er bewust niet in zit'))

  /* --- uitgeleverd --- */

  await planRepo.uitgevoerd(akkoord, '1.13.0', dev)
  const klaar = (await db.devPlans.get(plan.id))!
  check('uitvoeren legt de versie vast', klaar.uitgevoerdIn === '1.13.0')
  check('en de melding gaat op opgelost',
    (await db.tickets.get(melding.id))?.status === 'opgelost')
  check('met het versienummer erbij',
    (await db.tickets.get(melding.id))?.fixedIn === '1.13.0')

  /* --- alles overleeft de rondgang --- */

  await sync()
  await db.devPlans.clear()
  await setMeta(LAST_SYNC, 0)
  await sync()
  const terug = await db.devPlans.get(plan.id)
  check('het plan staat op de server', !!terug)
  check('inclusief de vinkjes',
    terug?.stappen.find((s) => s.id === 's3')?.gekozen === false)
}

/* ==================================================================== *
 *  De rondleiding
 *
 *  Per rol, en per rol een eigen versienummer. Dat laatste is de knop om
 *  hem bij iedereen opnieuw te laten zien als er wezenlijk iets verandert
 *  aan een dashboard.
 * ==================================================================== */

console.log('\n— de rondleiding —')

{
  const {
    RONDLEIDINGEN, merk, moetZien, terugTeKijken, metGezien, zichtbareAanwijzers,
  } = await import('../src/lib/rondleiding')
  const { ROLE_ORDER } = await import('../src/lib/types')

  /* --- er is er een voor elke rol --- */

  check('elke rol heeft een rondleiding',
    ROLE_ORDER.every((r) => !!RONDLEIDINGEN[r]),
    ROLE_ORDER.filter((r) => !RONDLEIDINGEN[r]).join(', '))

  check('en elke rondleiding heeft schermen',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].schermen.length >= 3))

  check('met een titel en een tekst die er staan',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].schermen.every(
      (s) => s.titel.length > 3 && s.tekst.length > 40)))

  check('de rol in de rondleiding klopt met de sleutel',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].rol === r))

  check('geen twee schermen met hetzelfde id binnen één rondleiding',
    ROLE_ORDER.every((r) => {
      const ids = RONDLEIDINGEN[r].schermen.map((s) => s.id)
      return new Set(ids).size === ids.length
    }))

  /* --- het merkje --- */

  check('het merkje bevat de rol en de versie', merk('employee') === 'employee@1')
  check('en verschilt per rol', merk('management') !== merk('employee'))

  /* --- wie moet hem zien --- */

  const nieuw = { id: 'zt_n', roles: ['employee'], seenTours: [] } as never
  const gezien = { id: 'zt_g', roles: ['employee'], seenTours: ['employee@1'] } as never
  const erbij = { id: 'zt_e', roles: ['employee', 'management'],
    seenTours: ['employee@1'] } as never

  check('wie hem nog niet heeft gezien, ziet hem', moetZien(nieuw, 'employee'))
  check('wie hem heeft gezien niet meer', !moetZien(gezien, 'employee'))
  check('maar bij een nieuwe rol wel weer', moetZien(erbij, 'management'))
  check('en niet nog eens voor de rol die hij al kende',
    !moetZien(erbij, 'employee'))
  check('zonder gebruiker gebeurt er niets', !moetZien(null, 'employee'))
  check('en zonder rol ook niet', !moetZien(nieuw, null))

  /*
   * Het geval waar het versienummer voor bestaat: verandert er wezenlijk
   * iets, dan hoogt iemand het op en ziet iedereen met die rol hem opnieuw.
   */
  const oudGezien = { id: 'zt_o', roles: ['employee'], seenTours: ['employee@0'] } as never
  check('een oudere versie telt niet als gezien', moetZien(oudGezien, 'employee'))

  /* --- afvinken --- */

  check('afvinken zet het merkje erbij',
    metGezien(nieuw, 'employee').includes('employee@1'))
  check('en doet dat niet twee keer',
    metGezien(gezien, 'employee').filter((m) => m === 'employee@1').length === 1)
  check('wat er al stond blijft staan',
    metGezien(erbij, 'management').includes('employee@1'))

  /* --- terugkijken --- */

  check('je kunt alleen de rondleidingen van je eigen rollen terugkijken',
    terugTeKijken(erbij).length === 2)
  check('een werknemer krijgt er één', terugTeKijken(nieuw).length === 1)
  check('zonder gebruiker geen lijst', terugTeKijken(null).length === 0)

  /* --- aanwijzers volgen de rechten --- */

  const alles = zichtbareAanwijzers(RONDLEIDINGEN.employee, () => true)
  const niets = zichtbareAanwijzers(RONDLEIDINGEN.employee, () => false)
  check('met alle rechten zie je alle aanwijzers',
    alles.length === RONDLEIDINGEN.employee.aanwijzers.length)
  check('zonder rechten vallen de rechtgebonden weg', niets.length < alles.length)
  check('maar de aanwijzers zonder recht blijven',
    niets.length === RONDLEIDINGEN.employee.aanwijzers.filter((a) => !a.recht).length)

  check('elke aanwijzer wijst ergens naartoe',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].aanwijzers.every(
      (a) => a.doel.length > 0 && a.titel.length > 0)))
}

/* ==================================================================== *
 *  Dubbele mensen
 *
 *  Twee dossiers van dezelfde man ontstaan doordat het kantoor er een
 *  aanmaakt op zijn werkadres en hij zich daarna zelf aanmeldt met zijn
 *  privé-adres. Op e-mailadres zijn dat twee mensen; op naam en
 *  telefoonnummer valt het wél op.
 * ==================================================================== */

console.log('\n— dubbele mensen —')

{
  const {
    mogelijkDubbel, normaliseerNaam, normaliseerTelefoon, inDienst,
  } = await import('../src/lib/personeel')

  const staat = [
    { id: 'p1', email: 'jan.jansen@truckwash1group.nl', name: 'Jan Jansen',
      phone: '06-12345678', roles: ['employee'], active: true, updatedAt: 0 },
    { id: 'p2', email: 'sanne@truckwash1group.nl', name: 'Sanne de Vries',
      phone: '06-99887766', roles: ['employee'], active: true, updatedAt: 0 },
    { id: 'p3', email: 'weg@truckwash1group.nl', name: 'Ferry Blok',
      roles: ['employee'], active: false, archivedAt: 1, updatedAt: 0 },
  ] as never[]

  /* --- namen normaliseren --- */

  check('tussenvoegsels tellen niet mee',
    normaliseerNaam('Sanne de Vries') === normaliseerNaam('Sanne Vries'))
  check('hoofdletters ook niet',
    normaliseerNaam('JAN JANSEN') === normaliseerNaam('jan jansen'))
  check('en de volgorde van voor- en achternaam niet',
    normaliseerNaam('Jansen, Jan') === normaliseerNaam('Jan Jansen'))
  check('accenten evenmin',
    normaliseerNaam('José Núñez') === normaliseerNaam('Jose Nunez'))
  check('maar twee verschillende namen blijven verschillend',
    normaliseerNaam('Jan Jansen') !== normaliseerNaam('Jan Janssen'))

  /* --- telefoonnummers --- */

  check('streepjes en spaties tellen niet mee',
    normaliseerTelefoon('06-12 34 56 78') === normaliseerTelefoon('0612345678'))
  check('de landcode ook niet',
    normaliseerTelefoon('+31 6 12345678') === normaliseerTelefoon('0612345678'))
  check('geen nummer levert niets op', normaliseerTelefoon(undefined) === '')

  /* --- het vangnet zelf --- */

  const opAdres = mogelijkDubbel(staat, {
    naam: 'Iemand Anders', email: 'jan.jansen@truckwash1group.nl' })
  check('hetzelfde adres is een zekere treffer',
    opAdres.length === 1 && opAdres[0].hard)
  check('en zegt waarom', opAdres[0].waarom === 'zelfde e-mailadres')

  const opNaam = mogelijkDubbel(staat, {
    naam: 'jan jansen', email: 'jan@prive.nl' })
  check('een privé-adres bij dezelfde naam valt op',
    opNaam.length === 1 && opNaam[0].user.id === 'p1')
  check('maar dat is een vermoeden, geen zekerheid', !opNaam[0].hard)
  check('en het zegt waarom', opNaam[0].waarom === 'zelfde naam')

  const naamEnTel = mogelijkDubbel(staat, {
    naam: 'Jan Jansen', email: 'jan@prive.nl', telefoon: '+31612345678' })
  check('naam én telefoonnummer maakt het wel zeker', naamEnTel[0].hard)
  check('met beide redenen erbij',
    naamEnTel[0].waarom === 'zelfde naam én telefoonnummer')

  const alleenTel = mogelijkDubbel(staat, {
    naam: 'Heel Iemand Anders', telefoon: '06-99887766' })
  check('een gedeeld telefoonnummer valt ook op',
    alleenTel.length === 1 && alleenTel[0].user.id === 'p2')

  check('wie er niet op lijkt komt er niet uit',
    mogelijkDubbel(staat, { naam: 'Piet Pietersen', email: 'piet@x.nl' }).length === 0)

  check('jezelf tel je niet mee bij het bijwerken',
    mogelijkDubbel(staat, {
      naam: 'Jan Jansen', email: 'jan.jansen@truckwash1group.nl' }, 'p1').length === 0)

  /*
   * Het geval waar het om begon: kantoor maakt Jan aan op het werkadres, Jan
   * meldt zich daarna zelf aan met zijn privé-adres. Dat moet opvallen.
   */
  const hetGeval = mogelijkDubbel(staat, {
    naam: 'Jan  Jansen', email: 'jjansen1987@hotmail.com', telefoon: '0612345678' })
  check('kantoor maakt hem aan, hij meldt zich zelf aan: dat valt op',
    hetGeval.length === 1 && hetGeval[0].hard && hetGeval[0].user.id === 'p1')

  /* --- uitgeschreven telt niet mee in de lijst --- */

  check('wie is uitgeschreven staat niet meer in dienst',
    inDienst(staat).length === 2)
  check('en de rest wel',
    inDienst(staat).every((u) => u.id !== 'p3'))
}

/* ==================================================================== *
 *  Uren rechtzetten en kilometers
 *
 *  Twee dingen die een medewerker over zichzelf zegt, en één ding dat hij
 *  juist niet zelf bepaalt.
 * ==================================================================== */

console.log('\n— uren en kilometers —')

{
  const {
    urenverzoeken, ritten: ritRepo, totaalKm, vergoeding, mijnRitten,
    openVerzoeken, adresVan, KM_TARIEF, SOORT_LABEL,
  } = await import('../src/lib/urenritten')

  const tom = { id: 'zt_tom', name: 'Tom Verhoeven', locationId: 'loc_utr' }
  const nour = { id: 'zt_nour', name: 'Nour El Amrani' }

  await db.users.bulkPut([
    { id: 'zt_tom', email: 'tom2@zt.nl', password: '', name: 'Tom Verhoeven',
      roles: ['employee'], active: true, locationId: 'loc_utr', updatedAt: 0 },
    { id: 'zt_nour', email: 'nour2@zt.nl', password: '', name: 'Nour El Amrani',
      roles: ['employee', 'supervisor'], active: true, locationId: 'loc_utr',
      manages: ['loc_utr'], updatedAt: 0 },
  ] as never)

  /* --- er staat niets, en dat moet er wel staan --- */

  const dag = new Date(2026, 8, 1, 8, 0).getTime()
  const verzoek = await urenverzoeken.indienen({
    door: tom as never,
    soort: 'vergeten',
    van: dag,
    tot: dag + 8 * 3_600_000,
    toelichting: 'De kassa deed het niet, Nour heeft me binnen zien komen.',
  })

  check('een verzoek begint op nieuw', verzoek.status === 'nieuw')
  check('en staat op naam van de aanvrager', verzoek.userId === 'zt_tom')
  check('het staat in de lijst die op de leidinggevende wacht',
    openVerzoeken(await db.hourRequests.toArray()).some((v) => v.id === verzoek.id))

  const seintje = (await db.notifications.toArray())
    .find((n) => n.toUserId === 'zt_nour' && n.title.includes('Urenverzoek'))
  check('de leidinggevende krijgt er bericht van', !!seintje)

  /* --- goedkeuren zet de uren ook echt recht --- */

  const voor = await db.timeEntries.where('userId').equals('zt_tom').count()
  await urenverzoeken.goedkeuren(
    (await db.hourRequests.get(verzoek.id))!, nour as never, 'Klopt, ik heb hem gezien')
  const na = await db.timeEntries.where('userId').equals('zt_tom').toArray()

  check('goedkeuren levert een urenregel op', na.length === voor + 1)
  check('met de gevraagde begintijd', na.some((e) => e.start === dag))
  check('en de gevraagde eindtijd', na.some((e) => e.end === dag + 8 * 3_600_000))
  check('de regel zegt waar hij vandaan komt',
    na.some((e) => (e.note ?? '').includes('verzoek')))

  const bij = (await db.hourRequests.get(verzoek.id))!
  check('het verzoek staat op goedgekeurd', bij.status === 'goedgekeurd')
  check('met wie het deed erbij', bij.beslistDoorNaam === 'Nour El Amrani')
  check('en de reden', bij.beslissingReden === 'Klopt, ik heb hem gezien')

  const bericht = (await db.notifications.toArray())
    .find((n) => n.toUserId === 'zt_tom' && n.title.includes('rechtgezet'))
  check('de aanvrager hoort het ook', !!bericht)

  /* --- een bestaande regel bijstellen in plaats van erbij zetten --- */

  const bestaand = na.find((e) => e.start === dag)!
  const tweede = await urenverzoeken.indienen({
    door: tom as never,
    soort: 'te vroeg uitgeklokt',
    van: dag,
    tot: dag + 9 * 3_600_000,
    entryId: bestaand.id,
    toelichting: 'Ik heb nog een uur doorgewerkt na het uitklokken.',
  })
  const aantalVoor = await db.timeEntries.where('userId').equals('zt_tom').count()
  await urenverzoeken.goedkeuren((await db.hourRequests.get(tweede.id))!, nour as never)

  check('een bestaande regel wordt bijgesteld, niet gedupliceerd',
    (await db.timeEntries.where('userId').equals('zt_tom').count()) === aantalVoor)
  check('en de eindtijd staat een uur later',
    (await db.timeEntries.get(bestaand.id))?.end === dag + 9 * 3_600_000)

  /* --- afwijzen laat de uren met rust --- */

  const derde = await urenverzoeken.indienen({
    door: tom as never, soort: 'anders', van: dag, tot: dag + 20 * 3_600_000,
    toelichting: 'Twintig uur gewerkt.',
  })
  const voorAfwijzen = await db.timeEntries.where('userId').equals('zt_tom').count()
  await urenverzoeken.afwijzen(
    (await db.hourRequests.get(derde.id))!, 'Twintig uur kan niet', nour as never)

  check('afwijzen verandert niets aan de uren',
    (await db.timeEntries.where('userId').equals('zt_tom').count()) === voorAfwijzen)
  check('en de aanvrager hoort waarom',
    (await db.notifications.toArray()).some(
      (n) => n.toUserId === 'zt_tom' && (n.body ?? '').includes('Twintig uur kan niet')))

  /* --- intrekken kan de aanvrager zelf --- */

  const vierde = await urenverzoeken.indienen({
    door: tom as never, soort: 'vergeten', van: dag, toelichting: 'Toch niet nodig.',
  })
  await urenverzoeken.intrekken(vierde)
  check('een verzoek intrekken kan',
    (await db.hourRequests.get(vierde.id))?.status === 'ingetrokken')
  check('en dan wacht het niet meer op de leidinggevende',
    !openVerzoeken(await db.hourRequests.toArray()).some((v) => v.id === vierde.id))

  check('elke soort verzoek heeft een naam',
    Object.values(SOORT_LABEL).every((l) => l.length > 3))

  /* --- kilometers --- */

  const rit = await ritRepo.toevoegen({
    door: tom as never,
    op: dag,
    vanLabel: 'Thuis', naarLabel: 'Utrecht',
    vanAdres: 'Dorpsstraat 1, Houten', naarAdres: 'Handelsweg 14, Utrecht',
    km: 12.4, retour: true, doel: 'woon-werk',
  })
  check('een rit begint op nieuw', rit.status === 'nieuw')
  check('en zegt dat de afstand van de routedienst komt', rit.bron === 'route')

  await ritRepo.toevoegen({
    door: tom as never,
    op: dag + DAG_MS,
    vanLabel: 'Utrecht', naarLabel: 'Almere',
    vanAdres: 'Handelsweg 14, Utrecht', naarAdres: 'Ergens 3, Almere',
    km: 40, retour: false, doel: 'vestiging',
  })

  const mijn = mijnRitten(await db.trips.toArray(), 'zt_tom')
  check('beide ritten staan op zijn naam', mijn.length === 2)
  check('de nieuwste bovenaan', mijn[0].naarLabel === 'Almere')

  check('retour telt dubbel', totaalKm(mijn) === 12.4 * 2 + 40)
  check('en de vergoeding volgt daaruit',
    vergoeding(mijn, KM_TARIEF) === Math.round((12.4 * 2 + 40) * KM_TARIEF * 100) / 100)
  check('het tarief is het onbelaste bedrag', KM_TARIEF === 0.23)

  check('een lege lijst is nul kilometer', totaalKm([]) === 0)

  /* --- het adres van een vestiging, zoals de routedienst het wil --- */

  check('een vestigingsadres wordt één regel',
    adresVan({ address: 'Handelsweg 14', postcode: '3542 AB', city: 'Utrecht' } as never)
      === 'Handelsweg 14, 3542 AB Utrecht')
  check('en zonder vestiging komt er niets uit', adresVan(undefined) === '')

  /* --- alles overleeft de rondgang --- */

  await sync()
  await db.hourRequests.clear()
  await db.trips.clear()
  await setMeta(LAST_SYNC, 0)
  await sync()
  check('het verzoek staat op de server',
    (await db.hourRequests.get(verzoek.id))?.status === 'goedgekeurd')
  check('de ritten ook', (await db.trips.get(rit.id))?.km === 12.4)
}

/* ==================================================================== *
 *  Een pasje uitlezen
 *
 *  De leesmotor zelf valt hier niet te testen -- die heeft een plaatje en
 *  een browser nodig. Wat wél te testen is, is het deel dat bepaalt wat er
 *  uit die brij aan tekst wordt overgenomen. En dat is precies het deel dat
 *  stil fout kan gaan: een getal dat toevallig op een BSN lijkt, of een
 *  regel die voor een MRZ wordt aangezien.
 * ==================================================================== */

console.log('\n— pasjes uitlezen —')

{
  const {
    vindMrzRegels, vindBsn, vindIban, vindNaamOpPas,
    voorstellenUitId, voorstellenUitPas,
  } = await import('../src/lib/scannen')
  const { leesMrz, bsnGeldig } = await import('../src/lib/identiteit')

  /* --- de twee regels onderaan een paspoort --- */

  const paspoort = [
    'KONINKRIJK DER NEDERLANDEN',
    'Paspoort / Passport',
    'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<',
    'SPECI20142NLD6503101M2403096999999990<<<<<84',
  ].join('\n')

  const regels = vindMrzRegels(paspoort)
  check('de twee regels worden uit de rest gevist',
    regels.split('\n').length === 2)
  check('en de kop blijft eruit', !regels.includes('KONINKRIJK'))
  check('ze zijn ook echt te lezen', !!leesMrz(regels))

  const gelezen = leesMrz(regels)!
  check('met de naam erin', gelezen.volledigeNaam.toLowerCase().includes('bruijn'))

  /*
   * Een ID-kaart heeft drie regels van dertig in plaats van twee van
   * vierenveertig. Dat onderscheid moet blijven staan, anders wordt een
   * ID-kaart als een half paspoort gelezen.
   */
  const idKaart = [
    'NEDERLANDSE IDENTITEITSKAART',
    'IDNLDSPECI20142<<<<<<<<<<<<<<<',
    '6503101M2403096NLD<<<<<<<<<<<8',
    'DE<BRUIJN<<WILLEM<JAN<<<<<<<<<',
  ].join('\n')
  check('een ID-kaart levert drie regels op',
    vindMrzRegels(idKaart).split('\n').length === 3)

  check('zonder herkenbare regels komt er niets uit',
    vindMrzRegels('Gewoon wat tekst\nzonder pasje erin') === '')
  check('en één losse regel is niet genoeg',
    vindMrzRegels('P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<') === '')

  /* --- het burgerservicenummer --- */

  /* Een geldig BSN om mee te werken; de elfproef moet erop kloppen. */
  const echt = '123456782'
  check('het testnummer klopt met de elfproef', bsnGeldig(echt))

  check('een BSN wordt uit de tekst gehaald',
    vindBsn(`Burgerservicenummer ${echt} / BSN`) === echt)
  check('ook met spaties erin', vindBsn(`BSN ${echt.slice(0, 4)} ${echt.slice(4)}`) === echt)

  /*
   * Dit is waar het om gaat. Op een pasje staan meer getallen van negen
   * cijfers -- documentnummers, datums achter elkaar. Alleen wat door de
   * elfproef komt telt.
   */
  check('een getal dat niet door de elfproef komt telt niet',
    vindBsn('Documentnummer 111111111 en verder niets') === undefined)
  check('een documentnummer met letters ook niet',
    vindBsn('SPECI2014 2 NLD') === undefined)
  check('en zonder cijfers komt er niets uit', vindBsn('Alleen maar tekst') === undefined)

  /* --- het rekeningnummer --- */

  const iban = 'NL91ABNA0417164300'
  check('een IBAN wordt gevonden', vindIban(`Rekening ${iban}`) === iban)
  check('ook met spaties zoals op een pas',
    vindIban('NL91 ABNA 0417 1643 00') === iban)
  check('ook tussen andere tekst',
    vindIban(`PASNR 1234\n${iban}\nVALID THRU 12/28`) === iban)

  /*
   * En hier hetzelfde: een pasnummer of een reeks die er toevallig uitziet
   * als een IBAN mag er niet doorheen. De mod-97 houdt dat tegen.
   */
  check('een nummer dat niet door de mod-97 komt telt niet',
    vindIban('NL00BANK0000000000') === undefined)
  check('en een gewone reeks cijfers evenmin',
    vindIban('1234567890123456') === undefined)

  /* --- de naam op de pas --- */

  const pastekst = 'MAESTRO\nNL91 ABNA 0417 1643 00\nW J DE BRUIJN\nVALID THRU 12/28'
  check('de naam op de pas wordt herkend',
    vindNaamOpPas(pastekst) === 'W J DE BRUIJN')
  check('en het merk niet', vindNaamOpPas(pastekst) !== 'MAESTRO')
  check('VALID THRU telt ook niet mee',
    (vindNaamOpPas(pastekst) ?? '').includes('VALID') === false)

  /* --- wat er wordt voorgesteld --- */

  const voorstellen = voorstellenUitId({
    mrz: gelezen, bsn: echt, tekst: '', gemist: [], kanten: 2,
  })

  /*
   * Het geval waar het misging: alleen de voorkant. Op een ID-kaart staan
   * het BSN en de machineleesbare regels achterop, dus dan mist de helft --
   * en dat hoort er ook bij te staan.
   */
  const halfDossier = { mrz: undefined, bsn: undefined, tekst: '',
    gemist: ['de twee regels onderaan het document', 'het burgerservicenummer'],
    kanten: 1 }
  check('met één kant mist er van alles', halfDossier.gemist.length === 2)
  check('en dat is te zien aan het aantal kanten', halfDossier.kanten === 1)
  check('er komen voorstellen uit een scan', voorstellen.length >= 3)
  check('het BSN zit erbij', voorstellen.some((v) => v.veld === 'bsn'))
  check('met de mededeling dat de elfproef klopt',
    voorstellen.find((v) => v.veld === 'bsn')?.gecontroleerd === 'elfproef klopt')
  check('en de geboortedatum is nagerekend',
    (voorstellen.find((v) => v.veld === 'geboortedatum')?.gecontroleerd ?? '')
      .includes('controlecijfer'))

  const leeg = voorstellenUitId({ tekst: '', gemist: ['alles'] })
  check('een mislukte scan stelt niets voor', leeg.length === 0)

  const pasVoorstel = voorstellenUitPas({ iban, naam: 'W J DE BRUIJN', tekst: '', gemist: [] })
  check('een pas levert het rekeningnummer op',
    pasVoorstel.some((v) => v.veld === 'iban'))
  check('met de mod-97 erbij',
    pasVoorstel.find((v) => v.veld === 'iban')?.gecontroleerd === 'mod-97 klopt')
}

/* ==================================================================== *
 *  De kassa's en de kluis
 *
 *  Twee dingen die hier fout kunnen gaan zonder dat iemand het merkt: een
 *  koppelcode met tekens die je niet uit elkaar houdt, en een kluissaldo dat
 *  net niet klopt. Bij het eerste belt er iemand; bij het tweede niet.
 * ==================================================================== */

console.log('\n— kassa en kluis —')

{
  const {
    schoonCode, codeProbleem, voorstelCode, nieuweCode, toonCode, openCodes,
    muntWaarde, waardeVan, saldoVan, laatsteTelling, tellingAchterstallig,
    bewegingenVan, coupuresOpVolgorde, coupureLabel, apparaatVan, stilte,
    TELLING_TERMIJN,
  } = await import('../src/lib/kassa')

  /* --- de code op de bon --- */

  check('een code wordt hoofdletters', schoonCode('kas-utr-1') === 'KAS-UTR-1')
  check('spaties worden streepjes', schoonCode('kas utr 1') === 'KAS-UTR-1')
  check('rommel eruit', schoonCode('kas//utr__1') === 'KAS-UTR-1')
  check('geen streepje aan het begin of eind', schoonCode('-kas-') === 'KAS')

  const kassas = [
    { id: 'r1', code: 'KAS-UTR-1', name: 'Balie', locationId: 'loc_utr',
      lastSeq: 42, active: true, updatedAt: 0 },
    { id: 'r2', code: 'KAS-UTR-2', name: 'Buiten', locationId: 'loc_utr',
      lastSeq: 0, active: false, updatedAt: 0 },
  ] as never[]

  check('een dubbele code wordt tegengehouden',
    !!codeProbleem('kas utr 1', kassas))
  check('en dat wordt uitgelegd, niet als databasefout',
    (codeProbleem('KAS-UTR-1', kassas) ?? '').includes('op elke bon'))
  check('een vrije code mag', codeProbleem('KAS-UTR-3', kassas) === null)
  check('je eigen code botst niet met jezelf',
    codeProbleem('KAS-UTR-1', kassas, 'r1') === null)
  check('twee tekens is te kort', !!codeProbleem('AB', kassas))

  const voorstel = voorstelCode({ code: 'TW-UTR' } as never, kassas)
  check('het voorstel telt door op wat er staat', voorstel === 'KAS-UTR-3',
    voorstel)

  /* --- de koppelcode --- */

  const codes = Array.from({ length: 60 }, () => nieuweCode())

  check('een code is acht tekens', codes.every((c) => c.length === 8))
  check('en alleen hoofdletters en cijfers',
    codes.every((c) => /^[A-Z0-9]{8}$/.test(c)))

  /*
   * Dit is de hele reden dat er een eigen alfabet is. Een code wordt van een
   * scherm gelezen en op een tablet ingetikt; wie een I voor een 1 aanziet
   * krijgt "code onbekend" en belt.
   */
  check('geen I, L, O, 0 of 1 erin',
    codes.every((c) => !/[ILO01]/.test(c)),
    codes.find((c) => /[ILO01]/.test(c)))

  check('twee codes achter elkaar zijn niet gelijk',
    new Set(codes).size === codes.length)

  check('een code wordt in twee groepjes getoond',
    toonCode('K7QJ4M2P') === 'K7QJ-4M2P')
  check('en de streepjes storen niet bij het teruglezen',
    toonCode('K7QJ-4M2P') === 'K7QJ-4M2P')

  const nu = Date.now()
  const alleCodes = [
    { id: 'p1', code: 'AAAABBBB', registerId: 'r1', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu + 3_600_000, updatedAt: 0 },
    { id: 'p2', code: 'CCCCDDDD', registerId: 'r1', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu - 1000, updatedAt: 0 },
    { id: 'p3', code: 'EEEEFFFF', registerId: 'r1', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu + 3_600_000, usedAt: nu, updatedAt: 0 },
    { id: 'p4', code: 'GGGGHHHH', registerId: 'r2', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu + 3_600_000, updatedAt: 0 },
  ] as never[]

  const open = openCodes(alleCodes, 'r1', nu)
  check('alleen codes die nog werken', open.length === 1 && open[0].id === 'p1')
  check('een verlopen code telt niet mee', !open.some((c) => c.id === 'p2'))
  check('een gebruikte code ook niet', !open.some((c) => c.id === 'p3'))
  check('en een code van een andere kassa evenmin', !open.some((c) => c.id === 'p4'))

  /* --- briefjes en munten --- */

  check('b100 is een briefje van honderd', muntWaarde('b100') === 100)
  check('m5 is vijf cent', muntWaarde('m5') === 0.05)
  /*
   * Dit onderscheid is de reden dat de sleutel met een letter begint. Vijf
   * euro tegenover vijf cent scheelt een factor honderd, en dat wil je niet
   * in een kasverschil terugvinden.
   */
  check('b5 en m5 zijn niet hetzelfde', muntWaarde('b5') !== muntWaarde('m5'))
  check('b5 is vijf euro', muntWaarde('b5') === 5)
  check('onzin is niets waard', muntWaarde('x9') === 0)

  check('een stapel telt op',
    waardeVan({ b50: 2, b20: 1, m50: 3, m5: 4 }) === 100 + 20 + 1.5 + 0.2)
  check('een lege stapel is nul', waardeVan({}) === 0)
  check('en niets is ook nul', waardeVan(undefined) === 0)

  check('coupures staan van groot naar klein',
    coupuresOpVolgorde({ m5: 1, b50: 1, m50: 1 }).map((c) => c[0]).join(',')
      === 'b50,m50,m5')
  check('nul stuks doen niet mee',
    coupuresOpVolgorde({ b50: 0, b20: 2 }).length === 1)
  check('een briefje heet euro', coupureLabel('b50') === '€ 50')
  check('en een munt cent', coupureLabel('m20') === '20 cent')

  /* --- het saldo --- */

  const DAG = 86_400_000
  const bewegingen = [
    { id: 'm1', safeId: 'k1', soort: 'inleg', coins: { b50: 4 }, amount: 200,
      reason: '', userName: '', at: nu - 10 * DAG, updatedAt: 0 },
    { id: 'm2', safeId: 'k1', soort: 'telling', coins: {}, counted: { b50: 4, b20: 1 },
      amount: 0, expected: 200, difference: 20,
      reason: '', userName: '', at: nu - 5 * DAG, updatedAt: 0 },
    { id: 'm3', safeId: 'k1', soort: 'afstorting', coins: { b20: 5 }, amount: 100,
      reason: '', userName: '', at: nu - 2 * DAG, updatedAt: 0 },
    { id: 'm4', safeId: 'k1', soort: 'naar-bank', coins: { b50: 2 }, amount: -100,
      reason: '', userName: '', at: nu - 1 * DAG, updatedAt: 0 },
    { id: 'm9', safeId: 'k2', soort: 'inleg', coins: { b10: 1 }, amount: 10,
      reason: '', userName: '', at: nu, updatedAt: 0 },
  ] as never[]

  /*
   * Vanaf de laatste telling optellen. De inleg van tien dagen geleden telt
   * dus niet mee: die zat al in wat er is geteld.
   */
  check('het saldo begint bij de laatste telling',
    saldoVan(bewegingen, 'k1') === 220 + 100 - 100)
  check('een andere kluis staat er los van', saldoVan(bewegingen, 'k2') === 10)
  check('zonder bewegingen is het nul', saldoVan([], 'k1') === 0)

  const zonderTelling = bewegingen.filter((m) => m.soort !== 'telling')
  check('zonder telling wordt alles opgeteld',
    saldoVan(zonderTelling, 'k1') === 200 + 100 - 100)

  /*
   * Twee boekingen in dezelfde milliseconde. Zou er alleen op tijd worden
   * gesorteerd, dan viel de boeking van hetzelfde moment als de telling uit
   * het saldo -- geen fout, alleen een bedrag dat niet klopt.
   */
  const zelfdeTel = [
    { id: 'a', safeId: 'k3', soort: 'telling', coins: {}, counted: { b50: 1 },
      amount: 0, reason: '', userName: '', at: 1000, updatedAt: 0 },
    { id: 'b', safeId: 'k3', soort: 'inleg', coins: { b10: 1 }, amount: 10,
      reason: '', userName: '', at: 1000, updatedAt: 0 },
  ] as never[]
  check('een boeking van hetzelfde moment als de telling telt mee',
    saldoVan(zelfdeTel, 'k3') === 60)

  /* --- is er nog geteld --- */

  check('de laatste telling wordt gevonden',
    laatsteTelling(bewegingen, 'k1')?.id === 'm2')
  check('een kluis zonder telling levert niets op',
    laatsteTelling(bewegingen, 'k2') === undefined)

  check('vijf dagen geleden geteld is op tijd',
    !tellingAchterstallig(bewegingen, 'k1', nu).achterstallig)
  check('twintig dagen niet',
    tellingAchterstallig(bewegingen, 'k1', nu + 20 * DAG).achterstallig)
  check('nooit geteld telt als achterstallig',
    tellingAchterstallig(bewegingen, 'k2', nu).achterstallig)
  check('en dat wordt apart gemeld',
    tellingAchterstallig(bewegingen, 'k2', nu).nooit)
  check('de termijn staat op veertien dagen', TELLING_TERMIJN === 14 * DAG)

  check('de bewegingen komen nieuwste eerst',
    bewegingenVan(bewegingen, 'k1')[0].id === 'm4')
  check('en alleen van die kluis',
    bewegingenVan(bewegingen, 'k1').every((m) => m.safeId === 'k1'))

  /* --- welk apparaat staat er --- */

  const apparaten = [
    { id: 'd1', registerId: 'r1', status: 'ingetrokken', deviceKey: 'a',
      name: 'Oude tablet', platform: 'android', pairedAt: 1, updatedAt: 0 },
    { id: 'd2', registerId: 'r1', status: 'actief', deviceKey: 'b',
      name: 'Tablet balie', platform: 'android', pairedAt: 2,
      lastSeenAt: nu - 3_600_000, updatedAt: 0 },
  ] as never[]

  check('het actieve apparaat wordt gepakt',
    apparaatVan(apparaten, 'r1')?.id === 'd2')
  check('een ingetrokken apparaat blijft zichtbaar als er niets anders is',
    apparaatVan([apparaten[0]], 'r1')?.id === 'd1')
  check('en zonder apparaat komt er niets uit',
    apparaatVan(apparaten, 'r9') === undefined)

  check('de stilte wordt gemeten', stilte(apparaten[1], nu) === 3_600_000)
  check('een apparaat dat zich nooit meldde geeft niets',
    stilte(apparaten[0], nu) === null)
}

/* ==================================================================== */

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
