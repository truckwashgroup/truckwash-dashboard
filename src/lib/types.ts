/* ------------------------------------------------------------------ *
 *  Domeinmodel Truckwash1 Group
 * ------------------------------------------------------------------ */

export type Role =
  | 'employee' | 'supervisor' | 'technician' | 'customer' | 'management' | 'developer'

export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Werknemer',
  supervisor: 'Leidinggevende',
  technician: 'Technische dienst',
  customer: 'Klant',
  management: 'Management',
  developer: 'Ontwikkelaar',
}

export const ROLE_ORDER: Role[] =
  ['employee', 'supervisor', 'technician', 'customer', 'management', 'developer']

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

  /* --- locaties --- */

  /** De vestiging waar deze persoon werkt */
  locationId?: string
  /**
   * Locaties waar deze persoon leiding over heeft. Een leidinggevende met
   * twee vestigingen heeft zijn rechten alleen daar, niet elders.
   */
  manages?: string[]
  /** Hoofdkantoor: ziet en mag alles, op alle vestigingen */
  allLocations?: boolean
}

/* ------------------------------------------------------------------ *
 *  Locaties
 *
 *  De organisatie bestaat uit vestigingen plus een hoofdkantoor. Bijna alles
 *  hangt aan een locatie: wasbeurten, roosters, voorraad, kosten en uren.
 *  Wie waar bij mag komt uit de locaties die aan een persoon hangen.
 * ------------------------------------------------------------------ */

export type LocationKind = 'vestiging' | 'hoofdkantoor'

export interface Location {
  id: string
  /** Korte code, bijv. TW-UTR */
  code: string
  name: string
  kind: LocationKind
  address: string
  postcode: string
  city: string
  phone?: string
  /** Vestigingsmanager */
  managerId?: string
  managerName?: string
  /** Aantal wasstraten op deze locatie */
  bays: number
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
  locationId: string
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
  /** Voorraad wordt per vestiging bijgehouden */
  locationId: string
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
  locationId?: string
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
  locationId: string
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
  locationId?: string
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
  /* techniek */
  | 'assets.view' | 'assets.manage'
  | 'faults.report' | 'faults.view' | 'faults.triage'
  | 'workorders.view' | 'workorders.create' | 'workorders.assign' | 'workorders.complete'
  | 'maintenance.view' | 'maintenance.manage'
  /* locaties */
  | 'locations.view' | 'locations.manage' | 'locations.all'
  /* meldingen aan de ontwikkelaar */
  | 'dev.report' | 'dev.tickets' | 'dev.respond' | 'dev.logs'
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

  { key: 'assets.view',        group: 'Techniek',  label: 'Installaties zien',    hint: 'Het machinepark en de gegevens per apparaat bekijken.' },
  { key: 'assets.manage',      group: 'Techniek',  label: 'Installaties beheren', hint: 'Apparaten toevoegen, wijzigen en QR-labels maken.' },
  { key: 'faults.report',      group: 'Techniek',  label: 'Storing melden',       hint: 'Een defect doorgeven, ook door een QR-code te scannen.' },
  { key: 'faults.view',        group: 'Techniek',  label: 'Storingen zien',       hint: 'Alle meldingen op je vestigingen bekijken.' },
  { key: 'faults.triage',      group: 'Techniek',  label: 'Storingen beoordelen', hint: 'Urgentie bepalen, toewijzen en afhandelen.' },
  { key: 'workorders.view',    group: 'Techniek',  label: 'Werkbonnen zien',      hint: 'De werkbonnen van je vestigingen bekijken.' },
  { key: 'workorders.create',  group: 'Techniek',  label: 'Werkbon maken',        hint: 'Zelf een werkbon aanmaken.' },
  { key: 'workorders.assign',  group: 'Techniek',  label: 'Werkbon toewijzen',    hint: 'Bepalen wie welke klus doet en wanneer.' },
  { key: 'workorders.complete', group: 'Techniek', label: 'Werkbon afronden',     hint: 'Uren, onderdelen en resultaat vastleggen.' },
  { key: 'maintenance.view',   group: 'Techniek',  label: 'Onderhoud zien',       hint: "De onderhoudsschema's en wat er openstaat." },
  { key: 'maintenance.manage', group: 'Techniek',  label: 'Onderhoud beheren',    hint: "Schema's en intervallen instellen." },

  { key: 'locations.view',    group: 'Locaties',   label: 'Locaties zien',        hint: 'De vestigingen en hun gegevens bekijken.' },
  { key: 'locations.manage',  group: 'Locaties',   label: 'Locaties beheren',     hint: 'Vestigingen toevoegen en wijzigen.', sensitive: true },
  { key: 'locations.all',     group: 'Locaties',   label: 'Alle vestigingen',     hint: 'Niet beperkt tot de eigen vestiging, maar overal bij.', sensitive: true },

