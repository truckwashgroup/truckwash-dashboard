import { db, uid } from './db'
import { enqueue } from './sync'
import {
  SERVICES,
  type AppNotification, type Course, type CourseProgress, type Expense,
  type ExpenseStatus, type InventoryItem, type NotificationKind, type Permission,
  SHIFT_KINDS,
  type Role, type ServiceKind, type Shift, type ShiftKind, type TimeEntry,
  type User, type WashJob, type WashStatus,
} from './types'
import { showDeviceNotification } from './notify'
import { mailBericht } from './mail'

/* ------------------------------------------------------------------ *
 *  Alle schrijfacties lopen hierlangs.
 *  Patroon: lokaal opslaan (direct zichtbaar) -> outbox -> sync.
 *  De UI wacht dus nooit op het netwerk.
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<any> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

/* ------------------------- Wasopdrachten -------------------------- */

export const jobs = {
  async create(input: {
    locationId: string
    companyId: string
    companyName: string
    plate: string
    service: ServiceKind
    scheduledAt: number
    notes?: string
    createdBy: string
    discountPct?: number
  }) {
    const meta = SERVICES[input.service]
    const price = Math.round(meta.price * (1 - (input.discountPct ?? 0) / 100) * 100) / 100
    const job: WashJob = {
      id: uid('job'),
      ticket: 'W' + String(Math.floor(Date.now() / 1000) % 100000),
      locationId: input.locationId,
      companyId: input.companyId,
      companyName: input.companyName,
      plate: input.plate.toUpperCase().trim(),
      service: input.service,
      status: 'gepland',
      scheduledAt: input.scheduledAt,
      priceExcl: price,
      notes: input.notes,
      createdBy: input.createdBy,
      updatedAt: Date.now(),
    }
    return put('washJobs', db.washJobs, job)
  },

  async setStatus(id: string, status: WashStatus) {
    const job = await db.washJobs.get(id)
    if (!job) return
    const patch: WashJob = { ...job, status }
    if (status === 'bezig' && !job.startedAt) patch.startedAt = Date.now()
    if (status === 'gereed') patch.completedAt = Date.now()
    if (status === 'wachtrij') { patch.startedAt = undefined; patch.completedAt = undefined }
    return put('washJobs', db.washJobs, patch)
  },

  async assign(id: string, user: Pick<User, 'id' | 'name'> | null) {
    const job = await db.washJobs.get(id)
    if (!job) return
    return put('washJobs', db.washJobs, {
      ...job,
      assignedTo: user?.id,
      assignedName: user?.name,
    })
  },

  async update(id: string, patch: Partial<WashJob>) {
    const job = await db.washJobs.get(id)
    if (!job) return
    return put('washJobs', db.washJobs, { ...job, ...patch, id })
  },
}

/* --------------------------- Voorraad ----------------------------- */

export const inventory = {
  async adjust(input: {
    itemId: string
    qty: number
    reason: string
    user: Pick<User, 'id' | 'name'>
    jobId?: string
  }) {
    const item = await db.inventory.get(input.itemId)
    if (!item) return

    const movement = {
      id: uid('sm'),
      itemId: item.id,
      itemName: item.name,
      qty: input.qty,
      reason: input.reason,
      jobId: input.jobId,
      userId: input.user.id,
      userName: input.user.name,
      at: Date.now(),
    }
    await db.stockMovements.put(movement)
    await enqueue('stockMovements', 'put', movement.id, movement)

    const next: InventoryItem = {
      ...item,
      stock: Math.round((item.stock + input.qty) * 100) / 100,
    }
    await put('inventory', db.inventory, next)
    return movement
  },

  async upsert(item: InventoryItem) {
    return put('inventory', db.inventory, item)
  },

  async create(input: Omit<InventoryItem, 'id' | 'updatedAt'>) {
    return put('inventory', db.inventory, { ...input, id: uid('inv'), updatedAt: Date.now() })
  },
}

/* ---------------------------- Kosten ------------------------------ */

