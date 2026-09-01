/* ------------------------------------------------------------------ *
 *  Een bestand bekijken
 *
 *  Tot nu toe deed de app hetzelfde als een browser: een adres opvragen en
 *  dat in een nieuw venster gooien. Dat werkt op een gewone computer met
 *  wat geluk, en verder nergens. In de Electron-schil wordt zo'n venster
 *  tegengehouden, en in de app op de tablet gebeurt er helemaal niets. Je
 *  zag dan een knop die niets deed en een bijlage die je niet kon lezen.
 *
 *  Daarom halen we het bestand nu zelf op en tonen we het zelf. Dat is ook
 *  veiliger dan het aan het systeem overhandigen: een PDF wordt door pdf.js
 *  op een canvas getekend en niet door een lezer geopend die er van alles
 *  mee mag, en een plaatje is een plaatje.
 *
 *  Het adres blijft een minuut geldig. Zodra de bytes binnen zijn doet dat
 *  er niet meer toe -- wat je op het scherm hebt blijft staan, ook als de
 *  link allang is vervallen.
 * ------------------------------------------------------------------ */

export type BestandSoort = 'beeld' | 'pdf' | 'tekst' | 'onbekend'

export interface Bekijkbaar {
  /** Wat de gebruiker als naam ziet */
  naam: string
  /** Wat het bestand beweert te zijn. Van buiten, dus niet leidend. */
  mime?: string
  size?: number
  /** Haalt een adres op dat kort geldig is. */
  haal: () => Promise<string>
  /** Reden waarom dit bestand niet open gaat; is die er, dan tonen we niets. */
  geblokkeerd?: string
  /**
   * De kop erboven. Tegengehouden door de controle is iets anders dan
   * nooit aangekomen, en dat hoort er niet hetzelfde uit te zien.
   */
  geblokkeerdKop?: string
}

const BEELD = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif']
const TEKST = ['txt', 'csv', 'log', 'md', 'json', 'xml', 'eml', 'ics']

export function extensieVan(naam: string): string {
  const punt = naam.lastIndexOf('.')
  return punt < 0 ? '' : naam.slice(punt + 1).toLowerCase()
}

/**
 * Wat is dit voor bestand?
 *
 * De extensie is leidend, niet het opgegeven type. Dat type komt bij een
 * bijlage van buiten mee met de mail, en iets dat zichzelf een plaatje
 * noemt is daarmee nog geen plaatje. Andersom weegt een tegensprekend type
 * wel mee: heet het .png maar zegt de afzender application/zip, dan tonen
 * we het niet en bieden we het aan om op te slaan.
 */
/**
 * Types die niets beweren.
 *
 * Hier zat een fout die veel bijlagen onzichtbaar maakte. De regel was: een
 * type dat de extensie tegenspreekt wint, en dan tonen we niets. Dat is goed
 * bedoeld -- een .png die zichzelf een zip noemt is verdacht.
 *
 * Alleen is application/octet-stream geen tegenspraak. Het betekent "ik weet
 * het niet", en het is wat een heleboel mailprogramma's standaard meesturen
 * bij élke bijlage. Een doodgewone factuur.pdf kwam daardoor binnen als
 * onbekend bestand en werd nooit getoond -- alleen aangeboden om op te slaan.
 *
 * Deze types tellen dus als "geen mening": de extensie beslist.
 */
const GEEN_MENING = [
  'application/octet-stream',
  'binary/octet-stream',
  'application/download',
  'application/force-download',
  'application/unknown',
  'content/unknown',
]

function zegtNiets(mime: string): boolean {
  return !mime || GEEN_MENING.includes(mime)
}

