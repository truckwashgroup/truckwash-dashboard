/* ------------------------------------------------------------------ *
 *  Controles op identiteits- en betaalgegevens
 *
 *  Waarom dit een eigen bestand is: een verkeerd overgetypt BSN gaat mee
 *  de loonaangifte in en komt er maanden later als probleem weer uit. Een
 *  verkeerd IBAN betekent dat er loon naar de verkeerde rekening gaat.
 *
 *  Alle drie de nummers hieronder dragen hun eigen controle in zich. Die
 *  kost niets om uit te voeren en vangt vrijwel elke typefout. Niet
 *  gebruiken zou zonde zijn.
 * ------------------------------------------------------------------ */

/* ================================================================== *
 *  Burgerservicenummer
 * ================================================================== */

/**
 * De elfproef.
 *
 * Vermenigvuldig de negen cijfers met 9, 8, 7, 6, 5, 4, 3, 2 en -1, tel op,
 * en de som moet deelbaar zijn door elf. Dat laatste cijfer telt negatief
 * mee; dat is het verschil met het oude sofinummer en precies waarom een
 * omgedraaid laatste cijfer eruit springt.
 */
export function bsnGeldig(waarde: string): boolean {
  const cijfers = waarde.replace(/\D/g, '')
  if (cijfers.length !== 9) return false
  // Negen nullen komt door de rekensom heen maar bestaat niet.
  if (/^0{9}$/.test(cijfers)) return false

  let som = 0
  for (let i = 0; i < 9; i++) {
    const gewicht = i === 8 ? -1 : 9 - i
    som += Number(cijfers[i]) * gewicht
  }
  return som % 11 === 0
}

/** Wat er mis is, of null als het klopt. Voor onder een invoerveld. */
export function bsnProbleem(waarde: string): string | null {
  const schoon = waarde.replace(/\D/g, '')
  if (!schoon) return null
  if (schoon.length < 9) return `Nog ${9 - schoon.length} cijfer(s) te gaan.`
  if (schoon.length > 9) return 'Een BSN heeft negen cijfers.'
  if (!bsnGeldig(schoon)) {
    return 'Dit nummer komt niet door de elfproef. Waarschijnlijk een typefout.'
  }
  return null
}

/** Negen cijfers, netjes gegroepeerd: 123 456 782. */
export function bsnFormatteer(waarde: string): string {
  const c = waarde.replace(/\D/g, '').slice(0, 9)
  return c.replace(/(\d{3})(\d{3})(\d{0,3})/, (_, a, b, d) => [a, b, d].filter(Boolean).join(' '))
}

/**
 * Zo tonen we een BSN in het scherm: alleen de laatste drie cijfers.
 *
 * Iemand die het dossier openheeft om iets anders te doen hoeft het niet
 * te zien, en een meelezer over de schouder al helemaal niet.
 */
export function bsnGemaskeerd(waarde?: string): string {
  const c = (waarde ?? '').replace(/\D/g, '')
  if (c.length !== 9) return '—'
  return '••• ••• ' + c.slice(6)
}

/* ================================================================== *
 *  IBAN
 * ================================================================== */

const IBAN_LENGTE: Record<string, number> = {
  NL: 18, BE: 16, DE: 22, FR: 27, GB: 22, ES: 24, IT: 27,
  PL: 28, PT: 25, LU: 20, AT: 20, CH: 21, DK: 18, SE: 24,
}

/**
 * De mod-97-toets.
 *
 * Zet de eerste vier tekens achteraan, vervang letters door getallen
 * (A=10 ... Z=35) en deel door 97: de rest moet 1 zijn. Omdat het getal
 * veel te groot is voor JavaScript rekenen we het in stukjes uit.
 */
export function ibanGeldig(waarde: string): boolean {
  const schoon = waarde.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(schoon)) return false

  const land = schoon.slice(0, 2)
  const verwacht = IBAN_LENGTE[land]
  if (verwacht && schoon.length !== verwacht) return false

  const omgedraaid = schoon.slice(4) + schoon.slice(0, 4)
  const cijferreeks = omgedraaid.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))

  let rest = 0
  for (const cijfer of cijferreeks) {
    rest = (rest * 10 + Number(cijfer)) % 97
  }
  return rest === 1
}

