import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import { effectivePermissions } from './permissions'
import type { Channel, ChannelRead, ChatMessage, Location, User } from './types'

/* ------------------------------------------------------------------ *
 *  Overleg
 *
 *  Wat dit vervangt: de groepsapp op de telefoons van iedereen, waar de
 *  planning van dinsdag tussen de verjaardagen verdwijnt en waar niemand
 *  die weggaat nog uit te halen is.
 *
 *  Drie soorten gesprekken:
 *
 *    kanaal      -- een onderwerp, bijv. #algemeen of #techniek
 *    vestiging   -- hangt aan één vestiging; wie daar werkt zit erin
 *    gesprek     -- rechtstreeks, tussen twee mensen
 *
 *  Alles loopt door dezelfde offline-laag als de rest van de app. Je typt
 *  een bericht in de machinekamer zonder bereik, het staat er meteen, en
 *  het vertrekt zodra je weer buiten staat.
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

export const MAX_MESSAGE = 4000

/** Maakt van een naam een bruikbare kanaalnaam: kleine letters, streepjes. */
export function slugify(text: string): string {
  // NFD haalt de accenten los van de letter; de tekenklasse gooit ze weg,
  // zodat Nieuwegein en Nieuwegeïn hetzelfde kanaal opleveren.
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** Het id van een rechtstreeks gesprek: altijd hetzelfde, wie het ook opent. */
export function dmId(a: string, b: string): string {
  return 'ch_dm_' + [a, b].sort().join('__')
}

/* ------------------------------------------------------------------ *
 *  Wie mag waar meelezen
 * ------------------------------------------------------------------ */

/**
 * Of iemand dit kanaal mag zien.
 *
 * Een open kanaal is voor iedereen die mee mag doen aan het overleg. Een
 * besloten kanaal en een rechtstreeks gesprek alleen voor wie erin staat.
 * Een vestigingskanaal voor wie op die vestiging werkt -- of voor het
 * hoofdkantoor, dat overal bij mag.
 */
export function mayRead(user: User | null, channel: Channel): boolean {
  if (!user) return false
  if (!effectivePermissions(user).has('chat.use')) return false
  if (channel.memberIds.includes(user.id)) return true
  if (channel.private) return false

  if (channel.kind === 'vestiging' && channel.locationId) {
    if (user.allLocations) return true
    if (effectivePermissions(user).has('locations.all')) return true
    if (user.locationId === channel.locationId) return true
    if ((user.manages ?? []).includes(channel.locationId)) return true
    return false
  }

  return true
}

export function visibleChannels(user: User | null, channels: Channel[]): Channel[] {
  return channels
    .filter((c) => !c.archived && mayRead(user, c))
    .sort((a, b) => {
      const order = { kanaal: 0, vestiging: 1, gesprek: 2 }
      if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind]
      return a.name.localeCompare(b.name)
    })
}

/** Hoe een rechtstreeks gesprek heet, gezien vanaf deze kant. */
export function channelTitle(channel: Channel, me: User | null, everyone: User[]): string {
  if (channel.kind !== 'gesprek') return channel.name
  const other = channel.memberIds.find((id) => id !== me?.id)
  return everyone.find((u) => u.id === other)?.name ?? channel.name
}

/* ------------------------------------------------------------------ *
 *  Wie wordt er genoemd?
 *
 *  Alleen namen die echt bestaan tellen; @iedereen is een apart geval.
 *  We zoeken op voornaam en op volledige naam, langste eerst, zodat
 *  "@Jan Peters" niet als "@Jan" wordt gelezen.
 * ------------------------------------------------------------------ */

export const EVERYONE = '@iedereen'

export function findMentions(body: string, members: User[]): string[] {
  const gevonden = new Set<string>()
  const lower = body.toLowerCase()

  const kandidaten = members
    .flatMap((u) => [
      { id: u.id, naam: u.name.toLowerCase() },
      { id: u.id, naam: u.name.split(' ')[0].toLowerCase() },
    ])
    .sort((a, b) => b.naam.length - a.naam.length)

  for (const k of kandidaten) {
    if (k.naam.length < 2) continue
    if (lower.includes('@' + k.naam)) gevonden.add(k.id)
  }

  return [...gevonden]
}

export function mentionsEveryone(body: string): boolean {
  return body.toLowerCase().includes(EVERYONE)
}

/* ------------------------------------------------------------------ *
 *  Kanalen
 * ------------------------------------------------------------------ */

