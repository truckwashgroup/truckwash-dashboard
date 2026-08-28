/* ------------------------------------------------------------------ *
 *  Domeinmodel Truckwash1 Group
 * ------------------------------------------------------------------ */

export type Role = 'employee' | 'supervisor' | 'customer' | 'management'

export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Werknemer',
  supervisor: 'Leidinggevende',
  customer: 'Klant',
  management: 'Management',
}

export const ROLE_ORDER: Role[] = ['employee', 'supervisor', 'customer', 'management']

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

  /**
   * Afwijkingen op wat de rollen standaard toestaan. Hiermee stel je per
   * persoon precies bij wat wel en niet mag -- ook bij een leidinggevende,
   * zonder dat je daar een nieuwe rol voor hoeft te verzinnen.
   */
  grants?: Permission[]
  revokes?: Permission[]

  /** Onder welke leidinggevende deze medewerker valt */
  supervisorId?: string
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
 *  Rechten
 *
 *  Rollen bepalen wat iemand standaard mag. Daarbovenop kan het management
 *  per persoon losse rechten geven of intrekken. Zo kun je een leidinggevende
 *  wel het rooster laten maken maar de loonkosten laten afschermen, zonder
 *  daar een aparte rol voor te verzinnen.
 * ------------------------------------------------------------------ */

export type Permission =
  /* wasopdrachten */
  | 'jobs.view' | 'jobs.claim' | 'jobs.edit' | 'jobs.assign' | 'jobs.cancel'
  /* planning */
  | 'planning.view' | 'planning.edit'
  /* rooster */
  | 'roster.viewOwn' | 'roster.viewTeam' | 'roster.edit' | 'roster.publish'
  /* uren */
  | 'hours.own' | 'hours.viewTeam' | 'hours.approve'
  /* voorraad */
  | 'inventory.view' | 'inventory.adjust' | 'inventory.manage'
  /* kosten */
  | 'expenses.submit' | 'expenses.viewTeam' | 'expenses.approve'
  /* personeel */
  | 'staff.view' | 'staff.create' | 'staff.edit' | 'staff.permissions' | 'staff.pay'
  /* klanten */
  | 'customers.view' | 'customers.manage'
  /* financieel */
  | 'finance.view' | 'finance.export'
  /* berichten */
  | 'notify.send' | 'notify.broadcast'
  /* opleiding */
  | 'learning.take' | 'learning.assign' | 'learning.manage'
  /* beheer */
  | 'admin.settings' | 'admin.audit'

export interface PermissionMeta {
  key: Permission
  group: string
  label: string
  /** Wat dit recht in de praktijk betekent */
  hint: string
  /** Gevoelig: vraagt een extra bevestiging bij het toekennen */
  sensitive?: boolean
}

