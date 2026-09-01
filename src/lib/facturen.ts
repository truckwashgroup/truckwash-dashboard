import { supabase, supabaseConfigured } from './api/supabaseApi'
import type { Expense, FactuurLezing, FactuurRegel } from './types'

/* ------------------------------------------------------------------ *
 *  De factuur laten voorlezen
 *
 *  Er komen bonnen binnen als PDF en als foto, en iemand tikt daar de
 *  leverancier, het bedrag en het btw-percentage van over. Dat is werk waar
 *  precies daarom fouten in sluipen: een 6 die een 5 wordt, een bedrag
 *  inclusief in het veld exclusief.
 *
 *  Wat hier terugkomt is een voorstel. Het staat in een eigen veld en
 *  overschrijft niets -- pas als iemand op overnemen drukt gaat er iets naar
 *  de kostenpost, en dan is dat een menselijke handeling met een naam eraan.
 * ------------------------------------------------------------------ */

export interface Leesuitkomst {
  ok: boolean
  lezing?: FactuurLezing
  reden?: string
  bewaard?: boolean
}

export async function leesFactuur(expenseId: string, pad?: string): Promise<Leesuitkomst> {
  if (!supabaseConfigured) {
    return { ok: false, reden: 'Er is nog geen database ingesteld.' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reden: 'Een factuur laten lezen lukt alleen met verbinding.' }
  }
  try {
    const { data, error } = await supabase().functions.invoke<Leesuitkomst>('factuur-lezen', {
      body: { expenseId, pad },
    })
    if (error) {
      const detail = await leesFout(error)
      return { ok: false, reden: detail ?? String(error.message ?? error) }
    }
    return data ?? { ok: false, reden: 'Geen antwoord van de leesdienst.' }
  } catch (e) {
    return { ok: false, reden: e instanceof Error ? e.message : String(e) }
  }
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

/* ================================================================== *
 *  Van lezing naar kostenpost
 * ================================================================== */

export interface Voorstel {
  veld: keyof Expense
  label: string
  waarde: string | number
  /** Wat er nu staat, zodat je ziet wat er verandert. */
  huidig?: string | number
}

const CATEGORIE_LABEL: Record<Expense['category'], string> = {
  materiaal: 'Materiaal',
  energie: 'Energie',
  onderhoud: 'Onderhoud',
  personeel: 'Personeel',
  transport: 'Transport',
  overig: 'Overig',
}

/**
 * Wat er over te nemen valt.
 *
 * Alleen wat werkelijk anders is dan wat er staat. Een lijst met tien regels
 * waarvan er acht niets veranderen leest niemand meer na, en juist het
 * nalezen is het punt.
 */
export function voorstellen(bon: Expense, lezing: FactuurLezing): Voorstel[] {
  const uit: Voorstel[] = []

  if (lezing.leverancier && lezing.leverancier !== bon.supplier) {
    uit.push({
      veld: 'supplier', label: 'Leverancier',
      waarde: lezing.leverancier, huidig: bon.supplier || undefined,
    })
  }

  const excl = bedragExcl(lezing)
  if (excl != null && Math.abs(excl - bon.amountExcl) > 0.005) {
    uit.push({
      veld: 'amountExcl', label: 'Bedrag exclusief btw',
      waarde: excl, huidig: bon.amountExcl,
    })
  }

  const btw = btwPercentage(lezing)
  if (btw != null && btw !== bon.vatPct) {
    uit.push({ veld: 'vatPct', label: 'Btw-percentage', waarde: btw, huidig: bon.vatPct })
  }

  if (lezing.datum && lezing.datum !== bon.date) {
    uit.push({ veld: 'date', label: 'Factuurdatum', waarde: lezing.datum, huidig: bon.date })
  }

  if (lezing.voorstelCategorie && lezing.voorstelCategorie !== bon.category) {
    uit.push({
      veld: 'category', label: 'Categorie',
      waarde: CATEGORIE_LABEL[lezing.voorstelCategorie],
      huidig: CATEGORIE_LABEL[bon.category],
    })
  }

  /*
   * Het factuurnummer krijgt geen eigen veld op de kostenpost, maar hoort
   * wel in de omschrijving: dat is wat je zoekt als de leverancier belt.
   */
  const nummer = lezing.factuurnummer
  if (nummer && !bon.description.includes(nummer)) {
    uit.push({
      veld: 'description', label: 'Omschrijving',
      waarde: bon.description
        ? `${bon.description} · factuur ${nummer}`
        : `Factuur ${nummer}`,
      huidig: bon.description || undefined,
    })
  }

  return uit
}

/**
 * Het bedrag exclusief btw.
 *
 * Bij voorkeur het subtotaal dat op de factuur staat. Staat dat er niet maar
 * wel een totaal en een btw-bedrag, dan is het verschil net zo hard. Alleen
 * een totaal inclusief is niet genoeg: dan zouden we een percentage moeten
 * aannemen, en aannames horen niet in een bedrag dat wordt goedgekeurd.
 */
export function bedragExcl(lezing: FactuurLezing): number | undefined {
  if (lezing.subtotaalExcl != null) return afgerond(lezing.subtotaalExcl)
  if (lezing.totaalIncl != null && lezing.btwBedrag != null) {
    return afgerond(lezing.totaalIncl - lezing.btwBedrag)
  }
  return undefined
}

/**
 * Het btw-percentage, teruggerekend uit de bedragen.
 *
 * Alleen als het uitkomt op een tarief dat in Nederland bestaat. Komt er
 * 17,4% uit, dan staan er twee tarieven op één factuur en is één percentage
 * gewoon het verkeerde antwoord -- dan liever niets voorstellen.
 */
export function btwPercentage(lezing: FactuurLezing): number | undefined {
  const excl = lezing.subtotaalExcl
  const btw = lezing.btwBedrag
  if (excl == null || btw == null || excl <= 0) return undefined

  const pct = (btw / excl) * 100
  for (const tarief of [0, 9, 21]) {
    if (Math.abs(pct - tarief) < 0.6) return tarief
  }
  return undefined
}

function afgerond(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Tellen de regels op tot het subtotaal?
 *
 * Zo niet, dan staat er iets op de factuur wat niet in de regels terecht is
 * gekomen -- een korting, statiegeld, verzendkosten. Dat is geen fout van de
 * lezer maar wel iets wat je wil weten voordat je tekent.
 */
export function regelsKloppen(lezing: FactuurLezing): { klopt: boolean; verschil: number } | null {
  const regels = lezing.regels ?? []
  if (!regels.length || lezing.subtotaalExcl == null) return null

  const som = regels.reduce((a, r) => a + (r.bedragExcl ?? 0), 0)
  const verschil = afgerond(som - lezing.subtotaalExcl)
  return { klopt: Math.abs(verschil) < 0.02, verschil }
}

/** Wat er in een regel ontbreekt, kort gezegd. */
export function regelKaal(r: FactuurRegel): boolean {
  return r.bedragExcl == null && r.stukprijs == null
}

/** Is deze bon te lezen? Zonder bijlage valt er niets voor te lezen. */
export function heeftIetsTeLezen(bon: Expense): boolean {
  return !!bon.attachmentPath || !!bon.mailboxId
}
