/* ------------------------------------------------------------------ *
 *  Domeinmodel Truckwash1 Group
 * ------------------------------------------------------------------ */

export type Role =
  | 'employee' | 'supervisor' | 'technician' | 'customer' | 'management'
  | 'developer' | 'employer'

export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Werknemer',
  supervisor: 'Leidinggevende',
  technician: 'Technische dienst',
  customer: 'Klant',
  management: 'Management',
  developer: 'Ontwikkelaar',
  employer: 'Werkgever',
}

export const ROLE_ORDER: Role[] =
  ['employee', 'supervisor', 'technician', 'customer', 'employer', 'management', 'developer']

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

  /**
   * Dit account is aangemaakt met een tijdelijk wachtwoord dat per mail is
   * verstuurd. Zolang dit aanstaat komt diegene niet verder dan het scherm
   * waar hij een eigen wachtwoord kiest.
   *
   * Een wachtwoord dat per mail is verstuurd staat in het postvak van de
   * ontvanger, in dat van de afzender, en op elke server ertussenin.
   */
  mustChangePassword?: boolean

  /**
   * Welke rondleidingen deze persoon heeft gezien, als 'rol@versie'.
   *
   * Op het profiel en niet op het apparaat: anders begint hij op elke
   * telefoon opnieuw. Het versienummer erin is de knop om hem bij iedereen
   * met die rol nog eens te laten zien als er wezenlijk iets verandert.
   */
  seenTours?: string[]

  /**
   * Uitgeschreven: inlog en dossier dicht, nergens meer te kiezen.
   *
   * Zijn uren, wasbeurten en getekende contracten blijven staan -- dat moet
   * ook, want loonadministratie en contracten bewaar je zeven jaar. Wissen
   * is iets anders en staat apart.
   */
  archivedAt?: number
  archivedBy?: string
  archiveReason?: string

  /**
   * Dit dossier hoort bij een kassa, niet bij een mens.
   *
   * Een gekoppelde kassa heeft zijn eigen inlog, en daar hangt een dossier aan
   * omdat de vestiging daarin staat -- en die bepaalt wat het apparaat mag
   * zien. Zonder dit vlaggetje staat "Kassa KAS-UTR-1" tussen het personeel:
   * in het rooster, in de urenstaat en in de lijst waaruit je aan de kassa
   * iemand kiest. Overal waar mensen worden opgesomd, hoort dit eruit
   * gefilterd te worden.
   */
  isDevice?: boolean
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
  /**
   * De werkgever waarop deze beurt is geschreven.
   *
   * Nodig om te bepalen wie hem mag zien: een chauffeur ziet de beurten van
   * de werkgever waar hij aan gekoppeld is. Raakt die koppeling verbroken,
   * dan verdwijnen ze uit zijn beeld -- ook al heeft hij ze zelf gebracht.
   */
  werkgeverId?: string
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

  /**
   * Waar deze bon vandaan komt. Een bon die per mail binnenkwam wil je
   * kunnen herkennen: die is niet door een collega ingetypt en de bijlage
   * is het bewijs.
   */
  source?: 'app' | 'mail'
  /** Het bericht in de postbus waar dit uit is ontstaan */
  mailboxId?: string
  /** Pad naar de bijlage in de emmer 'post' */
  attachmentPath?: string
  attachmentName?: string

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
  | 'hours.own' | 'hours.viewTeam' | 'hours.approve' | 'hours.clock'
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
  | 'dev.plan' | 'dev.approve'
  /* overleg */
  | 'chat.use' | 'chat.manage' | 'chat.moderate'
  /* aanmeldingen */
  | 'signups.view' | 'signups.decide'
  /* postbus */
  | 'mail.read' | 'mail.send'
  /* wijzigingen in het dossier */
  | 'staff.request' | 'staff.approve'
  /* agenda */
  | 'agenda.view' | 'agenda.edit'
  /* werkgevers */
  | 'employer.view' | 'employer.manage' | 'employer.approve'
  | 'employer.staff' | 'employer.rules'
  /* kassa */
  | 'pos.use' | 'pos.discount' | 'pos.refund' | 'pos.cash' | 'pos.safe'
  | 'pos.manage'
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

  { key: 'hours.own',         group: 'Uren',       label: 'Eigen uren',           hint: 'Je eigen urenstaat inzien. Klokken gebeurt aan de kassa.' },
  { key: 'hours.viewTeam',    group: 'Uren',       label: 'Uren van het team',    hint: 'Zien hoeveel het team gewerkt heeft.' },
  { key: 'hours.approve',     group: 'Uren',       label: 'Uren goedkeuren',      hint: 'Registraties accorderen voor de verloning.' },
  { key: 'hours.clock',       group: 'Uren',       label: 'Uren wegschrijven',    hint: 'Voor het kassa-account: in- en uitklokken namens wie zich meldt. Hoort niet bij een persoon.' },

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
  { key: 'dev.plan',          group: 'Ontwikkeling', label: 'Plannen maken',      hint: 'Uit een melding een plan met stappen destilleren.', sensitive: true },
  { key: 'dev.approve',       group: 'Ontwikkeling', label: 'Plannen goedkeuren', hint: 'Bepalen welke stappen er gebouwd worden. Dit is de knop die telt.', sensitive: true },

  { key: 'chat.use',          group: 'Overleg',    label: 'Meedoen aan het overleg', hint: 'Kanalen lezen en berichten plaatsen.' },
  { key: 'chat.manage',       group: 'Overleg',    label: 'Kanalen beheren',      hint: 'Kanalen aanmaken, hernoemen en archiveren.' },
  { key: 'chat.moderate',     group: 'Overleg',    label: 'Berichten verwijderen', hint: 'Ook berichten van anderen weghalen.', sensitive: true },

  { key: 'signups.view',      group: 'Aanmeldingen', label: 'Aanmeldingen zien',  hint: 'Zien wie zich via de app heeft aangemeld.' },
  { key: 'signups.decide',    group: 'Aanmeldingen', label: 'Aanmelding afhandelen', hint: 'Iemand toelaten als medewerker of klant, of afwijzen.', sensitive: true },

  { key: 'staff.request',     group: 'Personeel',  label: 'Wijziging aanvragen',  hint: 'Een verandering in een dossier voorstellen; het management beslist.' },
  { key: 'staff.approve',     group: 'Personeel',  label: 'Wijziging goedkeuren', hint: 'Voorgestelde wijzigingen doorvoeren of afwijzen.', sensitive: true },

  { key: 'employer.view',     group: 'Werkgevers', label: 'Werkgevers zien',      hint: 'De aangesloten werkgevers en hun wagens.' },
  { key: 'employer.manage',   group: 'Werkgevers', label: 'Werkgevers beheren',   hint: 'Aanmaken, gegevens wijzigen en blokkeren.', sensitive: true },
  { key: 'employer.approve',  group: 'Werkgevers', label: 'Aanvraag goedkeuren',  hint: 'Een aangemelde werkgever toelaten of afwijzen.', sensitive: true },
  { key: 'employer.staff',    group: 'Werkgevers', label: 'Werknemers koppelen',  hint: 'Chauffeurs uitnodigen en weer loskoppelen.' },
  { key: 'employer.rules',    group: 'Werkgevers', label: 'Afspraken vastleggen', hint: 'Wat er per wagen wel en niet afgenomen mag worden.', sensitive: true },

  { key: 'agenda.view',       group: 'Agenda',     label: 'Agenda zien',          hint: 'Afspraken, verjaardagen en wat er aankomt.' },
  { key: 'agenda.edit',       group: 'Agenda',     label: 'Agenda beheren',       hint: 'Afspraken toevoegen en wijzigen.' },

  { key: 'mail.read',         group: 'Postbus',    label: 'Post lezen',           hint: 'Binnengekomen e-mail en wat er is verstuurd.', sensitive: true },
  { key: 'mail.send',         group: 'Postbus',    label: 'Post versturen',       hint: 'Zelf een mail opstellen naar een adres naar keuze.', sensitive: true },

  { key: 'pos.use',           group: 'Kassa',      label: 'Kassa gebruiken',      hint: 'Afrekenen aan de kassa en de bon afdrukken.' },
  { key: 'pos.discount',      group: 'Kassa',      label: 'Korting geven',        hint: 'Een regel of de hele bon afprijzen.' },
  { key: 'pos.refund',        group: 'Kassa',      label: 'Bon crediteren',       hint: 'Een afgerekende bon terugdraaien met een creditbon.', sensitive: true },
  { key: 'pos.cash',          group: 'Kassa',      label: 'Lade en dagafsluiting', hint: 'Kas openen, tellen, afstorten en de dag afsluiten.', sensitive: true },
  { key: 'pos.safe',          group: 'Kassa',      label: 'Kluis',                hint: 'De kluis openen, afstorten, wisselgeld halen en de kluis tellen.', sensitive: true },
  { key: 'pos.manage',        group: 'Kassa',      label: 'Kassa beheren',        hint: "Artikelen, prijzen, kaarten, codes en de printerinstellingen.", sensitive: true },

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