export const expenses = {
  async create(input: Omit<Expense, 'id' | 'status' | 'updatedAt'>) {
    const exp: Expense = { ...input, id: uid('exp'), status: 'open', updatedAt: Date.now() }
    return put('expenses', db.expenses, exp)
  },

  async decide(
    id: string,
    status: Extract<ExpenseStatus, 'goedgekeurd' | 'afgekeurd'>,
    approver: Pick<User, 'id' | 'name'>,
    reason?: string,
  ) {
    const exp = await db.expenses.get(id)
    if (!exp) return
    return put('expenses', db.expenses, {
      ...exp,
      status,
      approvedBy: approver.id,
      approvedByName: approver.name,
      approvedAt: Date.now(),
      rejectReason: status === 'afgekeurd' ? reason : undefined,
    })
  },

  async reopen(id: string) {
    const exp = await db.expenses.get(id)
    if (!exp) return
    return put('expenses', db.expenses, {
      ...exp,
      status: 'open',
      approvedBy: undefined,
      approvedByName: undefined,
      approvedAt: undefined,
      rejectReason: undefined,
    })
  },
}

/* ----------------------------- Uren ------------------------------- */

/*
 * In- en uitklokken doet het dashboard niet meer.
 *
 * Dat gebeurt op het apparaat op de vestiging: je toetst je persoonlijke
 * code in of scant je badge, en daarmee ontstaat de urenregel -- op de plek
 * waar je ook werkelijk staat. Een knop op ieders telefoon maakt van
 * inklokken iets wat je vanaf de bank doet, en dat is geen urenstaat meer
 * maar een voorstel.
 *
 * Wat hier over is, is het enige wat het kantoor nog met de hand doet:
 * een regel afsluiten die is blijven openstaan omdat iemand aan het eind van
 * de dag vergat uit te klokken. De database laat dat toe aan het management
 * en aan een leidinggevende, en verder aan niemand.
 */
export const timeEntries = {
  async afsluiten(id: string, tot = Date.now()) {
    const entry = await db.timeEntries.get(id)
    if (!entry || entry.end) return entry
    return put('timeEntries', db.timeEntries, {
      ...entry,
      end: Math.max(tot, entry.start),
    })
  },
}

/* ----------------------------- Rooster ---------------------------- */

/**
 * Wie het rooster wijzigde, voor in het bericht aan de betrokkene.
 * Staat de persoon niet in de cache, dan noemen we het gewoon "het kantoor".
 */
async function actor(id?: string): Promise<{ id: string; name: string }> {
  const u = id ? await db.users.get(id) : undefined
  return { id: u?.id ?? 'systeem', name: u?.name ?? 'Het kantoor' }
}

/**
 * Bericht over een dienst die van jou is.
 *
 * Ook per mail: een dienst die verschuift terwijl jij het niet weet, is de
 * ene helft van een misverstand waar de andere helft om vier uur 's ochtends
 * voor de deur staat.
 */
