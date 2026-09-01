/* ===========================================================================
 *  Controle op bijlagen
 *
 *  Eerst eerlijk zijn over wat dit is en niet is.
 *
 *  Dit is GEEN virusscanner. Een serverfunctie kan geen ClamAV draaien: daar
 *  is geen plek voor binaries, geen geheugen voor de handtekeningendatabase
 *  en geen tijd binnen de looptijd. Wie beweert dat hij in een paar honderd
 *  regels een virusscanner heeft geschreven, verkoopt je een gerust gevoel
 *  in plaats van beveiliging.
 *
 *  Wat dit wél is: de controles die in de praktijk het meeste tegenhouden
 *  van wat er via e-mail binnenkomt.
 *
 *   1. Klopt het bestand met wat het beweert te zijn? Een .pdf die in
 *      werkelijkheid een uitvoerbaar bestand is, wordt geweigerd. Dit is de
 *      controle die de meeste rommel tegenhoudt, want bijna alles wat via
 *      mail binnenkomt vermomt zich.
 *
 *   2. Zit er actieve inhoud in? Een PDF met JavaScript, een automatische
 *      actie bij het openen, een ingesloten bestand of een launch-opdracht
 *      heeft in een factuur niets te zoeken. Dat zijn precies de wegen die
 *      in de praktijk gebruikt worden.
 *
 *   3. Is er een echte scanner aangesloten? Zet SCANNER_URL en de bijlage
 *      gaat daar eerst langs. Dat is de plek voor ClamAV of een betaalde
 *      dienst -- de enige plek waar handtekeningen thuishoren.
 *
 *  Wat er niet doorheen komt gaat niet de opslag in. Wat wel binnenkomt maar
 *  niet als schoon is aangemerkt, weigert de app te openen.
 * =========================================================================== */

export type Uitkomst = 'schoon' | 'verdacht' | 'mislukt'

export interface ControleResultaat {
  uitkomst: Uitkomst
  reden?: string
  scanner?: string
}

/* ------------------------------------------------------------------ *
 *  1. Klopt het bestand met zijn naam?
 * ------------------------------------------------------------------ */

