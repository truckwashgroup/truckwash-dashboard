/* ------------------------------------------------------------------ *
 *  Domeinmodel Truckwash1 Group
 * ------------------------------------------------------------------ */

export type Role = 'employee' | 'customer' | 'management'

export interface User {
  id: string
  email: string
  /** Alleen voor de mock-backend. Echte backend hasht dit serverside. */
  password: string
  name: string
  roles: Role[]
  /** Gekoppeld klantaccount (alleen relevant voor rol 'customer') */
  companyId?: string
  hourlyRate?: number
  active: boolean
  updatedAt: number
}

export interface Company {
  id: string
  name: string
  contact: string
  email: string
  phone: string
  city: string
  /** Afgesproken tarief per wasbeurt-type, override op standaardprijs */
  contractDiscountPct: number
  updatedAt: number
}

export type WashStatus = 'gepland' | 'wachtrij' | 'bezig' | 'gereed' | 'geannuleerd'
export type ServiceKind = 'buitenwas' | 'binnenwas' | 'combi' | 'tankreiniging' | 'polish'

export const SERVICES: Record<ServiceKind, { label: string; minutes: number; price: number }> = {
  buitenwas: { label: 'Buitenwas', minutes: 25, price: 65 },
  binnenwas: { label: 'Cabine binnen', minutes: 35, price: 55 },
  combi: { label: 'Combi (buiten + cabine)', minutes: 50, price: 110 },
  tankreiniging: { label: 'Tankreiniging', minutes: 90, price: 245 },
  polish: { label: 'Polijsten / coating', minutes: 180, price: 480 },
}

export interface WashJob {
  id: string
  ticket: string
  companyId: string
  companyName: string
  plate: string
  service: ServiceKind
  status: WashStatus
  /** user.id van de werknemer */
  assignedTo?: string
  assignedName?: string
  scheduledAt: number
  startedAt?: number
  completedAt?: number
  priceExcl: number
  notes?: string
  createdBy: string
  updatedAt: number
}

export interface InventoryItem {
  id: string
  name: string
  unit: string
  stock: number
  minStock: number
  pricePerUnit: number
  supplier: string
  updatedAt: number
}

export interface StockMovement {
  id: string
  itemId: string
  itemName: string
  /** negatief = verbruik, positief = ontvangst */
  qty: number
  reason: string
  jobId?: string
  userId: string
  userName: string
  at: number
}

export type ExpenseStatus = 'open' | 'goedgekeurd' | 'afgekeurd'

export interface Expense {
  id: string
  date: number
  category: 'materiaal' | 'energie' | 'onderhoud' | 'personeel' | 'transport' | 'overig'
  supplier: string
  description: string
  amountExcl: number
  vatPct: number
  status: ExpenseStatus
  submittedBy: string
  submittedByName: string
  approvedBy?: string
  approvedByName?: string
  approvedAt?: number
  rejectReason?: string
  updatedAt: number
}

export interface TimeEntry {
  id: string
  userId: string
  userName: string
  jobId?: string
  start: number
  end?: number
  note?: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Sync
 * ------------------------------------------------------------------ */

export type EntityName =
  | 'users' | 'companies' | 'washJobs' | 'inventory'
  | 'stockMovements' | 'expenses' | 'timeEntries'

export type SyncOp = 'put' | 'delete'

export interface OutboxRecord {
  id?: number
  entity: EntityName
  op: SyncOp
  recordId: string
  payload: unknown
  createdAt: number
  tries: number
  lastError?: string
}

export interface SyncState {
  online: boolean
  syncing: boolean
  pending: number
  lastSyncAt: number | null
  lastError: string | null
}
