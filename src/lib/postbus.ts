import { db, uid } from './db'
import { enqueue } from './sync'
import { leesInstelling, SLEUTELS } from './instellingen'
import { laatsteMailFout, mailVrij } from './mail'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import { CONTROLE_LABELS } from './types'
import type {
  BijlageControle, Expense, MailBericht, MailBijlage, MailStatus, User,
} from './types'

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

/**
 * Een bijlage die niet door de controle kwam.
 *
 * Wat er gecontroleerd wordt gebeurt op de server, bij het binnenkomen:
 * klopt het bestand met wat het beweert te zijn, zit er geen actieve inhoud
 * in, en -- als er een scanner is aangesloten -- wat zegt die.
 */
export class BijlageGeweigerd extends Error {
  constructor(readonly controle: BijlageControle, readonly detail?: string) {
    super(
      controle === 'verdacht'
        ? `Deze bijlage is tegengehouden. ${detail ?? ''}`.trim()
        : controle === 'mislukt'
          ? `De controle op deze bijlage is niet gelukt, dus hij gaat niet open. ${detail ?? ''}`.trim()
          : 'Deze bijlage is nog niet gecontroleerd.',
    )
  }
}

/** Mag deze bijlage geopend worden? */
export function magOpenen(bijlage: MailBijlage): boolean {
  /*
   * Zonder pad staat er niets in de opslag. Dat gebeurt als de bijlage wel
   * in de mail zat maar er niet uit te halen was -- de webhook stuurde geen
   * inhoud mee, of het opslaan liep stuk. Hij blijft in het rijtje staan met
   * de reden erbij, maar er valt niets te openen.
   */
  if (!bijlage.path) return false

  // Geen uitkomst betekent: van vóór de controle. Die laten we door, met
  // een waarschuwing in beeld.
  return !bijlage.controle || bijlage.controle === 'schoon'
}

/** Wat er bij een bijlage in het scherm hoort te staan. */
export function controleLabel(bijlage: MailBijlage): { label: string; tone: string } | null {
  if (!bijlage.path && bijlage.controle !== 'verdacht') {
    return { label: 'Niet binnengekomen', tone: 'warn' }
  }
  if (!bijlage.controle) {
    return { label: 'Niet gecontroleerd', tone: 'warn' }
  }
  if (bijlage.controle === 'schoon') return null
  return CONTROLE_LABELS[bijlage.controle]
}

export type DeelDuur = '1 hour' | '8 hours' | '24 hours' | '48 hours'

export const DEEL_DUUR: Record<DeelDuur, string> = {
  '1 hour':   'Een uur',
  '8 hours':  'Acht uur',
  '24 hours': 'Een dag',
  '48 hours': 'Twee dagen',
}

/** Roept de serverfunctie aan en pakt de reden uit als het misgaat. */
async function roepActie(body: Record<string, unknown>) {
  if (!supabaseConfigured) {
    return { ok: false, reden: 'Er is nog geen database ingesteld.' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reden: 'Dit lukt alleen met verbinding.' }
  }
  try {
    const { data, error } = await supabase().functions.invoke('postbus-actie', { body })
    if (error) {
      const detail = await leesFunctieFout(error)
      return { ok: false, reden: detail ?? String(error.message ?? error) }
    }
    return (data ?? { ok: false, reden: 'Geen antwoord' }) as {
      ok: boolean; url?: string; aantal?: number; gelukt?: number; reden?: string
    }
  } catch (e) {
    return { ok: false, reden: e instanceof Error ? e.message : String(e) }
  }
}

