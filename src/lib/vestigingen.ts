import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type {
  Location, LocationKind, LocationPhoto, Openingstijden, User, Venster, Weekdag,
} from './types'
import { WEEKDAGEN } from './types'

/* ------------------------------------------------------------------ *
 *  Vestigingen
 *
 *  De vestigingen stonden er wel, maar er was geen manier om er een bij te
 *  maken, er een te wijzigen of er een weg te halen. Dit is die manier.
 *
 *  Het lastigste stuk is niet het aanmaken maar het weghalen. Op een
 *  vestiging hangen installaties, storingen, werkbonnen, voorraad, roosters,
 *  urenregels, kassa's, een kluis en een overlegkanaal -- en een flink deel
 *  van die verwijzingen staat in de database op "cascade". Een vestiging
 *  wissen zou dat allemaal meenemen zonder een woord.
 *
 *  Daarom twee sloten. De database weigert het en zegt erbij wat eraan hangt;
 *  dit bestand telt hetzelfde lokaal, zodat het scherm het al kan vertellen
 *  voordat je de knop indrukt. Het scherm alleen zou te omzeilen zijn, de
 *  database alleen zou niets uitleggen.
 * ------------------------------------------------------------------ */

export const EMMER = 'vestigingen'

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
 *  De code
 *
 *  De code staat op werkbonnen, op kassabonnen en in exports. Twee
 *  vestigingen met dezelfde code betekent dat je achteraf niet meer weet
 *  waar iets vandaan kwam, en dat repareer je niet meer.
 * ================================================================== */

const AFKORTINGEN: Record<string, string> = {
  's-hertogenbosch': 'DEN',
  "'s-hertogenbosch": 'DEN',
  'den bosch': 'DEN',
  'den haag': 'HAA',
  "'s-gravenhage": 'HAA',
}

/** TW-UTR uit "Utrecht". Een voorstel, geen wet: je mag hem overtypen. */
export function voorstelCode(plaats: string, kind: LocationKind = 'vestiging'): string {
  const schoon = plaats.trim().toLowerCase()
  const kern = AFKORTINGEN[schoon]
    ?? schoon.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase()
  if (!kern) return ''
  return `${kind === 'hoofdkantoor' ? 'HK' : 'TW'}-${kern}`
}

/** Een vrije variant: TW-UTR, TW-UTR2, TW-UTR3... */
export function vrijeCode(basis: string, bezet: string[]): string {
  const genomen = new Set(bezet.map((c) => c.trim().toUpperCase()))
  if (!basis) return ''
  if (!genomen.has(basis)) return basis
  for (let n = 2; n < 100; n++) {
    if (!genomen.has(`${basis}${n}`)) return `${basis}${n}`
  }
  return ''
}

/**
 * Waarom deze code niet kan, of niets.
 *
 * Geeft een zin terug die je aan iemand kunt laten lezen, en niet een
 * foutmelding uit de database over een index die hij niet kent.
 */
export function codeProbleem(code: string, bestaand: Location[], eigenId?: string): string | null {
  const schoon = code.trim().toUpperCase()
  if (!schoon) return 'Een vestiging heeft een code nodig; die staat op elke werkbon.'
  if (schoon.length < 3) return 'Een code van minder dan drie tekens zegt te weinig.'
  if (schoon.length > 12) return 'Houd de code kort; hij moet op een bon passen.'
  if (!/^[A-Z0-9-]+$/.test(schoon)) {
    return 'Alleen letters, cijfers en streepjes. Spaties en accenten geven gedoe in exports.'
  }
  const botsing = bestaand.find(
    (l) => l.id !== eigenId && l.code.trim().toUpperCase() === schoon)
  if (botsing) return `${botsing.name} heeft deze code al.`
  return null
}

/* ================================================================== *
 *  De website
 *
 *  Wat hier wordt ingevuld komt op truckwash-workspace.com te staan. Dat is
 *  de reden dat dit blok wat strenger is dan de rest van het scherm: een
 *  typefout in een interne notitie ziet niemand, een typefout in het adres
 *  op de vestigingspagina stuurt een chauffeur de verkeerde afrit op.
 * ================================================================== */