export function soortVan(naam: string, mime?: string): BestandSoort {
  const ext = extensieVan(naam)
  const m = (mime ?? '').toLowerCase().split(';')[0].trim()

  if (BEELD.includes(ext)) {
    return zegtNiets(m) || m.startsWith('image/') ? 'beeld' : 'onbekend'
  }
  if (ext === 'pdf') {
    return zegtNiets(m) || m.includes('pdf') ? 'pdf' : 'onbekend'
  }
  if (TEKST.includes(ext)) {
    return zegtNiets(m) || m.startsWith('text/') || m.includes('json') || m.includes('xml')
      ? 'tekst'
      : 'onbekend'
  }

  // Geen bruikbare extensie? Dan mag het type het alsnog zeggen, maar
  // alleen voor de soorten die we veilig zelf tekenen.
  if (!ext) {
    if (m.startsWith('image/')) return 'beeld'
    if (m.includes('pdf')) return 'pdf'
    if (m.startsWith('text/')) return 'tekst'
  }
  return 'onbekend'
}

/**
 * Wat zit er werkelijk in dit bestand?
 *
 * Aanleiding: een inkoopfactuur van 3 kB die niet openging, met als enige
 * uitleg "deze PDF is niet te openen". Dat is geen uitleg maar een
 * doodlopende weg -- je weet niet of het aan de lezer ligt, aan het bestand,
 * of aan hoe het is opgeslagen.
 *
 * De eerste bytes verraden het meestal. Een PDF begint met %PDF, een
 * foutmelding van een server met { of <, en een afgekapte download met
 * niets herkenbaars. Dat kunnen we gewoon zéggen.
 */
export function watIsDit(bytes: Uint8Array, verwacht: BestandSoort): string | null {
  if (bytes.length === 0) {
    return 'Dit bestand is leeg — er is niets opgeslagen.'
  }

  const kop = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  const begin = kop.trimStart()

  if (verwacht === 'pdf') {
    // Een PDF begint met %PDF, eventueel na wat rommel van een mailserver.
    if (kop.includes('%PDF')) return null

    if (/^[[{]/.test(begin)) {
      return 'Hier staat geen PDF in maar een stukje JSON. Waarschijnlijk is bij '
           + 'het binnenhalen een foutmelding opgeslagen in plaats van de bijlage.'
    }
    if (/^<(!doctype|html|\?xml)/i.test(begin)) {
      return 'Hier staat geen PDF in maar een webpagina. Dat gebeurt als het '
           + 'ophalen van de bijlage misging en het antwoord toch is bewaard.'
    }
    if (begin.startsWith('PK')) {
      return 'Dit is een zip-bestand, geen PDF. Een .docx of .xlsx ziet er zo uit.'
    }
    return `Dit bestand begint niet met %PDF, dus het is geen PDF — wat er ook `
         + `boven staat. Het is ${grootteVan(bytes.length)}.`
  }

  return null
}

/** Leesbare grootte. */
export function grootteVan(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Meer dan dit halen we niet binnen om te tonen.
 *
 * Een bijlage van tachtig megabyte in het geheugen van een tablet zetten om
 * hem te laten zien is geen dienst. Boven de grens bieden we hem aan om op
 * te slaan.
 */
export const MAX_TONEN = 25 * 1024 * 1024

export class TeGroot extends Error {
  constructor(readonly bytes: number) {
    super(
      `Dit bestand is ${grootteVan(bytes)} en dat is te groot om hier te ` +
      'tonen. Opslaan kan wel.',
    )
  }
}

/** Haalt de bytes op achter een kort geldig adres. */
export async function haalBytes(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      res.status === 400 || res.status === 403
        ? 'Het adres van dit bestand is verlopen. Probeer het opnieuw.'
        : `Ophalen mislukte (${res.status}).`,
    )
  }
  return res.blob()
}

/** Haalt een tekstbestand op, met een dak erop zodat een log niet de app opeet. */
export async function haalTekst(blob: Blob, maxTekens = 200_000): Promise<string> {
  const tekst = await blob.text()
  return tekst.length > maxTekens
    ? tekst.slice(0, maxTekens) + '\n\n[…afgekapt, het bestand is langer]'
    : tekst
}