async function leesFunctieFout(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!context || typeof context !== 'object') return null
  try {
    const response = context as Response
    if (typeof response.json !== 'function') return null
    const body = await response.json()
    return body?.reden ?? body?.error ?? null
  } catch {
    return null
  }
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
  async openBijlage(bijlage: Pick<MailBijlage, 'path' | 'controle' | 'controleReden'>): Promise<string> {
    if (!supabaseConfigured) {
      throw new Error('De opslag is nog niet ingesteld.')
    }

    /*
     * Niet openen wat niet is nagekeken.
     *
     * Bijlagen van oudere berichten hebben nog geen uitkomst; die zijn
     * binnengekomen voordat er gecontroleerd werd. Die laten we door met
     * een waarschuwing in het scherm, niet stilzwijgend.
     */
    if (bijlage.controle && bijlage.controle !== 'schoon') {
      throw new BijlageGeweigerd(bijlage.controle, bijlage.controleReden)
    }
    if (!bijlage.path) {
      throw new Error(
        'Van deze bijlage staat er niets in de opslag; er valt dus niets te ' +
        'openen. Vraag de afzender om hem opnieuw te sturen.',
      )
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
   * De bijlagen alsnog ophalen.
   *
   * Resend zet de inhoud van een bijlage niet in de webhook -- alleen de
   * naam en het type. Het ophalen is een tweede stap, en die deden we een
   * tijd lang niet. Alle post uit die periode heeft dus wel de namen van
   * zijn bijlagen maar niets erachter. Hiermee haal je ze alsnog binnen,
   * zonder de afzender te hoeven vragen het nog eens te sturen.
   */
  async haalBijlagenOpnieuw(berichtId: string): Promise<{
    ok: boolean; aantal?: number; gelukt?: number; reden?: string
  }> {
    return roepActie({ actie: 'bijlagen', berichtId })
  },

  /**
   * Een link waarmee je deze mail kunt laten zien.
   *
   * Voor wie geen toegang tot het dashboard heeft: de boekhouder, of een
   * leverancier die volhoudt dat hij iets anders heeft gestuurd. De link
   * vervalt vanzelf -- Resend staat hoogstens achtenveertig uur toe, en dat
   * is ruim genoeg voor een gesprek.
   */
  async deel(berichtId: string, geldig: DeelDuur = '24 hours'): Promise<{
    ok: boolean; url?: string; reden?: string
  }> {
    return roepActie({ actie: 'deel', berichtId, geldig })
  },

  /**
   * Van een bericht dat de post als verkoopfactuur wegzette alsnog een
   * kostenpost maken.
   *
   * De weg terug. De post haalt bij een verkoopfactuur de kostenpost weg, en
   * hoe goed het tweede slot ook is, ooit zit hij ernaast -- en dan stond er
   * tot nu toe niets tegenover: overtikken, zonder bijlage. Dit maakt
   * dezelfde kostenpost als de post zelf zou hebben gemaakt: leeg bedrag,
   * de bijlage eraan, bron 'mail', de vestiging uit het adres. Alleen wie
   * hem indiende is nu een mens in plaats van niemand, want dat is ook zo.
   *
   * Wat er niet gebeurt: voorlezen. Dat doet de knop bij de bon in de
   * administratie, en daar hoort ook de mens die dit net heeft beslist.
   */
  async tochKostenpost(berichtId: string, door: Pick<User, 'id' | 'name'>): Promise<Expense> {
    const bericht = await db.mailbox.get(berichtId)
    if (!bericht) throw new Error('Dit bericht staat niet (meer) in de postbus.')

    // Twee keer drukken levert geen twee bonnen op.
    if (bericht.expenseId) {
      const bestaand = await db.expenses.get(bericht.expenseId)
      if (bestaand) return bestaand
    }

    /*
     * Dezelfde keuze als de post: eerst een PDF, dan een foto, en alleen
     * wat écht in de opslag staat. Anders hangt het logo uit de handtekening
     * aan de bon in plaats van de factuur.
     */
    const bruikbaar = bericht.attachments.filter((b) => b.path)
    const bon =
      bruikbaar.find((b) => b.mime === 'application/pdf')
      ?? bruikbaar.find((b) => b.mime.startsWith('image/'))
      ?? bruikbaar[0]
    if (!bon) {
      throw new Error(
        'Bij dit bericht staat geen bijlage in de opslag, dus er valt geen ' +
        'kostenpost met bewijs van te maken. Haal eerst de bijlagen opnieuw op.',
      )
    }

    const vestiging = await vestigingUitAdres(bericht.aan)

    /*
     * Het type zegt dat locationId er altijd is; de post zet hem op niets als
     * het adres bij geen vestiging hoort, en de database staat dat toe. Dat
     * hier ook zo doen is beter dan een lege tekst, want die botst op de
     * verwijzing naar locations.
     */
    const zonderVestiging: Omit<Expense, 'locationId'> & { locationId?: string } = {
      id: uid('exp'),
      locationId: vestiging,
      date: Date.now(),
      category: 'overig',
      supplier: bericht.vanNaam || bericht.van,
      description: bericht.onderwerp,
      amountExcl: 0,
      vatPct: 21,
      status: 'open',
      submittedBy: door.id,
      submittedByName: door.name,
      source: 'mail',
      mailboxId: bericht.id,
      attachmentPath: bon.path,
      attachmentName: bon.naam,
      updatedAt: Date.now(),
    }
    const kostenpost = zonderVestiging as Expense

    await put('expenses', db.expenses, kostenpost)
    await put('mailbox', db.mailbox, { ...bericht, expenseId: kostenpost.id, soort: 'inkoop' })
    return kostenpost
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
      const reden = uitkomst?.skipped ?? laatsteMailFout()
      throw new Error(
        reden
          ? `Niet verstuurd: ${reden}`
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

/**
 * Bij welke vestiging hoort post op dit adres?
 *
 * Dezelfde regel als de post op de server hanteert: inkoop.<slug>@<domein>,
 * met de slug van de website of anders de code van de vestiging. Past het
 * niet, dan hoort de bon bij geen vestiging -- en dat is een uitkomst, geen
 * fout. Post weggooien of weigeren omdat het adres net anders is, doet de
 * server ook niet.
 */
async function vestigingUitAdres(aan: string): Promise<string | undefined> {
  const bak = (aan ?? '').trim().toLowerCase()
  if (!bak.includes('@')) return undefined
  const [postvak, domein] = bak.split('@')

  const verwachtDomein = (await leesInstelling(SLEUTELS.inkoopDomein)).toLowerCase()
  const voorvoegsel = (await leesInstelling(SLEUTELS.inkoopVoorvoegsel, 'inkoop')).toLowerCase()

  if (verwachtDomein && domein !== verwachtDomein) return undefined
  if (!postvak.startsWith(voorvoegsel + '.')) return undefined

  const slug = postvak.slice(voorvoegsel.length + 1).split('+')[0].trim()
  if (!slug) return undefined

  const locaties = await db.locations.toArray()
  const plek =
    locaties.find((l) => (l.websiteSlug ?? '').toLowerCase() === slug)
    ?? locaties.find((l) => l.code.toLowerCase() === slug)
  return plek?.id
}

/* ------------------------------------------------------------------ *
 *  Wat je ervan ziet
 * ------------------------------------------------------------------ */

export interface PostbusFilter {
  richting: 'in' | 'uit' | 'alles'
  status?: MailStatus | 'alles'
  /**
   * Alleen post van dit soort. Het scherm gebruikt het om de verkoopfacturen
   * bij elkaar te zetten -- die zaten verstopt tussen de bonnen, en dat was
   * precies het probleem.
   */
  soort?: NonNullable<MailBericht['soort']> | 'alles'
  zoek?: string
}

/** Is dit een factuur van Truckwash zelf, die iemand heeft doorgestuurd? */
export function isVerkoopfactuur(bericht: MailBericht): boolean {
  return bericht.soort === 'verkoop'
}

export function filterPost(
  alle: MailBericht[],
  filter: PostbusFilter,
): MailBericht[] {
  const q = (filter.zoek ?? '').trim().toLowerCase().slice(0, 64)

  return alle
    .filter((m) => filter.richting === 'alles' || m.richting === filter.richting)
    .filter((m) => !filter.status || filter.status === 'alles' || m.status === filter.status)
    .filter((m) => !filter.soort || filter.soort === 'alles' || m.soort === filter.soort)
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

/** Hoeveel verkoopfacturen er binnenkwamen. Voor de teller op het tabblad. */
export function aantalVerkoopfacturen(alle: MailBericht[]): number {
  return alle.filter((m) => m.richting === 'in' && isVerkoopfactuur(m)).length
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