export function ibanProbleem(waarde: string): string | null {
  const schoon = waarde.replace(/\s+/g, '').toUpperCase()
  if (!schoon) return null
  if (schoon.length < 8) return 'Nog niet compleet.'
  if (!/^[A-Z]{2}/.test(schoon)) return 'Een IBAN begint met een landcode, bijvoorbeeld NL.'

  const verwacht = IBAN_LENGTE[schoon.slice(0, 2)]
  if (verwacht && schoon.length !== verwacht) {
    return `Een ${schoon.slice(0, 2)}-rekeningnummer heeft ${verwacht} tekens; dit zijn er ${schoon.length}.`
  }
  if (!ibanGeldig(schoon)) {
    return 'Dit rekeningnummer komt niet door de controle. Kijk het na.'
  }
  return null
}

/** In blokjes van vier, zoals het op een bankpas staat. */
export function ibanFormatteer(waarde: string): string {
  return waarde.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()
}

/* ================================================================== *
 *  De machineleesbare strook van een identiteitsbewijs
 *
 *  Onderaan elk paspoort en elke ID-kaart staan twee of drie regels in een
 *  vast formaat, met controlecijfers erin verwerkt. Daar staat de naam in,
 *  de geboortedatum, het documentnummer en de vervaldatum.
 *
 *  Wat er NIET in staat is het burgerservicenummer. Dat staat er los op
 *  gedrukt en moet dus altijd met de hand ingevuld worden -- vandaar de
 *  elfproef hierboven.
 * ================================================================== */

export type MrzSoort = 'paspoort' | 'id-kaart'

export interface MrzResultaat {
  soort: MrzSoort
  documentNumber: string
  achternaam: string
  voornamen: string
  volledigeNaam: string
  geboortedatum?: number
  geslacht?: 'M' | 'V' | 'X'
  nationaliteit: string
  vervaldatum?: number
  /** Kloppen alle controlecijfers? */
  betrouwbaar: boolean
  /** Welke velden niet door hun controle kwamen */
  twijfel: string[]
}

const MRZ_WAARDE: Record<string, number> = {}
for (let i = 0; i < 10; i++) MRZ_WAARDE[String(i)] = i
for (let i = 0; i < 26; i++) MRZ_WAARDE[String.fromCharCode(65 + i)] = 10 + i
MRZ_WAARDE['<'] = 0

/** Het controlecijfer over een stuk tekst: gewichten 7, 3, 1, herhaald. */
function controlecijfer(tekst: string): number {
  const gewichten = [7, 3, 1]
  let som = 0
  for (let i = 0; i < tekst.length; i++) {
    som += (MRZ_WAARDE[tekst[i]] ?? 0) * gewichten[i % 3]
  }
  return som % 10
}

/** JJMMDD uit de strook naar een echte datum. */
function mrzDatum(jjmmdd: string, toekomst: boolean): number | undefined {
  if (!/^\d{6}$/.test(jjmmdd)) return undefined
  const jj = Number(jjmmdd.slice(0, 2))
  const mm = Number(jjmmdd.slice(2, 4))
  const dd = Number(jjmmdd.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined

  /*
   * Twee cijfers voor het jaar is altijd gokken. Voor een vervaldatum is
   * het antwoord simpel: die ligt in de toekomst. Voor een geboortedatum
   * gaan we ervan uit dat niemand nog niet geboren is.
   */
  const nu = new Date()
  const eeuw = Math.floor(nu.getFullYear() / 100) * 100
  let jaar = eeuw + jj
  if (toekomst && jaar < nu.getFullYear() - 1) jaar += 100
  if (!toekomst && jaar > nu.getFullYear()) jaar -= 100

  const d = new Date(jaar, mm - 1, dd)
  return Number.isNaN(d.getTime()) ? undefined : d.getTime()
}

/** Streepjes eruit, en de naamscheiding netjes maken. */
function naamDeel(ruw: string): { achternaam: string; voornamen: string } {
  const [achter = '', voor = ''] = ruw.split('<<')
  const net = (t: string) =>
    t.replace(/</g, ' ').replace(/\s+/g, ' ').trim()
      .toLowerCase()
      .replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
  return { achternaam: net(achter), voornamen: net(voor) }
}

/**
 * Leest de machineleesbare strook.
 *
 * Slikt zowel het paspoortformaat (2 regels van 44) als de ID-kaart
 * (3 regels van 30). Spaties en regeleindes mogen erin staan; de meeste
 * mensen typen ze over met een spatie ertussen.
 */
export function leesMrz(ruw: string): MrzResultaat | null {
  const regels = ruw
    .toUpperCase()
    .replace(/[^A-Z0-9<\n]/g, '')
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)

  if (regels.length === 2 && regels.every((r) => r.length >= 40)) {
    return leesTd3(regels)
  }
  if (regels.length === 3 && regels.every((r) => r.length >= 28)) {
    return leesTd1(regels)
  }

  // Alles aan elkaar geplakt: alsnog proberen te knippen.
  const alles = regels.join('')
  if (alles.length >= 88) return leesTd3([alles.slice(0, 44), alles.slice(44, 88)])
  if (alles.length >= 90) return leesTd1([alles.slice(0, 30), alles.slice(30, 60), alles.slice(60, 90)])

  return null
}

