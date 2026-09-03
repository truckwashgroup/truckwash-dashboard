import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured, supabaseUrl } from './api/supabaseApi'
import { inventory as voorraadRepo } from './repo'
import { leesInstelling, SLEUTELS } from './instellingen'
import {
  BESTELLING_STATUS,
  type Bestelling, type BestellingBron, type BestellingStatus, type Bestelregel,
  type InventoryItem, type Location, type Role, type User, type VoorraadAlarm,
} from './types'

/* ------------------------------------------------------------------ *
 *  Trucksupply, de leverancier van de vestigingen
 *
 *  Drie dingen die aan elkaar hangen:
 *
 *    Alarm        een artikel op een vestiging dat onder zijn minimum staat;
 *                 de database zet hem, de app toont en mailt hem
 *    Artikel      wat Trucksupply levert, met prijs, foto en minimum, en
 *                 desgewenst doorgezet naar de kassa
 *    Bestelling   wat er naar een vestiging gaat: van concept via inpakken
 *                 en verzenden tot ontvangen, met pakbon en verzendlabel
 *
 *  Waarom dit bestaat: "we zijn door de shampoo heen" kwam per telefoon, per
 *  appje of helemaal niet, en dan stond er een wasstraat stil. Nu meldt de
 *  voorraad het zelf, en de bestelling boekt de levering bij op de vestiging
 *  op het moment dat hij de deur uitgaat.
 *
 *  Alles wat hier puur kan is puur gehouden (geen Dexie, geen netwerk), zodat
 *  de zelftest het kan narekenen. De schrijvende functies volgen het patroon
 *  van de rest van de app: lokaal eerst, dan de wachtrij.
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

/** Zijn we in een browser met verbinding? In Node (de zelftest) nee. */
function verbonden(): boolean {
  if (!supabaseConfigured) return false
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  return true
}

/**
 * Een serverfunctie aanroepen met het sessietoken.
 *
 * Zelfde patroon als trucky.beantwoord(): de functies staan open zonder
 * verplichte inlog (de cron moet erbij kunnen) en controleren dus zelf wie
 * er belt. Zonder token heeft bellen geen zin.
 */