async function meldRooster(
  shift: Shift,
  doorId: string | undefined,
  wat: 'ingepland' | 'gewijzigd' | 'vervallen',
) {
  const door = await actor(doorId)
  if (door.id === shift.userId) return

  const dag = new Date(shift.startAt).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const tijd = SHIFT_KINDS[shift.kind].counts
    ? ` van ${new Date(shift.startAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` +
      ` tot ${new Date(shift.endAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
    : ''

  const kop =
    wat === 'ingepland' ? `Je staat ingepland op ${dag}` :
    wat === 'gewijzigd' ? `Je dienst van ${dag} is gewijzigd` :
    `Je dienst van ${dag} is vervallen`

  await notifications.send({
    to: { id: shift.userId, name: shift.userName },
    from: door,
    kind: 'rooster',
    title: kop,
    body: wat === 'vervallen'
      ? 'Je hoeft die dag niet te komen.'
      : `${SHIFT_KINDS[shift.kind].label}${tijd}.` +
        (shift.note ? ` ${shift.note}` : ''),
    link: 'rooster',
    mail: true,
  })
}

export const shifts = {
  async create(input: {
    user: Pick<User, 'id' | 'name'>
    kind: ShiftKind
    startAt: number
    endAt: number
    breakMinutes?: number
    note?: string
    createdBy: string
  }) {
    const shift: Shift = {
      id: uid('sh'),
      userId: input.user.id,
      userName: input.user.name,
      kind: input.kind,
      startAt: input.startAt,
      endAt: input.endAt,
      breakMinutes: input.breakMinutes ?? 0,
      note: input.note,
      createdBy: input.createdBy,
      updatedAt: Date.now(),
    }
    const opgeslagen = await put('shifts', db.shifts, shift)
    await meldRooster(shift, input.createdBy, 'ingepland')
    return opgeslagen
  },

  async update(id: string, patch: Partial<Shift>, doorId?: string) {
    const shift = await db.shifts.get(id)
    if (!shift) return
    const bijgewerkt = await put('shifts', db.shifts, { ...shift, ...patch, id })

    /* Alleen berichten als er iets verandert waar de betrokkene iets aan
       heeft. Een opmerking die wordt bijgesteld hoeft geen mail. */
    const raakt =
      patch.startAt !== undefined && patch.startAt !== shift.startAt ||
      patch.endAt !== undefined && patch.endAt !== shift.endAt ||
      patch.kind !== undefined && patch.kind !== shift.kind

    if (raakt && bijgewerkt) {
      await meldRooster(bijgewerkt, doorId ?? shift.createdBy, 'gewijzigd')
    }
    return bijgewerkt
  },

  async remove(id: string, doorId?: string) {
    const shift = await db.shifts.get(id)
    await db.shifts.delete(id)
    await enqueue('shifts', 'delete', id, null)
    if (shift) await meldRooster(shift, doorId ?? shift.createdBy, 'vervallen')
  },
}

/* --------------------------- Berichten ---------------------------- */

export const notifications = {
  /**
   * Bericht aan één persoon.
   *
   * Met `mail: true` gaat het bericht ook naar het postvak. Dat doen we
   * alleen als iemand er iets mee moet en de app misschien dicht staat --
   * een storing die de wasstraat stillegt, een antwoord op zijn melding.
   * Niet voor alles, anders leest niemand het meer.
   */
  async send(input: {
    to: Pick<User, 'id' | 'name'>
    from: Pick<User, 'id' | 'name'>
    kind: NotificationKind
    title: string
    body: string
    link?: string
    mail?: boolean
    /**
     * Een vast id, voor berichten die maar één keer horen te bestaan --
     * een felicitatie bijvoorbeeld. Sturen twee apparaten hem tegelijk,
     * dan schrijft de tweede dezelfde regel over in plaats van er een
     * tweede bij te zetten.
     */
    id?: string
  }) {
    const note: AppNotification = {
      id: input.id ?? uid('nt'),
      toUserId: input.to.id,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body.trim(),
      fromUserId: input.from.id,
      fromName: input.from.name,
      createdAt: Date.now(),
      link: input.link,
      updatedAt: Date.now(),
    }
    const saved = await put('notifications', db.notifications, note)

    if (input.mail) {
      // Niet op wachten: de bel in de app is al gegaan.
      void mailBericht(input.to.id, {
        titel: note.title,
        tekst: note.body,
        van: input.from.name,
      })
    }

    return saved
  },

  /** Bericht aan iedereen met een bepaalde rol. */
  async broadcast(input: {
    role: Role
    from: Pick<User, 'id' | 'name'>
    kind: NotificationKind
    title: string
    body: string
    link?: string
  }) {
    const note: AppNotification = {
      id: uid('nt'),
      toRole: input.role,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body.trim(),
      fromUserId: input.from.id,
      fromName: input.from.name,
      createdAt: Date.now(),
      link: input.link,
      updatedAt: Date.now(),
    }
    return put('notifications', db.notifications, note)
  },

  async markRead(id: string) {
    const note = await db.notifications.get(id)
    if (!note || note.readAt) return
    return put('notifications', db.notifications, { ...note, readAt: Date.now() })
  },

  async markAllRead(userId: string, roles: Role[]) {
    const all = await db.notifications.toArray()
    const mine = all.filter(
      (n) => !n.readAt && (n.toUserId === userId || (n.toRole && roles.includes(n.toRole))),
    )
    for (const n of mine) {
      await put('notifications', db.notifications, { ...n, readAt: Date.now() })
    }
    return mine.length
  },

  /** Toont een melding op het apparaat zelf. */
  async toDevice(title: string, body: string) {
    await showDeviceNotification(title, body)
  },
}

/* --------------------------- Opleiding ---------------------------- */

export const learning = {
  async upsertCourse(course: Course) {
    return put('courses', db.courses, course)
  },

  /** Start of hervat een cursus. */
  async start(user: Pick<User, 'id' | 'name'>, courseId: string) {
    const id = `${user.id}__${courseId}`
    const existing = await db.courseProgress.get(id)
    if (existing) return existing

    const progress: CourseProgress = {
      id,
      userId: user.id,
      userName: user.name,
      courseId,
      startedAt: Date.now(),
      lessonIndex: 0,
      passed: false,
      attempts: 0,
      updatedAt: Date.now(),
    }
    return put('courseProgress', db.courseProgress, progress)
  },

  async setLesson(id: string, lessonIndex: number) {
    const p = await db.courseProgress.get(id)
    if (!p) return
    if (lessonIndex <= p.lessonIndex) return p
    return put('courseProgress', db.courseProgress, { ...p, lessonIndex })
  },

  /** Verwerkt een toetspoging. */
  async submitQuiz(id: string, scorePct: number, passScore: number, validMonths?: number) {
    const p = await db.courseProgress.get(id)
    if (!p) return
    const passed = scorePct >= passScore
    return put('courseProgress', db.courseProgress, {
      ...p,
      attempts: p.attempts + 1,
      score: scorePct,
      passed,
      completedAt: passed ? Date.now() : undefined,
      expiresAt: passed && validMonths
        ? new Date(new Date().setMonth(new Date().getMonth() + validMonths)).getTime()
        : undefined,
    })
  },

  /** Wijst een cursus toe met een uiterste datum. */
  async assign(input: {
    user: Pick<User, 'id' | 'name'>
    courseId: string
    assignedBy: string
    dueAt?: number
  }) {
    const id = `${input.user.id}__${input.courseId}`
    const existing = await db.courseProgress.get(id)
    const progress: CourseProgress = existing
      ? { ...existing, assignedBy: input.assignedBy, dueAt: input.dueAt }
      : {
          id,
          userId: input.user.id,
          userName: input.user.name,
          courseId: input.courseId,
          startedAt: 0,
          lessonIndex: 0,
          passed: false,
          attempts: 0,
          assignedBy: input.assignedBy,
          dueAt: input.dueAt,
          updatedAt: Date.now(),
        }
    return put('courseProgress', db.courseProgress, progress)
  },
}

/* ---------------------------- Gebruikers -------------------------- */

export const users = {
  /**
   * Nieuw personeelsdossier. Dit maakt nog geen inlogaccount aan -- dat kan
   * alleen met beheerdersrechten, die bewust niet in de app zitten. Zodra de
   * persoon een account krijgt, koppelt de server dat op e-mailadres.
   */
  async create(input: {
    name: string
    email: string
    roles: Role[]
    personnelNumber?: string
    phone?: string
    function?: string
    hourlyRate?: number
    contractHours?: number
    startDate?: number
    companyId?: string
    notes?: string
  }) {
    const user: User = {
      id: uid('u'),
      email: input.email.trim().toLowerCase(),
      password: '',
      name: input.name.trim(),
      roles: input.roles,
      active: true,
      personnelNumber: input.personnelNumber?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      function: input.function?.trim() || undefined,
      hourlyRate: input.hourlyRate,
      contractHours: input.contractHours,
      startDate: input.startDate,
      companyId: input.companyId,
      notes: input.notes?.trim() || undefined,
      updatedAt: Date.now(),
    }
    return put('users', db.users, user)
  },

  async update(id: string, patch: Partial<User>) {
    const user = await db.users.get(id)
    if (!user) return
    return put('users', db.users, { ...user, ...patch, id })
  },
  /** Zet de losse rechten (afwijkingen op de rol) van een medewerker. */
  async setPermissions(id: string, grants: Permission[], revokes: Permission[]) {
    const user = await db.users.get(id)
    if (!user) return
    return put('users', db.users, { ...user, grants, revokes })
  },

  async setSupervisor(id: string, supervisorId?: string) {
    const user = await db.users.get(id)
    if (!user) return
    return put('users', db.users, { ...user, supervisorId })
  },

  async setRoles(id: string, roles: Role[]) {
    const user = await db.users.get(id)
    if (!user) return
    return put('users', db.users, { ...user, roles })
  },

  async setActive(id: string, active: boolean) {
    const user = await db.users.get(id)
    if (!user) return
    return put('users', db.users, { ...user, active })
  },

  /**
   * Het uurtarief staat in het afgeschermde deel van het dossier, niet in
   * het profiel. Deze functie is er nog voor oude aanroepen en zet hem op
   * de juiste plek.
   */
  async setRate(id: string, hourlyRate: number) {
    const { dossier } = await import('./dossier')
    return dossier.save(id, { hourlyRate })
  },
}
