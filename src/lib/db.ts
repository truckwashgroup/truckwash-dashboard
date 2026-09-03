import Dexie, { type Table } from 'dexie'
import type {
  LocationPhoto,
  PosRegister,
  PosDevice,
  PosPairing,
  PosSafe,
  PosSafeMove,
  HourRequest,
  Trip,
  WachtendeMail,
    DevPlan,
AppNotification, Asset, Channel, ChannelRead, ChatMessage, Company, Course,
  CourseProgress, EmailLog, Expense, Fault, InventoryItem, Location, LogEvent,
  AgendaItem, DossierWijziging, Instelling, MailBericht, MaintenancePlan, OutboxRecord,
  TruckyContact, TruckyVraag, Grootboek, KostenTag,
  VoorraadAlarm, Bestelling, Bestelregel,
  Werkgever, WerkgeverKoppeling, WerkgeverRegel,
  PersonnelDocument, PersonnelPrivate,
  Shift, Signup, StockMovement, Ticket,
  TicketMessage, TimeEntry, User, WashJob, WorkOrder,
} from './types'

/**
 * Lokale cache. Alles wat de app toont komt hieruit — nooit direct van de
 * server. Daardoor werkt de app identiek met en zonder internet.
 */
class TruckwashDB extends Dexie {
  locations!: Table<Location, string>
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
  assets!: Table<Asset, string>
  faults!: Table<Fault, string>
  workOrders!: Table<WorkOrder, string>
  maintenancePlans!: Table<MaintenancePlan, string>
  tickets!: Table<Ticket, string>
  ticketMessages!: Table<TicketMessage, string>
  logEvents!: Table<LogEvent, string>
  devPlans!: Table<DevPlan, string>
  hourRequests!: Table<HourRequest, string>
  trips!: Table<Trip, string>
  posRegisters!: Table<PosRegister, string>
  posDevices!: Table<PosDevice, string>
  posPairings!: Table<PosPairing, string>
  posSafes!: Table<PosSafe, string>
  posSafeMoves!: Table<PosSafeMove, string>
  locationPhotos!: Table<LocationPhoto, string>
  truckyVragen!: Table<TruckyVraag, string>
  grootboek!: Table<Grootboek, string>
  kostenTags!: Table<KostenTag, string>
  voorraadAlarmen!: Table<VoorraadAlarm, string>
  bestellingen!: Table<Bestelling, string>
  bestelregels!: Table<Bestelregel, string>
  truckyContact!: Table<TruckyContact, string>
  instellingen!: Table<Instelling, string>
  media!: Table<Media, string>
  mailOutbox!: Table<WachtendeMail, number>
  signups!: Table<Signup, string>
  channels!: Table<Channel, string>
  chatMessages!: Table<ChatMessage, string>
  channelReads!: Table<ChannelRead, string>
  emailLog!: Table<EmailLog, string>
  personnelPrivate!: Table<PersonnelPrivate, string>
  documents!: Table<PersonnelDocument, string>
  mailbox!: Table<MailBericht, string>
  changeRequests!: Table<DossierWijziging, string>
  agendaItems!: Table<AgendaItem, string>
  employers!: Table<Werkgever, string>
  employerLinks!: Table<WerkgeverKoppeling, string>
  employerRules!: Table<WerkgeverRegel, string>
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

    // v3: berichten en e-learning
    this.version(3).stores({
      notifications: 'id, toUserId, toRole, readAt, createdAt, updatedAt',
      courses: 'id, category, code, updatedAt',
      courseProgress: 'id, userId, courseId, passed, updatedAt',
    })

    // v4: meerdere vestigingen
    this.version(4).stores({
      locations: 'id, code, kind, active, updatedAt',
      users: 'id, email, active, personnelNumber, locationId, updatedAt',
      washJobs: 'id, status, companyId, assignedTo, scheduledAt, locationId, updatedAt',
      inventory: 'id, name, stock, locationId, updatedAt',
      expenses: 'id, status, category, date, locationId, updatedAt',
      shifts: 'id, userId, startAt, locationId, updatedAt',
      timeEntries: 'id, userId, jobId, start, locationId, updatedAt',
    })

    // v5: technische dienst
    this.version(5).stores({
      assets: 'id, locationId, category, status, code, qrToken, updatedAt',
      faults: 'id, locationId, assetId, status, severity, reportedAt, updatedAt',
      workOrders: 'id, locationId, assetId, status, assignedTo, plannedAt, updatedAt',
      maintenancePlans: 'id, assetId, locationId, nextDueAt, active, updatedAt',
    })

    // v6: meldingen aan de ontwikkelaar en het logboek
    this.version(6).stores({
      tickets: 'id, status, priority, reportedBy, assignedTo, reportedAt, updatedAt',
      ticketMessages: 'id, ticketId, createdAt, updatedAt',
      logEvents: 'id, level, at, updatedAt',
    })

    // v7: aanmeldingen en het overleg
    this.version(7).stores({
      signups: 'id, status, email, createdAt, updatedAt',
      channels: 'id, slug, kind, locationId, archived, updatedAt',
      chatMessages: 'id, channelId, authorId, at, updatedAt',
      channelReads: 'id, userId, channelId, updatedAt',
      emailLog: 'id, template, status, at, updatedAt',
    })

    // v8: het afgeschermde deel van het dossier, en de documenten
    this.version(8).stores({
      personnelPrivate: 'id, userId, updatedAt',
      documents: 'id, userId, kind, requiresSignature, updatedAt',
    })

