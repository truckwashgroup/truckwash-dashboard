import { bsnGeldig, ibanGeldig, leesMrz, type MrzResultaat } from './identiteit'

/* ------------------------------------------------------------------ *
 *  Een identiteitsbewijs en een bankpas uitlezen
 *
 *  Op het toestel zelf. Er gaat geen foto van een paspoort naar een externe
 *  partij -- niet naar ons, niet naar een leverancier. Dat is de reden dat
 *  hier een leesmotor in de app zit in plaats van een aanroep naar een
 *  dienst die het beter zou kunnen.
 *
 *  Wat er uitkomt is een vóórstel, geen waarheid. Alles wat gevonden wordt
 *  gaat langs een controle die er los van staat -- het BSN door de elfproef,
 *  het IBAN door de mod-97, de MRZ door zijn eigen controlecijfers -- en
 *  daarna kijkt er nog een mens naar. Een verkeerd overgenomen BSN is erger
 *  dan een leeg veld: dat laatste valt op, het eerste niet.
 *
 *  De motor wordt pas opgehaald als er werkelijk iets gescand wordt. Hij is
 *  groot, en wie nooit een pasje inleest hoeft hem niet te downloaden.
 * ------------------------------------------------------------------ */

export interface ScanVoortgang {
  stap: string
  deel: number
}

/** Wat er uit een identiteitsbewijs is te halen. */
export interface IdScan {
  mrz?: MrzResultaat
  /** Alleen als hij door de elfproef komt. */
  bsn?: string
  /** De ruwe tekst, zodat iemand kan nakijken wat er is gelezen. */
  tekst: string
  /** Wat er niet gevonden is, in gewone woorden. */
  gemist: string[]
}

export interface PasScan {
  iban?: string
  naam?: string
  tekst: string
  gemist: string[]
}

/* ------------------------------------------------------------------ *
 *  De motor
 * ------------------------------------------------------------------ */

type Tesseract = typeof import('tesseract.js')
let motor: Tesseract | null = null

/**
 * Waar de zware delen vandaan komen.
 *
 * De motor zelf is klein; het rekenwerk (een wasm-bestand) en de taalkennis
 * zijn samen tientallen megabytes. Die zitten niet in de app -- dan zou
 * iedereen ze downloaden, ook wie nooit een pasje inleest.
 *
 * Vastgezet op één versie en één adres, met opzet. De standaard van
 * tesseract.js wijst naar "de nieuwste", en dan verandert er op een dag iets
 * onder je handen zonder dat er hier iets is gewijzigd.
 */
const VERSIE = '7.0.0'
const KERN = '7.0.0'
const BRON = {
  workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${VERSIE}/dist/worker.min.js`,
  corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${KERN}`,
  langPath: 'https://tessdata.projectnaptha.com/4.0.0',
}

export class MotorNietBereikbaar extends Error {
  constructor() {
    super(
      'De leesmotor kon niet worden opgehaald. Dat gebeurt één keer per ' +
      'apparaat en daar is verbinding voor nodig. Typ zolang de twee regels ' +
      'onderaan het document over — dat werkt net zo goed.',
    )
  }
}

async function laadMotor(): Promise<Tesseract> {
  if (motor) return motor
  try {
    motor = await import('tesseract.js')
  } catch {
    throw new MotorNietBereikbaar()
  }
  return motor
}

/**
 * Het plaatje klaarmaken om te lezen.
 *
 * Drie dingen, en ze schelen samen meer dan welke instelling van de motor
 * ook: niet groter dan nodig (anders duurt het minuten op een tablet), grijs
 * in plaats van kleur, en het contrast opgerekt. Een foto van een pasje op
 * een keukentafel is vrijwel altijd te grijs om zo te lezen.
 */
async function klaarmaken(bestand: File | Blob, maxBreedte = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(bestand)
  const schaal = Math.min(1, maxBreedte / bitmap.width)
  const breedte = Math.round(bitmap.width * schaal)
  const hoogte = Math.round(bitmap.height * schaal)

  const doek = document.createElement('canvas')
  doek.width = breedte
  doek.height = hoogte
  const ctx = doek.getContext('2d')
  if (!ctx) return bestand

  ctx.drawImage(bitmap, 0, 0, breedte, hoogte)
  bitmap.close?.()

  const beeld = ctx.getImageData(0, 0, breedte, hoogte)
  const d = beeld.data

  // Eerst grijs, en meteen het lichtste en donkerste punt onthouden.
  let min = 255
  let max = 0
  for (let i = 0; i < d.length; i += 4) {
    const grijs = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    d[i] = d[i + 1] = d[i + 2] = grijs
    if (grijs < min) min = grijs
    if (grijs > max) max = grijs
  }

  // Contrast oprekken tussen die twee punten.
  const spanne = Math.max(1, max - min)
  for (let i = 0; i < d.length; i += 4) {
    const uit = ((d[i] - min) / spanne) * 255
    d[i] = d[i + 1] = d[i + 2] = uit < 0 ? 0 : uit > 255 ? 255 : uit
  }

  ctx.putImageData(beeld, 0, 0)

  return new Promise<Blob>((klaar) => {
    doek.toBlob((b) => klaar(b ?? (bestand as Blob)), 'image/png')
  })
}