/* ------------------------------------------------------------------ *
 *  Van melding naar plan
 *
 *  Een melding is zelden meteen een opdracht. "Hij doet het niet" en "kan
 *  dit handiger" zijn allebei waar en allebei onbruikbaar zonder de vragen
 *  die erachter zitten. Daarom eerst een gesprek met de melder, en daarna
 *  pas een plan.
 *
 *  Het plan is opgedeeld in stappen die je los kunt aan- of uitzetten. Dat
 *  is het hele punt: bij een wens van drie dingen wil je er misschien twee,
 *  en dan hoort de melder ook te horen wat er níét is gedaan en waarom.
 *
 *  Wat er daarna gebeurt staat buiten de app. Het goedgekeurde plan is een
 *  opdracht: alleen de aangevinkte stappen, met wat er verandert en waarom.
 * ------------------------------------------------------------------ */

export type PlanStatus =
  | 'concept' | 'ter beoordeling' | 'goedgekeurd' | 'afgewezen' | 'uitgevoerd'

export const PLAN_STATUS: Record<PlanStatus, { label: string; tone: string }> = {
  'concept':         { label: 'Concept',          tone: 'default' },
  'ter beoordeling': { label: 'Wacht op akkoord', tone: 'warn' },
  'goedgekeurd':     { label: 'Goedgekeurd',      tone: 'ok' },
  'afgewezen':       { label: 'Afgewezen',        tone: 'danger' },
  'uitgevoerd':      { label: 'Uitgevoerd',       tone: 'info' },
}

export type PlanOmvang = 'klein' | 'middel' | 'groot'

export const PLAN_OMVANG: Record<PlanOmvang, { label: string; hint: string }> = {
  klein:  { label: 'Klein',  hint: 'Een tekst, een knop, een veld erbij' },
  middel: { label: 'Middel', hint: 'Een scherm of een stuk logica' },
  groot:  { label: 'Groot',  hint: 'Raakt de database of meerdere schermen' },
}