  { key: 'dev.report',        group: 'Ontwikkeling', label: 'Melding maken',      hint: 'Een probleem of wens doorgeven aan de ontwikkelaar.' },
  { key: 'dev.tickets',       group: 'Ontwikkeling', label: 'Alle meldingen zien', hint: 'Het volledige ticketoverzicht van iedereen.', sensitive: true },
  { key: 'dev.respond',       group: 'Ontwikkeling', label: 'Reageren en afhandelen', hint: 'Antwoorden op meldingen en de status bijwerken.', sensitive: true },
  { key: 'dev.logs',          group: 'Ontwikkeling', label: 'Logboek zien',       hint: 'Foutmeldingen en gebeurtenissen uit de app.', sensitive: true },

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
  locationId?: string
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
 *  Technische dienst
 *
 *  Vier dingen die aan elkaar hangen:
 *
 *    Installatie  -- een apparaat op een vestiging, met een QR-label erop
 *    Storing      -- een melding dat er iets stuk is
 *    Onderhoud    -- een terugkerende beurt volgens een schema
 *    Werkbon      -- het werk zelf: uren, onderdelen, wat er gedaan is
 *
 *  Een storing of een onderhoudsbeurt levert een werkbon op. De werkbon is
 *  waar de monteur op werkt en waar de verantwoording in staat.
 * ------------------------------------------------------------------ */

export type AssetCategory =
  | 'wasstraat' | 'borstelunit' | 'hogedruk' | 'waterzuivering'
  | 'osmose' | 'compressor' | 'doseerunit' | 'droger'
  | 'heftruck' | 'elektra' | 'gebouw' | 'overig'

export const ASSET_CATEGORIES: Record<AssetCategory, string> = {
  wasstraat: 'Wasstraat',
  borstelunit: 'Borstelunit',
  hogedruk: 'Hogedrukinstallatie',
  waterzuivering: 'Waterzuivering',
  osmose: 'Osmose-installatie',
  compressor: 'Compressor',
  doseerunit: 'Doseerunit',
  droger: 'Droogblazer',
  heftruck: 'Heftruck',
  elektra: 'Elektra en besturing',
  gebouw: 'Gebouw en terrein',
  overig: 'Overig',
}

export type AssetStatus = 'in bedrijf' | 'storing' | 'onderhoud' | 'buiten gebruik'

export interface Asset {
  id: string
  locationId: string
  /** Leesbare code op het label, bijv. UTR-BOR-01 */
  code: string
  name: string
  category: AssetCategory
  brand?: string
  model?: string
  serialNumber?: string
  status: AssetStatus
  installedAt?: number
  warrantyUntil?: number
  /** Draaiuren, als het apparaat die bijhoudt */
  runningHours?: number
  location?: string
  notes?: string
  /**
   * De sleutel die in de QR-code staat. Bewust apart van het id: een label
   * kan worden vervangen zonder dat de historie eraan verandert, en een
   * gescande code verraadt geen interne id's.
   */
  qrToken: string
  lastServiceAt?: number
  nextServiceAt?: number
  updatedAt: number
}

export type FaultSeverity = 'laag' | 'middel' | 'hoog' | 'kritiek'

export const FAULT_SEVERITY: Record<FaultSeverity, { label: string; tone: string; hint: string }> = {
  laag:    { label: 'Laag',    tone: 'default', hint: 'Hinderlijk, kan wachten' },
  middel:  { label: 'Middel',  tone: 'info',    hint: 'Beperkt het werk, deze week oplossen' },
  hoog:    { label: 'Hoog',    tone: 'warn',    hint: 'Installatie deels uit bedrijf' },
  kritiek: { label: 'Kritiek', tone: 'danger',  hint: 'Wasstraat ligt stil of onveilig' },
}

export type FaultStatus =
  | 'gemeld' | 'in behandeling' | 'wacht op onderdelen' | 'opgelost' | 'afgewezen'

export interface Fault {
  id: string
  number: string
  locationId: string
  assetId?: string
  assetName?: string
  title: string
  description: string
  severity: FaultSeverity
  status: FaultStatus
  /** Ligt de installatie stil door deze storing? */
  stopsProduction: boolean
  reportedBy: string
  reportedByName: string
  reportedAt: number
  assignedTo?: string
  assignedName?: string
  resolvedAt?: number
  resolution?: string
  /** Stilstand in minuten, voor de cijfers van het management */
  downtimeMinutes?: number
  workOrderId?: string
  updatedAt: number
}

export type MaintenanceInterval = 'wekelijks' | 'maandelijks' | 'kwartaal' | 'halfjaar' | 'jaar'

export const MAINTENANCE_DAYS: Record<MaintenanceInterval, number> = {
  wekelijks: 7,
  maandelijks: 30,
  kwartaal: 91,
  halfjaar: 182,
  jaar: 365,
}

export interface MaintenancePlan {
  id: string
  /** Geldt voor één apparaat, of voor een hele categorie op een vestiging */
  assetId?: string
  locationId?: string
  category?: AssetCategory
  title: string
  description?: string
  interval: MaintenanceInterval
  /** Checklist die de monteur afvinkt */
  checklist: string[]
  estimatedMinutes: number
  lastDoneAt?: number
  nextDueAt: number
  active: boolean
  updatedAt: number
}

export type WorkOrderType = 'storing' | 'preventief' | 'inspectie' | 'modificatie'
export type WorkOrderStatus = 'open' | 'ingepland' | 'bezig' | 'gereed' | 'geannuleerd'
export type WorkOrderPriority = 'laag' | 'normaal' | 'hoog' | 'spoed'

export interface WorkOrderPart {
  itemId?: string
  name: string
  qty: number
  unitPrice: number
}

export interface WorkOrderCheck {
  text: string
  done: boolean
  note?: string
}

export interface WorkOrder {
  id: string
  number: string
  locationId: string
  assetId?: string
  assetName?: string
  faultId?: string
  planId?: string
  type: WorkOrderType
  priority: WorkOrderPriority
  status: WorkOrderStatus
  title: string
  description?: string
  createdBy: string
  createdByName: string
  createdAt: number
  assignedTo?: string
  assignedName?: string
  plannedAt?: number
  startedAt?: number
  completedAt?: number
  /** Bestede tijd in minuten */
  minutesSpent?: number
  parts: WorkOrderPart[]
  checklist: WorkOrderCheck[]
  workDone?: string
  /** Naam van wie voor akkoord tekende op de vestiging */
  signedOffBy?: string
  externalCost?: number
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Meldingen aan de ontwikkelaar
 *
 *  Wie tegen een probleem aanloopt maakt een melding. Daar hangt automatisch
 *  bij wat diegene het afgelopen kwartier in de app deed, plus de technische
 *  gegevens van het apparaat. Dat scheelt de heen-en-weer van "wat deed je
 *  precies?" -- want dat weet niemand een dag later nog.
 * ------------------------------------------------------------------ */

export type TicketKind = 'fout' | 'vraag' | 'wens' | 'traag'

export const TICKET_KINDS: Record<TicketKind, { label: string; hint: string }> = {
  fout:  { label: 'Er gaat iets fout', hint: 'Iets werkt niet zoals het hoort' },
  vraag: { label: 'Vraag',             hint: 'Ik snap niet hoe iets werkt' },
  wens:  { label: 'Wens',              hint: 'Dit zou handig zijn' },
  traag: { label: 'Traag of hapert',   hint: 'Het werkt wel, maar stroef' },
}

export type TicketPriority = 'laag' | 'normaal' | 'hoog' | 'blokkerend'
export type TicketStatus =
  | 'nieuw' | 'in behandeling' | 'wacht op melder' | 'opgelost' | 'gesloten'

/** Eén handeling uit het spoor van de laatste vijftien minuten. */
export interface TrailEntry {
  at: number
  kind: 'pagina' | 'actie' | 'fout' | 'sync' | 'melding'
  text: string
}

export interface Ticket {
  id: string
  number: string
  title: string
  description: string
  kind: TicketKind
  priority: TicketPriority
  status: TicketStatus

