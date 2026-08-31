/* ------------------------------------------------------------------ *
 *  Een contract uitlezen
 *
 *  Wat dit wel doet: de tekstlaag van een PDF ophalen en daar de gegevens
 *  uit vissen die in vrijwel elk Nederlands arbeidscontract op dezelfde
 *  manier staan -- salaris, uren, ingangsdatum, einddatum, functie.
 *
 *  Wat dit met opzet niet doet: die waarden zelf opslaan. Ze worden
 *  vóórgesteld, met de zin waarin ze gevonden zijn eronder, en iemand
 *  bevestigt ze. Een verkeerd overgenomen loon of een einddatum die er een
 *  jaar naast zit is erger dan een leeg veld -- dat laatste valt op, het
 *  eerste niet.
 *
 *  Per gevonden waarde houden we bij hoe zeker we zijn. "Bruto per maand:
 *  € 2.850" is iets anders dan een willekeurig bedrag ergens in de tekst.
 * ------------------------------------------------------------------ */

export type Zekerheid = 'hoog' | 'middel' | 'laag'

export interface Vondst<T> {
  waarde: T
  zekerheid: Zekerheid
  /** De zin waarin het gevonden is, zodat iemand het kan nakijken */
  bron: string
}

export interface ContractGegevens {
  functie?: Vondst<string>
  /** Bruto per maand, in euro's */
  maandloon?: Vondst<number>
  /** Bruto per uur, in euro's */
  uurloon?: Vondst<number>
  urenPerWeek?: Vondst<number>
  startDatum?: Vondst<number>
  eindDatum?: Vondst<number>
  /** Onbepaalde tijd gevonden? Dan is er geen einddatum. */
  onbepaaldeTijd?: Vondst<boolean>
  /** De hele tekst, voor als iemand zelf wil zoeken */
  tekst: string
  bladzijden: number
}

/* ------------------------------------------------------------------ *
 *  De tekstlaag uit de PDF halen
 * ------------------------------------------------------------------ */

let pdfjs: typeof import('pdfjs-dist') | null = null

/**
 * pdf.js is groot. Hij wordt pas opgehaald als iemand daadwerkelijk een
 * contract inleest, niet bij het opstarten van de app.
 */
async function laadPdfjs() {
  if (pdfjs) return pdfjs
  const mod = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  mod.GlobalWorkerOptions.workerSrc = worker.default
  pdfjs = mod
  return mod
}

export class GeenTekstlaag extends Error {
  constructor() {
    super(
      'Dit is een gescand document zonder tekstlaag — er valt niets uit te ' +
      'lezen. Vul de gegevens met de hand in; het bestand zelf blijft gewoon ' +
      'in het dossier staan.',
    )
  }
}

/** Haalt de tekst uit een PDF. Gooit als er geen tekstlaag in zit. */
export async function leesPdfTekst(bestand: Blob): Promise<{ tekst: string; bladzijden: number }> {
  const lib = await laadPdfjs()
  const data = new Uint8Array(await bestand.arrayBuffer())

  const doc = await lib.getDocument({ data }).promise
  const stukken: string[] = []

  // Twintig bladzijden is ruim; een arbeidscontract is er zelden meer.
  const max = Math.min(doc.numPages, 20)
  for (let i = 1; i <= max; i++) {
    const bladzijde = await doc.getPage(i)
    const inhoud = await bladzijde.getTextContent()
    stukken.push(
      inhoud.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' '),
    )
  }

  const tekst = stukken.join('\n').replace(/[ \t]+/g, ' ').trim()
  if (tekst.replace(/\s/g, '').length < 40) throw new GeenTekstlaag()

  return { tekst, bladzijden: doc.numPages }
}

/* ------------------------------------------------------------------ *
 *  De gegevens eruit vissen
 * ------------------------------------------------------------------ */

const MAANDEN: Record<string, number> = {
  januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5,
  juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
  jan: 0, feb: 1, mrt: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
}

/** "1 maart 2026", "01-03-2026" en "2026-03-01" naar een datum. */
export function leesDatum(ruw: string): number | undefined {
  const tekst = ruw.trim().toLowerCase()

  const geschreven = tekst.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/)
  if (geschreven) {
    const maand = MAANDEN[geschreven[2]]
    if (maand !== undefined) {
      return new Date(Number(geschreven[3]), maand, Number(geschreven[1])).getTime()
    }
  }

  /*
   * ISO eerst. Anders leest het patroon hieronder "2026-03-01" van achteren
   * naar voren als 26 maart 2001 -- een datum die er plausibel uitziet en er
   * vijfentwintig jaar naast zit.
   */
  const iso = tekst.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime()
  }

  const punten = tekst.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (punten) {
    const jaar = Number(punten[3])
    return new Date(
      jaar < 100 ? 2000 + jaar : jaar,
      Number(punten[2]) - 1,
      Number(punten[1]),
    ).getTime()
  }

  return undefined
}

