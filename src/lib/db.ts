import Dexie, { type Table } from 'dexie'
import type {
  AppNotification, Asset, Channel, ChannelRead, ChatMessage, Company, Course,
  CourseProgress, EmailLog, Expense, Fault, InventoryItem, Location, LogEvent,
  AgendaItem, DossierWijziging, MailBericht, MaintenancePlan, OutboxRecord,
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