export type PlanRisico = 'klein' | 'gemiddeld' | 'groot'

export const PLAN_RISICO: Record<PlanRisico, { label: string; tone: string }> = {
  klein:     { label: 'Weinig risico',  tone: 'ok' },
  gemiddeld: { label: 'Let op',         tone: 'warn' },
  groot:     { label: 'Riskant',        tone: 'danger' },
}

export interface PlanStap {
  id: string
  titel: string
  /** Wat er verandert, in gewone woorden */
  wat: string
  /** Waarom dit erin zit -- waar de melder om vroeg */
  waarom?: string
  /** Welk deel van de app dit raakt */
  raakt?: string
  risico: PlanRisico
  omvang: PlanOmvang
  /** Aangevinkt door wie het beoordeelt. Uit betekent: dit doen we niet. */
  gekozen: boolean
  /** Aantekening bij deze stap, gaat mee in de opdracht */
  opmerking?: string
}

export interface DevPlan {
  id: string
  ticketId: string
  ticketNumber: string
  titel: string
  /** Wat de melder wil, in één alinea, zoals het uit het gesprek kwam */
  aanleiding: string
  stappen: PlanStap[]
  /** Wat er bewust niet in zit, zodat dat niet stil verdwijnt */
  buitenScope?: string

  status: PlanStatus
  /** Kwam dit uit een gesprek of uit de vaste vragenlijst? */
  bron: 'gesprek' | 'vragenlijst' | 'handmatig'

  gemaaktDoor: string
  gemaaktDoorNaam: string
  gemaaktOp: number

  beoordeeldDoor?: string
  beoordeeldDoorNaam?: string
  beoordeeldOp?: number
  /** Aantekening bij het akkoord of de afwijzing */
  opmerking?: string

  /** In welke versie het terechtkwam */
  uitgevoerdIn?: string
  uitgevoerdOp?: number

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
 *  Aanmeldingen
 *
 *  Iemand die zich via de app aanmeldt maakt zelf een inlogaccount aan --
 *  dat is het enige wat een bezoeker mag. Toegang krijgt hij daarmee niet:
 *  zijn dossier staat op inactief en zonder rollen tot iemand van het
 *  management de aanmelding heeft beoordeeld.
 *
 *  Zo hoeft er nooit iemand handmatig in Supabase: toelaten, rollen geven
 *  en vestigingen toewijzen gebeurt allemaal in de app.
 * ------------------------------------------------------------------ */

export type SignupKind = 'werknemer' | 'klant'
export type SignupStatus = 'nieuw' | 'goedgekeurd' | 'afgewezen'

export const SIGNUP_KINDS: Record<SignupKind, { label: string; hint: string }> = {
  werknemer: {
    label: 'Ik werk bij Truckwash1',
    hint: 'Medewerker, leidinggevende of technische dienst',
  },
  klant: {
    label: 'Ik ben klant',
    hint: 'Wasbeurten inplannen en facturen inzien',
  },
}

export interface Signup {
  id: string
  name: string
  email: string
  phone?: string
  kind: SignupKind
  /** Bij een klant: de naam van het bedrijf */
  companyName?: string
  /** Bij een medewerker: op welke vestiging diegene zegt te werken */
  locationId?: string
  /** Wat de aanmelder er zelf bij schreef */
  message?: string
  status: SignupStatus
  createdAt: number

  /** Het inlogaccount dat bij de aanmelding is aangemaakt */
  authId?: string
  /** Het dossier dat de app alvast heeft klaargezet (inactief) */
  profileId?: string

  handledBy?: string
  handledByName?: string
  handledAt?: number
  rejectReason?: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Verstuurde e-mail
 *
 *  De app verstuurt zelf geen mail; dat doet een klein serverfunctietje met
 *  de sleutel van Resend. Wat het wel doet is bijhouden wat eruit is gegaan,
 *  zodat je bij "ik heb niets ontvangen" kunt kijken in plaats van gokken.
 * ------------------------------------------------------------------ */

export type EmailStatus = 'verstuurd' | 'mislukt'

export interface EmailLog {
  id: string
  template: string
  toEmail: string
  toUserId?: string
  subject: string
  status: EmailStatus
  /** Het id dat Resend teruggeeft; daarmee zoek je het daar terug */
  providerId?: string
  error?: string
  at: number
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Overleg
 *
 *  Kanalen per onderwerp of per vestiging, plus rechtstreekse gesprekken.
 *  Alles gaat door dezelfde offline-laag als de rest: je typt een bericht
 *  in de machinekamer zonder bereik, en het vertrekt zodra je weer buiten
 *  staat.
 * ------------------------------------------------------------------ */

export type ChannelKind = 'kanaal' | 'vestiging' | 'gesprek'

export interface Channel {
  id: string
  /** Zonder hekje, bijv. algemeen of utrecht */
  slug: string
  name: string
  kind: ChannelKind
  /** Waar het kanaal over gaat; staat boven het gesprek */
  topic?: string
  /** Een vestigingskanaal hangt aan één vestiging */
  locationId?: string
  /**
   * Besloten: alleen wie in `memberIds` staat komt erin. Een rechtstreeks
   * gesprek is altijd besloten en heeft precies twee leden.
   */
  private: boolean
  memberIds: string[]
  createdBy: string
  createdAt: number
  archived: boolean
  updatedAt: number
}

export interface ChatMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  body: string
  at: number
  editedAt?: number
  /** Antwoord op een eerder bericht */
  replyToId?: string
  replyToName?: string
  replyToBody?: string
  /** De dossier-id's die met @ zijn genoemd */
  mentions: string[]
  /** Verwijderd door de auteur of een beheerder; de regel blijft staan */
  deletedAt?: number
  deletedBy?: string
  updatedAt: number
}

/** Tot waar iemand een kanaal heeft gelezen. Bepaalt de ongelezen-teller. */
export interface ChannelRead {
  /** `${userId}__${channelId}` */
  id: string
  userId: string
  channelId: string
  lastReadAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Het personeelsdossier: het afgeschermde deel
 *
 *  Dit staat met opzet niet in `profiles`. Die tabel mag iedereen die bij
 *  Truckwash1 werkt lezen -- dat moet ook, want je wilt de naam van je
 *  collega kunnen zien. Maar dan zou zijn burgerservicenummer op het
 *  toestel van iedere wasser terechtkomen, en dat is precies wat je niet
 *  wilt.
 *
 *  Alles wat hieronder staat komt in een eigen tabel waar alleen het
 *  management bij mag, plus de persoon zelf voor zijn eigen regel. Wie er
 *  niet bij mag krijgt geen lege velden maar helemaal geen rij: de
 *  synchronisatie levert hem simpelweg niets.
 * ------------------------------------------------------------------ */

export interface PersonnelPrivate {
  /** Gelijk aan het dossier-id; één regel per persoon */
  id: string
  userId: string