/** De motor loslaten op een plaatje, met een beperkt alfabet. */
async function lees(
  bestand: File | Blob,
  tekens: string | undefined,
  onVoortgang?: (v: ScanVoortgang) => void,
): Promise<string> {
  const lib = await laadMotor()
  const klaar = await klaarmaken(bestand)

  let worker: Awaited<ReturnType<typeof lib.createWorker>>
  try {
    worker = await lib.createWorker('eng', 1, {
      ...BRON,
      logger: (m: { status: string; progress: number }) => {
        onVoortgang?.({
          stap: m.status === 'recognizing text' ? 'Tekst lezen' : 'Motor klaarzetten',
          deel: m.progress,
        })
      },
    })
  } catch {
    throw new MotorNietBereikbaar()
  }

  try {
    if (tekens) {
      await worker.setParameters({ tessedit_char_whitelist: tekens })
    }
    const { data } = await worker.recognize(klaar)
    return data.text ?? ''
  } finally {
    await worker.terminate()
  }
}

/* ------------------------------------------------------------------ *
 *  Identiteitsbewijs
 * ------------------------------------------------------------------ */

const MRZ_TEKENS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'

/**
 * De regels onderaan een paspoort of ID-kaart eruit vissen.
 *
 * Die zijn te herkennen aan hun vorm: lang, alleen hoofdletters, cijfers en
 * punthaken. Dat is genoeg om ze uit een pagina vol tekst te halen zonder te
 * hoeven weten waar ze staan.
 */
export function vindMrzRegels(tekst: string): string {
  const regels = tekst
    .toUpperCase()
    .split('\n')
    .map((r) => r.replace(/[^A-Z0-9<]/g, ''))
    .filter((r) => r.length >= 28 && r.includes('<'))

  if (regels.length < 2) return ''

  // Een paspoort heeft twee regels van 44, een ID-kaart drie van 30.
  const drie = regels.filter((r) => r.length >= 28 && r.length <= 32)
  if (drie.length >= 3) return drie.slice(-3).join('\n')

  const twee = regels.filter((r) => r.length >= 40)
  if (twee.length >= 2) return twee.slice(-2).join('\n')

  return regels.slice(-2).join('\n')
}

/**
 * Een burgerservicenummer in gewone tekst zoeken.
 *
 * Het staat niet in de MRZ; op een Nederlandse ID-kaart staat het er in
 * leesbare cijfers naast. We nemen alleen een reeks van negen die door de
 * elfproef komt -- een documentnummer of een datum valt daarmee af.
 */
export function vindBsn(tekst: string): string | undefined {
  const kandidaten = tekst.match(/\d[\d .]{7,12}\d/g) ?? []
  for (const ruw of kandidaten) {
    const cijfers = ruw.replace(/\D/g, '')
    if (cijfers.length === 9 && bsnGeldig(cijfers)) return cijfers
  }
  return undefined
}

export async function scanIdentiteitsbewijs(
  bestand: File,
  onVoortgang?: (v: ScanVoortgang) => void,
): Promise<IdScan> {
  const gemist: string[] = []

  /*
   * Twee keer lezen. Eén keer met alleen de MRZ-tekens -- dat maakt die
   * regels veel betrouwbaarder -- en één keer gewoon, voor het BSN dat er in
   * leesbare cijfers naast staat.
   */
  const mrzTekst = await lees(bestand, MRZ_TEKENS, onVoortgang)
  const regels = vindMrzRegels(mrzTekst)
  const mrz = regels ? leesMrz(regels) ?? undefined : undefined
  if (!mrz) gemist.push('de twee regels onderaan het document')

  const vrijeTekst = await lees(bestand, undefined, onVoortgang)
  const bsn = vindBsn(vrijeTekst)
  if (!bsn) gemist.push('het burgerservicenummer')

  return { mrz, bsn, tekst: `${mrzTekst}\n${vrijeTekst}`.trim(), gemist }
}

