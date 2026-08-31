import { db, uid } from './db'
import { enqueue } from './sync'
import { mailVrij } from './mail'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type { Expense, MailBericht, MailBijlage, MailStatus, User } from './types'

/* ------------------------------------------------------------------ *
 *  Postbus
 *
 *  Post die binnenkomt op het adres van het dashboard komt hier terecht,
 *  gezet door een serverfunctie die de webhook van Resend aanneemt. De app
 *  leest alleen; schrijven doet ze hoogstens om de status bij te werken.
 *
 *  De bijlagen staan in een afgesloten emmer. Net als bij het dossier
 *  bestaat er geen blijvend adres: openen levert een link die na een minuut
 *  vervalt.
 * ------------------------------------------------------------------ */

export const EMMER = 'post'

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

export const postbus = {
  async setStatus(id: string, status: MailStatus, door?: Pick<User, 'id' | 'name'>) {
    const bericht = await db.mailbox.get(id)
    if (!bericht) return
    return put('mailbox', db.mailbox, {
      ...bericht,
      status,
      handledBy: door?.id ?? bericht.handledBy,
      handledByName: door?.name ?? bericht.handledByName,
      handledAt: status === 'nieuw' ? undefined : Date.now(),
    })
  },

  /** Als iemand het bericht openslaat is het gelezen; niet meer dan dat. */
  async markeerGelezen(id: string) {
    const bericht = await db.mailbox.get(id)
    if (!bericht || bericht.status !== 'nieuw') return bericht
    return put('mailbox', db.mailbox, { ...bericht, status: 'gelezen' })
  },

  /**
   * Een adres om een bijlage te openen, dat na een minuut vervalt.
   *
   * Kort met opzet: een link die in een gesprek belandt of in de
   * geschiedenis van een browser blijft staan, is daarna niets meer waard.
   */
  async openBijlage(bijlage: Pick<MailBijlage, 'path'>): Promise<string> {
    if (!supabaseConfigured) {
      throw new Error('De opslag is nog niet ingesteld.')
    }
    const { data, error } = await supabase().storage
      .from(EMMER)
      .createSignedUrl(bijlage.path, 60)

    if (error || !data?.signedUrl) {
      throw new Error(String(error?.message ?? 'De bijlage is niet op te halen.'))
    }
    return data.signedUrl
  },

  /**
   * Zelf een mail versturen.
   *
   * Dit is het enige geval waarin de app een adres meegeeft in plaats van
   * een id. Daarom loopt het langs een aparte weg in de serverfunctie, die
   * de rol controleert, afremt en elke verzending vastlegt.
   *
   * Wat er hier bij komt: het bericht komt ook in de postbus te staan, zodat
   * je later terugziet wat er is verstuurd en door wie.
   */
  async verstuur(input: {
    aan: string
    onderwerp: string
    tekst: string
    door: Pick<User, 'id' | 'name'>
  }) {
    const uitkomst = await mailVrij(input.aan, input.onderwerp, input.tekst)
    if (!uitkomst || uitkomst.sent === 0) {
      throw new Error(
        uitkomst?.skipped
          ? `Niet verstuurd: ${uitkomst.skipped}`
          : 'Versturen lukte niet. Kijk bij Post wat de server terugzei.',
      )
    }

    const bericht: MailBericht = {
      id: uid('mb'),
      richting: 'uit',
      van: 'dashboard',
      vanNaam: input.door.name,
      aan: input.aan.trim().toLowerCase(),
      onderwerp: input.onderwerp.trim(),
      tekst: input.tekst.trim(),
      hadHtml: false,
      at: Date.now(),
      status: 'verwerkt',
      attachments: [],
      handledBy: input.door.id,
      handledByName: input.door.name,
      handledAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('mailbox', db.mailbox, bericht)
  },
}

/* ------------------------------------------------------------------ *
 *  Wat je ervan ziet
 * ------------------------------------------------------------------ */

export interface PostbusFilter {
  richting: 'in' | 'uit' | 'alles'
  status?: MailStatus | 'alles'
  zoek?: string
}

export function filterPost(
  alle: MailBericht[],
  filter: PostbusFilter,
): MailBericht[] {
  const q = (filter.zoek ?? '').trim().toLowerCase().slice(0, 64)

  return alle
    .filter((m) => filter.richting === 'alles' || m.richting === filter.richting)
    .filter((m) => !filter.status || filter.status === 'alles' || m.status === filter.status)
    .filter((m) => !q ||
      m.onderwerp.toLowerCase().includes(q) ||
      m.van.toLowerCase().includes(q) ||
      (m.vanNaam ?? '').toLowerCase().includes(q) ||
      m.tekst.toLowerCase().includes(q))
    .sort((a, b) => b.at - a.at)
}

/** Hoeveel post er nog niet is bekeken. Voor het bolletje in het menu. */
export function onbekeken(alle: MailBericht[]): number {
  return alle.filter((m) => m.richting === 'in' && m.status === 'nieuw').length
}

/**
 * De bon die uit dit bericht is ontstaan, als hij er is.
 *
 * De serverfunctie zet het bedrag bewust op nul: dat uit een PDF lezen is
 * gokken, en een gok in de boekhouding is erger dan een leeg veld.
 */
export function bijbehorendeBon(
  bericht: MailBericht,
  bonnen: Expense[],
): Expense | undefined {
  if (!bericht.expenseId) return undefined
  return bonnen.find((b) => b.id === bericht.expenseId)
}

/** Leesbare grootte van een bijlage. */
export function grootte(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
