/* ===========================================================================
 *  De eigen AI vragen
 *
 *  Eén functie, twee bellers: melding-gesprek en trucky. Allebei stelden hun
 *  vraag rechtstreeks aan Claude; nu gaat het eerst hierlangs, en die kijkt
 *  wat er is ingesteld.
 *
 *  Hoe het werkt
 *  -------------
 *
 *  Een Edge Function draait in de cloud en kan de pc thuis niet bellen. Bij
 *  de facturen is dat opgelost door de richting om te draaien: de pc haalt
 *  werk op. Hier speelt hetzelfde, met één verschil -- er zit iemand te
 *  wachten. Dus:
 *
 *    1. deze functie legt de vraag in public.ai_opdrachten
 *    2. de pc hangt aan een lange lijn (functie lezer, actie 'ai-werk') en
 *       krijgt hem binnen een fractie van een seconde
 *    3. deze functie kijkt elke 300 ms of er antwoord staat
 *    4. na de ingestelde wachttijd geeft hij het op
 *
 *  Dat wachten kost functietijd, en dat is de prijs van geen open poort. Bij
 *  twintig seconden en een handvol gesprekken per dag is dat niets.
 *
 *  Wat er gebeurt als de pc uit staat
 *  ----------------------------------
 *
 *    lokaal            een nette melding: de eigen AI is niet bereikbaar
 *    lokaal-terugval   Claude beantwoordt hem alsnog
 *
 *  De tweede is de stand die je wilt zolang je het uitprobeert. De eerste is
 *  voor als je zeker wilt weten dat er niets naar buiten gaat.
 * =========================================================================== */

/** Wat er is ingesteld voor deze plek. */
export type Keuze = 'claude' | 'lokaal' | 'lokaal-terugval'

export interface Uitkomst {
  /** De tekst van het model, of null als het niet gelukt is. */
  tekst: string | null
  /** Wie het uiteindelijk deed; voor het logboek. */
  door: string
  /** Waarom het misging, als het misging. */
  reden?: string
}

const nu = () => Date.now()

/** Hoe vaak we kijken of er al antwoord is. */
const KIJK_ELKE_MS = 300

/** Waar geen instelling staat: gewoon Claude, zoals het altijd was. */
function leesKeuze(waarde: unknown): Keuze {
  const w = String(waarde ?? '').trim().toLowerCase()
  return w === 'lokaal' || w === 'lokaal-terugval' ? w : 'claude'
}

/**
 * Wat er is ingesteld voor deze plek, plus het model en de wachttijd.
 *
 * Eén vraag aan de database voor alle vier, omdat dit vóór elke aanroep
 * gebeurt en vier losse vragen vier keer de reistijd zijn.
 */
// deno-lint-ignore no-explicit-any
export async function lokaleInstelling(admin: any, sleutel: 'ai_melding' | 'ai_trucky'): Promise<{
  keuze: Keuze
  model: string
  wachtMs: number
}> {
  try {
    const { data } = await admin
      .from('instellingen')
      .select('sleutel, waarde')
      .in('sleutel', [sleutel, 'ai_lokaal_model', 'ai_wachttijd'])

    const pak = (s: string) =>
      (data ?? []).find((r: { sleutel: string }) => r.sleutel === s)?.waarde

    const seconden = Number(String(pak('ai_wachttijd') ?? '').trim())
    return {
      keuze: leesKeuze(pak(sleutel)),
      model: String(pak('ai_lokaal_model') ?? '').trim() || 'gemma4:26b',
      /*
       * Tussen 5 en 50 seconden. De bovengrens is er omdat een Edge Function
       * niet eeuwig mag draaien; de ondergrens omdat een model dat net moet
       * laden er alleen al een paar seconden over doet.
       */
      wachtMs: Math.min(50, Math.max(5, Number.isFinite(seconden) ? seconden : 20)) * 1000,
    }
  } catch (e) {
    console.warn('[lokaal] instelling lezen: ' + String(e))
    return { keuze: 'claude', model: 'gemma4:26b', wachtMs: 20000 }
  }
}

const slaap = (ms: number) => new Promise((klaar) => setTimeout(klaar, ms))

/**
 * De vraag bij de eigen pc neerleggen en op het antwoord wachten.
 *
 * Geeft null terug als er niets kwam; de beller beslist dan wat er gebeurt
 * (een melding, of alsnog Claude).
 */
// deno-lint-ignore no-explicit-any
export async function vraagLokaal(admin: any, opties: {
  soort: 'melding' | 'trucky'
  systeem: string
  gebruiker: string
  model: string
  wachtMs: number
  /** Moet het antwoord JSON zijn volgens dit schema? */
  schema?: unknown
}): Promise<Uitkomst> {
  const id = 'ai_' + crypto.randomUUID().replace(/-/g, '')
  const begin = nu()

  const { error } = await admin.from('ai_opdrachten').insert({
    id,
    soort: opties.soort,
    status: 'wacht',
    systeem: opties.systeem,
    gebruiker: opties.gebruiker,
    model: opties.model,
    schema: opties.schema ?? null,
    created_at: begin,
    updated_at: begin,
  })

  if (error) {
    /*
     * De tabel bestaat niet (0051 nog niet gedraaid), of de database is even
     * weg. Geen reden om de beller te laten vallen: die valt terug op Claude
     * of meldt het netjes.
     */
    console.warn('[lokaal] opdracht neerleggen: ' + error.message)
    return { tekst: null, door: 'lokaal', reden: 'De opdracht kon niet worden neergelegd.' }
  }

  while (nu() - begin < opties.wachtMs) {
    await slaap(KIJK_ELKE_MS)

    const { data } = await admin
      .from('ai_opdrachten')
      .select('status, antwoord, fout, gebruikt_model')
      .eq('id', id)
      .maybeSingle()

    if (!data) continue

    if (data.status === 'klaar' && data.antwoord) {
      const duur = ((nu() - begin) / 1000).toFixed(1)
      console.log(`[lokaal] ${opties.soort} beantwoord door ${data.gebruikt_model ?? opties.model} in ${duur}s`)
      return { tekst: String(data.antwoord), door: 'lokaal: ' + (data.gebruikt_model ?? opties.model) }
    }

    if (data.status === 'mislukt') {
      return {
        tekst: null,
        door: 'lokaal',
        reden: String(data.fout ?? 'De eigen AI kwam er niet uit.'),
      }
    }
  }

  /*
   * Tijd om. De rij blijft staan met status wacht of bezig; de opruimer in de
   * database haalt hem later weg. Hem hier wissen zou de pc midden in zijn
   * werk het antwoord onder handen weghalen, en dat levert een verwarrende
   * foutmelding op in plaats van een stille mislukking.
   */
  console.warn(`[lokaal] ${opties.soort}: geen antwoord binnen ${opties.wachtMs / 1000}s`)
  return {
    tekst: null,
    door: 'lokaal',
    reden: 'De eigen AI antwoordde niet op tijd. Staat de pc aan en draait het programma in lezer/?',
  }
}
