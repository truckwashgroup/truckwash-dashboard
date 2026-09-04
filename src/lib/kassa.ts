import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type {
  Coupures, Location, PosDevice, PosPairing, PosRegister, PosSafe, PosSafeMove,
  User,
} from './types'

/* ------------------------------------------------------------------ *
 *  De beheerkant van de kassa
 *
 *  De kassa is een tweede app die met dezelfde database praat. Hier staat
 *  wat het kantoor erover te zeggen heeft: welke kassa's er zijn, welk
 *  apparaat erop staat, en wat er in de kluis zit.
 *
 *  Twee dingen worden hier bewust níét gedaan:
 *
 *   - de printer- en pinautomaatinstellingen wijzigen. Die zet de kassa
 *     zelf, want die weet welk apparaat eraan hangt. Het dashboard leest ze.
 *
 *   - een kluisboeking wijzigen of wissen. De database weigert het, om
 *     dezelfde reden als bij een afgerekende bon: een kasadministratie die je
 *     achteraf kunt bijschaven is geen administratie.
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

/* ================================================================== *
 *  De kassa's
 * ================================================================== */

/**
 * De code die in elk bonnummer komt.
 *
 * Kort, hoofdletters, streepjes in plaats van spaties. Hij staat op elke bon
 * en wordt door mensen overgetypt bij het zoeken, dus hoe minder tekens hoe
 * beter -- en geen tekens die je op een bon niet uit elkaar houdt.
 */
export function schoonCode(ruw: string): string {
  return ruw
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
}

export function codeProbleem(code: string, bestaand: PosRegister[], eigenId?: string): string | null {
  const schoon = schoonCode(code)
  if (schoon.length < 3) return 'Een code van minder dan drie tekens is te kort.'
  if (bestaand.some((r) => r.code === schoon && r.id !== eigenId)) {
    return `Er is al een kassa met de code ${schoon}. De code komt op elke bon, dus hij moet uniek zijn.`
  }
  return null
}

/** Een voorstel: de code van de vestiging, met een volgnummer erachter. */
export function voorstelCode(locatie: Location | undefined, bestaand: PosRegister[]): string {
  const basis = schoonCode(locatie?.code ?? 'KAS').replace(/^TW-?/, '')
  const stam = `KAS-${basis || 'X'}`
  for (let n = 1; n < 50; n++) {
    const kandidaat = `${stam}-${n}`
    if (!bestaand.some((r) => r.code === kandidaat)) return kandidaat
  }
  return stam
}

export const kassas = {
  async aanmaken(input: { code: string; naam: string; locationId: string }) {
    const kassa: PosRegister = {
      id: uid('reg'),
      locationId: input.locationId,
      code: schoonCode(input.code),
      name: input.naam.trim(),
      lastSeq: 0,
      active: true,
      updatedAt: Date.now(),
    }
    return put('posRegisters', db.posRegisters, kassa)
  },

  async update(id: string, patch: Partial<PosRegister>) {
    const kassa = await db.posRegisters.get(id)
    if (!kassa) return
    return put('posRegisters', db.posRegisters, { ...kassa, ...patch, id })
  },

  /**
   * Een kassa uitzetten.
   *
   * Er kan dan geen nieuw apparaat meer op gekoppeld worden. Wat er al op
   * staat blijft werken; die zet je apart stil met het apparaat zelf.
   */
  aanUit: (kassa: PosRegister, aan: boolean) =>
    kassas.update(kassa.id, { active: aan }),
}

/* ================================================================== *
 *  De koppelcodes
 * ================================================================== */

/**
 * Het alfabet van een koppelcode.
 *
 * Zonder I, L, O, 0 en 1. Die worden bij het overtypen door elkaar gehaald --
 * de code wordt van een scherm gelezen en op een tablet ingetikt -- en de
 * kassa weigert ze met een uitleg in plaats van met "code onbekend".
 */
const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Acht tekens uit een echte toevalsbron.
 *
 * `Math.random` is voorspelbaar genoeg om te raden als je weet wanneer een
 * code is gemaakt, en hiermee koppel je een apparaat aan een vestiging.
 */
export function nieuweCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => ALFABET[b % ALFABET.length]).join('')
}