  /* --- persoonsgegevens --- */
  birthDate?: number
  birthPlace?: string
  nationality?: string

  /**
   * Waar iemand woont.
   *
   * Hier en niet op het profiel: het adres van een collega gaat niemand
   * anders aan. Zonder adres valt woon-werkverkeer niet uit te rekenen.
   */
  address?: string
  postcode?: string
  city?: string

  /* --- identiteitsbewijs --- */
  documentType?: 'paspoort' | 'id-kaart' | 'verblijfsdocument' | 'rijbewijs'
  documentNumber?: string
  documentExpires?: number
  /** Is het nummer met de controlecijfers uit de MRZ nagelopen? */
  documentVerified?: boolean

  /* --- loonadministratie --- */
  /**
   * Burgerservicenummer. Een werkgever mag dit verwerken voor de
   * loonaangifte; dat is precies waar het voor bedoeld is. Het wordt
   * gecontroleerd met de elfproef, zodat een typefout er meteen uitspringt.
   */
  bsn?: string
  iban?: string
  /** Uurtarief hoort hier: je collega's loon gaat niemand anders aan. */
  hourlyRate?: number

  /* --- noodgeval --- */
  emergencyName?: string
  emergencyPhone?: string
  emergencyRelation?: string

  /** Notities van het management. De medewerker ziet deze nooit. */
  internalNotes?: string

  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Documenten
 *
 *  Het bestand zelf staat in de opslag van Supabase, in een emmer die van
 *  buitenaf dicht zit. Hier staat alleen wat erover te zeggen valt --
 *  inclusief of de medewerker het mag zien.
 * ------------------------------------------------------------------ */

export type DocumentKind =
  | 'identiteitsbewijs' | 'contract' | 'loonstrook' | 'diploma'
  | 'verklaring' | 'beoordeling' | 'overig'

export const DOCUMENT_KINDS: Record<DocumentKind, {
  label: string
  hint: string
  /** Ziet de medewerker dit standaard? */
  standaardZichtbaar: boolean
}> = {
  identiteitsbewijs: {
    label: 'Identiteitsbewijs',
    hint: 'Paspoort, ID-kaart of verblijfsdocument',
    standaardZichtbaar: true,
  },
  contract: {
    label: 'Contract',
    hint: 'Arbeidsovereenkomst, verlenging of wijziging',
    standaardZichtbaar: true,
  },
  loonstrook: {
    label: 'Loonstrook',
    hint: 'Maandelijkse afrekening of jaaropgave',
    standaardZichtbaar: true,
  },
  diploma: {
    label: 'Diploma of certificaat',
    hint: 'Opleiding, VCA, heftruckcertificaat',
    standaardZichtbaar: true,
  },
  verklaring: {
    label: 'Verklaring',
    hint: 'VOG, medische keuring, geheimhouding',
    standaardZichtbaar: true,
  },
  beoordeling: {
    label: 'Beoordeling of gespreksverslag',
    hint: 'Functioneren, verzuim, waarschuwing',
    standaardZichtbaar: false,
  },
  overig: {
    label: 'Overig',
    hint: 'Alles wat hierboven niet past',
    standaardZichtbaar: true,
  },
}

export interface PersonnelDocument {
  id: string
  /** Van wie is dit dossierstuk */
  userId: string
  userName: string
  kind: DocumentKind
  title: string
  description?: string

  /** Pad in de opslag-emmer. Nooit een openbare link. */
  storagePath: string
  mime: string
  sizeBytes: number
  /** SHA-256 van het bestand; hiermee toon je aan dat het niet is gewijzigd */
  hash?: string

  /**
   * Mag de medewerker dit zelf zien?
   *
   * Op onzichtbaar zetten is een bewuste handeling met een reden erbij.
   * Een gespreksverslag over disfunctioneren hoort niet in het postvak van
   * de betrokkene te belanden voordat het gesprek is gevoerd.
   */
  visibleToEmployee: boolean
  hiddenReason?: string