export const channels = {
  async create(input: {
    name: string
    kind?: Channel['kind']
    topic?: string
    locationId?: string
    private?: boolean
    memberIds?: string[]
    by: Pick<User, 'id' | 'name'>
  }) {
    const slug = slugify(input.name)
    const bestaand = (await db.channels.toArray()).find(
      (c) => c.slug === slug && c.kind === (input.kind ?? 'kanaal'))
    if (bestaand) return bestaand

    const kanaal: Channel = {
      id: uid('ch'),
      slug,
      name: input.name.trim(),
      kind: input.kind ?? 'kanaal',
      topic: input.topic?.trim() || undefined,
      locationId: input.locationId,
      private: input.private ?? false,
      memberIds: input.memberIds ?? [input.by.id],
      createdBy: input.by.id,
      createdAt: Date.now(),
      archived: false,
      updatedAt: Date.now(),
    }
    return put('channels', db.channels, kanaal)
  },

  async update(id: string, patch: Partial<Channel>) {
    const kanaal = await db.channels.get(id)
    if (!kanaal) return
    return put('channels', db.channels, { ...kanaal, ...patch, id })
  },

  async archive(id: string, archived = true) {
    return channels.update(id, { archived })
  },

  async addMember(id: string, userId: string) {
    const kanaal = await db.channels.get(id)
    if (!kanaal || kanaal.memberIds.includes(userId)) return kanaal
    return channels.update(id, { memberIds: [...kanaal.memberIds, userId] })
  },

  async removeMember(id: string, userId: string) {
    const kanaal = await db.channels.get(id)
    if (!kanaal) return
    return channels.update(id, { memberIds: kanaal.memberIds.filter((m) => m !== userId) })
  },

  /** Opent (of hervat) een rechtstreeks gesprek met iemand. */
  async openDirect(me: Pick<User, 'id' | 'name'>, other: Pick<User, 'id' | 'name'>) {
    const id = dmId(me.id, other.id)
    const bestaand = await db.channels.get(id)
    if (bestaand) return bestaand

    const kanaal: Channel = {
      id,
      slug: 'gesprek',
      name: `${me.name} en ${other.name}`,
      kind: 'gesprek',
      private: true,
      memberIds: [me.id, other.id],
      createdBy: me.id,
      createdAt: Date.now(),
      archived: false,
      updatedAt: Date.now(),
    }
    return put('channels', db.channels, kanaal)
  },
}

/* ------------------------------------------------------------------ *
 *  Berichten
 * ------------------------------------------------------------------ */

export const chat = {
  async send(input: {
    channelId: string
    body: string
    by: Pick<User, 'id' | 'name'>
    replyTo?: ChatMessage
    /** De mensen die dit kanaal lezen; nodig om @-namen te herkennen */
    members: User[]
  }) {
    const body = input.body.trim().slice(0, MAX_MESSAGE)
    if (!body) return

    const kanaal = await db.channels.get(input.channelId)
    const genoemd = findMentions(body, input.members.filter((u) => u.id !== input.by.id))
    const iedereen = mentionsEveryone(body)

    const bericht: ChatMessage = {
      id: uid('cm'),
      channelId: input.channelId,
      authorId: input.by.id,
      authorName: input.by.name,
      body,
      at: Date.now(),
      replyToId: input.replyTo?.id,
      replyToName: input.replyTo?.authorName,
      replyToBody: input.replyTo?.body.slice(0, 160),
      mentions: genoemd,
      updatedAt: Date.now(),
    }

    await put('chatMessages', db.chatMessages, bericht)

    // Eigen leesteken meteen bijwerken: je hebt je eigen bericht gelezen.
    await chat.markRead(input.channelId, input.by.id)

    /*
     * Een bel voor wie genoemd wordt, en voor de deelnemers van een
     * rechtstreeks gesprek. Voor een gewoon kanaal niet: dan zou iedereen
     * bij elke regel piepen en zet men het na een dag uit.
     */
    const ontvangers = new Set<string>(genoemd)

    if (kanaal?.kind === 'gesprek') {
      for (const id of kanaal.memberIds) if (id !== input.by.id) ontvangers.add(id)
    }
    if (iedereen) {
      for (const u of input.members) if (u.id !== input.by.id) ontvangers.add(u.id)
    }

    for (const id of ontvangers) {
      const persoon = input.members.find((u) => u.id === id)
      if (!persoon) continue
      await notifications.send({
        to: { id: persoon.id, name: persoon.name },
        from: input.by,
        kind: 'info',
        title: kanaal?.kind === 'gesprek'
          ? `Bericht van ${input.by.name}`
          : `${input.by.name} noemt je in ${kanaal?.name ?? 'het overleg'}`,
        body: body.slice(0, 140),
        link: 'overleg',
      })
    }

    return bericht
  },

  async edit(id: string, body: string) {
    const bericht = await db.chatMessages.get(id)
    if (!bericht || bericht.deletedAt) return
    return put('chatMessages', db.chatMessages, {
      ...bericht,
      body: body.trim().slice(0, MAX_MESSAGE),
      editedAt: Date.now(),
    })
  },

  /**
   * Verwijderen laat de regel staan met "bericht verwijderd" erin.
   *
   * Dat is met opzet: een gesprek waar zomaar gaten in vallen leest niemand
   * meer met vertrouwen, en het antwoord eronder slaat dan nergens op.
   */
  async remove(id: string, by: Pick<User, 'id'>) {
    const bericht = await db.chatMessages.get(id)
    if (!bericht) return
    return put('chatMessages', db.chatMessages, {
      ...bericht,
      deletedAt: Date.now(),
      deletedBy: by.id,
      body: '',
      mentions: [],
    })
  },

  async markRead(channelId: string, userId: string, at = Date.now()) {
    // Geen leesteken voor een kanaal dat we niet eens kennen. Zo'n regel
    // heeft nergens betrekking op en zou alleen de wachtrij vervuilen.
    if (!(await db.channels.get(channelId))) return

    const id = `${userId}__${channelId}`
    const bestaand = await db.channelReads.get(id)
    if (bestaand && bestaand.lastReadAt >= at) return bestaand

    const rij: ChannelRead = {
      id, userId, channelId, lastReadAt: at, updatedAt: Date.now(),
    }
    return put('channelReads', db.channelReads, rij)
  },

  /**
   * Zet iemand in het kanaal van zijn vestiging, en maakt dat kanaal aan
   * als het er nog niet is. Gebruikt bij het toelaten van een aanmelding.
   */
  async addToLocationChannel(user: User) {
    if (!user.locationId) return
    const alle = await db.channels.toArray()
    const kanaal = alle.find(
      (c) => c.kind === 'vestiging' && c.locationId === user.locationId)
    if (!kanaal) return
    if (kanaal.memberIds.includes(user.id)) return kanaal
    return channels.addMember(kanaal.id, user.id)
  },
}