/** K7QJ-4M2P: twee groepjes van vier leest en tikt beter dan acht op een rij. */
export function toonCode(code: string): string {
  const schoon = code.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return schoon.length === 8 ? `${schoon.slice(0, 4)}-${schoon.slice(4)}` : schoon
}

export const GELDIGHEID = [
  { uren: 1, label: 'Een uur' },
  { uren: 24, label: 'Een dag' },
  { uren: 24 * 7, label: 'Een week' },
] as const

export const koppelcodes = {
  async maken(input: {
    kassa: PosRegister
    urenGeldig: number
    door: Pick<User, 'id' | 'name'>
    notitie?: string
  }) {
    if (!input.kassa.locationId) {
      throw new Error('Deze kassa hangt niet aan een vestiging; zet die eerst goed.')
    }
    const code: PosPairing = {
      id: uid('pair'),
      code: nieuweCode(),
      locationId: input.kassa.locationId,
      registerId: input.kassa.id,
      createdBy: input.door.id,
      createdByName: input.door.name,
      expiresAt: Date.now() + input.urenGeldig * 3_600_000,
      note: input.notitie?.trim() || undefined,
      updatedAt: Date.now(),
    }
    return put('posPairings', db.posPairings, code)
  },

  /**
   * Een code intrekken.
   *
   * Door hem te laten verlopen in plaats van hem weg te gooien: dan blijft
   * zichtbaar dát er een code is gemaakt en door wie. Een code die spoorloos
   * verdwijnt is een code waarvan niemand meer weet of hij is gebruikt.
   */
  intrekken: (code: PosPairing) =>
    put('posPairings', db.posPairings, { ...code, expiresAt: Date.now() - 1000 }),
}

/** De codes die nu nog werken voor deze kassa. */
export function openCodes(alle: PosPairing[], registerId: string, nu = Date.now()): PosPairing[] {
  return alle
    .filter((c) => c.registerId === registerId && !c.usedAt && c.expiresAt > nu)
    .sort((a, b) => b.expiresAt - a.expiresAt)
}

/* ================================================================== *
 *  De apparaten
 * ================================================================== */

export const apparaten = {
  /**
   * Blokkeren.
   *
   * De kassa gaat op slot maar blijft zijn wachtrij versturen. Dat is precies
   * wat je wil als een tablet kwijt is: er kan omzet op staan die nog niet
   * binnen is, en die wil je alsnog hebben.
   */
  blokkeren: (apparaat: PosDevice) => zetStatus(apparaat, 'geblokkeerd'),

  vrijgeven: (apparaat: PosDevice) => zetStatus(apparaat, 'actief'),

  /**
   * Intrekken.
   *
   * Dit is geen handeling maar een opdracht. De kassa ziet hem bij zijn
   * volgende ronde, stuurt eerst zijn wachtrij leeg, wist zichzelf en zet
   * dan pas `wipedAt`. Tot dat moment is het apparaat niet klaar en blijft
   * het inlogaccount staan -- weghalen zou betekenen dat wat er nog op stond
   * nooit meer binnenkomt.
   */
  intrekken: (apparaat: PosDevice) => zetStatus(apparaat, 'ingetrokken'),

  /**
   * Het inlogaccount en het dossier weghalen. Pas als het apparaat klaar is.
   *
   * Met `forceren` mag het ook zonder afmelding, en dan is een reden verplicht.
   * Dat is er voor het toestel dat nooit meer terugkomt -- kwijt, kapot, of
   * opnieuw ingericht. Zonder die uitweg bleef het kantoor voor altijd naar
   * "wacht op afmelden" kijken zonder ook maar een knop, en dat is precies wat
   * er gebeurde bij twee kassa's die al dagen stil stonden.
   *
   * De reden gaat het verwijderlogboek in. Er kan omzet mee weg die alleen op
   * dat apparaat bestond, en dan hoort na te lezen te zijn wie dat besloot.
   */
  async definitiefWissen(
    apparaat: PosDevice,
    opties: { forceren?: boolean; reden?: string } = {},
  ): Promise<{ ok: boolean; reden?: string }> {
    if (!apparaat.wipedAt && !opties.forceren) {
      return {
        ok: false,
        reden: 'Dit apparaat heeft zich nog niet afgemeld. Er kan omzet op ' +
               'staan die nog niet is verstuurd.',
      }
    }
    if (!apparaat.wipedAt && (opties.reden ?? '').trim().length < 3) {
      return { ok: false, reden: 'Geef een reden op voor het geforceerd wissen.' }
    }
    if (!supabaseConfigured) return { ok: false, reden: 'Er is nog geen database ingesteld.' }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ok: false, reden: 'Dit lukt alleen met verbinding.' }
    }

    try {
      const { data, error } = await supabase().functions.invoke<{ ok: boolean; reden?: string }>(
        'kassa-apparaat', {
          body: {
            actie: 'wissen',
            deviceId: apparaat.id,
            forceren: opties.forceren === true,
            reden: (opties.reden ?? '').trim(),
          },
        })
      if (error) {
        const detail = await leesFout(error)
        return { ok: false, reden: detail ?? String(error.message ?? error) }
      }
      if (data?.ok) await db.posDevices.delete(apparaat.id)
      return data ?? { ok: false, reden: 'Geen antwoord van de server.' }
    } catch (e) {
      return { ok: false, reden: e instanceof Error ? e.message : String(e) }
    }
  },
}