  uploadedBy: string
  uploadedByName: string
  uploadedAt: number
  /** Vervaldatum, bijvoorbeeld van een ID-kaart of een VOG */
  expiresAt?: number

  /* --- ondertekenen --- */
  requiresSignature: boolean
  signedAt?: number
  signedBy?: string
  signedName?: string
  /** Wat er getekend is: de vingerafdruk van het bestand op dat moment */
  signedHash?: string
  /** De getekende krabbel, als afbeelding */
  signatureImage?: string
  signedPlatform?: string
  /** Afgewezen door de medewerker, met reden */
  declinedAt?: number
  declineReason?: string

  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Postbus
 *
 *  Post die binnenkomt op het adres van het dashboard, en post die eruit
 *  gaat. Het ontvangen loopt via een webhook van Resend naar een
 *  serverfunctie; die zet het bericht en de bijlagen weg.
 *
 *  Waarom dit bestaat: bonnen komen per mail binnen. Ze doorsturen, printen,
 *  inscannen en opnieuw invoeren is drie keer werk voor één bedrag. Een mail
 *  met een bijlage levert hier meteen een kostenpost op die alleen nog
 *  goedgekeurd hoeft te worden.
 * ------------------------------------------------------------------ */

export type MailRichting = 'in' | 'uit'
export type MailStatus = 'nieuw' | 'gelezen' | 'verwerkt' | 'genegeerd'

export const MAIL_STATUS: Record<MailStatus, { label: string; tone: string }> = {
  nieuw:      { label: 'Nieuw',      tone: 'warn' },
  gelezen:    { label: 'Gelezen',    tone: 'info' },
  verwerkt:   { label: 'Verwerkt',   tone: 'ok' },
  genegeerd:  { label: 'Genegeerd',  tone: 'default' },
}

/**
 * De uitkomst van de controle op een bijlage.
 *
 * Wat er gecontroleerd wordt staat in de serverfunctie: klopt het bestand
 * met wat het beweert te zijn, zit er geen actieve inhoud in, en -- als er
 * een scanner is aangesloten -- wat zegt die.
 *
 * Zolang dit niet 'schoon' is, weigert de app het bestand te openen.
 */
export type BijlageControle = 'onbekend' | 'schoon' | 'verdacht' | 'mislukt'

export const CONTROLE_LABELS: Record<BijlageControle, { label: string; tone: string }> = {
  onbekend: { label: 'Nog niet gecontroleerd', tone: 'warn' },
  schoon:   { label: 'Gecontroleerd',          tone: 'ok' },
  verdacht: { label: 'Geweigerd',              tone: 'danger' },
  mislukt:  { label: 'Controle mislukt',       tone: 'warn' },
}

export interface MailBijlage {
  naam: string
  mime: string
  size: number
  /** Pad in de emmer 'post'. Nooit een openbaar adres. */
  path: string

  /** Uitkomst van de controle. Ontbreekt bij oudere berichten. */
  controle?: BijlageControle
  /** Waarom hij is geweigerd, of waarom de controle niet lukte */
  controleReden?: string
  controleOp?: number
  /** Welke scanner het zei, als er een is aangesloten */
  scanner?: string
}

export interface MailBericht {
  id: string
  richting: MailRichting
  /** Afzender, zoals de mailserver hem doorgaf */
  van: string
  vanNaam?: string
  aan: string
  onderwerp: string
  /** Platte tekst. HTML wordt nooit als HTML getoond. */
  tekst: string
  /** Kwam er ook een HTML-versie mee? Alleen ter informatie. */
  hadHtml: boolean
  at: number
  status: MailStatus

  attachments: MailBijlage[]
  /** De kostenpost die hieruit is ontstaan */
  expenseId?: string

  handledBy?: string
  handledByName?: string
  handledAt?: number

  /** Het id bij Resend, om het daar terug te zoeken */
  providerId?: string
  /**
   * Wat er precies binnenkwam, ingekort. Alleen voor de ontwikkelaar: als
   * een bericht niet goed wordt herkend, staat hier waarom.
   */
  raw?: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Wijzigingen in een dossier
 *
 *  Een leidinggevende staat het dichtst bij zijn mensen en merkt als eerste
 *  dat iemand meer uren gaat draaien of van functie verandert. Maar hij hoort
 *  niet zelf in het dossier te schrijven: een uurloon dat verandert zonder
 *  dat iemand het heeft goedgekeurd is geen administratie.
 *
 *  Dus stelt hij het voor, en het management drukt op akkoord. Wat er
 *  precies verandert staat er per veld bij -- oude waarde naast nieuwe --
 *  zodat je niet hoeft te raden wat je goedkeurt.
 * ------------------------------------------------------------------ */

export type WijzigingStatus = 'open' | 'goedgekeurd' | 'afgewezen' | 'ingetrokken'

/** Welke velden via een verzoek te wijzigen zijn. */
export type WijzigbaarVeld =
  | 'function' | 'contractHours' | 'hourlyRate' | 'locationId'
  | 'manages' | 'supervisorId' | 'endDate' | 'startDate' | 'roles'

export const VELD_LABELS: Record<WijzigbaarVeld, string> = {
  function: 'Functie',
  contractHours: 'Contracturen per week',
  hourlyRate: 'Uurtarief',
  locationId: 'Vestiging',
  manages: 'Geeft leiding op',
  supervisorId: 'Valt onder',
  endDate: 'Uit dienst per',
  startDate: 'In dienst sinds',
  roles: 'Toegang tot dashboards',
}

export interface WijzigingVeld {
  veld: WijzigbaarVeld
  /** Zoals het nu is; puur om naast het voorstel te tonen */
  oud?: unknown
  nieuw?: unknown
}

export interface DossierWijziging {
  id: string
  /** Wiens dossier */
  userId: string
  userName: string