  reportedBy: string
  reportedByName: string
  reportedAt: number
  /** Vanuit welk dashboard en welke pagina de melding kwam */
  fromRole?: Role
  fromPage?: string
  locationId?: string

  /* --- technische context, automatisch meegestuurd --- */
  appVersion: string
  platform: string
  userAgent: string
  screen: string
  online: boolean
  pendingChanges: number
  /** Wat de melder het afgelopen kwartier deed */
  trail: TrailEntry[]

  assignedTo?: string
  assignedName?: string
  resolvedAt?: number
  resolution?: string
  /** Versie waarin het is opgelost */
  fixedIn?: string
  updatedAt: number
}

export interface TicketMessage {
  id: string
  ticketId: string
  authorId: string
  authorName: string
  /** Interne notities ziet de melder niet */
  internal: boolean
  body: string
  createdAt: number
  updatedAt: number
}

export type LogLevel = 'fout' | 'waarschuwing' | 'info'

export interface LogEvent {
  id: string
  level: LogLevel
  message: string
  stack?: string
  /** Waar in de app het gebeurde */
  page?: string
  userId?: string
  userName?: string
  locationId?: string
  appVersion: string
  platform: string
  at: number
  /** Hoe vaak deze zelfde fout is voorgekomen */
  count: number
  ticketId?: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Sync
 * ------------------------------------------------------------------ */

export type EntityName =
  | 'locations' | 'users' | 'companies' | 'washJobs' | 'inventory'
  | 'stockMovements' | 'expenses' | 'timeEntries' | 'shifts'
  | 'notifications' | 'courses' | 'courseProgress'
  | 'assets' | 'faults' | 'workOrders' | 'maintenancePlans'
  | 'tickets' | 'ticketMessages' | 'logEvents'

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
