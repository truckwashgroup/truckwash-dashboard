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

  /* --- personeelsdossier --- */

  /** Intern personeelsnummer, bijv. TW-014 */
  personnelNumber?: string
  phone?: string
  /** Contracturen per week */
  contractHours?: number
  /** Datum in dienst (epoch ms) */
  startDate?: number
  /** Datum uit dienst, leeg zolang iemand in dienst is */
  endDate?: number
  function?: string
  notes?: string
  /**
   * Het inlogaccount waaraan dit dossier hangt. Leeg betekent: wel op de
   * loonlijst, nog geen toegang tot de app.
   */
  authId?: string
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
 *  Rooster
 * ------------------------------------------------------------------ */

export type ShiftKind = 'dienst' | 'verlof' | 'ziek' | 'vrij'

export const SHIFT_KINDS: Record<ShiftKind, { label: string; tone: string; counts: boolean }> = {
  dienst: { label: 'Dienst',     tone: 'brand',  counts: true },
  verlof: { label: 'Verlof',     tone: 'info',   counts: false },
  ziek:   { label: 'Ziek',       tone: 'danger', counts: false },
  vrij:   { label: 'Vrije dag',  tone: 'default', counts: false },
}

export interface Shift {
  id: string
  userId: string
  userName: string
  kind: ShiftKind
  /** Begin en eind van de dienst (epoch ms) */
  startAt: number
  endAt: number
  /** Onbetaalde pauze in minuten */
  breakMinutes: number
  note?: string
  createdBy: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Sync
 * ------------------------------------------------------------------ */

export type EntityName =
  | 'users' | 'companies' | 'washJobs' | 'inventory'
  | 'stockMovements' | 'expenses' | 'timeEntries' | 'shifts'

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
