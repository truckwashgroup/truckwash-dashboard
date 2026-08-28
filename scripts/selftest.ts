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

check('elke rol heeft een standaardset', Object.keys(ROLE_DEFAULTS).length === 5,
  Object.keys(ROLE_DEFAULTS).join(', '))

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

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