/**
 * De diensten zoals ze op de website heten.
 *
 * Dit is met opzet NIET dezelfde lijst als SERVICES in types.ts. Die vijf
 * (buitenwas, cabine binnen, combi, tankreiniging, polijsten) zijn wat de
 * wasstraat boekt en afrekent, en dat type gaat letterlijk mee naar de
 * kassa-repo -- daar iets aan veranderen raakt negentien kassa's.
 *
 * Wat je verkoopt is een langere lijst, met truckparking, catering en de
 * wasboxen erbij. De sleutels komen overeen met de mappen op de site, zodat
 * de pagina rechtstreeks kan doorlinken naar de dienst.
 */
export const WEBSITE_DIENSTEN: { slug: string; naam: string }[] = [
  { slug: 'alcoa-velgen-reinigen', naam: 'Alcoa velgen reinigen' },
  { slug: 'bus-wasstraat', naam: 'Bus wasstraat' },
  { slug: 'camper-wasstraat', naam: 'Camper wasstraat' },
  { slug: 'catering-op-locatie', naam: 'Catering en vergaderen' },
  { slug: 'haal-en-brengservice', naam: 'Haal- en brengservice' },
  { slug: 'haccp-certificaat-en-behandeling', naam: 'HACCP-behandeling' },
  { slug: 'interieur-reinigen', naam: 'Interieur reinigen' },
  { slug: 'nao-wasplaats', naam: 'NAO-wasplaats' },
  { slug: 'truck-shop', naam: 'Truckshop' },
  { slug: 'truckparking', naam: 'Truckparking' },
  { slug: 'vogelgriep', naam: 'Vogelgriep' },
  { slug: 'vrachtwagen-polijsten', naam: 'Vrachtwagen polijsten' },
  { slug: 'wasboxen', naam: 'Wasboxen' },
  { slug: 'wegrestaurant-a2', naam: 'Wegrestaurant A2' },
]