  velden: WijzigingVeld[]
  /** Waarom; een verzoek zonder reden is niet te beoordelen */
  reden: string
  /** Per wanneer het in zou moeten gaan */
  ingaandOp?: number

  status: WijzigingStatus
  aangevraagdDoor: string
  aangevraagdDoorNaam: string
  aangevraagdOp: number

  besistDoor?: string
  beslistDoorNaam?: string
  beslistOp?: number
  afwijzingReden?: string

  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Agenda
 *
 *  Alleen de afspraken die iemand er zelf in zet. Verjaardagen, jubilea en
 *  aflopende contracten staan er niet in: die volgen uit gegevens die er al
 *  zijn, en worden bij het tonen berekend. Twee waarheden over dezelfde
 *  datum lopen vroeg of laat uit elkaar.
 * ------------------------------------------------------------------ */

export type AgendaSoort = 'afspraak' | 'verlof' | 'opleiding' | 'onderhoud' | 'overig'

export const AGENDA_SOORTEN: Record<AgendaSoort, { label: string; hint: string }> = {
  afspraak:  { label: 'Afspraak',  hint: 'Overleg, bezoek, gesprek' },
  verlof:    { label: 'Verlof',    hint: 'Vrij, vakantie, bijzonder verlof' },
  opleiding: { label: 'Opleiding', hint: 'Cursus, keuring, examen' },
  onderhoud: { label: 'Onderhoud', hint: 'Werk aan de installatie of het pand' },
  overig:    { label: 'Overig',    hint: 'Wat hier niet in past' },
}

export interface AgendaItem {
  id: string
  title: string
  description?: string
  soort: AgendaSoort
  startAt: number
  endAt: number
  /** Hele dag: dan doen de tijden er niet toe */
  heleDag: boolean
  locationId?: string
  /** Wie erbij moeten zijn */
  deelnemers: string[]
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Werkgevers
 *
 *  Een transportbedrijf waarvan de chauffeurs hier komen wassen. De
 *  werkgever betaalt, ziet wat zijn mensen laten doen, en legt vast wat er
 *  per wagen wél en niet afgenomen mag worden.
 *
 *  Waarom dat laatste bestaat: een chauffeur die op kosten van de zaak een
 *  polijstbeurt van vierhonderd euro afneemt terwijl er een buitenwas was
 *  afgesproken, is een gesprek achteraf. De afspraak vooraf voorkomt dat --
 *  en het kassasysteem leest dezelfde regels, zodat het aan de balie niet
 *  eens in beeld komt.
 * ------------------------------------------------------------------ */

export type WerkgeverStatus = 'aangevraagd' | 'actief' | 'geblokkeerd' | 'afgewezen'

export const WERKGEVER_STATUS: Record<WerkgeverStatus, { label: string; tone: string }> = {
  aangevraagd: { label: 'Wacht op akkoord', tone: 'warn' },
  actief:      { label: 'Actief',           tone: 'ok' },
  geblokkeerd: { label: 'Geblokkeerd',      tone: 'danger' },
  afgewezen:   { label: 'Afgewezen',        tone: 'default' },
}

export interface Werkgever {
  id: string
  naam: string
  kvk?: string
  contactNaam: string
  email: string
  telefoon?: string
  adres?: string
  postcode?: string
  plaats?: string

  /** Het klantaccount waar de facturen heen gaan */
  companyId?: string
  status: WerkgeverStatus

  /** Wie dit bedrijf beheert in de app; dossier-id's */
  beheerders: string[]

  aangevraagdDoor?: string
  aangevraagdDoorNaam?: string
  aangevraagdOp: number
  beslistDoor?: string
  beslistDoorNaam?: string
  beslistOp?: number
  afwijzingReden?: string

  notitie?: string
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Werknemers van een werkgever
 *
 *  Een koppeling, geen bezit. Een chauffeur kan bij twee bedrijven rijden,
 *  en als hij ergens weggaat verdwijnt alleen die ene koppeling -- niet zijn
 *  account, en niet wat hij bij de ander doet.
 * ------------------------------------------------------------------ */

export type KoppelingStatus =
  | 'uitgenodigd' | 'wacht op akkoord' | 'actief' | 'beëindigd' | 'geweigerd'

export const KOPPELING_STATUS: Record<KoppelingStatus, { label: string; tone: string }> = {
  'uitgenodigd':      { label: 'Uitgenodigd',       tone: 'info' },
  'wacht op akkoord': { label: 'Wacht op akkoord',  tone: 'warn' },
  'actief':           { label: 'Actief',            tone: 'ok' },
  'beëindigd':        { label: 'Beëindigd',         tone: 'default' },
  'geweigerd':        { label: 'Geweigerd',         tone: 'danger' },
}

export interface WerkgeverKoppeling {
  id: string
  werkgeverId: string
  werkgeverNaam: string

  /** Het dossier van de chauffeur, zodra dat er is */
  userId?: string
  naam: string
  email: string
  /** Kentekens die deze chauffeur mag brengen; leeg is alles van de werkgever */
  kentekens: string[]