/** "2.850,00" en "2850.00" naar een getal. */
export function leesBedrag(ruw: string): number | undefined {
  const schoon = ruw.replace(/[^\d.,]/g, '')
  if (!schoon) return undefined

  /*
   * Nederlandse notatie: punt scheidt duizendtallen, komma de centen. Maar
   * "2850.00" komt ook voor. De regel die beide goed doet: staat er een
   * komma, dan is die de decimaal en zijn de punten scheidingstekens.
   */
  const genormaliseerd = schoon.includes(',')
    ? schoon.replace(/\./g, '').replace(',', '.')
    : schoon.replace(/\.(?=\d{3}\b)/g, '')

  const getal = Number(genormaliseerd)
  return Number.isFinite(getal) && getal > 0 ? getal : undefined
}

/** De zin waarin iets staat, om onder het voorstel te tonen. */
function zinRond(tekst: string, index: number): string {
  const van = Math.max(0, tekst.lastIndexOf('.', index - 1) + 1)
  const tot = tekst.indexOf('.', index)
  return tekst
    .slice(van, tot === -1 ? Math.min(tekst.length, index + 120) : tot + 1)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 220)
}

interface Patroon {
  test: RegExp
  zekerheid: Zekerheid
}

/** Probeert de patronen op volgorde; het eerste dat raak is telt. */
function zoek(tekst: string, patronen: Patroon[]): { match: RegExpMatchArray; zekerheid: Zekerheid } | null {
  for (const p of patronen) {
    const m = tekst.match(p.test)
    if (m && m.index !== undefined) return { match: m, zekerheid: p.zekerheid }
  }
  return null
}

/**
 * Vist de gegevens uit de tekst van een contract.
 *
 * De patronen staan van specifiek naar algemeen. "Bruto maandsalaris van
 * € 2.850" is hoge zekerheid; een los bedrag achter het woord "salaris" is
 * dat niet, en dat staat er dan ook bij.
 */