function zetStatus(apparaat: PosDevice, status: PosDevice['status']) {
  return put('posDevices', db.posDevices, { ...apparaat, status })
}

async function leesFout(error: unknown): Promise<string | null> {
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

/** Het apparaat dat nu op deze kassa staat, als dat er is. */
export function apparaatVan(alle: PosDevice[], registerId: string): PosDevice | undefined {
  return alle.find((a) => a.registerId === registerId && a.status !== 'ingetrokken')
    ?? alle.filter((a) => a.registerId === registerId)
      .sort((a, b) => b.pairedAt - a.pairedAt)[0]
}

/**
 * Hoe lang geleden een apparaat zich heeft gemeld.
 *
 * Een kassa die al dagen niets van zich laat horen is niet per se stuk -- een
 * vestiging kan dicht zijn -- maar het is wel het eerste waar je naar kijkt
 * als er omzet mist.
 */
export function stilte(apparaat: PosDevice, nu = Date.now()): number | null {
  if (!apparaat.lastSeenAt) return null
  return nu - apparaat.lastSeenAt
}

/* ================================================================== *
 *  De kluis
 * ================================================================== */

/**
 * Wat één briefje of munt waard is.
 *
 * b<euro> en m<cent>: b100 is een briefje van honderd, m5 een munt van vijf
 * cent. Dat b5 en m5 niet hetzelfde zijn is precies waarom het twee letters
 * zijn en niet één -- vijf euro tegenover vijf cent scheelt een factor
 * honderd, en dat wil je niet in een kasverschil terugvinden.
 */
export function muntWaarde(sleutel: string): number {
  const briefje = /^b(\d+)$/.exec(sleutel)
  if (briefje) return Number(briefje[1])
  const munt = /^m(\d+)$/.exec(sleutel)
  if (munt) return Number(munt[1]) / 100
  return 0
}

/** Wat een stapel briefjes en munten samen waard is. */
export function waardeVan(coupures: Coupures | undefined): number {
  if (!coupures) return 0
  const som = Object.entries(coupures)
    .reduce((a, [sleutel, aantal]) => a + muntWaarde(sleutel) * (Number(aantal) || 0), 0)
  return Math.round(som * 100) / 100
}

/**
 * Het saldo van een kluis.
 *
 * Dezelfde regel als in de database en op de kassa: vanaf de laatste telling
 * optellen, en zonder telling vanaf nul. Op tijd én id sorteren, want twee
 * boekingen kunnen in dezelfde milliseconde vallen -- dan valt een boeking
 * van hetzelfde moment als de telling anders uit het saldo.
 */
export function saldoVan(bewegingen: PosSafeMove[], safeId: string): number {
  const vanDeze = bewegingen
    .filter((m) => m.safeId === safeId)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

  const laatsteTelling = [...vanDeze]
    .reverse()
    .find((m) => m.soort === 'telling' && m.counted)

  const basis = laatsteTelling ? waardeVan(laatsteTelling.counted) : 0
  const na = laatsteTelling
    ? vanDeze.filter((m) =>
        m.soort !== 'telling' &&
        (m.at > laatsteTelling.at ||
          (m.at === laatsteTelling.at && m.id > laatsteTelling.id)))
    : vanDeze.filter((m) => m.soort !== 'telling')

  const som = basis + na.reduce((a, m) => a + m.amount, 0)
  return Math.round(som * 100) / 100
}

/** De laatste telling van een kluis, als die er is. */
export function laatsteTelling(bewegingen: PosSafeMove[], safeId: string): PosSafeMove | undefined {
  return bewegingen
    .filter((m) => m.safeId === safeId && m.soort === 'telling')
    .sort((a, b) => b.at - a.at)[0]
}

/**
 * Hoe lang een kluis niet is geteld.
 *
 * Zonder telling weet niemand of de administratie nog met de kluis klopt. De
 * kassa waarschuwt na dertig dagen; hier is het veertien, want vanaf het
 * kantoor kun je er iets aan doen voordat het een probleem wordt.
 */
export const TELLING_TERMIJN = 14 * 86_400_000

export function tellingAchterstallig(
  bewegingen: PosSafeMove[],
  safeId: string,
  nu = Date.now(),
): { achterstallig: boolean; sinds?: number; nooit: boolean } {
  const telling = laatsteTelling(bewegingen, safeId)
  if (!telling) return { achterstallig: true, nooit: true }
  return {
    achterstallig: nu - telling.at > TELLING_TERMIJN,
    sinds: telling.at,
    nooit: false,
  }
}

/** De bewegingen van een kluis, nieuwste eerst. */
export function bewegingenVan(alle: PosSafeMove[], safeId: string, max = 60): PosSafeMove[] {
  return alle
    .filter((m) => m.safeId === safeId)
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    .slice(0, max)
}

export function kluisVan(kluizen: PosSafe[], locationId: string): PosSafe | undefined {
  return kluizen.find((k) => k.locationId === locationId)
}

/**
 * De coupures op volgorde, van groot naar klein.
 *
 * Zoals je ze op tafel legt bij het tellen; een lijst op alfabet leest bij
 * geld nergens naar.
 */
export function coupuresOpVolgorde(coupures: Coupures | undefined): [string, number][] {
  if (!coupures) return []
  return Object.entries(coupures)
    .filter(([, aantal]) => Number(aantal) > 0)
    .map(([sleutel, aantal]) => [sleutel, Number(aantal)] as [string, number])
    .sort((a, b) => muntWaarde(b[0]) - muntWaarde(a[0]))
}

/** "€ 50" of "50 cent", zoals je het zegt. */
export function coupureLabel(sleutel: string): string {
  const waarde = muntWaarde(sleutel)
  if (waarde >= 1) return `€ ${waarde}`
  return `${Math.round(waarde * 100)} cent`
}

/* ------------------------------------------------------------------ *
 *  De laatste bon per kassa
 *
 *  Het verkoopjournaal halen we niet binnen. Negentien vestigingen die elke
 *  dag bonnen maken zou betekenen dat elk dashboard de hele kassa-
 *  administratie in zijn geheugen heeft staan om één regel te laten zien.
 *
 *  Hoevéél bonnen er zijn staat al in pos_registers.last_seq, bijgehouden
 *  door de database. Wat de laatste was vragen we hier op, één keer, als het
 *  scherm opengaat.
 * ------------------------------------------------------------------ */

export interface LaatsteBon {
  registerId: string
  bonnummer: string
  bedrag: number
  op: number
}

export async function laatsteBonnen(): Promise<Map<string, LaatsteBon>> {
  const uit = new Map<string, LaatsteBon>()
  if (!supabaseConfigured) return uit
  if (typeof navigator !== 'undefined' && !navigator.onLine) return uit

  try {
    const { data, error } = await supabase()
      .from('pos_sales')
      .select('register_id, receipt_no, total_incl, closed_at')
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false })
      .limit(200)

    if (error || !data) return uit

    for (const rij of data as Record<string, unknown>[]) {
      const kassa = String(rij.register_id ?? '')
      if (!kassa || uit.has(kassa)) continue
      uit.set(kassa, {
        registerId: kassa,
        bonnummer: String(rij.receipt_no ?? ''),
        bedrag: Number(rij.total_incl ?? 0),
        op: Number(rij.closed_at ?? 0),
      })
    }
  } catch {
    /* Geen bonnen kunnen ophalen is geen storing; dan staat het er niet. */
  }
  return uit
}