async function roepFunctie<T>(naam: string, body: Record<string, unknown>): Promise<T> {
  const { data: sessie } = await supabase().auth.getSession()
  const token = sessie.session?.access_token
  if (!token) throw new Error('Je sessie is verlopen. Log opnieuw in.')

  const res = await fetch(`${supabaseUrl()}/functions/v1/${naam}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const uit = await res.json().catch(() => null) as
    ({ ok?: boolean; reden?: string } & Record<string, unknown>) | null
  if (!res.ok || !uit || uit.ok === false) {
    throw new Error(uit?.reden ?? `De serverfunctie ${naam} gaf ${res.status} terug.`)
  }
  return uit as T
}

/* ================================================================== *
 *  Alarmen
 * ================================================================== */

/** De alarmen die nog niet zijn opgelost, nieuwste bovenaan. */
export function openAlarmen(alarmen: VoorraadAlarm[]): VoorraadAlarm[] {
  return alarmen
    .filter((a) => !a.opgelostAt)
    .sort((a, b) => b.ontstaanAt - a.ontstaanAt)
}

export interface AlarmenPerVestiging {
  locationId: string
  naam: string
  locatie?: Location
  alarmen: VoorraadAlarm[]
}

/**
 * De open alarmen gegroepeerd per vestiging, drukste vestiging bovenaan.
 *
 * Een vestiging die in de alarmen voorkomt maar niet in de lijst locaties
 * (net opgeheven, of nog niet gesynchroniseerd) krijgt geen lege groep maar
 * een naam die zegt wat er aan de hand is. Weglaten zou betekenen dat een
 * alarm onzichtbaar wordt om een reden die er los van staat.
 */
export function perVestiging(alarmen: VoorraadAlarm[], locaties: Location[]): AlarmenPerVestiging[] {
  const groepen = new Map<string, VoorraadAlarm[]>()
  for (const a of openAlarmen(alarmen)) {
    const lijst = groepen.get(a.locationId) ?? []
    lijst.push(a)
    groepen.set(a.locationId, lijst)
  }
  const uit: AlarmenPerVestiging[] = []
  for (const [locationId, lijst] of groepen) {
    const locatie = locaties.find((l) => l.id === locationId)
    uit.push({
      locationId,
      naam: locatie?.name ?? 'Onbekende vestiging',
      locatie,
      alarmen: lijst,
    })
  }
  return uit.sort((a, b) =>
    b.alarmen.length - a.alarmen.length || a.naam.localeCompare(b.naam, 'nl'))
}

/**
 * Een alarm op gezien zetten.
 *
 * Gezien is niet opgelost: de stand is nog steeds te laag. Het betekent
 * alleen dat iemand van Trucksupply het weet, en dan hoeft de ochtendmail
 * er niet nog eens over te beginnen.
 */
export async function markeerGezien(alarm: VoorraadAlarm, door: Pick<User, 'id' | 'name'>) {
  if (alarm.gezienAt) return alarm
  return put('voorraadAlarmen', db.voorraadAlarmen, {
    ...alarm,
    gezienAt: Date.now(),
    gezienDoor: door.id,
    gezienDoorNaam: door.name,
  })
}

/* ================================================================== *
 *  Artikelen
 * ================================================================== */

export interface ArtikelInvoer {
  id?: string
  locationId: string
  name: string
  unit: string
  sku?: string
  omschrijving?: string
  image?: string
  stock?: number
  minStock?: number
  bestelhoeveelheid?: number
  inkoopprijs?: number
  pricePerUnit?: number
  supplier?: string
  actief?: boolean
  exactCode?: string
}

const getal = (v: unknown, terugval = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : terugval
}

/**
 * Een artikel aanmaken of bijwerken.
 *
 * Bestaat het al (id meegegeven en gevonden), dan blijven stand en velden
 * die niet zijn meegegeven staan: dit scherm gaat over het artikel, niet
 * over de voorraadstand -- die wordt door leveringen en verbruik bijgewerkt.
 */
export async function artikelOpslaan(input: ArtikelInvoer): Promise<InventoryItem> {
  // De server heeft een check op de fotomaat (inventory_items_image_maat, 0048).
  // Een te grote foto zou lokaal gewoon lukken en dan in de wachtrij blijven
  // hangen zonder dat de gebruiker iets ziet; liever nu een fout op het scherm.
  if (input.image && input.image.length > FOTO_SERVER_MAX_TEKENS) {
    throw new Error('De foto is te groot om op te slaan. Kies hem opnieuw; de app verkleint hem dan.')
  }

  const bestaand = input.id ? await db.inventory.get(input.id) : undefined

  const item: InventoryItem = {
    ...(bestaand ?? {
      id: uid('inv'),
      stock: 0,
      minStock: 0,
      pricePerUnit: 0,
      supplier: 'Trucksupply',
      updatedAt: Date.now(),
    }),
    locationId: input.locationId,
    name: input.name.trim(),
    unit: input.unit.trim() || 'stuk',
    sku: input.sku?.trim() || undefined,
    omschrijving: input.omschrijving?.trim() || undefined,
    image: input.image ?? bestaand?.image,
    stock: input.stock !== undefined ? getal(input.stock) : (bestaand?.stock ?? 0),
    minStock: input.minStock !== undefined ? getal(input.minStock) : (bestaand?.minStock ?? 0),
    bestelhoeveelheid: input.bestelhoeveelheid !== undefined
      ? Math.max(0, getal(input.bestelhoeveelheid))
      : (bestaand?.bestelhoeveelheid ?? 0),
    inkoopprijs: input.inkoopprijs !== undefined ? getal(input.inkoopprijs) : bestaand?.inkoopprijs,
    // Zonder aparte interne prijs is de inkoopprijs wat het kost.
    pricePerUnit: input.pricePerUnit !== undefined
      ? getal(input.pricePerUnit)
      : (bestaand?.pricePerUnit || getal(input.inkoopprijs, 0)),
    supplier: input.supplier?.trim() || bestaand?.supplier || 'Trucksupply',
    actief: input.actief ?? bestaand?.actief ?? true,
    exactCode: input.exactCode?.trim() || undefined,
  }
  if (!item.name) throw new Error('Een artikel heeft een naam nodig.')

  return voorraadRepo.upsert(item)
}

/**
 * Hetzelfde artikel op andere vestigingen zetten.
 *
 * De voorraad is per vestiging, dus "shampoo" bestaat negentien keer. Wie
 * een artikel toevoegt wil het niet negentien keer intikken. De kopie krijgt
 * dezelfde naam, sku, prijs en foto, en stand 0: wat er werkelijk ligt weet
 * de vestiging, niet wij. Staat er op een vestiging al een artikel met deze
 * sku (of, zonder sku, deze naam), dan slaan we die over -- twee keer
 * dezelfde shampoo op één vestiging is precies de verwarring die dit moest
 * voorkomen.
 */
export async function artikelKopieerNaar(
  item: InventoryItem,
  locationIds: string[],
  opties: { minimumMeenemen?: boolean } = {},
): Promise<InventoryItem[]> {
  const alles = await db.inventory.toArray()
  const zelfde = (x: InventoryItem, locationId: string) =>
    x.locationId === locationId && (
      item.sku ? x.sku === item.sku
               : x.name.trim().toLowerCase() === item.name.trim().toLowerCase())

  const gemaakt: InventoryItem[] = []
  for (const locationId of new Set(locationIds)) {
    if (locationId === item.locationId) continue
    if (alles.some((x) => zelfde(x, locationId))) continue
    const kopie = await voorraadRepo.upsert({
      ...item,
      id: uid('inv'),
      locationId,
      stock: 0,
      /*
       * Het minimum gaat standaard NIET mee.
       *
       * De kopie begint op stand 0, en stand 0 onder een minimum is voor de
       * trigger een alarm -- per vestiging, meteen, en binnen een kwartier
       * één mail met al die regels, terwijl er op de vloer niets veranderde.
       * Achttien vinkjes waren achttien rode kaarten. Het minimum hoort te
       * volgen op wat er werkelijk ligt, dus dat zet de leverancier per
       * vestiging zodra de stand geteld is. Wie het toch wil, zegt het.
       */
      minStock: opties.minimumMeenemen ? item.minStock : 0,
      updatedAt: Date.now(),
    })
    gemaakt.push(kopie)
  }
  return gemaakt
}

/**
 * Hoe groot een artikelfoto mag zijn, als data-URI.
 *
 * Het plaatje gaat mee in de rij van het artikel en dus naar elk apparaat
 * dat de voorraad synchroniseert. Negentien vestigingen keer honderd
 * artikelen keer een foto van een megabyte is geen voorraadlijst meer. De
 * kassa hanteert 150 kB (0027); wij blijven daar ruim onder, want dit is een
 * herkenningsplaatje en geen productfoto.
 */
export const FOTO_MAX_TEKENS = 48 * 1024
/** Wat de database hoogstens aanneemt (check inventory_items_image_maat in 0048). */
export const FOTO_SERVER_MAX_TEKENS = 150_000

/**
 * Een foto verkleinen tot een data-URI die in de rij past.
 *
 * Zelfde aanpak als vestigingen.verklein(), maar dan met een harde grens:
 * eerst de zijde omlaag, dan de kwaliteit, tot hij past. Lukt het niet
 * (geen canvas, een raar formaat), dan een fout en geen origineel van drie
 * megabyte in de database.
 */
export async function fotoVerkleinen(bestand: Blob, maxTekens = FOTO_MAX_TEKENS): Promise<string> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('Een foto verkleinen kan alleen in de app zelf.')
  }
  const bitmap = await createImageBitmap(bestand)
  try {
    for (const zijde of [320, 240, 180, 120]) {
      const schaal = Math.min(1, zijde / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * schaal))
      canvas.height = Math.max(1, Math.round(bitmap.height * schaal))
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const kwaliteit of [0.82, 0.7, 0.55, 0.4]) {
        const uri = canvas.toDataURL('image/jpeg', kwaliteit)
        if (uri.length <= maxTekens) return uri
      }
    }
  } finally {
    bitmap.close?.()
  }
  throw new Error('Deze foto is ook verkleind te groot. Probeer een eenvoudiger plaatje.')
}

/**
 * Een artikel in de kassa zetten (of daar bijwerken).
 *
 * De pos_*-tabellen zijn van de kassa en de app schrijft er niet rechtstreeks
 * in; de enige deur is de serverfunctie supply_artikel_naar_kassa. Die maakt
 * of werkt het kassaproduct bij met de naam, eenheid, foto en vestiging van
 * het artikel, en de prijs inclusief btw die hier wordt meegegeven.
 *
 * Werkt alleen met verbinding: de kassatabellen zitten niet in de
 * synchronisatie van deze app, dus er is geen wachtrij om op terug te vallen.
 */
export async function naarKassa(item: InventoryItem, prijsIncl: number, groep: string): Promise<string> {
  if (!verbonden()) {
    throw new Error('Een artikel naar de kassa zetten lukt alleen met verbinding.')
  }
  const { data, error } = await supabase().rpc('supply_artikel_naar_kassa', {
    item_id: item.id,
    prijs_incl: getal(prijsIncl),
    groep: groep.trim() || 'Overig',
  })
  if (error) throw new Error('Naar de kassa zetten mislukte: ' + error.message)
  return String(data ?? '')
}

/** Wat de kassa van een artikel weet: het gekoppelde product, de prijs, aan of uit. */
export interface KassaPrijs {
  inventoryItemId: string
  productId: string
  prijsIncl: number
  actief: boolean
}

/**
 * De kassaprijzen terugkijken.
 *
 * De leverancier mag pos_products niet lezen -- die tabel is voor personeel
 * -- maar wie de prijs zet hoort hem terug te kunnen zien. Daarom een
 * leesdeur in de database (supply_kassa_prijzen, 0048) die alleen de
 * koppeling, de prijs en aan/uit teruggeeft. Zonder verbinding: niets, en
 * dat is geen fout; het scherm zegt dan "onbekend" in plaats van te gokken.
 */
export async function kassaPrijzen(): Promise<KassaPrijs[] | null> {
  if (!verbonden()) return null
  const { data, error } = await supabase().rpc('supply_kassa_prijzen')
  if (error || !Array.isArray(data)) return null
  return (data as { inventory_item_id: string; product_id: string; price_incl: number; active: boolean }[])
    .map((r) => ({
      inventoryItemId: r.inventory_item_id,
      productId: r.product_id,
      prijsIncl: Number(r.price_incl) || 0,
      actief: !!r.active,
    }))
}

/* ================================================================== *
 *  Bestellingen
 * ================================================================== */

export type RegelInvoer = Omit<Bestelregel, 'id' | 'bestellingId' | 'updatedAt'>

/** Welke stap er na welke mag. Alles kan geannuleerd worden tot het verzonden is. */
export const VOLGENDE_STATUS: Record<BestellingStatus, BestellingStatus[]> = {
  concept:     ['bevestigd', 'geannuleerd'],
  bevestigd:   ['ingepakt', 'geannuleerd'],
  ingepakt:    ['verzonden', 'geannuleerd'],
  verzonden:   ['ontvangen'],
  ontvangen:   [],
  geannuleerd: [],
}

export function magNaar(van: BestellingStatus, naar: BestellingStatus): boolean {
  return VOLGENDE_STATUS[van].includes(naar)
}

/** Het voorvoegsel van een nummer dat nog niet door de server is uitgegeven. */
export const CONCEPT_VOORVOEGSEL = 'TS-concept-'

export function isConceptNummer(nummer: string): boolean {
  return nummer.startsWith(CONCEPT_VOORVOEGSEL)
}

/**
 * Een bestelnummer halen.
 *
 * Het nummer komt van een reeks op de server (public.bestelnummer): twee
 * apparaten die tegelijk een bestelling maken krijgen zo nooit hetzelfde
 * nummer. Zonder verbinding kan dat niet, en dan krijgt de bestelling een
 * tijdelijk nummer dat aan zijn vorm te herkennen is. Zodra hij bevestigd
 * wordt met verbinding, wordt het alsnog een echt nummer. Een bestelling
 * niet kunnen maken omdat je in de loods geen bereik hebt zou erger zijn.
 */
async function haalNummer(): Promise<string> {
  if (verbonden()) {
    try {
      const { data, error } = await supabase().rpc('bestelnummer')
      if (!error && typeof data === 'string' && data) return data
    } catch {
      /* dan het tijdelijke nummer */
    }
  }
  return CONCEPT_VOORVOEGSEL + Date.now()
}

/**
 * Hoeveel er van een artikel mee zou moeten.
 *
 * De bestelhoeveelheid die erbij staat; is die nul, dan genoeg om weer op
 * twee keer het minimum te komen (minimum * 2 - stand). Nooit nul of minder:
 * een regel met nul stuks is geen bestelling maar een vergissing.
 *
 * Een functie voor de alarmen, het voorraadscherm en de aanvraagknop op de
 * vloer: die rekenden eerst elk net iets anders, en dan vraagt de vestiging
 * 12 en zet de leverancier er 10 in zonder dat iemand weet waarom.
 */
export function voorstelAantal(item: Pick<InventoryItem, 'stock' | 'minStock' | 'bestelhoeveelheid'>): number {
  let aantal = getal(item.bestelhoeveelheid)
  if (aantal <= 0) aantal = item.minStock * 2 - item.stock
  if (aantal <= 0) aantal = Math.max(item.minStock, 1)
  return Math.round(aantal * 100) / 100
}

/** Het voorstel voor een bestelling uit de open alarmen; per artikel een regel. */
export function voorstelUitAlarmen(alarmen: VoorraadAlarm[], items: InventoryItem[]): RegelInvoer[] {
  const uit: RegelInvoer[] = []
  const gezien = new Set<string>()
  for (const a of openAlarmen(alarmen)) {
    if (gezien.has(a.itemId)) continue
    gezien.add(a.itemId)
    const item = items.find((i) => i.id === a.itemId)

    uit.push({
      itemId: a.itemId,
      itemNaam: item?.name ?? a.itemNaam,
      aantal: voorstelAantal({
        stock: item?.stock ?? a.stand,
        minStock: item?.minStock ?? a.minimum,
        bestelhoeveelheid: item?.bestelhoeveelheid,
      }),
      eenheid: item?.unit ?? 'stuk',
      prijs: item?.inkoopprijs,
    })
  }
  return uit
}

/**
 * Een nieuwe bestelling met haar regels.
 *
 * De bestelling gaat vóór de regels de wachtrij in (en PUSH_ORDER houdt dat
 * ook zo): een regel die eerder aankomt dan zijn bestelling wordt door de
 * server geweigerd op de verwijzing.
 */
export async function nieuweBestelling(input: {
  locationId: string
  bron: BestellingBron
  door: Pick<User, 'id' | 'name'>
  regels: RegelInvoer[]
  opmerking?: string
}): Promise<{ bestelling: Bestelling; regels: Bestelregel[] }> {
  const regelsMetInhoud = input.regels.filter((r) => r.aantal > 0)
  if (!regelsMetInhoud.length) throw new Error('Een bestelling heeft minstens één regel nodig.')

  const nu = Date.now()
  const bestelling: Bestelling = {
    id: uid('bst'),
    nummer: await haalNummer(),
    locationId: input.locationId,
    status: 'concept',
    bron: input.bron,
    aangemaaktDoor: input.door.id,
    aangemaaktDoorNaam: input.door.name,
    aangemaaktAt: nu,
    opmerking: input.opmerking?.trim() || undefined,
    updatedAt: nu,
  }
  await put('bestellingen', db.bestellingen, bestelling)

  const regels: Bestelregel[] = []
  for (const r of regelsMetInhoud) {
    const regel: Bestelregel = {
      ...r,
      id: uid('bsr'),
      bestellingId: bestelling.id,
      itemNaam: r.itemNaam.trim(),
      updatedAt: nu,
    }
    regels.push(await put('bestelregels', db.bestelregels, regel))
  }
  return { bestelling, regels }
}

/**
 * De pure kant van een statuswijziging: het object met de juiste stempels.
 *
 * Elke stap krijgt zijn eigen tijdstempel, en die wordt niet overschreven
 * als hij er al staat -- wie een bestelling per ongeluk twee keer op
 * verzonden zet, verandert daarmee niet wanneer hij werkelijk wegging.
 */
export function volgendeStatus(bestelling: Bestelling, status: BestellingStatus, nu = Date.now()): Bestelling {
  const uit: Bestelling = { ...bestelling, status }
  if (status === 'bevestigd' && !uit.bevestigdAt) uit.bevestigdAt = nu
  if (status === 'verzonden') {
    // Verzonden zonder bevestigd komt voor als iemand snel werkt; dan is
    // het moment van verzenden ook het moment van bevestigen.
    if (!uit.bevestigdAt) uit.bevestigdAt = nu
    if (!uit.verzondenAt) uit.verzondenAt = nu
  }
  if (status === 'ontvangen' && !uit.ontvangenAt) uit.ontvangenAt = nu
  return uit
}

/**
 * Wie de server een voorraadmutatie laat schrijven.
 *
 * De insert-regel op stock_movements (stock_insert, 0040, door 0048 bewust
 * ongemoeid gelaten) laat alleen is_staff() door, en dat zijn precies deze
 * rollen. De rol trucksupply zit er niet bij: verbruik boeken doet de
 * vestiging. Dit lijstje is een spiegel van public.is_staff() in 0048;
 * verandert die functie, dan dit lijstje ook.
 *
 * Waarom de app dit moet weten: een mutatie die de server weigert komt niet
 * terug als foutmelding maar blijft in de wachtrij hangen, en na acht
 * pogingen logt de synchronisatie "Blijft hangen". Dat gebeurde bij elke
 * levering van een gebruiker met alleen de rol trucksupply, terwijl de stand
 * zelf wel aankwam (inventory_write laat de leverancier wel door). Beter
 * vooraf weten welke weg open is dan achteraf een wachtrij vol spoken.
 */
export const MUTATIE_ROLLEN: readonly Role[] = [
  'employee', 'supervisor', 'technician', 'administratie', 'management', 'developer',
]

/** Mag deze gebruiker een rij in stock_movements zetten (spiegel van stock_insert)? */
export function magMutatieBoeken(door: { roles?: readonly Role[] }): boolean {
  return (door.roles ?? []).some((r) => MUTATIE_ROLLEN.includes(r))
}

/**
 * Een levering bijboeken op één artikel van de vestiging.
 *
 * Twee wegen, allebei positief en met dezelfde uitkomst voor de stand:
 *
 *   mutatie   als de gebruiker een voorraadmutatie mag schrijven (zie
 *             MUTATIE_ROLLEN): via de inventory-repo, dus mét een regel
 *             "Levering Trucksupply <nummer>" in de mutaties van de vestiging
 *   stand     anders alleen de stand zelf ophogen (inventory_write laat de
 *             leverancier door). De bestelling met haar regels en
 *             verzondenAt ís dan het bewijs van de levering; er staat alleen
 *             geen losse regel tussen het verbruik op de vloer.
 *
 * Zodra deel A stock_insert openzet voor de leverancier hoeft alleen
 * 'trucksupply' bij MUTATIE_ROLLEN en loopt alles via de eerste weg.
 */
async function boekLevering(
  item: InventoryItem,
  aantal: number,
  bestelling: Bestelling,
  door: Pick<User, 'id' | 'name' | 'roles'>,
): Promise<'mutatie' | 'stand'> {
  if (magMutatieBoeken(door)) {
    await voorraadRepo.adjust({
      itemId: item.id,
      qty: aantal,
      reason: `Levering Trucksupply ${bestelling.nummer}`,
      user: door,
    })
    return 'mutatie'
  }
  await voorraadRepo.upsert({
    ...item,
    stock: Math.round((item.stock + aantal) * 100) / 100,
  })
  return 'stand'
}

/**
 * Een bestelling een stap verder zetten.
 *
 * Bij 'verzonden' wordt de levering bijgeboekt op de vestiging: per regel
 * positief, met de reden "Levering Trucksupply <nummer>" als de gebruiker
 * een mutatie mag schrijven en anders alleen de stand (zie boekLevering).
 * Dat gebeurt één keer: staat hij al op verzonden of ontvangen, dan wordt er
 * niets nog eens bijgeboekt.
 *
 * Eerst boeken, dan de status. Andersom kon een mislukte boeking een
 * bestelling opleveren die "verzonden" zegt terwijl de vestiging de voorraad
 * nooit heeft zien binnenkomen -- en dan gaat het alarm er nooit af.
 */
export async function zetStatus(
  bestelling: Bestelling,
  status: BestellingStatus,
  door: Pick<User, 'id' | 'name' | 'roles'>,
): Promise<Bestelling> {
  if (bestelling.status === status) return bestelling
  // VOLGENDE_STATUS is de enige toegestane volgorde. De knoppen houden zich
  // eraan, maar wie dit rechtstreeks aanroept ('geannuleerd' -> 'verzonden')
  // zou anders voorraad bijboeken op een bestelling die nooit de deur uitging.
  if (!magNaar(bestelling.status, status)) {
    const van = BESTELLING_STATUS[bestelling.status].label.toLowerCase()
    const naar = BESTELLING_STATUS[status].label.toLowerCase()
    throw new Error(`Een bestelling gaat niet van ${van} naar ${naar}`)
  }

  let volgende = volgendeStatus(bestelling, status)

  if (status === 'verzonden' && bestelling.status !== 'verzonden' && bestelling.status !== 'ontvangen') {
    const regels = await db.bestelregels.where('bestellingId').equals(bestelling.id).toArray()
    for (const r of regels) {
      const aantal = r.geleverd ?? r.aantal
      if (aantal <= 0) continue
      const item = await db.inventory.get(r.itemId)
      if (!item) {
        console.warn(`[trucksupply] artikel ${r.itemId} (${r.itemNaam}) staat niet in de voorraad; niet bijgeboekt`)
        continue
      }
      await boekLevering(item, aantal, bestelling, door)
    }
  }

  // Een concept-nummer alsnog inruilen voor een echt nummer, nu er misschien
  // verbinding is. Bij elke stap, niet alleen bij bevestigen: wie offline
  // bevestigde en later met verbinding inpakt, moet geen 'TS-concept-...' op
  // de pakbon en het verzendlabel krijgen.
  if (isConceptNummer(volgende.nummer)) {
    const nummer = await haalNummer()
    if (!isConceptNummer(nummer)) volgende = { ...volgende, nummer }
  }

  return put('bestellingen', db.bestellingen, volgende)
}

/** Vervoerder en track & trace erbij zetten, of de opmerking wijzigen. */
export async function bestellingBijwerken(
  bestelling: Bestelling,
  patch: Partial<Pick<Bestelling, 'vervoerder' | 'trackTrace' | 'opmerking'>>,
): Promise<Bestelling> {
  return put('bestellingen', db.bestellingen, {
    ...bestelling,
    vervoerder: patch.vervoerder !== undefined ? (patch.vervoerder.trim() || undefined) : bestelling.vervoerder,
    trackTrace: patch.trackTrace !== undefined ? (patch.trackTrace.trim() || undefined) : bestelling.trackTrace,
    opmerking: patch.opmerking !== undefined ? (patch.opmerking.trim() || undefined) : bestelling.opmerking,
  })
}

/** Het geleverde aantal op een regel, als dat afwijkt van wat er besteld was. */
export async function regelGeleverd(regel: Bestelregel, geleverd: number): Promise<Bestelregel> {
  return put('bestelregels', db.bestelregels, {
    ...regel,
    geleverd: Math.max(0, getal(geleverd)),
  })
}

/** Een conceptbestelling weggooien. Verder dan concept kan alleen annuleren. */
export async function bestellingVerwijderen(bestelling: Bestelling): Promise<void> {
  if (bestelling.status !== 'concept') {
    throw new Error('Alleen een concept kan weg; annuleer de bestelling anders.')
  }
  const regels = await db.bestelregels.where('bestellingId').equals(bestelling.id).toArray()
  for (const r of regels) {
    await db.bestelregels.delete(r.id)
    await enqueue('bestelregels', 'delete', r.id, null)
  }
  await db.bestellingen.delete(bestelling.id)
  await enqueue('bestellingen', 'delete', bestelling.id, null)
}

/**
 * De pakbon per mail doorsturen -- naar de vestiging, of naar een vervoerder.
 *
 * Gaat via de serverfunctie, want de app heeft geen mailsleutel en hoort die
 * ook niet te hebben. De functie zet doorgestuurd_naar/at op de server; we
 * zetten het hier ook meteen lokaal, zodat het scherm niet op de volgende
 * synchronisatie hoeft te wachten.
 */
export async function mailBestelling(bestelling: Bestelling, naar: string, bericht: string): Promise<Bestelling> {
  const adres = naar.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) throw new Error('Dat is geen geldig mailadres.')

  await roepFunctie<{ ok: boolean }>('trucksupply', {
    actie: 'mail-bestelling',
    bestellingId: bestelling.id,
    naar: adres,
    bericht: bericht.trim(),
  })

  return put('bestellingen', db.bestellingen, {
    ...bestelling,
    doorgestuurdNaar: adres,
    doorgestuurdAt: Date.now(),
  })
}

/* ------------------------------------------------------------------ *
 *  Pakbon en verzendlabel
 * ------------------------------------------------------------------ */

const AFZENDER = 'Trucksupply'

function datumTekst(ms?: number): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function aantalTekst(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

/**
 * De pakbon als platte tekst, voor de mail en als terugval voor de print.
 *
 * Platte tekst met opzet: de mail bevat wat mensen hebben ingetikt (namen,
 * opmerkingen) en dat hoort niet als HTML naar buiten te gaan.
 */
export function pakbonTekst(bestelling: Bestelling, regels: Bestelregel[], locatie?: Location): string {
  const r: string[] = []
  r.push(`PAKBON ${bestelling.nummer}`)
  r.push(`Afzender: ${AFZENDER}`)
  r.push(`Datum: ${datumTekst(bestelling.verzondenAt ?? bestelling.bevestigdAt ?? bestelling.aangemaaktAt)}`)
  r.push('')
  r.push('Bestemming:')
  r.push(`  ${locatie?.name ?? 'Vestiging ' + bestelling.locationId}`)
  if (locatie?.address) r.push(`  ${locatie.address}`)
  if (locatie?.postcode || locatie?.city) r.push(`  ${[locatie?.postcode, locatie?.city].filter(Boolean).join(' ')}`)
  if (locatie?.phone) r.push(`  ${locatie.phone}`)
  r.push('')
  r.push('Inhoud:')
  const mijn = regels.filter((x) => x.bestellingId === bestelling.id)
  for (const regel of mijn) {
    const aantal = regel.geleverd ?? regel.aantal
    r.push(`  ${aantalTekst(aantal)} ${regel.eenheid}  ${regel.itemNaam}`)
  }
  if (!mijn.length) r.push('  (geen regels)')
  if (bestelling.opmerking) {
    r.push('')
    r.push(`Opmerking: ${bestelling.opmerking}`)
  }
  if (bestelling.vervoerder || bestelling.trackTrace) {
    r.push('')
    r.push(`Vervoerder: ${bestelling.vervoerder ?? '-'}`)
    if (bestelling.trackTrace) r.push(`Track & trace: ${bestelling.trackTrace}`)
  }
  return r.join('\n')
}

/** Wat er op het printvel komt: de pakbon en het verzendlabel, als gegevens. */
export interface Printvel {
  nummer: string
  datum: string
  afzender: string
  ontvanger: {
    naam: string
    adres?: string
    postcode?: string
    plaats?: string
    telefoon?: string
  }
  regels: { aantal: number; eenheid: string; naam: string; sku?: string }[]
  opmerking?: string
  vervoerder?: string
  trackTrace?: string
  /** Het label: kort, groot, en met het nummer dat op de doos komt. */
  label: { van: string; naar: string; regel2: string; nummer: string }
}

export function printvel(
  bestelling: Bestelling,
  regels: Bestelregel[],
  locatie?: Location,
  items: InventoryItem[] = [],
): Printvel {
  const naam = locatie?.name ?? 'Vestiging ' + bestelling.locationId
  return {
    nummer: bestelling.nummer,
    datum: datumTekst(bestelling.verzondenAt ?? bestelling.bevestigdAt ?? bestelling.aangemaaktAt),
    afzender: AFZENDER,
    ontvanger: {
      naam,
      adres: locatie?.address,
      postcode: locatie?.postcode,
      plaats: locatie?.city,
      telefoon: locatie?.phone,
    },
    regels: regels
      .filter((x) => x.bestellingId === bestelling.id)
      .map((x) => ({
        aantal: x.geleverd ?? x.aantal,
        eenheid: x.eenheid,
        naam: x.itemNaam,
        sku: items.find((i) => i.id === x.itemId)?.sku,
      })),
    opmerking: bestelling.opmerking,
    vervoerder: bestelling.vervoerder,
    trackTrace: bestelling.trackTrace,
    label: {
      van: AFZENDER,
      naar: naam,
      regel2: [locatie?.address, [locatie?.postcode, locatie?.city].filter(Boolean).join(' ')]
        .filter(Boolean).join(', '),
      nummer: bestelling.nummer,
    },
  }
}

/* ================================================================== *
 *  Instellingen
 * ================================================================== */

export interface TrucksupplyInstellingen {
  mail: string
  /** Het uur (Europe/Amsterdam) waarop de ochtendmail vertrekt */
  ochtendUur: number
  exactDivision: string
}

/** Wat er staat, met de terugval die de serverfunctie ook hanteert. */
export async function trucksupplyInstellingen(): Promise<TrucksupplyInstellingen> {
  const uur = Number(await leesInstelling(SLEUTELS.trucksupplyOchtendUur, '8'))
  return {
    mail: await leesInstelling(SLEUTELS.trucksupplyMail, 'casper@truckwash1group.nl'),
    ochtendUur: Number.isInteger(uur) && uur >= 0 && uur <= 23 ? uur : 8,
    exactDivision: await leesInstelling(SLEUTELS.exactDivision, ''),
  }
}

/** Een testmail naar het ingestelde adres, om te zien of de keten werkt. */
export async function testMail(): Promise<void> {
  await roepFunctie<{ ok: boolean }>('trucksupply', { actie: 'test-mail' })
}

/* ================================================================== *
 *  Exact
 *
 *  Alleen de koppeling zelf: verbinden, kijken of hij er nog is, en
 *  losmaken. De tokens staan in exact_koppeling, waar alleen de server bij
 *  kan; de app ziet hoogstens of er verbinding is en tot wanneer.
 * ================================================================== */

export interface ExactStatus {
  verbonden: boolean
  division?: string
  verlooptAt?: number
  laatsteFout?: string
}

export async function exactStatus(): Promise<ExactStatus> {
  const uit = await roepFunctie<ExactStatus & { ok?: boolean }>('exact', { actie: 'status' })
  return {
    verbonden: !!uit.verbonden,
    division: uit.division || undefined,
    verlooptAt: uit.verlooptAt || undefined,
    laatsteFout: uit.laatsteFout || undefined,
  }
}

/** De URL waar de gebruiker Exact toestemming geeft; open hem in een nieuw venster. */
export async function exactVerbindUrl(): Promise<string> {
  const uit = await roepFunctie<{ url?: string }>('exact', { actie: 'verbind-url' })
  if (!uit.url) throw new Error('De server gaf geen adres terug om mee te verbinden.')
  return uit.url
}

export async function exactLos(): Promise<void> {
  await roepFunctie<{ ok: boolean }>('exact', { actie: 'los' })
}
