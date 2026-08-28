import Dexie, { type Table } from 'dexie'
import type { ApiAdapter, PullResult, PushChange } from './types'
import type {
  AppNotification, Company, Course, CourseProgress, EntityName, Expense,
  InventoryItem, Shift, StockMovement, TimeEntry, User, WashJob,
} from '../types'
import { SERVICES } from '../types'
import { COURSES } from '../courses'

/* ------------------------------------------------------------------ *
 *  Mock-server: een aparte database die doet alsof het "de cloud" is.
 *  Zo is push/pull echt zichtbaar en is de swap naar een echte API
 *  later één bestand.
 * ------------------------------------------------------------------ */

class MockServerDB extends Dexie {
  users!: Table<User, string>
  companies!: Table<Company, string>
  washJobs!: Table<WashJob, string>
  inventory!: Table<InventoryItem, string>
  stockMovements!: Table<StockMovement, string>
  expenses!: Table<Expense, string>
  timeEntries!: Table<TimeEntry, string>
  shifts!: Table<Shift, string>
  notifications!: Table<AppNotification, string>
  courses!: Table<Course, string>
  courseProgress!: Table<CourseProgress, string>

  constructor() {
    super('truckwash-mock-server')
    this.version(1).stores({
      users: 'id, email, updatedAt',
      companies: 'id, updatedAt',
      washJobs: 'id, updatedAt',
      inventory: 'id, updatedAt',
      stockMovements: 'id, at',
      expenses: 'id, updatedAt',
      timeEntries: 'id, updatedAt',
      shifts: 'id, userId, startAt, updatedAt',
      notifications: 'id, toUserId, updatedAt',
      courses: 'id, updatedAt',
      courseProgress: 'id, userId, updatedAt',
    })
  }
}

const server = new MockServerDB()

const ENTITY_TABLES: Record<EntityName, () => Table<any, string>> = {
  users: () => server.users,
  companies: () => server.companies,
  washJobs: () => server.washJobs,
  inventory: () => server.inventory,
  stockMovements: () => server.stockMovements,
  expenses: () => server.expenses,
  timeEntries: () => server.timeEntries,
  shifts: () => server.shifts,
  notifications: () => server.notifications,
  courses: () => server.courses,
  courseProgress: () => server.courseProgress,
}

/* ------------------------------------------------------------------ *
 *  Netwerksimulatie — hiermee kun je in de app offline gaan om de
 *  cache + wachtrij live te testen.
 * ------------------------------------------------------------------ */

const FORCE_OFFLINE_KEY = 'tw.forceOffline'

export function isForcedOffline() {
  return localStorage.getItem(FORCE_OFFLINE_KEY) === '1'
}

export function setForcedOffline(v: boolean) {
  localStorage.setItem(FORCE_OFFLINE_KEY, v ? '1' : '0')
  window.dispatchEvent(new Event(v ? 'offline' : 'online'))
}

function reachable() {
  return navigator.onLine && !isForcedOffline()
}

const latency = () => new Promise((r) => setTimeout(r, 180 + Math.random() * 320))

async function guard() {
  await latency()
  if (!reachable()) throw new Error('Geen verbinding met de server')
}

/* ------------------------------------------------------------------ *
 *  Seed
 * ------------------------------------------------------------------ */

const DAY = 86_400_000
const now = () => Date.now()

function pick<T>(arr: T[], i: number): T {
  return arr[Math.abs(i) % arr.length]
}

