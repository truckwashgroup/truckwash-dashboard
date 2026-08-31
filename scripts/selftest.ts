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

/* ==================================================================== */

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
