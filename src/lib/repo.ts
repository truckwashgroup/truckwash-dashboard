import { db, uid } from './db'
import { enqueue } from './sync'
import {
  SERVICES,
  type Expense, type ExpenseStatus, type InventoryItem, type Role,
  type ServiceKind, type Shift, type ShiftKind, type TimeEntry,
  type User, type WashJob, type WashStatus,
} from './types'

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

export const timeEntries = {
  async clockIn(user: Pick<User, 'id' | 'name'>, jobId?: string, note?: string) {
    const entry: TimeEntry = {
      id: uid('te'),
      userId: user.id,
      userName: user.name,
      jobId,
      start: Date.now(),
      note,
      updatedAt: Date.now(),
    }
    return put('timeEntries', db.timeEntries, entry)
  },

  async clockOut(id: string) {
    const entry = await db.timeEntries.get(id)
    if (!entry) return
    return put('timeEntries', db.timeEntries, { ...entry, end: Date.now() })
  },
}

/* ----------------------------- Rooster ---------------------------- */

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
    return put('shifts', db.shifts, shift)
  },

  async update(id: string, patch: Partial<Shift>) {
    const shift = await db.shifts.get(id)
    if (!shift) return
    return put('shifts', db.shifts, { ...shift, ...patch, id })
  },

  async remove(id: string) {
    await db.shifts.delete(id)
    await enqueue('shifts', 'delete', id, null)
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

  async setRate(id: string, hourlyRate: number) {
    const user = await db.users.get(id)
    if (!user) return
    return put('users', db.users, { ...user, hourlyRate })
  },
}