export function vindGegevens(tekst: string): Omit<ContractGegevens, 'tekst' | 'bladzijden'> {
  const t = tekst.replace(/\s+/g, ' ')
  const laag = t.toLowerCase()
  const uit: Omit<ContractGegevens, 'tekst' | 'bladzijden'> = {}

  const maak = <T>(waarde: T, zekerheid: Zekerheid, index: number): Vondst<T> => ({
    waarde, zekerheid, bron: zinRond(t, index),
  })

  /* ---------------------------- salaris ---------------------------- */

  const maand = zoek(laag, [
    { test: /bruto\s*(?:maand)?salaris[^€\d]{0,40}€?\s*([\d.,]+)\s*(?:bruto\s*)?per\s*maand/i, zekerheid: 'hoog' },
    { test: /(?:bruto\s*)?maandsalaris[^€\d]{0,40}€?\s*([\d.,]+)/i, zekerheid: 'hoog' },
    { test: /€\s*([\d.,]+)\s*bruto\s*per\s*maand/i, zekerheid: 'hoog' },
    { test: /salaris[^€\d]{0,40}€\s*([\d.,]+)\s*per\s*maand/i, zekerheid: 'middel' },
  ])
  if (maand) {
    const bedrag = leesBedrag(maand.match[1])
    // Een maandloon onder het minimum of boven de dertigduizend is geen
    // maandloon maar iets anders dat toevallig op die plek stond.
    if (bedrag && bedrag >= 400 && bedrag <= 30_000) {
      uit.maandloon = maak(bedrag, maand.zekerheid, maand.match.index!)
    }
  }

  const uur = zoek(laag, [
    { test: /(?:bruto\s*)?uurloon[^€\d]{0,40}€?\s*([\d.,]+)/i, zekerheid: 'hoog' },
    { test: /€\s*([\d.,]+)\s*(?:bruto\s*)?per\s*uur/i, zekerheid: 'hoog' },
    { test: /uurtarief[^€\d]{0,40}€?\s*([\d.,]+)/i, zekerheid: 'middel' },
  ])
  if (uur) {
    const bedrag = leesBedrag(uur.match[1])
    if (bedrag && bedrag >= 5 && bedrag <= 200) {
      uit.uurloon = maak(bedrag, uur.zekerheid, uur.match.index!)
    }
  }

  /* ----------------------------- uren ------------------------------ */

  const uren = zoek(laag, [
    { test: /(?:arbeidsduur|werkweek)[^\d]{0,40}([\d.,]+)\s*uur/i, zekerheid: 'hoog' },
    { test: /([\d.,]+)\s*uur\s*per\s*week/i, zekerheid: 'hoog' },
    { test: /gemiddeld\s*([\d.,]+)\s*uur/i, zekerheid: 'middel' },
  ])
  if (uren) {
    const aantal = leesBedrag(uren.match[1])
    if (aantal && aantal > 0 && aantal <= 60) {
      uit.urenPerWeek = maak(aantal, uren.zekerheid, uren.match.index!)
    }
  }

  /* ---------------------------- datums ----------------------------- */

  const DATUM = '(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}\\s+[a-z]+\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})'

  const start = zoek(laag, [
    { test: new RegExp(`(?:in\\s*dienst\\s*(?:treden\\s*)?(?:per|op|vanaf)|ingangsdatum|aanvang(?:sdatum)?)[^\\d]{0,30}${DATUM}`, 'i'), zekerheid: 'hoog' },
    { test: new RegExp(`(?:met\\s*ingang\\s*van)[^\\d]{0,30}${DATUM}`, 'i'), zekerheid: 'hoog' },
  ])
  if (start) {
    const datum = leesDatum(start.match[1])
    if (datum) uit.startDatum = maak(datum, start.zekerheid, start.match.index!)
  }

  const eind = zoek(laag, [
    { test: new RegExp(`(?:eindigt\\s*(?:van\\s*rechtswege\\s*)?(?:op|per)|einddatum|tot\\s*en\\s*met)[^\\d]{0,30}${DATUM}`, 'i'), zekerheid: 'hoog' },
    { test: new RegExp(`bepaalde\\s*tijd[^\\d]{0,60}${DATUM}`, 'i'), zekerheid: 'middel' },
  ])
  if (eind) {
    const datum = leesDatum(eind.match[1])
    if (datum) uit.eindDatum = maak(datum, eind.zekerheid, eind.match.index!)
  }

  const onbepaald = laag.match(/onbepaalde\s*tijd/i)
  if (onbepaald && onbepaald.index !== undefined && !uit.eindDatum) {
    uit.onbepaaldeTijd = maak(true, 'hoog', onbepaald.index)
  }

  /* ---------------------------- functie ---------------------------- */

  const functie = zoek(t, [
    { test: /(?:in\s*de\s*functie\s*van|functie:?)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-/]{2,40}?)(?=[.,;\n]|\s{2}|$)/i, zekerheid: 'hoog' },
    { test: /(?:aangesteld\s*als|werkzaam\s*als)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-/]{2,40}?)(?=[.,;\n]|\s{2}|$)/i, zekerheid: 'middel' },
  ])
  if (functie) {
    const naam = functie.match[1].trim().replace(/\s+/g, ' ')
    if (naam.length >= 3) {
      uit.functie = maak(
        naam.charAt(0).toUpperCase() + naam.slice(1),
        functie.zekerheid,
        functie.match.index!,
      )
    }
  }

  return uit
}

/** Alles in één keer: tekst ophalen en uitlezen. */
export async function leesContract(bestand: Blob): Promise<ContractGegevens> {
  const { tekst, bladzijden } = await leesPdfTekst(bestand)
  return { ...vindGegevens(tekst), tekst, bladzijden }
}

/** Hoeveel er is gevonden, voor een korte samenvatting. */
export function aantalGevonden(g: Omit<ContractGegevens, 'tekst' | 'bladzijden'>): number {
  return [g.functie, g.maandloon, g.uurloon, g.urenPerWeek,
          g.startDatum, g.eindDatum, g.onbepaaldeTijd]
    .filter(Boolean).length
}

/** Uit een maandloon een uurtarief afleiden, als dat laatste ontbreekt. */
export function afgeleidUurloon(maandloon: number, urenPerWeek: number): number {
  // 52 weken gedeeld door 12 maanden geeft de gemiddelde maand in weken.
  const urenPerMaand = (urenPerWeek * 52) / 12
  return Math.round((maandloon / urenPerMaand) * 100) / 100
}
