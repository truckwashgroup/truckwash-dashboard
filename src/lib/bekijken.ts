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
  /** Reden waarom dit bestand niet open mag; is die er, dan tonen we niets. */
  geblokkeerd?: string
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
export function soortVan(naam: string, mime?: string): BestandSoort {
  const ext = extensieVan(naam)
  const m = (mime ?? '').toLowerCase()

  if (BEELD.includes(ext)) {
    return !m || m.startsWith('image/') ? 'beeld' : 'onbekend'
  }
  if (ext === 'pdf') {
    return !m || m.includes('pdf') ? 'pdf' : 'onbekend'
  }
  if (TEKST.includes(ext)) {
    return !m || m.startsWith('text/') || m.includes('json') || m.includes('xml')
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