/* ------------------------------------------------------------------ *
 *  Bankpas
 * ------------------------------------------------------------------ */

const IBAN_TEKENS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '

/**
 * Een IBAN uit de tekst halen.
 *
 * Alleen als hij door de mod-97 komt. Een pasnummer of een vervaldatum ziet
 * er soms uit als het begin van een rekeningnummer; die controle houdt dat
 * tegen.
 */
export function vindIban(tekst: string): string | undefined {
  const plat = tekst.toUpperCase().replace(/[^A-Z0-9]/g, '')

  // Nederlandse IBANs zijn 18 tekens; we kijken breder voor buitenlandse.
  for (const lengte of [18, 16, 20, 22, 24]) {
    for (let i = 0; i + lengte <= plat.length; i++) {
      const stuk = plat.slice(i, i + lengte)
      if (!/^[A-Z]{2}\d{2}/.test(stuk)) continue
      if (ibanGeldig(stuk)) return stuk
    }
  }
  return undefined
}

/**
 * De naam op de pas.
 *
 * Staat in hoofdletters, meestal onderaan, en zonder cijfers. Het is een
 * vermoeden en niet meer dan dat -- de naam op een pas is vaak afgekort, en
 * daarom vullen we hem alleen in als er nog niets staat.
 */
export function vindNaamOpPas(tekst: string): string | undefined {
  const kandidaten = tekst
    .split('\n')
    .map((r) => r.trim())
    .filter((r) =>
      r.length >= 5 && r.length <= 40 &&
      /^[A-Z][A-Z .'-]+$/.test(r) &&
      r.includes(' ') &&
      !/(BANK|PAS|VALID|THRU|DEBIT|CREDIT|MAESTRO|VISA|MASTERCARD)/.test(r))

  return kandidaten.sort((a, b) => b.length - a.length)[0]
}

export async function scanBankpas(
  bestand: File,
  onVoortgang?: (v: ScanVoortgang) => void,
): Promise<PasScan> {
  const gemist: string[] = []
  const tekst = await lees(bestand, IBAN_TEKENS, onVoortgang)

  const iban = vindIban(tekst)
  if (!iban) gemist.push('het rekeningnummer')

  const naam = vindNaamOpPas(tekst)

  return { iban, naam, tekst, gemist }
}

/* ------------------------------------------------------------------ *
 *  Wat er uit een scan bruikbaar is
 * ------------------------------------------------------------------ */

export interface Voorstel {
  veld: string
  label: string
  waarde: string
  /** Wat het is nagelopen: een controlecijfer, de elfproef, mod-97 */
  gecontroleerd?: string
}

/** De gevonden gegevens als lijstje, om te laten zien wat er wordt ingevuld. */
export function voorstellenUitId(scan: IdScan): Voorstel[] {
  const uit: Voorstel[] = []
  const m = scan.mrz
  if (m) {
    if (m.volledigeNaam) {
      uit.push({ veld: 'naam', label: 'Naam', waarde: m.volledigeNaam })
    }
    if (m.geboortedatum) {
      uit.push({
        veld: 'geboortedatum',
        label: 'Geboortedatum',
        waarde: new Date(m.geboortedatum).toLocaleDateString('nl-NL'),
        gecontroleerd: 'controlecijfer klopt',
      })
    }
    if (m.documentNumber) {
      uit.push({
        veld: 'documentNumber',
        label: 'Documentnummer',
        waarde: m.documentNumber,
        gecontroleerd: 'controlecijfer klopt',
      })
    }
    if (m.vervaldatum) {
      uit.push({
        veld: 'documentExpires',
        label: 'Geldig tot',
        waarde: new Date(m.vervaldatum).toLocaleDateString('nl-NL'),
        gecontroleerd: 'controlecijfer klopt',
      })
    }
    if (m.nationaliteit) {
      uit.push({ veld: 'nationality', label: 'Nationaliteit', waarde: m.nationaliteit })
    }
  }
  if (scan.bsn) {
    uit.push({
      veld: 'bsn',
      label: 'Burgerservicenummer',
      waarde: scan.bsn,
      gecontroleerd: 'elfproef klopt',
    })
  }
  return uit
}

export function voorstellenUitPas(scan: PasScan): Voorstel[] {
  const uit: Voorstel[] = []
  if (scan.iban) {
    uit.push({
      veld: 'iban',
      label: 'Rekeningnummer',
      waarde: scan.iban,
      gecontroleerd: 'mod-97 klopt',
    })
  }
  if (scan.naam) {
    uit.push({ veld: 'naam', label: 'Naam op de pas', waarde: scan.naam })
  }
  return uit
}