  status: KoppelingStatus
  uitgenodigdOp: number
  uitgenodigdDoor: string
  uitgenodigdDoorNaam: string
  /**
   * Er bestond al een account op dit adres. Dan wordt er niets aangemaakt
   * maar gevraagd of het gekoppeld mag worden.
   */
  bestaandAccount: boolean

  gekoppeldOp?: number
  beeindigdOp?: number
  beeindigdDoor?: string
  beeindigdDoorNaam?: string
  beeindigdReden?: string

  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Afspraken over wat er afgenomen mag worden
 * ------------------------------------------------------------------ */

export type RegelSoort = 'niet toegestaan' | 'alleen met akkoord'

export const REGEL_SOORTEN: Record<RegelSoort, { label: string; hint: string; tone: string }> = {
  'niet toegestaan': {
    label: 'Niet toegestaan',
    hint: 'Komt niet in beeld, ook niet aan de kassa',
    tone: 'danger',
  },
  'alleen met akkoord': {
    label: 'Alleen met akkoord',
    hint: 'Mag wel, maar iemand van het bedrijf moet het bevestigen',
    tone: 'warn',
  },
}

export interface WerkgeverRegel {
  id: string
  werkgeverId: string
  /** Leeg betekent: geldt voor alle wagens van deze werkgever */
  kenteken?: string
  /** De behandeling waar het over gaat */
  service?: ServiceKind
  /** Of een losse productcode uit het kassasysteem */
  productCode?: string
  soort: RegelSoort
  reden?: string
  aangemaaktDoor: string
  aangemaaktOp: number
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
  | 'tickets' | 'ticketMessages' | 'logEvents' | 'devPlans'
  | 'hourRequests' | 'trips'
  | 'signups' | 'channels' | 'chatMessages' | 'channelReads' | 'emailLog'
  | 'personnelPrivate' | 'documents' | 'mailbox' | 'changeRequests'
  | 'agendaItems' | 'employers' | 'employerLinks' | 'employerRules'
  | 'posRegisters' | 'posDevices' | 'posPairings' | 'posSafes' | 'posSafeMoves'

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

/* ------------------------------------------------------------------ *
 *  Post die op verbinding wacht
 *
 *  Blijft op het apparaat staan; hij gaat niet mee met de synchronisatie.
 *  Die verstuurt records, en dit is een verzoek -- twee apparaten die
 *  hetzelfde verzoek doorsturen leveren twee mails op.
 * ------------------------------------------------------------------ */

export interface WachtendeMail {
  id?: number
  /** Hetzelfde verzoek dat anders meteen naar de serverfunctie was gegaan */
  request: unknown
  createdAt: number
  tries: number
}

/* ------------------------------------------------------------------ *
 *  Uren rechtzetten
 *
 *  Klokken gaat via de kassa. Wie vergeet in te klokken staat daarmee met
 *  lege handen -- hij was er wel, het staat er niet, en hij kan er zelf
 *  niets aan doen. Dit is de weg terug: hij zegt wat er had moeten staan,
 *  zijn leidinggevende kijkt ernaar.
 * ------------------------------------------------------------------ */

export type HourRequestSoort =
  | 'vergeten' | 'verkeerde tijd' | 'te vroeg uitgeklokt' | 'anders'

export type HourRequestStatus = 'nieuw' | 'goedgekeurd' | 'afgewezen' | 'ingetrokken'

export const HR_STATUS: Record<HourRequestStatus, { label: string; tone: string }> = {
  nieuw:        { label: 'Wacht op akkoord', tone: 'warn' },
  goedgekeurd:  { label: 'Goedgekeurd',      tone: 'ok' },
  afgewezen:    { label: 'Afgewezen',        tone: 'danger' },
  ingetrokken:  { label: 'Ingetrokken',      tone: 'default' },
}

export interface HourRequest {
  id: string
  userId: string
  userName: string
  /** De regel waar het over gaat; leeg betekent: die is er helemaal niet */
  entryId?: string
  locationId?: string

  soort: HourRequestSoort
  /** Wat er volgens de medewerker had moeten staan */
  van: number
  tot?: number
  toelichting: string

  status: HourRequestStatus
  aangevraagdOp: number

  beslistDoor?: string
  beslistDoorNaam?: string
  beslistOp?: number
  beslissingReden?: string

  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  Ritten
 *
 *  De afstand komt van de routedienst, over de weg, van adres naar adres.
 *  Losse kilometers intypen kan niet -- niet in het scherm en niet in de
 *  database. Een vergoeding waarbij iedereen zijn eigen getal invult is geen
 *  vergoeding maar een vertrouwenskwestie.
 * ------------------------------------------------------------------ */

export type TripDoel = 'woon-werk' | 'klant' | 'vestiging' | 'anders'

export const TRIP_DOEL: Record<TripDoel, { label: string; hint: string }> = {
  'woon-werk':  { label: 'Woon-werk',   hint: 'Van huis naar de vestiging en terug' },
  'vestiging':  { label: 'Tussen vestigingen', hint: 'Ingesprongen op een andere locatie' },
  'klant':      { label: 'Naar een klant', hint: 'Op locatie bij een klant' },
  'anders':     { label: 'Anders',      hint: 'Met een toelichting erbij' },
}

export interface Trip {
  id: string
  userId: string
  userName: string
  /** De dag waarop de rit is gemaakt */
  op: number