    // v9: de postbus
    this.version(9).stores({
      mailbox: 'id, richting, status, at, updatedAt',
    })

    // v10: wijzigingsverzoeken op een dossier
    this.version(10).stores({
      changeRequests: 'id, userId, status, aangevraagdOp, updatedAt',
    })

    // v11: de agenda
    this.version(11).stores({
      agendaItems: 'id, soort, startAt, locationId, updatedAt',
    })

    // v12: werkgevers, hun chauffeurs en hun afspraken
    this.version(12).stores({
      employers: 'id, status, naam, updatedAt',
      employerLinks: 'id, werkgeverId, userId, status, updatedAt',
      employerRules: 'id, werkgeverId, kenteken, updatedAt',
    })

    // v13: van melding naar plan
    this.version(13).stores({
      devPlans: 'id, ticketId, status, gemaaktOp, updatedAt',
    })

    // v14: post die op verbinding wacht
    this.version(14).stores({
      mailOutbox: '++id, createdAt',
    })

    // v15: uren rechtzetten en kilometers
    this.version(15).stores({
      hourRequests: 'id, userId, status, aangevraagdOp, updatedAt',
      trips: 'id, userId, op, status, updatedAt',
    })

    // v16: de kassa's, de apparaten en de kluis
    this.version(16).stores({
      posRegisters: 'id, locationId, code, updatedAt',
      posDevices: 'id, registerId, locationId, status, updatedAt',
      posPairings: 'id, code, registerId, expiresAt, updatedAt',
      posSafes: 'id, locationId, updatedAt',
      posSafeMoves: 'id, safeId, at, soort, updatedAt',
    })

    // v17: foto's bij een vestiging, en de bestanden zelf om de hoek
    this.version(17).stores({
      locationPhotos: 'id, locationId, sort, updatedAt',
      media: 'pad, at',
    })

    /* Trucky: de vragenlijst voor de website, de contactverzoeken die daaruit
       voortkomen, en de instellingen die het management zet. */
    this.version(18).stores({
      truckyVragen: 'id, actief, updatedAt',
      truckyContact: 'id, status, createdAt, updatedAt',
      instellingen: 'id, sleutel, updatedAt',
    })

    /* Het grootboek en de etiketten waarmee een factuur zichzelf indeelt.

       Beide zijn klein en veranderen zelden, en ze staan hier omdat de
       kostenposten anders een rekeningnummer laten zien zonder naam -- 4031
       zegt niemand iets, "Contributies en heffingen" wel. */
    this.version(19).stores({
      grootboek: 'code, actief, updatedAt',
      kostenTags: 'id, naam, updatedAt',
    })

    /* Trucksupply: de alarmen die de database zet als een vestiging onder
       haar minimum zakt, en de bestellingen waarmee die worden aangevuld.

       opgelostAt staat in de index omdat het scherm vooral de open alarmen
       wil (opgelostAt leeg); bestelregels zijn op bestellingId te vinden
       omdat een pakbon alle regels van één bestelling nodig heeft. */
    this.version(20).stores({
      voorraadAlarmen: 'id, itemId, locationId, opgelostAt, updatedAt',
      bestellingen: 'id, locationId, status, aangemaaktAt, updatedAt',
      bestelregels: 'id, bestellingId, updatedAt',
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

/* ------------------------------------------------------------------ *
 *  Mensen, geen apparaten
 *
 *  Een gekoppelde kassa heeft een eigen personeelsdossier, want daar hangt
 *  aan welke vestiging hij is en dus wat hij mag zien. Maar het is geen mens.
 *
 *  Zonder deze grens staat "Kassa KAS-UTR-1" tussen het personeel: in het
 *  rooster, in de urenstaat, in elke keuzelijst waar je iemand aanwijst, en
 *  in elk aantal ("15 medewerkers"). Dat is het soort ding dat je één keer
 *  over het hoofd ziet en dan drie maanden in een rapport meeneemt.
 *
 *  Vandaar op één plek in plaats van in tweeëndertig schermen. Wie een lijst
 *  van mensen wil, vraagt hierom -- niet om db.users.
 * ------------------------------------------------------------------ */

export function alleMensen() {
  return db.users.filter((u) => !u.isDevice).toArray()
}

/** En hetzelfde voor een lijst die je al hebt. */
export function alleenMensen<T extends { isDevice?: boolean }>(lijst: T[]): T[] {
  return lijst.filter((u) => !u.isDevice)
}

/* ------------------------------------------------------------------ *
 *  Bestanden om de hoek
 *
 *  Foto's van vestigingen staan bij Supabase, maar een app die op een tablet
 *  in een wasstraat draait heeft daar niet altijd bij gekund. Wat een keer is
 *  opgehaald blijft hier staan, zodat het scherm ook zonder verbinding een
 *  vestiging laat zien in plaats van negentien grijze vlakken.
 *
 *  Bewust geen onderdeel van de synchronisatie: dit is een kopie van iets dat
 *  ergens anders de waarheid is. Weggooien mag altijd.
 * ------------------------------------------------------------------ */

export interface Media {
  /** Het pad in de emmer; dat is meteen de sleutel. */
  pad: string
  blob: Blob
  at: number
}

/** Zeven dagen. Lang genoeg voor een week zonder verbinding. */
const MEDIA_TERMIJN = 7 * 86_400_000

export async function mediaOpruimen(nu = Date.now()) {
  const oud = await db.media.where('at').below(nu - MEDIA_TERMIJN).primaryKeys()
  if (oud.length) await db.media.bulkDelete(oud)
  return oud.length
}