export const PERMISSIONS: PermissionMeta[] = [
  { key: 'jobs.view',         group: 'Wasstraat',  label: 'Wasopdrachten zien',   hint: 'De dagplanning en de wachtrij bekijken.' },
  { key: 'jobs.claim',        group: 'Wasstraat',  label: 'Wagens oppakken',      hint: 'Een wasbeurt aan zichzelf toewijzen en gereed melden.' },
  { key: 'jobs.edit',         group: 'Wasstraat',  label: 'Wasopdracht wijzigen', hint: 'Behandeling, tijd of opmerking aanpassen.' },
  { key: 'jobs.assign',       group: 'Wasstraat',  label: 'Wagens toewijzen',     hint: 'Bepalen wie welke wagen doet.' },
  { key: 'jobs.cancel',       group: 'Wasstraat',  label: 'Annuleren',            hint: 'Een wasbeurt schrappen.' },

  { key: 'planning.view',     group: 'Planning',   label: 'Volledige planning',   hint: 'Alle wasbeurten zien, ook van andere dagen.' },
  { key: 'planning.edit',     group: 'Planning',   label: 'Planning wijzigen',    hint: 'Wasbeurten verplaatsen en statussen zetten.' },

  { key: 'roster.viewOwn',    group: 'Rooster',    label: 'Eigen rooster',        hint: 'De eigen diensten bekijken.' },
  { key: 'roster.viewTeam',   group: 'Rooster',    label: 'Teamrooster',          hint: 'Het rooster van het hele team bekijken.' },
  { key: 'roster.edit',       group: 'Rooster',    label: 'Rooster maken',        hint: 'Diensten inplannen, wijzigen en verwijderen.' },
  { key: 'roster.publish',    group: 'Rooster',    label: 'Rooster publiceren',   hint: 'Een concept definitief maken en iedereen berichten.' },

  { key: 'hours.own',         group: 'Uren',       label: 'Eigen uren',           hint: 'In- en uitklokken, eigen registraties zien.' },
  { key: 'hours.viewTeam',    group: 'Uren',       label: 'Uren van het team',    hint: 'Zien hoeveel het team gewerkt heeft.' },
  { key: 'hours.approve',     group: 'Uren',       label: 'Uren goedkeuren',      hint: 'Registraties accorderen voor de verloning.' },

  { key: 'inventory.view',    group: 'Voorraad',   label: 'Voorraad zien',        hint: 'Standen en verbruik bekijken.' },
  { key: 'inventory.adjust',  group: 'Voorraad',   label: 'Verbruik boeken',      hint: 'Materiaal afboeken en leveringen bijboeken.' },
  { key: 'inventory.manage',  group: 'Voorraad',   label: 'Artikelen beheren',    hint: 'Artikelen toevoegen, prijzen en minima wijzigen.' },

  { key: 'expenses.submit',   group: 'Kosten',     label: 'Bon indienen',         hint: 'Zelf kosten ter goedkeuring aanbieden.' },
  { key: 'expenses.viewTeam', group: 'Kosten',     label: 'Bonnen van het team',  hint: 'Zien wat het team heeft ingediend.' },
  { key: 'expenses.approve',  group: 'Kosten',     label: 'Bonnen goedkeuren',    hint: 'Kosten accorderen of afkeuren.', sensitive: true },

  { key: 'staff.view',        group: 'Personeel',  label: 'Personeel zien',       hint: 'De medewerkerslijst en dossiers bekijken.' },
  { key: 'staff.create',      group: 'Personeel',  label: 'Medewerker toevoegen', hint: 'Nieuwe personeelsdossiers aanmaken.' },
  { key: 'staff.edit',        group: 'Personeel',  label: 'Gegevens wijzigen',    hint: 'Naam, functie en contracturen aanpassen.' },
  { key: 'staff.permissions', group: 'Personeel',  label: 'Rechten toekennen',    hint: 'Bepalen wat anderen mogen.', sensitive: true },
  { key: 'staff.pay',         group: 'Personeel',  label: 'Loongegevens zien',    hint: 'Uurtarieven en loonkosten inzien.', sensitive: true },

  { key: 'customers.view',    group: 'Klanten',    label: 'Klanten zien',         hint: 'Klantgegevens en contracten bekijken.' },
  { key: 'customers.manage',  group: 'Klanten',    label: 'Klanten beheren',      hint: 'Klanten toevoegen en kortingen wijzigen.' },

  { key: 'finance.view',      group: 'Financieel', label: 'Cijfers zien',         hint: 'Omzet, kosten en marge inzien.', sensitive: true },
  { key: 'finance.export',    group: 'Financieel', label: 'Exporteren',           hint: 'Overzichten downloaden of afdrukken.' },

  { key: 'notify.send',       group: 'Berichten',  label: 'Bericht sturen',       hint: 'Een melding sturen naar losse medewerkers.' },
  { key: 'notify.broadcast',  group: 'Berichten',  label: 'Iedereen berichten',   hint: 'Een melding naar een hele groep sturen.' },

  { key: 'learning.take',     group: 'Opleiding',  label: 'Cursussen volgen',     hint: 'De e-learning doorlopen.' },
  { key: 'learning.assign',   group: 'Opleiding',  label: 'Cursussen toewijzen',  hint: 'Bepalen wie wat moet doen en voortgang volgen.' },
  { key: 'learning.manage',   group: 'Opleiding',  label: 'Cursussen beheren',    hint: 'Lesmateriaal en toetsvragen aanpassen.' },

  { key: 'admin.settings',    group: 'Beheer',     label: 'Instellingen',         hint: 'Tarieven, openingstijden en app-instellingen.', sensitive: true },
  { key: 'admin.audit',       group: 'Beheer',     label: 'Logboek',              hint: 'Zien wie wat heeft gewijzigd.', sensitive: true },
]

export const PERMISSION_GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))]

/* ------------------------------------------------------------------ *
 *  Berichten
 * ------------------------------------------------------------------ */

export type NotificationKind = 'info' | 'taak' | 'waarschuwing' | 'rooster' | 'opleiding'

export interface AppNotification {
  id: string
  /** Ontvanger. Bij een groepsbericht staat hier de rol in toRole. */
  toUserId?: string
  toRole?: Role
  kind: NotificationKind
  title: string
  body: string
  fromUserId: string
  fromName: string
  createdAt: number
  readAt?: number
  /** Waar de melding naartoe verwijst, bijv. 'rooster' of 'opleiding' */
  link?: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Opleiding
 * ------------------------------------------------------------------ */

export type CourseCategory = 'veiligheid' | 'chemie' | 'machine' | 'kwaliteit' | 'klant'

export const COURSE_CATEGORIES: Record<CourseCategory, string> = {
  veiligheid: 'Veiligheid',
  chemie: 'Chemie en middelen',
  machine: 'Installatie en techniek',
  kwaliteit: 'Kwaliteit en werkwijze',
  klant: 'Klant en communicatie',
}

export interface QuizQuestion {
  id: string
  text: string
  options: string[]
  /** Index van het juiste antwoord */
  correct: number
  explain?: string
}

export interface Lesson {
  id: string
  title: string
  /** Alinea's; wordt als tekst weergegeven, nooit als HTML */
  body: string[]
  keyPoints?: string[]
  warning?: string
}

export interface Course {
  id: string
  code: string
  title: string
  summary: string
  category: CourseCategory
  estimatedMinutes: number
  /** Verplicht voor deze rollen */
  requiredFor: Role[]
  /** Geldigheid in maanden; leeg = verloopt niet */
  validMonths?: number
  passScore: number
  version: number
  lessons: Lesson[]
  quiz: QuizQuestion[]
  updatedAt: number
}

export interface CourseProgress {
  id: string
  userId: string
  userName: string
  courseId: string
  startedAt: number
  lessonIndex: number
  completedAt?: number
  score?: number
  passed: boolean
  attempts: number
  /** Wanneer de geldigheid verloopt */
  expiresAt?: number
  /** Toegewezen door een leidinggevende */
  assignedBy?: string
  dueAt?: number
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
  | 'notifications' | 'courses' | 'courseProgress'

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