  vanLabel: string
  naarLabel: string
  /** Wat er werkelijk is opgezocht; hiermee is de afstand na te rekenen */
  vanAdres: string
  naarAdres: string

  /** Kilometers over de weg, één kant op */
  km: number
  retour: boolean
  doel: TripDoel
  toelichting?: string

  /** Waar de afstand vandaan komt. 'handmatig' bestaat met opzet niet. */
  bron: 'route' | 'vast'

  status: 'nieuw' | 'goedgekeurd' | 'afgewezen'
  beslistDoor?: string
  beslistDoorNaam?: string
  beslistOp?: number

  updatedAt: number
}

/* ------------------------------------------------------------------ *
 *  De kassa's, de apparaten en de kluis
 *
 *  De kassa is een tweede app die met dezelfde database praat. Wat hier
 *  staat is de beheerkant: welke kassa's er zijn, welk apparaat erop staat,
 *  en wat er in de kluis zit.
 *
 *  Het schema komt uit 0012 en 0025 en wordt aan de kassakant gebruikt. Deze
 *  types zijn de vertaling ervan naar de app; verander ze niet zonder de
 *  andere kant erbij, want die leunt erop.
 * ------------------------------------------------------------------ */

export interface PosRegister {
  id: string
  locationId?: string
  /** Kort en uniek, komt in elk bonnummer: KAS-UTR-1 */
  code: string
  name: string
  /** Welk apparaat hier staat, zoals de kassa het zelf noteert */
  device?: string
  /** Instellingen die de kassa zelf zet; het dashboard leest ze alleen. */
  printer?: Record<string, unknown>
  terminal?: Record<string, unknown>
  /** Het hoogste bonnummer dat de server heeft gezien */
  lastSeq: number
  active: boolean
  updatedAt: number
}

export type PosDeviceStatus = 'actief' | 'geblokkeerd' | 'ingetrokken'

export const POS_DEVICE_STATUS: Record<PosDeviceStatus, {
  label: string
  tone: string
  hint: string
}> = {
  actief: {
    label: 'Actief',
    tone: 'ok',
    hint: 'Doet mee',
  },
  geblokkeerd: {
    label: 'Geblokkeerd',
    tone: 'warn',
    hint: 'De kassa gaat op slot maar blijft versturen wat er nog op staat',
  },
  ingetrokken: {
    label: 'Ingetrokken',
    tone: 'danger',
    hint: 'De kassa maakt zijn wachtrij leeg en wist zichzelf',
  },
}

export interface PosDevice {
  id: string
  registerId?: string
  locationId?: string
  /** Wat het apparaat van zichzelf weet; overleeft een herinstallatie */
  deviceKey: string
  name: string
  platform: string
  appVersion?: string
  authUserId?: string
  profileId?: string
  status: PosDeviceStatus
  pairedAt: number
  lastSeenAt?: number
  /**
   * Wanneer het apparaat zichzelf heeft gewist.
   *
   * Leeg bij een ingetrokken apparaat betekent: nog niet klaar. Er kan omzet
   * op staan die nog niet is verstuurd, dus het inlogaccount blijft tot dit
   * gevuld is.
   */
  wipedAt?: number
  note?: string
  updatedAt: number
}

export interface PosPairing {
  id: string
  /** Acht tekens, zonder I, L, O, 0 en 1 */
  code: string
  locationId: string
  registerId?: string
  createdBy?: string
  createdByName: string
  expiresAt: number
  usedAt?: number
  usedByDevice?: string
  note?: string
  updatedAt: number
}

export interface PosSafe {
  id: string
  locationId?: string
  name: string
  active: boolean
  note?: string
  updatedAt: number
}

export type SafeMoveSoort =
  | 'afstorting' | 'wisselgeld' | 'naar-bank' | 'van-bank'
  | 'uitgave' | 'inleg' | 'telling'

export const SAFE_MOVE_SOORT: Record<SafeMoveSoort, { label: string; hint: string }> = {
  'afstorting': { label: 'Afstorting', hint: 'Uit de kassalade naar de kluis' },
  'wisselgeld': { label: 'Wisselgeld',  hint: 'Uit de kluis naar de kassalade' },
  'naar-bank':  { label: 'Naar de bank', hint: 'Opgehaald of afgestort' },
  'van-bank':   { label: 'Van de bank', hint: 'Wisselgeld gehaald' },
  'uitgave':    { label: 'Uitgave',     hint: 'Contant betaald uit de kluis' },
  'inleg':      { label: 'Inleg',       hint: 'Er is geld bij gelegd' },
  'telling':    { label: 'Telling',     hint: 'De kluis is geteld; dit zet het saldo' },
}

/**
 * De briefjes en munten.
 *
 * De sleutels zijn b<euro> en m<cent>: b100 is een briefje van honderd, m5
 * een munt van vijf cent. Let op dat b5 en m5 dus niet hetzelfde zijn --
 * vijf euro tegenover vijf cent.
 */
export type Coupures = Record<string, number>

export interface PosSafeMove {
  id: string
  safeId: string
  locationId?: string
  soort: SafeMoveSoort
  /** Wat er fysiek bewoog. Bij een telling leeg. */
  coins: Coupures
  /** Alleen bij een telling: de volledige samenstelling zoals geteld. */
  counted?: Coupures
  /** Het bedrag met teken, vastgelegd op het moment zelf */
  amount: number
  expected?: number
  difference?: number
  sessionId?: string
  registerId?: string
  reason: string
  userId?: string
  userName: string
  at: number
  updatedAt: number
}