/** Paspoort: twee regels van 44. */
function leesTd3(regels: string[]): MrzResultaat {
  const [r1, r2] = regels.map((r) => r.padEnd(44, '<'))
  const twijfel: string[] = []

  const documentNumber = r2.slice(0, 9).replace(/</g, '')
  if (controlecijfer(r2.slice(0, 9)) !== Number(r2[9])) twijfel.push('documentnummer')

  const geboorte = r2.slice(13, 19)
  if (controlecijfer(geboorte) !== Number(r2[19])) twijfel.push('geboortedatum')

  const verval = r2.slice(21, 27)
  if (controlecijfer(verval) !== Number(r2[27])) twijfel.push('vervaldatum')

  const { achternaam, voornamen } = naamDeel(r1.slice(5))

  return {
    soort: 'paspoort',
    documentNumber,
    achternaam,
    voornamen,
    volledigeNaam: [voornamen, achternaam].filter(Boolean).join(' '),
    geboortedatum: mrzDatum(geboorte, false),
    geslacht: geslachtUit(r2[20]),
    nationaliteit: r2.slice(10, 13).replace(/</g, ''),
    vervaldatum: mrzDatum(verval, true),
    betrouwbaar: twijfel.length === 0,
    twijfel,
  }
}

/** ID-kaart: drie regels van 30. */
function leesTd1(regels: string[]): MrzResultaat {
  const [r1, r2, r3] = regels.map((r) => r.padEnd(30, '<'))
  const twijfel: string[] = []

  const documentNumber = r1.slice(5, 14).replace(/</g, '')
  if (controlecijfer(r1.slice(5, 14)) !== Number(r1[14])) twijfel.push('documentnummer')

  const geboorte = r2.slice(0, 6)
  if (controlecijfer(geboorte) !== Number(r2[6])) twijfel.push('geboortedatum')

  const verval = r2.slice(8, 14)
  if (controlecijfer(verval) !== Number(r2[14])) twijfel.push('vervaldatum')

  const { achternaam, voornamen } = naamDeel(r3)

  return {
    soort: 'id-kaart',
    documentNumber,
    achternaam,
    voornamen,
    volledigeNaam: [voornamen, achternaam].filter(Boolean).join(' '),
    geboortedatum: mrzDatum(geboorte, false),
    geslacht: geslachtUit(r2[7]),
    nationaliteit: r2.slice(15, 18).replace(/</g, ''),
    vervaldatum: mrzDatum(verval, true),
    betrouwbaar: twijfel.length === 0,
    twijfel,
  }
}

function geslachtUit(teken: string): 'M' | 'V' | 'X' | undefined {
  if (teken === 'M') return 'M'
  if (teken === 'F') return 'V'
  if (teken === '<' || teken === 'X') return 'X'
  return undefined
}

/* ================================================================== *
 *  Vingerafdruk van een bestand
 *
 *  Bij een ondertekend contract wil je later kunnen aantonen dat het
 *  bestand niet meer is veranderd. Een SHA-256 is daarvoor genoeg: verander
 *  één komma en er komt een compleet ander getal uit.
 * ================================================================== */

export async function bestandsVingerafdruk(bestand: Blob): Promise<string> {
  const buffer = await bestand.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Kort en leesbaar, om naast een handtekening te zetten. */
export function kortHash(hash?: string): string {
  if (!hash) return '—'
  return hash.slice(0, 8) + '…' + hash.slice(-8)
}