function startOfDay(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const DEMO_ACCOUNTS = [
  { email: 'casper@truckwash1group.nl', password: 'truckwash', label: 'Eigenaar — alle 3 de dashboards' },
  { email: 'manager@truckwash1group.nl', password: 'manager', label: 'Management — alle 3 de dashboards' },
  { email: 'wasser@truckwash1group.nl', password: 'wasser', label: 'Werknemer — 2 dashboards' },
  { email: 'planning@transportjansen.nl', password: 'klant', label: 'Klant — 1 dashboard' },
]

async function seed() {
  const count = await server.users.count()
  if (count > 0) return

  const t = now()

  const companies: Company[] = [
    { id: 'co_jansen', name: 'Transport Jansen B.V.', contact: 'Mark Jansen', email: 'planning@transportjansen.nl', phone: '030-1234567', city: 'Utrecht', contractDiscountPct: 10, updatedAt: t },
    { id: 'co_devries', name: 'De Vries Logistiek', contact: 'Sanne de Vries', email: 'wagenpark@devrieslogistiek.nl', phone: '010-7654321', city: 'Rotterdam', contractDiscountPct: 5, updatedAt: t },
    { id: 'co_koeltrans', name: 'KoelTrans Nederland', contact: 'Ahmed Yilmaz', email: 'info@koeltrans.nl', phone: '040-2223344', city: 'Eindhoven', contractDiscountPct: 12, updatedAt: t },
    { id: 'co_bulk', name: 'BulkLine Tankvervoer', contact: 'Petra Bos', email: 'planning@bulkline.nl', phone: '050-9988776', city: 'Groningen', contractDiscountPct: 8, updatedAt: t },
  ]

  const YEAR = 365 * DAY
  const users: User[] = [
    { id: 'u_casper', authId: 'u_casper', email: 'casper@truckwash1group.nl', password: 'truckwash', name: 'Casper', roles: ['employee', 'customer', 'management'], active: true, hourlyRate: 0,
      personnelNumber: 'TW-001', phone: '06-12345678', function: 'Eigenaar', contractHours: 40, startDate: t - 8 * YEAR, updatedAt: t },
    { id: 'u_manager', authId: 'u_manager', email: 'manager@truckwash1group.nl', password: 'manager', name: 'Ilse Bakker', roles: ['employee', 'customer', 'management'], active: true, hourlyRate: 34,
      personnelNumber: 'TW-002', phone: '06-23456789', function: 'Vestigingsmanager', contractHours: 38, startDate: t - 4 * YEAR, updatedAt: t },
    { id: 'u_wasser', authId: 'u_wasser', email: 'wasser@truckwash1group.nl', password: 'wasser', name: 'Tom Verhoeven', roles: ['employee', 'customer'], active: true, hourlyRate: 22,
      personnelNumber: 'TW-014', phone: '06-34567890', function: 'Wasmedewerker', supervisorId: 'u_wasser3', contractHours: 40, startDate: t - 2 * YEAR, updatedAt: t },
    { id: 'u_wasser2', authId: 'u_wasser2', email: 'daan@truckwash1group.nl', password: 'wasser', name: 'Daan Smit', roles: ['employee', 'customer'], active: true, hourlyRate: 21,
      personnelNumber: 'TW-018', phone: '06-45678901', function: 'Wasmedewerker', supervisorId: 'u_wasser3', contractHours: 32, startDate: t - 400 * DAY, updatedAt: t },
    { id: 'u_wasser3', authId: 'u_wasser3', email: 'nour@truckwash1group.nl', password: 'wasser', name: 'Nour El Amrani', roles: ['employee', 'supervisor', 'customer'], active: true, hourlyRate: 23.5,
      personnelNumber: 'TW-021', phone: '06-56789012', function: 'Voorman wasstraat', contractHours: 40, startDate: t - 640 * DAY, updatedAt: t },
    // Wel op de loonlijst, nog geen inlogaccount -- laat zien hoe dat eruitziet
    { id: 'u_nieuw', email: 'joris@truckwash1group.nl', password: '', name: 'Joris Peters', roles: ['employee'], active: true, hourlyRate: 20,
      personnelNumber: 'TW-024', phone: '06-67890123', function: 'Wasmedewerker', supervisorId: 'u_wasser3', contractHours: 24, startDate: t - 12 * DAY, notes: 'Zaterdaghulp, nog inwerken op tankreiniging.', updatedAt: t },
    { id: 'u_klant', authId: 'u_klant', email: 'planning@transportjansen.nl', password: 'klant', name: 'Mark Jansen', roles: ['customer'], companyId: 'co_jansen', active: true, updatedAt: t },
    { id: 'u_klant2', authId: 'u_klant2', email: 'wagenpark@devrieslogistiek.nl', password: 'klant', name: 'Sanne de Vries', roles: ['customer'], companyId: 'co_devries', active: true, updatedAt: t },
  ]

  const inventory: InventoryItem[] = [
    { id: 'inv_shampoo', name: 'Truckshampoo concentraat', unit: 'liter', stock: 240, minStock: 100, pricePerUnit: 3.85, supplier: 'CleanChem BV', updatedAt: t },
    { id: 'inv_ontvetter', name: 'Alkalische ontvetter', unit: 'liter', stock: 68, minStock: 80, pricePerUnit: 5.4, supplier: 'CleanChem BV', updatedAt: t },
    { id: 'inv_velgen', name: 'Velgenreiniger zuur', unit: 'liter', stock: 45, minStock: 30, pricePerUnit: 6.2, supplier: 'CleanChem BV', updatedAt: t },
    { id: 'inv_wax', name: 'Droogwax / glansmiddel', unit: 'liter', stock: 112, minStock: 60, pricePerUnit: 4.75, supplier: 'Nordic Wash', updatedAt: t },
    { id: 'inv_borstel', name: 'Wasborstel telescoop', unit: 'stuk', stock: 7, minStock: 4, pricePerUnit: 42, supplier: 'WashParts NL', updatedAt: t },
    { id: 'inv_doek', name: 'Microvezeldoek', unit: 'stuk', stock: 180, minStock: 100, pricePerUnit: 1.35, supplier: 'WashParts NL', updatedAt: t },
    { id: 'inv_zout', name: 'Onthardingszout', unit: 'kg', stock: 520, minStock: 250, pricePerUnit: 0.42, supplier: 'AquaSoft', updatedAt: t },
    { id: 'inv_handschoen', name: 'Nitril handschoenen', unit: 'doos', stock: 9, minStock: 12, pricePerUnit: 8.9, supplier: 'SafetyFirst', updatedAt: t },
  ]

  const plates = ['12-BND-4', '84-JHT-9', 'VJ-701-P', '17-BKX-2', 'BZ-49-TL', '91-PLD-3', 'RJ-338-N', '05-GVS-7', 'XT-812-K', '63-NRD-1']
  const serviceKeys = Object.keys(SERVICES) as (keyof typeof SERVICES)[]
  const staff = users.filter((u) => u.roles.includes('employee') && u.id !== 'u_casper')

  const washJobs: WashJob[] = []
  const timeEntries: TimeEntry[] = []
  const stockMovements: StockMovement[] = []
  const shifts: Shift[] = []

  /* --- rooster: 14 dagen terug tot 28 dagen vooruit --- */
  const rosterStaff = users.filter((u) => u.roles.includes('employee'))
  const PATTERNS = [
    { start: 7, end: 15.5, label: 'Ochtenddienst' },
    { start: 11, end: 19.5, label: 'Middagdienst' },
    { start: 6, end: 14, label: 'Vroege dienst' },
  ]

  for (let d = -14; d <= 28; d++) {
    const day = startOfDay(t + d * DAY)
    const dow = new Date(day).getDay()
    if (dow === 0) continue // zondag gesloten

    rosterStaff.forEach((u, idx) => {
      const seed = idx * 7 + d
      const deeltijd = (u.contractHours ?? 40) < 32
      // vaste vrije dag per persoon, en deeltijders werken minder dagen
      const vrij = dow === (idx % 5) + 1 || (deeltijd && dow % 2 === 0)
      const kind: Shift['kind'] =
        seed % 37 === 0 ? 'ziek' :
        seed % 23 === 0 ? 'verlof' :
        vrij ? 'vrij' : 'dienst'

      const pat = PATTERNS[Math.abs(seed) % PATTERNS.length]
      const zaterdag = dow === 6

      shifts.push({
        id: 'sh_' + u.id + '_' + d,
        userId: u.id,
        userName: u.name,
        kind,
        startAt: day + (kind === 'dienst' ? (zaterdag ? 8 : pat.start) : 0) * 3_600_000,
        endAt: day + (kind === 'dienst' ? (zaterdag ? 13 : pat.end) : 24) * 3_600_000,
        breakMinutes: kind === 'dienst' && !zaterdag ? 30 : 0,
        note: kind === 'dienst' ? (zaterdag ? 'Zaterdagdienst' : pat.label) : undefined,
        createdBy: 'u_manager',
        updatedAt: t,
      })
    })
  }

  let n = 0

  // 70 dagen historie
  for (let d = 70; d >= 0; d--) {
    const day = startOfDay(t - d * DAY)
    const dow = new Date(day).getDay()
    if (dow === 0) continue // zondag gesloten
    const jobsToday = dow === 6 ? 3 + (d % 3) : 6 + (d % 5)

    for (let j = 0; j < jobsToday; j++) {
      n++
      const co = pick(companies, n + d)
      const svc = pick(serviceKeys, n * 3 + j)
      const meta = SERVICES[svc]
      const worker = pick(staff, n + j)
      const scheduledAt = day + (7 + j) * 3_600_000 + (n % 4) * 900_000
      const isPast = scheduledAt < t - 3_600_000
      const dur = Math.max(10, meta.minutes + ((n * 7) % 21) - 8)

      const status: WashJob['status'] = isPast
        ? n % 23 === 0
          ? 'geannuleerd'
          : 'gereed'
        : d === 0
          ? j < 2
            ? 'bezig'
            : 'wachtrij'
          : 'gepland'

      const job: WashJob = {
        id: 'job_' + d + '_' + j,
        ticket: 'W' + String(1000 + n),
        companyId: co.id,
        companyName: co.name,
        plate: pick(plates, n + j * 2),
        service: svc,
        status,
        assignedTo: worker.id,
        assignedName: worker.name,
        scheduledAt,
        startedAt: status === 'gereed' || status === 'bezig' ? scheduledAt + 300_000 : undefined,
        completedAt: status === 'gereed' ? scheduledAt + 300_000 + dur * 60_000 : undefined,
        priceExcl: Math.round(meta.price * (1 - co.contractDiscountPct / 100) * 100) / 100,
        createdBy: 'u_manager',
        updatedAt: scheduledAt,
      }
      washJobs.push(job)

      if (job.status === 'gereed') {
        timeEntries.push({
          id: 'te_' + job.id,
          userId: worker.id,
          userName: worker.name,
          jobId: job.id,
          start: job.startedAt!,
          end: job.completedAt!,
          note: meta.label,
          updatedAt: job.completedAt!,
        })
        const item = pick(inventory, n)
        const qty = -(Math.round((0.4 + (n % 7) * 0.15) * 10) / 10)
        stockMovements.push({
          id: 'sm_' + job.id,
          itemId: item.id,
          itemName: item.name,
          qty,
          reason: 'Verbruik ' + meta.label,
          jobId: job.id,
          userId: worker.id,
          userName: worker.name,
          at: job.completedAt!,
        })
      }
    }
  }

  // toekomstige afspraken
  for (let d = 1; d <= 12; d++) {
    const day = startOfDay(t + d * DAY)
    if (new Date(day).getDay() === 0) continue
    for (let j = 0; j < 3 + (d % 3); j++) {
      n++
      const co = pick(companies, n)
      const svc = pick(serviceKeys, n + d)
      const meta = SERVICES[svc]
      washJobs.push({
        id: 'job_f' + d + '_' + j,
        ticket: 'W' + String(1000 + n),
        companyId: co.id,
        companyName: co.name,
        plate: pick(plates, n),
        service: svc,
        status: 'gepland',
        scheduledAt: day + (7 + j * 2) * 3_600_000,
        priceExcl: Math.round(meta.price * (1 - co.contractDiscountPct / 100) * 100) / 100,
        createdBy: 'u_klant',
        updatedAt: t,
      })
    }
  }

  const expenseCats: Expense['category'][] = ['materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig']
  const suppliers = ['CleanChem BV', 'Eneco Zakelijk', 'WashParts NL', 'Garage Van Dijk', 'AquaSoft', 'Nordic Wash']
  const descriptions: Record<Expense['category'], string> = {
    materiaal: 'Levering reinigingsmiddelen',
    energie: 'Voorschot elektra en water',
    onderhoud: 'Onderhoud wasstraat / borstelunit',
    personeel: 'Uitzendkracht weekenddienst',
    transport: 'Brandstof bedrijfsbus',
    overig: 'Diverse bedrijfskosten',
  }

  const expenses: Expense[] = []
  for (let i = 0; i < 46; i++) {
    const dayOffset = Math.floor((i * 70) / 46)
    const cat = pick(expenseCats, i)
    const amount = Math.round((80 + ((i * 137) % 1900)) * 100) / 100
    const submitter = pick(staff, i)
    const recent = 70 - dayOffset < 14
    expenses.push({
      id: 'exp_' + i,
      date: startOfDay(t - (70 - dayOffset) * DAY),
      category: cat,
      supplier: pick(suppliers, i + 2),
      description: descriptions[cat] + ' — week ' + Math.max(1, Math.ceil((70 - dayOffset) / 7)),
      amountExcl: amount,
      vatPct: cat === 'personeel' ? 0 : 21,
      status: recent ? 'open' : i % 11 === 0 ? 'afgekeurd' : 'goedgekeurd',
      submittedBy: submitter.id,
      submittedByName: submitter.name,
      approvedBy: recent ? undefined : 'u_manager',
      approvedByName: recent ? undefined : 'Ilse Bakker',
      approvedAt: recent ? undefined : startOfDay(t - (68 - dayOffset) * DAY),
      rejectReason: !recent && i % 11 === 0 ? 'Bon ontbreekt' : undefined,
      updatedAt: t,
    })
  }

  /* --- opleiding --- */
  const courses = COURSES.map((c) => ({ ...c, updatedAt: t }))

  const courseProgress: CourseProgress[] = []
  for (const [i, u] of rosterStaff.entries()) {
    for (const [j, c] of courses.entries()) {
      // Niet iedereen heeft alles af: dat maakt het overzicht pas nuttig.
      const state = (i + j) % 4
      if (state === 3) continue // nog niet begonnen
      const done = state !== 2
      courseProgress.push({
        id: u.id + '__' + c.id,
        userId: u.id,
        userName: u.name,
        courseId: c.id,
        startedAt: t - (30 + i * 5 + j * 3) * DAY,
        lessonIndex: done ? c.lessons.length : Math.max(0, c.lessons.length - 2),
        completedAt: done ? t - (25 + i * 4) * DAY : undefined,
        score: done ? 80 + ((i + j) % 4) * 5 : undefined,
        passed: done,
        attempts: done ? 1 + ((i + j) % 2) : 0,
        expiresAt: done && c.validMonths
          ? t - (25 + i * 4) * DAY + c.validMonths * 30 * DAY
          : undefined,
        updatedAt: t,
      })
    }
  }

  /* --- berichten --- */
  const notifications = [
    {
      id: 'nt_1', toRole: 'employee' as const, kind: 'rooster' as const,
      title: 'Rooster volgende week staat klaar',
      body: 'Kijk je even of je diensten kloppen? Ruilen kan tot donderdag.',
      fromUserId: 'u_wasser3', fromName: 'Nour El Amrani',
      createdAt: t - 2 * 3_600_000, link: 'rooster', updatedAt: t,
    },
    {
      id: 'nt_2', toRole: 'employee' as const, kind: 'opleiding' as const,
      title: 'Herhaling Veilig werken',
      body: 'De jaarlijkse herhaling van VEI-01 staat open. Ronden voor het einde van de maand.',
      fromUserId: 'u_manager', fromName: 'Ilse Bakker',
      createdAt: t - 26 * 3_600_000, link: 'opleiding', updatedAt: t,
    },
    {
      id: 'nt_3', toUserId: 'u_wasser', kind: 'taak' as const,
      title: 'Ontvetter bijna op',
      body: 'De alkalische ontvetter staat onder het minimum. Wil jij de levering inboeken zodra die binnen is?',
      fromUserId: 'u_wasser3', fromName: 'Nour El Amrani',
      createdAt: t - 5 * 3_600_000, link: 'materiaal', updatedAt: t,
    },
  ]

  await server.transaction('rw', server.tables, async () => {
    await server.companies.bulkPut(companies)
    await server.users.bulkPut(users)
    await server.inventory.bulkPut(inventory)
    await server.washJobs.bulkPut(washJobs)
    await server.timeEntries.bulkPut(timeEntries)
    await server.stockMovements.bulkPut(stockMovements)
    await server.expenses.bulkPut(expenses)
    await server.shifts.bulkPut(shifts)
    await server.courses.bulkPut(courses)
    await server.courseProgress.bulkPut(courseProgress as never)
    await server.notifications.bulkPut(notifications as never)
  })
}

let seeding: Promise<void> | null = null
function ensureSeeded() {
  if (!seeding) seeding = seed()
  return seeding
}

/* ------------------------------------------------------------------ *
 *  Adapter
 * ------------------------------------------------------------------ */

export const mockApi: ApiAdapter = {
  name: 'mock',

  async ping() {
    await latency()
    return reachable()
  },

  async login(email, password) {
    await guard()
    await ensureSeeded()
    const target = email.trim().toLowerCase()
    const user = await server.users.filter((u) => u.email.toLowerCase() === target).first()
    if (!user || user.password !== password || !user.active) return null
    return {
      userId: user.id,
      token: 'mock.' + user.id + '.' + Date.now(),
      profile: user as unknown as Record<string, unknown>,
    }
  },

  async push(changes: PushChange[]) {
    await guard()
    await ensureSeeded()
    await server.transaction('rw', server.tables, async () => {
      for (const c of changes) {
        const table = ENTITY_TABLES[c.entity]()
        if (c.op === 'delete') {
          await table.delete(c.recordId)
        } else {
          await table.put({ ...(c.payload as object) } as any)
        }
      }
    })
  },

  async pull(since: number): Promise<PullResult> {
    await guard()
    await ensureSeeded()
    const changes: PullResult['changes'] = {}
    for (const entity of Object.keys(ENTITY_TABLES) as EntityName[]) {
      const table = ENTITY_TABLES[entity]()
      const field = entity === 'stockMovements' ? 'at' : 'updatedAt'
      const rows = await table.filter((r: any) => (r[field] ?? 0) > since).toArray()
      if (rows.length) changes[entity] = rows
    }
    return { changes, serverTime: Date.now() }
  },
}

export { ensureSeeded as seedMockServer }