/** Van "Nieuw-Vennep" naar "nieuw-vennep". Dat is wat er in het adres komt. */
export function voorstelSlug(plaats: string): string {
  return plaats
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // é wordt e
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Deugt dit als adres op de website?
 *
 * De strengheid zit hem in het laatste stuk. Twee vestigingen op dezelfde
 * pagina kan niet: dan is het maar net welke de lijst als eerste ziet, en dat
 * verschilt per keer. De database weigert het ook -- daar staat een unieke
 * index op -- maar die geeft je een foutmelding nadat je hebt opgeslagen, en
 * dit geeft hem terwijl je typt.
 */
export function slugProbleem(
  slug: string, bestaand: Location[], eigenId?: string,
): string | null {
  const schoon = slug.trim().toLowerCase()
  if (!schoon) return null  // leeg mag: dan staat hij niet op de site
  if (schoon.length < 2) return 'Te kort om een adres van te maken.'
  if (!/^[a-z0-9-]+$/.test(schoon)) {
    return 'Alleen kleine letters, cijfers en streepjes -- dit wordt een webadres.'
  }
  if (schoon.startsWith('-') || schoon.endsWith('-')) {
    return 'Een streepje aan het begin of eind hoort er niet in.'
  }
  const botsing = bestaand.find(
    (l) => l.id !== eigenId && (l.websiteSlug ?? '').trim().toLowerCase() === schoon)
  if (botsing) return `${botsing.name} staat al op /locaties/${schoon}/.`
  return null
}

/**
 * Wat er nog ontbreekt voordat deze vestiging op de site kan.
 *
 * Geen foutmeldingen maar een boodschappenlijstje. Een halve pagina
 * publiceren is erger dan hem nog even niet publiceren, en dit is de enige
 * plek waar iemand dat kan zien voordat het live staat.
 */
export function websiteGaten(l: Location): string[] {
  const gaten: string[] = []
  if (!(l.websiteSlug ?? '').trim()) gaten.push('een adres op de site')
  if (!l.address.trim() || !l.postcode.trim() || !l.city.trim()) gaten.push('een volledig adres')
  if (!(l.phone ?? '').trim()) gaten.push('een telefoonnummer')
  if (!Object.keys(l.openingHours ?? {}).length) gaten.push('openingstijden')
  if (!(l.intro ?? '').trim()) gaten.push('een introtekst')
  if (!(l.diensten ?? []).length) gaten.push('minstens een dienst')
  return gaten
}

/* ================================================================== *
 *  Openingstijden
 * ================================================================== */

const TIJD = /^([01]\d|2[0-3]):([0-5]\d)$/

export function tijdProbleem(v: Venster): string | null {
  if (!TIJD.test(v.van) || !TIJD.test(v.tot)) return 'Vul een tijd in als 07:00.'
  if (v.van >= v.tot) return 'De sluitingstijd ligt voor de openingstijd.'
  return null
}

/** Zes dagen hetzelfde en zondag dicht: het meest voorkomende geval. */
export function standaardTijden(): Openingstijden {
  const uit: Openingstijden = {}
  for (const d of WEEKDAGEN) {
    uit[d.key] = d.key === 'zo' ? null : { van: '07:00', tot: '18:00' }
  }
  return uit
}

/**
 * "ma t/m vr 07:00-18:00, za 08:00-13:00, zo dicht"
 *
 * Dagen met dezelfde tijden worden samengetrokken. Zeven regels onder elkaar
 * leest niemand; een zin wel.
 */
export function tijdenInHetKort(tijden?: Openingstijden): string {
  if (!tijden || !Object.keys(tijden).length) return 'Niet ingevuld'

  const stukken: string[] = []
  let begin = 0

  const sleutel = (d: Weekdag) => {
    const v = tijden[d]
    return v === null ? 'dicht' : v ? `${v.van}-${v.tot}` : 'leeg'
  }

  for (let i = 0; i <= WEEKDAGEN.length; i++) {
    const zelfde = i < WEEKDAGEN.length
      && sleutel(WEEKDAGEN[i].key) === sleutel(WEEKDAGEN[begin].key)
    if (zelfde) continue

    const s = sleutel(WEEKDAGEN[begin].key)
    if (s !== 'leeg') {
      const naam = i - begin === 1
        ? WEEKDAGEN[begin].kort
        : `${WEEKDAGEN[begin].kort} t/m ${WEEKDAGEN[i - 1].kort}`
      stukken.push(s === 'dicht' ? `${naam} dicht` : `${naam} ${s}`)
    }
    begin = i
  }

  return stukken.length ? stukken.join(', ') : 'Niet ingevuld'
}

/** Is er nu open? Geeft null als er niets is ingevuld, en dan zeggen we niets. */
export function nuOpen(loc: Location, nu = new Date()): boolean | null {
  const tijden = loc.openingHours
  if (!tijden || !Object.keys(tijden).length) return null
  const dag = WEEKDAGEN[(nu.getDay() + 6) % 7].key
  const venster = tijden[dag]
  if (venster === null) return false
  if (!venster) return null
  const klok = `${String(nu.getHours()).padStart(2, '0')}:${String(nu.getMinutes()).padStart(2, '0')}`
  return klok >= venster.van && klok < venster.tot
}

/* ================================================================== *
 *  Wat hangt eraan?
 * ================================================================== */

export interface Bezetting { wat: string; aantal: number }

/**
 * Wat er aan deze vestiging vastzit, uit de lokale kopie.
 *
 * Dit is het antwoord dat het scherm laat zien. Het echte slot zit in de
 * database -- die telt hetzelfde, maar dan over alles en niet alleen over
 * wat deze gebruiker mag zien.
 */
export async function bezetting(id: string): Promise<Bezetting[]> {
  const tel = async (wat: string, n: Promise<number>) => ({ wat, aantal: await n })

  const rijen = await Promise.all([
    tel('medewerkers', db.users
      .filter((u) => !u.isDevice && (u.locationId === id || (u.manages ?? []).includes(id)))
      .count()),
    tel('wasbeurten', db.washJobs.filter((j) => j.locationId === id).count()),
    tel('diensten', db.shifts.filter((s) => s.locationId === id).count()),
    tel('installaties', db.assets.filter((a) => a.locationId === id).count()),
    tel('storingen', db.faults.filter((f) => f.locationId === id).count()),
    tel('werkbonnen', db.workOrders.filter((w) => w.locationId === id).count()),
    tel('voorraadregels', db.inventory.filter((i) => i.locationId === id).count()),
    tel("kassa's", db.posRegisters.filter((r) => r.locationId === id).count()),
    tel('kluisboekingen', db.posSafeMoves.filter((m) => m.locationId === id).count()),
    tel('overlegkanalen', db.channels.filter((c) => c.locationId === id).count()),
  ])

  return rijen.filter((r) => r.aantal > 0).sort((a, b) => b.aantal - a.aantal)
}

/** "9 medewerkers, 4 installaties en 2 kassa's" */
export function bezettingInWoorden(rijen: Bezetting[]): string {
  const stukken = rijen.map((r) => `${r.aantal} ${r.wat}`)
  if (stukken.length <= 1) return stukken[0] ?? ''
  return `${stukken.slice(0, -1).join(', ')} en ${stukken[stukken.length - 1]}`
}

/* ================================================================== *
 *  Het adres opzoeken
 * ================================================================== */

export interface Gevonden {
  ok: boolean
  lat?: number
  lon?: number
  label?: string
  reden?: string
}

/**
 * Vraagt de kaartendienst waar dit adres ligt.
 *
 * Het antwoord overschrijft nooit wat er is ingetikt. Het komt ernaast te
 * staan, zodat je zelf ziet of "Kanaalweg 12" hetzelfde is als wat de dienst
 * ervan maakte. Mislukt het, dan gaat opslaan gewoon door -- coordinaten zijn
 * mooi meegenomen, geen voorwaarde.
 */
export async function zoekAdres(adres: string): Promise<Gevonden> {
  if (!adres.trim()) return { ok: false, reden: 'Vul eerst een adres in.' }
  if (!supabaseConfigured) {
    return { ok: false, reden: 'Er is nog geen database ingesteld.' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reden: 'Een adres opzoeken lukt alleen met verbinding.' }
  }
  try {
    const { data, error } = await supabase().functions.invoke<Gevonden>('route', {
      body: { actie: 'zoek', adres },
    })
    if (error) return { ok: false, reden: String(error.message ?? error) }
    return data ?? { ok: false, reden: 'Geen antwoord van de kaartendienst.' }
  } catch (e) {
    return { ok: false, reden: e instanceof Error ? e.message : String(e) }
  }
}

/** Het hele adres op een regel, zoals je het op een envelop zet. */
export function adresRegel(l: Pick<Location, 'address' | 'postcode' | 'city'>): string {
  return [l.address, [l.postcode, l.city].filter(Boolean).join(' ')]
    .filter((s) => s && s.trim()).join(', ')
}

/* ================================================================== *
 *  De vestigingen zelf
 * ================================================================== */

export interface NieuweVestiging {
  code: string
  name: string
  kind: LocationKind
  address: string
  postcode: string
  city: string
  phone?: string
  email?: string
  bays: number
  notes?: string
  openingHours?: Openingstijden
  managerId?: string
  managerName?: string
  lat?: number
  lon?: number
  geoLabel?: string
}

export class VestigingBezet extends Error {
  constructor(readonly rijen: Bezetting[]) {
    super(`Er hangt nog van alles aan deze vestiging: ${bezettingInWoorden(rijen)}.`)
    this.name = 'VestigingBezet'
  }
}

export const vestigingen = {
  async aanmaken(input: NieuweVestiging): Promise<Location> {
    const rij: Location = {
      id: uid('loc'),
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      kind: input.kind,
      address: input.address.trim(),
      postcode: input.postcode.trim().toUpperCase(),
      city: input.city.trim(),
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim().toLowerCase() || undefined,
      managerId: input.managerId,
      managerName: input.managerName,
      bays: Math.max(0, Math.round(input.bays)),
      notes: input.notes?.trim() || undefined,
      openingHours: input.openingHours,
      lat: input.lat,
      lon: input.lon,
      geoLabel: input.geoLabel,
      geoAt: input.lat != null ? Date.now() : undefined,
      active: true,
      updatedAt: Date.now(),
    }
    return put('locations', db.locations, rij)
  },

  async bijwerken(id: string, patch: Partial<Location>): Promise<Location | undefined> {
    const bestaand = await db.locations.get(id)
    if (!bestaand) return undefined
    return put('locations', db.locations, { ...bestaand, ...patch, id })
  },

  /**
   * Aan of uit.
   *
   * Uitzetten is wat je in negen van de tien gevallen wil: de vestiging is
   * dicht, maar de uren, werkbonnen en cijfers van de afgelopen jaren horen
   * er nog bij te staan. Daarom vraagt het om een reden -- "actief = nee"
   * zonder uitleg is over een half jaar een raadsel.
   */
  async aanUit(id: string, aan: boolean, reden?: string) {
    return vestigingen.bijwerken(id, {
      active: aan,
      inactiveReason: aan ? undefined : reden?.trim() || undefined,
      inactiveAt: aan ? undefined : Date.now(),
    })
  },

  /**
   * Echt weg.
   *
   * Alleen als er niets meer aan hangt. Dat is in de praktijk een vestiging
   * die per ongeluk of ter proef is aangemaakt -- en precies daarvoor moet
   * dit kunnen, anders staat die er voor altijd tussen.
   */
  async wissen(id: string) {
    const rijen = await bezetting(id)
    if (rijen.length) throw new VestigingBezet(rijen)

    const bij = await db.locationPhotos.where('locationId').equals(id).toArray()
    for (const f of bij) await fotos.wissen(f)

    await db.locations.delete(id)
    await enqueue('locations', 'delete', id, null)
  },
}

/* ================================================================== *
 *  Foto's
 * ================================================================== */

export const TOEGESTAAN = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_FOTO = 10 * 1024 * 1024

/** De lange kant waar een foto naartoe wordt gebracht voor het uploaden. */
export const MAX_ZIJDE = 1600

export type FotoFout =
  | { soort: 'te-groot'; max: number }
  | { soort: 'soort-niet-toegestaan'; mime: string }
  | { soort: 'geen-verbinding' }
  | { soort: 'geen-opslag' }
  | { soort: 'server'; bericht: string }

export class FotoProbleem extends Error {
  constructor(readonly detail: FotoFout) {
    super(uitleg(detail))
    this.name = 'FotoProbleem'
  }
}

function uitleg(f: FotoFout): string {
  switch (f.soort) {
    case 'te-groot':
      return `Deze foto is te groot. Maximaal ${Math.round(f.max / 1024 / 1024)} MB.`
    case 'soort-niet-toegestaan':
      return 'Alleen JPEG, PNG en WebP. Een HEIC uit een iPhone kun je in de ' +
             'Foto-app bewaren als JPEG.'
    case 'geen-verbinding':
      return 'Een foto uploaden lukt alleen met verbinding. De rest van het ' +
             'scherm werkt gewoon door.'
    case 'geen-opslag':
      return 'De opslag is nog niet ingesteld. Draai supabase/bijwerken.sql; ' +
             'die maakt de emmer "vestigingen" aan.'
    case 'server':
      return f.bericht
  }
}

/**
 * Een foto kleiner maken voordat hij de deur uit gaat.
 *
 * Een telefoon maakt tegenwoordig plaatjes van acht megabyte. Negentien
 * vestigingen met vijf foto's is dan driehonderd megabyte die elk toestel
 * over de lijn haalt om een tegel van tweehonderd pixels te tekenen.
 *
 * Lukt het verkleinen niet -- een browser zonder canvas, een raar formaat --
 * dan gaat het origineel gewoon mee. Beter een grote foto dan geen foto.
 */
export async function verklein(bestand: Blob, maxZijde = MAX_ZIJDE): Promise<Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return bestand
  }
  try {
    const bitmap = await createImageBitmap(bestand)
    const schaal = Math.min(1, maxZijde / Math.max(bitmap.width, bitmap.height))
    if (schaal >= 1 && bestand.size < 1024 * 1024) {
      bitmap.close?.()
      return bestand
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * schaal)
    canvas.height = Math.round(bitmap.height * schaal)
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return bestand }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()

    const uit = await new Promise<Blob | null>((klaar) =>
      canvas.toBlob(klaar, 'image/jpeg', 0.82))
    return uit && uit.size < bestand.size ? uit : bestand
  } catch {
    return bestand
  }
}