/** De eerste bytes waaraan je een bestandssoort herkent. */
const HANDTEKENINGEN: { mime: string; magisch: number[]; offset?: number }[] = [
  { mime: 'application/pdf',  magisch: [0x25, 0x50, 0x44, 0x46] },              // %PDF
  { mime: 'image/jpeg',       magisch: [0xff, 0xd8, 0xff] },
  { mime: 'image/png',        magisch: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif',        magisch: [0x47, 0x49, 0x46, 0x38] },              // GIF8
  { mime: 'image/webp',       magisch: [0x57, 0x45, 0x42, 0x50], offset: 8 },   // WEBP
  { mime: 'image/heic',       magisch: [0x66, 0x74, 0x79, 0x70], offset: 4 },   // ftyp
]

/** Wat er nooit in mag, hoe het ook heet. */
const VERBODEN: { magisch: number[]; wat: string }[] = [
  { magisch: [0x4d, 0x5a], wat: 'een Windows-programma' },                       // MZ
  { magisch: [0x7f, 0x45, 0x4c, 0x46], wat: 'een Linux-programma' },             // ELF
  { magisch: [0xca, 0xfe, 0xba, 0xbe], wat: 'een macOS-programma' },
  { magisch: [0x50, 0x4b, 0x03, 0x04], wat: 'een archief (zip, docx, xlsx)' },
  { magisch: [0x52, 0x61, 0x72, 0x21], wat: 'een RAR-archief' },
  { magisch: [0x37, 0x7a, 0xbc, 0xaf], wat: 'een 7z-archief' },
  { magisch: [0x1f, 0x8b], wat: 'een gzip-archief' },
  { magisch: [0xd0, 0xcf, 0x11, 0xe0], wat: 'een oud Office-bestand met macro’s' },
]

function begintMet(bytes: Uint8Array, magisch: number[], offset = 0): boolean {
  if (bytes.length < offset + magisch.length) return false
  return magisch.every((b, i) => bytes[offset + i] === b)
}

/* ------------------------------------------------------------------ *
 *  2. Actieve inhoud in een PDF
 * ------------------------------------------------------------------ */

/**
 * Wat er in een factuur echt niet hoort te staan.
 *
 * Deze lijst was te lang, en dat had een gevolg dat erger was dan het kwaad
 * dat hij moest voorkomen: gewone facturen werden tegengehouden, en dan kon
 * niemand ze meer openen én ging de AI er niet overheen. Een controle die
 * alles tegenhoudt is geen controle, want dan zet je hem uit.
 *
 * Wat eruit is, en waarom:
 *
 *   /OpenAction   staat in bijna elke PDF uit Word, InDesign of LaTeX. Het
 *                 zet meestal alleen de beginweergave ("open op pagina 1,
 *                 passend"). Alleen gevaarlijk als hij naar JavaScript of
 *                 /Launch wijst, en dán vangen we die twee zelf al.
 *   /AA           idem: hangt aan formuliervelden van elke invulbare factuur.
 *   /EmbeddedFile een PDF met een ingesloten bestand is meestal een ZUGFeRD-
 *                 of Factur-X-factuur: de Europese e-factuur, met de gegevens
 *                 als XML erin. Dat is precies het soort factuur dat je wél
 *                 wil hebben.
 *   /RichMedia    ingesloten Flash of 3D. Zeldzaam en nutteloos in een
 *                 rekening, maar er is geen lezer meer die het uitvoert.
 *
 * Wat blijft: het uitvoeren van code, en het starten van een programma. Daar
 * is geen onschuldige lezing van.
 */
const PDF_ALARM: { patroon: string; wat: string }[] = [
  { patroon: '/JavaScript', wat: 'JavaScript' },
  { patroon: '/JS',         wat: 'JavaScript' },
  { patroon: '/Launch',     wat: 'een opdracht om een programma te starten' },
]

/**
 * Dingen die het vermelden waard zijn maar niets tegenhouden.
 *
 * Ze komen terug als opmerking bij een schone uitkomst, zodat je het ziet
 * staan zonder dat de bijlage op slot gaat.
 */
const PDF_OPMERKING: { patroon: string; wat: string }[] = [
  { patroon: '/EmbeddedFile', wat: 'een ingesloten bestand, waarschijnlijk een e-factuur' },
  { patroon: '/RichMedia',    wat: 'ingesloten media' },
]

function zoekNamen(
  tekst: string,
  lijst: { patroon: string; wat: string }[],
): string | null {
  for (const { patroon, wat } of lijst) {
    // Het moet een naam-object zijn, dus gevolgd door een scheidingsteken.
    const regex = new RegExp(patroon.replace('/', '\\/') + '[^A-Za-z]')
    if (regex.test(tekst)) return wat
  }
  return null
}

/**
 * Wat deze controle wel en niet is.
 *
 * Hij leest de ruwe bytes als tekst. De structuur van een PDF staat daar
 * meestal leesbaar in, maar de inhoud van objecten is vaak samengeperst --
 * dus echt verstopte code ziet hij níét. Dit is een zeef tegen het domme
 * geval, geen virusscanner. Wie dat laatste wil, hangt er een echte scanner
 * achter via SCANNER_URL.
 */
function pdfHeeftActieveInhoud(bytes: Uint8Array): string | null {
  return zoekNamen(new TextDecoder('latin1').decode(bytes), PDF_ALARM)
}

function pdfOpmerking(bytes: Uint8Array): string | null {
  return zoekNamen(new TextDecoder('latin1').decode(bytes), PDF_OPMERKING)
}

/* ------------------------------------------------------------------ *
 *  3. Een echte scanner, als die er is
 * ------------------------------------------------------------------ */

const SCANNER_URL = Deno.env.get('SCANNER_URL') ?? ''
const SCANNER_KEY = Deno.env.get('SCANNER_KEY') ?? ''
const SCANNER_NAAM = Deno.env.get('SCANNER_NAAM') ?? 'externe scanner'

/**
 * Legt de bijlage voor aan een scanner.
 *
 * Verwacht een antwoord met `{ clean: true }` of `{ infected: true }`; dat
 * is wat vrijwel elke dienst teruggeeft. Reageert hij niet, dan is de
 * uitkomst 'mislukt' -- en dat is nadrukkelijk niet hetzelfde als schoon.
 */
async function externeScan(bytes: Uint8Array, naam: string): Promise<ControleResultaat | null> {
  if (!SCANNER_URL) return null

  try {
    const form = new FormData()
    form.append('file', new Blob([bytes]), naam)

    const res = await fetch(SCANNER_URL, {
      method: 'POST',
      headers: SCANNER_KEY ? { Authorization: `Bearer ${SCANNER_KEY}` } : undefined,
      body: form,
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      return { uitkomst: 'mislukt', reden: `Scanner gaf ${res.status}`, scanner: SCANNER_NAAM }
    }

    const body = await res.json().catch(() => ({}))
    const besmet = body?.infected === true
      || body?.clean === false
      || /infected|malicious|found/i.test(String(body?.status ?? body?.result ?? ''))

    if (besmet) {
      return {
        uitkomst: 'verdacht',
        reden: String(body?.virus ?? body?.name ?? 'De scanner sloeg aan'),
        scanner: SCANNER_NAAM,
      }
    }
    return { uitkomst: 'schoon', scanner: SCANNER_NAAM }
  } catch (e) {
    return {
      uitkomst: 'mislukt',
      reden: `Scanner niet bereikbaar: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`,
      scanner: SCANNER_NAAM,
    }
  }
}

/* ------------------------------------------------------------------ *
 *  De controle zelf
 * ------------------------------------------------------------------ */

export async function controleerBijlage(
  bytes: Uint8Array,
  naam: string,
  gemeldMime: string,
): Promise<ControleResultaat> {
  if (bytes.byteLength === 0) {
    return { uitkomst: 'verdacht', reden: 'Het bestand is leeg' }
  }

  /* --- verboden soorten, ongeacht de naam --- */

  for (const { magisch, wat } of VERBODEN) {
    if (begintMet(bytes, magisch)) {
      return { uitkomst: 'verdacht', reden: `Dit is ${wat}, geen document` }
    }
  }

  /* --- klopt het met wat het beweert te zijn? --- */

  const verwacht = HANDTEKENINGEN.find((h) => h.mime === gemeldMime)
  if (verwacht && !begintMet(bytes, verwacht.magisch, verwacht.offset)) {
    return {
      uitkomst: 'verdacht',
      reden: `Het bestand heet ${gemeldMime} maar is dat niet`,
    }
  }
  if (!verwacht) {
    // Een soort die we niet kunnen nalopen laten we niet zomaar door.
    return { uitkomst: 'verdacht', reden: `Onbekend soort bestand: ${gemeldMime}` }
  }

  /* --- actieve inhoud in een PDF --- */

  let opmerking: string | undefined

  if (gemeldMime === 'application/pdf') {
    const gevonden = pdfHeeftActieveInhoud(bytes)
    if (gevonden) {
      return {
        uitkomst: 'verdacht',
        reden: `De PDF bevat ${gevonden}. Een factuur heeft dat niet nodig.`,
      }
    }
    opmerking = pdfOpmerking(bytes) ?? undefined
  }

  /* --- en tot slot de echte scanner, als die er is --- */

  const extern = await externeScan(bytes, naam)
  if (extern) return extern

  return opmerking
    ? { uitkomst: 'schoon', reden: `Bevat ${opmerking}.` }
    : { uitkomst: 'schoon' }
}