/* ------------------------------------------------------------------ *
 *  Ongelezen
 * ------------------------------------------------------------------ */

export interface ChannelState {
  channel: Channel
  laatste?: ChatMessage
  ongelezen: number
  /** Word ik genoemd in iets wat ik nog niet heb gelezen? */
  genoemd: boolean
}

export function channelStates(
  user: User | null,
  kanalen: Channel[],
  berichten: ChatMessage[],
  gelezen: ChannelRead[],
): ChannelState[] {
  const leesMoment = new Map(gelezen
    .filter((r) => r.userId === user?.id)
    .map((r) => [r.channelId, r.lastReadAt]))

  const perKanaal = new Map<string, ChatMessage[]>()
  for (const m of berichten) {
    const lijst = perKanaal.get(m.channelId) ?? []
    lijst.push(m)
    perKanaal.set(m.channelId, lijst)
  }

  return visibleChannels(user, kanalen).map((channel) => {
    const lijst = (perKanaal.get(channel.id) ?? []).sort((a, b) => a.at - b.at)
    const sinds = leesMoment.get(channel.id) ?? 0
    const nieuw = lijst.filter((m) => m.at > sinds && m.authorId !== user?.id)
    return {
      channel,
      laatste: lijst[lijst.length - 1],
      ongelezen: nieuw.length,
      genoemd: nieuw.some((m) => m.mentions.includes(user?.id ?? '')),
    }
  })
}

/** Alles bij elkaar, voor het bolletje in de balk. */
export function totalUnread(states: ChannelState[]): number {
  return states.reduce((a, s) => a + s.ongelezen, 0)
}

/* ------------------------------------------------------------------ *
 *  Standaardkanalen
 *
 *  Een leeg overleg nodigt niet uit. Bij het eerste gebruik zetten we de
 *  vaste kanalen klaar plus één per vestiging, zodat er meteen ergens
 *  gepraat kan worden.
 * ------------------------------------------------------------------ */

export const STANDAARD: { name: string; topic: string }[] = [
  { name: 'Algemeen', topic: 'Alles wat iedereen aangaat' },
  { name: 'Techniek', topic: 'Storingen, onderhoud en werkbonnen' },
  { name: 'Planning', topic: 'Drukte, bezetting en wie waar staat' },
  { name: 'Kwaliteit', topic: 'Klachten, herstelwerk en hoe het beter kan' },
]

export async function ensureDefaultChannels(
  by: Pick<User, 'id' | 'name'>,
  locaties: Location[],
) {
  const bestaand = await db.channels.toArray()
  const heeft = (slug: string, kind: Channel['kind']) =>
    bestaand.some((c) => c.slug === slug && c.kind === kind)

  for (const s of STANDAARD) {
    if (heeft(slugify(s.name), 'kanaal')) continue
    await channels.create({ name: s.name, topic: s.topic, by })
  }

  for (const loc of locaties) {
    if (!loc.active) continue
    const slug = slugify(loc.name)
    if (heeft(slug, 'vestiging')) continue
    await channels.create({
      name: loc.name,
      kind: 'vestiging',
      topic: `Het overleg van ${loc.name}`,
      locationId: loc.id,
      by,
    })
  }
}