async function afmetingen(bestand: Blob): Promise<{ width?: number; height?: number }> {
  if (typeof createImageBitmap !== 'function') return {}
  try {
    const bitmap = await createImageBitmap(bestand)
    const uit = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return uit
  } catch {
    return {}
  }
}

export const fotos = {
  van(locationId: string) {
    return db.locationPhotos
      .where('locationId').equals(locationId)
      .toArray()
      .then(opVolgorde)
  },

  /**
   * Zet een foto bij een vestiging.
   *
   * Eerst het bestand naar de opslag, dan pas de regel erover. Andersom zou
   * je een foto in de lijst hebben staan waarvan het plaatje er nooit is
   * gekomen -- en dat is precies het soort lege vlak waar niemand van weet
   * of het aan de verbinding ligt of aan de app.
   */
  async upload(input: {
    bestand: Blob
    bestandsnaam: string
    locatie: Pick<Location, 'id' | 'name'>
    caption?: string
    door?: Pick<User, 'id' | 'name'>
  }): Promise<LocationPhoto> {
    const mime = (input.bestand as File).type || 'application/octet-stream'
    if (!TOEGESTAAN.includes(mime)) {
      throw new FotoProbleem({ soort: 'soort-niet-toegestaan', mime })
    }
    if (input.bestand.size > MAX_FOTO) {
      throw new FotoProbleem({ soort: 'te-groot', max: MAX_FOTO })
    }
    if (!supabaseConfigured) throw new FotoProbleem({ soort: 'geen-opslag' })
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new FotoProbleem({ soort: 'geen-verbinding' })
    }

    const klein = await verklein(input.bestand)
    const maat = await afmetingen(klein)
    const uitMime = klein === input.bestand ? mime : 'image/jpeg'

    const id = uid('lfoto')
    const extensie = uitMime === 'image/png' ? 'png' : uitMime === 'image/webp' ? 'webp' : 'jpg'
    const pad = `${input.locatie.id}/${id}.${extensie}`

    const { error } = await supabase().storage.from(EMMER).upload(pad, klein, {
      contentType: uitMime,
      upsert: false,
    })
    if (error) {
      const bericht = String(error.message ?? error)
      if (/bucket/i.test(bericht) && /not found|does not exist/i.test(bericht)) {
        throw new FotoProbleem({ soort: 'geen-opslag' })
      }
      throw new FotoProbleem({ soort: 'server', bericht })
    }

    const bestaand = await fotos.van(input.locatie.id)

    const rij: LocationPhoto = {
      id,
      locationId: input.locatie.id,
      storagePath: pad,
      mime: uitMime,
      sizeBytes: klein.size,
      width: maat.width,
      height: maat.height,
      caption: input.caption?.trim() || undefined,
      sort: bestaand.length,
      // De eerste foto is meteen de foto die vooraan staat. Anders heeft een
      // vestiging er wel een, maar blijft de tegel leeg tot iemand het merkt.
      isCover: bestaand.length === 0,
      uploadedBy: input.door?.id,
      uploadedByName: input.door?.name,
      uploadedAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Meteen in het geheugen: dan staat hij er ook zonder hem op te halen.
    await db.media.put({ pad, blob: klein, at: Date.now() })

    return put('locationPhotos', db.locationPhotos, rij)
  },

  async bijschrift(id: string, caption: string) {
    const foto = await db.locationPhotos.get(id)
    if (!foto) return
    return put('locationPhotos', db.locationPhotos,
      { ...foto, caption: caption.trim() || undefined })
  },

  /** Deze naar voren; de vorige eerste is het dan niet meer. */
  async voorop(id: string) {
    const foto = await db.locationPhotos.get(id)
    if (!foto || foto.isCover) return

    /*
     * Eerst de oude afzetten, dan pas de nieuwe aan. De database staat er
     * maar een toe per vestiging; andersom botst het met die regel en zou de
     * wijziging blijven hangen in de wachtrij.
     */
    for (const a of await fotos.van(foto.locationId)) {
      if (a.isCover) await put('locationPhotos', db.locationPhotos, { ...a, isCover: false })
    }
    return put('locationPhotos', db.locationPhotos, { ...foto, isCover: true })
  },

  /** De hele volgorde in een keer; het scherm laat ze slepen. */
  async volgorde(lijst: LocationPhoto[]) {
    for (let i = 0; i < lijst.length; i++) {
      if (lijst[i].sort === i) continue
      await put('locationPhotos', db.locationPhotos, { ...lijst[i], sort: i })
    }
  },

  /**
   * Weg.
   *
   * Andersom dan bij het uploaden: eerst de regel, dan het bestand. Blijft
   * er een bestand achter waar niets meer naar wijst, dan kost dat opslag;
   * blijft er een regel achter zonder bestand, dan staat er een kapot vlak
   * in het scherm.
   */
  async wissen(foto: LocationPhoto) {
    await db.locationPhotos.delete(foto.id)
    await enqueue('locationPhotos', 'delete', foto.id, null)
    await db.media.delete(foto.storagePath)

    // Was dit de foto die vooraan stond, dan schuift de volgende naar voren.
    if (foto.isCover) {
      const rest = await fotos.van(foto.locationId)
      if (rest.length) {
        await put('locationPhotos', db.locationPhotos, { ...rest[0], isCover: true })
      }
    }

    if (supabaseConfigured && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        await supabase().storage.from(EMMER).remove([foto.storagePath])
      } catch {
        // Het bestand blijft dan staan. Vervelend, maar niet iets waar de
        // gebruiker iets mee kan; de regel is weg en dat is wat telt.
      }
    }
  },
}

