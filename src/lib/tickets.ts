import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import { deviceInfo, trail } from './trail'
import type {
  LogEvent, LogLevel, Role, Ticket, TicketKind, TicketMessage,
  TicketPriority, TicketStatus, User,
} from './types'

/* ------------------------------------------------------------------ *
 *  Meldingen aan de ontwikkelaar
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<unknown> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

function nummer(prefix: string, bestaand: number) {
  const d = new Date()
  const jm = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0')
  return `${prefix}-${jm}-${String(bestaand + 1).padStart(4, '0')}`
}

export const tickets = {
  /**
   * Maakt een melding, inclusief het spoor van de laatste vijftien minuten
   * en de technische gegevens van het apparaat.
   */
  async create(input: {
    title: string
    description: string
    kind: TicketKind
    priority: TicketPriority
    by: Pick<User, 'id' | 'name' | 'locationId'>
    fromRole?: Role
    fromPage?: string
    appVersion: string
    online: boolean
    pendingChanges: number
  }) {
    const aantal = await db.tickets.count()
    const device = deviceInfo()

    const ticket: Ticket = {
      id: uid('tk'),
      number: nummer('M', aantal),
      title: input.title.trim(),
      description: input.description.trim(),
      kind: input.kind,
      priority: input.priority,
      status: 'nieuw',
      reportedBy: input.by.id,
      reportedByName: input.by.name,
      reportedAt: Date.now(),
      fromRole: input.fromRole,
      fromPage: input.fromPage,
      locationId: input.by.locationId,
      appVersion: input.appVersion,
      platform: device.platform,
      userAgent: device.userAgent,
      screen: device.screen,
      online: input.online,
      pendingChanges: input.pendingChanges,
      trail: trail.recent(),
      updatedAt: Date.now(),
    }

    await put('tickets', db.tickets, ticket)

    // De ontwikkelaars op de hoogte brengen
    const devs = (await db.users.toArray()).filter(
      (u) => u.active && u.roles.includes('developer'))
    for (const d of devs) {
      await notifications.send({
        to: { id: d.id, name: d.name },
        from: { id: input.by.id, name: input.by.name },
        kind: input.priority === 'blokkerend' ? 'waarschuwing' : 'taak',
        title: `${ticket.number}: ${ticket.title}`,
        body: `${input.by.name} · ${input.priority} · ${device.platform}`,
        link: 'tickets',
      })
    }

    return ticket
  },

  async update(id: string, patch: Partial<Ticket>) {
    const ticket = await db.tickets.get(id)
    if (!ticket) return
    return put('tickets', db.tickets, { ...ticket, ...patch, id })
  },

  /** Status wijzigen en de melder erover berichten. */
  async setStatus(
    id: string,
    status: TicketStatus,
    by: Pick<User, 'id' | 'name'>,
    opts?: { resolution?: string; fixedIn?: string },
  ) {
    const ticket = await db.tickets.get(id)
    if (!ticket) return
    if (ticket.status === status) return ticket

    const patch: Partial<Ticket> = { status }
    if (status === 'opgelost' || status === 'gesloten') {
      patch.resolvedAt = Date.now()
      patch.resolution = opts?.resolution ?? ticket.resolution
      patch.fixedIn = opts?.fixedIn ?? ticket.fixedIn
    }

    const bijgewerkt = await tickets.update(id, patch)

    if (ticket.reportedBy !== by.id) {
      await notifications.send({
        to: { id: ticket.reportedBy, name: ticket.reportedByName },
        from: by,
        kind: status === 'opgelost' ? 'info' : 'taak',
        title: `${ticket.number} is nu: ${status}`,
        body: opts?.resolution
          ? opts.resolution
          : status === 'wacht op melder'
            ? 'De ontwikkelaar heeft een vraag voor je.'
            : ticket.title,
        link: 'meldingen',
      })
    }
    return bijgewerkt
  },

  async assign(id: string, to: Pick<User, 'id' | 'name'> | null, by: Pick<User, 'id' | 'name'>) {
    const ticket = await db.tickets.get(id)
    if (!ticket) return
    const bijgewerkt = await tickets.update(id, {
      assignedTo: to?.id,
      assignedName: to?.name,
      status: to && ticket.status === 'nieuw' ? 'in behandeling' : ticket.status,
    })
    if (to && to.id !== by.id) {
      await notifications.send({
        to, from: by, kind: 'taak',
        title: `Melding ${ticket.number} voor jou`,
        body: ticket.title,
        link: 'tickets',
      })
    }
    return bijgewerkt
  },

  async setPriority(id: string, priority: TicketPriority) {
    return tickets.update(id, { priority })
  },
}

/* ------------------------------------------------------------------ *
 *  Berichten in een melding
 * ------------------------------------------------------------------ */

