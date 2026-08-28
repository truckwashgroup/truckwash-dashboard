import Dexie, { type Table } from 'dexie'
import type {
  Company, Expense, InventoryItem, OutboxRecord, Shift,
  StockMovement, TimeEntry, User, WashJob,
} from './types'

/**
 * Lokale cache. Alles wat de app toont komt hieruit — nooit direct van de
 * server. Daardoor werkt de app identiek met en zonder internet.
 */
class TruckwashDB extends Dexie {
  users!: Table<User, string>
  companies!: Table<Company, string>
  washJobs!: Table<WashJob, string>
  inventory!: Table<InventoryItem, string>
  stockMovements!: Table<StockMovement, string>
  expenses!: Table<Expense, string>
  timeEntries!: Table<TimeEntry, string>
  shifts!: Table<Shift, string>
  outbox!: Table<OutboxRecord, number>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('truckwash-client')
    this.version(1).stores({
      users: 'id, email, active, updatedAt',
      companies: 'id, name, updatedAt',
      washJobs: 'id, status, companyId, assignedTo, scheduledAt, updatedAt',
      inventory: 'id, name, stock, updatedAt',
      stockMovements: 'id, itemId, jobId, at',
      expenses: 'id, status, category, date, updatedAt',
      timeEntries: 'id, userId, jobId, start, updatedAt',
      outbox: '++id, entity, recordId, createdAt',
      meta: 'key',
    })

    // v2: rooster erbij, plus personeelsvelden op users
    this.version(2).stores({
      users: 'id, email, active, personnelNumber, updatedAt',
      shifts: 'id, userId, startAt, updatedAt',
    })
  }
}

export const db = new TruckwashDB()

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

export function uid(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${raw}` : raw
}