export function opVolgorde(lijst: LocationPhoto[]): LocationPhoto[] {
  return [...lijst].sort((a, b) =>
    Number(b.isCover) - Number(a.isCover) || a.sort - b.sort || a.uploadedAt - b.uploadedAt)
}

export function coverVan(lijst: LocationPhoto[]): LocationPhoto | undefined {
  return opVolgorde(lijst)[0]
}

/* ================================================================== *
 *  Het plaatje ophalen
 * ================================================================== */

/**
 * Een adres waarmee het plaatje te tekenen is.
 *
 * Eerst uit het geheugen om de hoek, en pas daarna van de server. Dat is niet
 * alleen sneller: het is het verschil tussen een scherm dat het doet in een
 * wasstraat zonder bereik en een scherm vol grijze vlakken.
 *
 * De emmer is openbaar leesbaar, anders dan de dossiers. Dat is een keuze:
 * een foto van een wasstraat langs de snelweg staat ook op de website, en
 * negentien ondertekende adressen ophalen bij elk scherm maakt de lijst traag
 * en offline leeg.
 */
export async function fotoUrl(foto: LocationPhoto): Promise<string | null> {
  const bekend = await db.media.get(foto.storagePath)
  if (bekend) return URL.createObjectURL(bekend.blob)

  if (!supabaseConfigured) return null
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null

  try {
    const { data, error } = await supabase().storage.from(EMMER).download(foto.storagePath)
    if (error || !data) return null
    await db.media.put({ pad: foto.storagePath, blob: data, at: Date.now() })
    return URL.createObjectURL(data)
  } catch {
    return null
  }
}