export const ticketMessages = {
  async send(input: {
    ticketId: string
    body: string
    internal: boolean
    by: Pick<User, 'id' | 'name'>
  }) {
    const ticket = await db.tickets.get(input.ticketId)
    if (!ticket) return

    const bericht: TicketMessage = {
      id: uid('tm'),
      ticketId: input.ticketId,
      authorId: input.by.id,
      authorName: input.by.name,
      internal: input.internal,
      body: input.body.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await put('ticketMessages', db.ticketMessages, bericht)

    // Een interne notitie blijft binnen het ontwikkelteam.
    if (input.internal) return bericht

    // Antwoord aan de melder, of reactie van de melder naar de behandelaar.
    const naarMelder = input.by.id !== ticket.reportedBy
    const ontvangerId = naarMelder ? ticket.reportedBy : ticket.assignedTo
    const ontvangerNaam = naarMelder ? ticket.reportedByName : ticket.assignedName

    if (ontvangerId && ontvangerNaam && ontvangerId !== input.by.id) {
      await notifications.send({
        to: { id: ontvangerId, name: ontvangerNaam },
        from: input.by,
        kind: 'info',
        title: `Reactie op ${ticket.number}`,
        body: bericht.body.slice(0, 140),
        link: naarMelder ? 'meldingen' : 'tickets',
      })
    }

    /*
     * De bal wisselt van kant. Een melding die nog op "nieuw" staat en waar
     * de ontwikkelaar op reageert, is daarmee opgepakt -- die hoort niet in
     * de lijst met onbeantwoorde meldingen te blijven staan.
     */
    const nogOpen = ticket.status !== 'opgelost' && ticket.status !== 'gesloten'

    if (naarMelder && nogOpen && ticket.status !== 'wacht op melder') {
      await tickets.update(ticket.id, { status: 'wacht op melder' })
    }
    if (!naarMelder && nogOpen && ticket.status !== 'in behandeling') {
      await tickets.update(ticket.id, { status: 'in behandeling' })
    }

    return bericht
  },
}

/* ------------------------------------------------------------------ *
 *  Logboek
 *
 *  Dezelfde fout die honderd keer voorkomt hoeft niet honderd regels op te
 *  leveren. We tellen op, en houden alleen het laatste voorval bij.
 * ------------------------------------------------------------------ */

/** Vingerafdruk zodat herhalingen bij elkaar komen. */
function fingerprint(level: LogLevel, message: string, page?: string) {
  const kern = message
    .replace(/\d+/g, '#')          // getallen weg: id's en tijden verschillen altijd
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${level}|${page ?? '-'}|${kern}`
}

const MAX_LOG_ROWS = 500

export const logs = {
  async record(input: {
    level: LogLevel
    message: string
    stack?: string
    page?: string
    appVersion: string
    user?: Pick<User, 'id' | 'name' | 'locationId'>
  }) {
    const device = deviceInfo()
    const key = fingerprint(input.level, input.message, input.page)
    const id = 'lg_' + [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e12, 7).toString(36)

    const bestaand = await db.logEvents.get(id)
    const event: LogEvent = bestaand
      ? { ...bestaand, at: Date.now(), count: bestaand.count + 1, stack: input.stack ?? bestaand.stack }
      : {
          id,
          level: input.level,
          message: input.message.slice(0, 500),
          stack: input.stack,
          page: input.page,
          userId: input.user?.id,
          userName: input.user?.name,
          locationId: input.user?.locationId,
          appVersion: input.appVersion,
          platform: device.platform,
          at: Date.now(),
          count: 1,
          updatedAt: Date.now(),
        }

    await put('logEvents', db.logEvents, event)

    // De lokale lijst niet oneindig laten groeien
    const aantal = await db.logEvents.count()
    if (aantal > MAX_LOG_ROWS) {
      const oudste = await db.logEvents.orderBy('at').limit(aantal - MAX_LOG_ROWS).toArray()
      await db.logEvents.bulkDelete(oudste.map((o) => o.id))
    }

    return event
  },

  async clear() {
    const alle = await db.logEvents.toArray()
    await db.logEvents.clear()
    for (const l of alle) await enqueue('logEvents', 'delete', l.id, null)
  },
}

/* ------------------------------------------------------------------ */

export const TICKET_STATUS_TONE: Record<TicketStatus, 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'> = {
  nieuw: 'warn',
  'in behandeling': 'brand',
  'wacht op melder': 'info',
  opgelost: 'ok',
  gesloten: 'default',
}

export const TICKET_PRIORITY_TONE: Record<TicketPriority, 'default' | 'info' | 'warn' | 'danger'> = {
  laag: 'default',
  normaal: 'info',
  hoog: 'warn',
  blokkerend: 'danger',
}
