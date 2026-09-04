/* ===========================================================================
 *  ontvang-mail -- de webhook waar binnenkomende post aankomt
 *
 *  Uitrollen:
 *
 *    supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...
 *    supabase functions deploy ontvang-mail --no-verify-jwt
 *
 *  Daarna bij Resend onder Webhooks het adres van deze functie invullen en
 *  het inkomende adres (bijvoorbeeld bonnen@preview.truckwash.cloud) laten
 *  afleveren op deze webhook.
 *
 *  --no-verify-jwt is hier onvermijdelijk: Resend heeft geen account bij ons
 *  en kan dus geen token meesturen. De echtheid wordt in plaats daarvan
 *  bewezen met de handtekening die Resend zelf meestuurt -- en die wordt
 *  hieronder nagerekend voordat er ook maar iets wordt opgeslagen.
 *
 *  Wat er gebeurt met een bericht dat we niet herkennen: het wordt alsnog
 *  opgeslagen, met de ruwe inhoud erbij. Post weggooien omdat het formaat
 *  net anders is dan verwacht is het ergste wat een postbus kan doen.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { controleerBijlage, lijktEchtOp } from './controle.ts'
import { leesFactuur } from '../_gedeeld/factuurlezer.ts'
import { meldManagement, verwerkLezing } from '../_gedeeld/verwerking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? ''
// Niet elke aanbieder zet de inhoud van een bijlage in de webhook zelf. Komt
// er alleen een verwijzing mee, dan halen we hem hiermee alsnog op.
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

const EMMER = 'post'
const MAX_BIJLAGE = 25 * 1024 * 1024
const MAX_TEKST = 40_000

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const nu = () => Date.now()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/* ------------------------------------------------------------------ *
 *  De handtekening
 *
 *  Resend ondertekent zijn webhooks volgens het Svix-formaat: een id, een
 *  tijdstempel en een handtekening in aparte kopregels. De handtekening is
 *  HMAC-SHA256 over "id.tijdstempel.inhoud" met een sleutel die base64 is
 *  gecodeerd achter "whsec_".
 *
 *  Zonder deze controle kan iedereen die het adres van deze functie kent
 *  bonnen in de administratie zetten.
 * ------------------------------------------------------------------ */

async function handtekeningKlopt(req: Request, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false

  const id = req.headers.get('svix-id') ?? req.headers.get('webhook-id')
  const stempel = req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp')
  const kop = req.headers.get('svix-signature') ?? req.headers.get('webhook-signature')
  if (!id || !stempel || !kop) return false

  // Een oud bericht opnieuw aanbieden mag niet werken.
  const leeftijd = Math.abs(nu() / 1000 - Number(stempel))
  if (!Number.isFinite(leeftijd) || leeftijd > 300) return false

  const geheim = WEBHOOK_SECRET.replace(/^whsec_/, '')
  const sleutel = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(geheim), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const teken = await crypto.subtle.sign(
    'HMAC', sleutel, new TextEncoder().encode(`${id}.${stempel}.${body}`))
  const verwacht = btoa(String.fromCharCode(...new Uint8Array(teken)))

  // De kopregel kan meerdere handtekeningen bevatten: "v1,xxx v1,yyy".
  return kop.split(' ')
    .map((deel) => deel.split(',')[1])
    .some((s) => s && veiligGelijk(s, verwacht))
}

/** Vergelijken zonder dat de tijd verraadt hoeveel tekens klopten. */
function veiligGelijk(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let verschil = 0
  for (let i = 0; i < a.length; i++) verschil |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return verschil === 0
}

/* ------------------------------------------------------------------ *
 *  Uitpakken
 *
 *  Het formaat van een inkomende webhook ligt niet in beton. Daarom kijken
 *  we op meerdere plekken naar hetzelfde veld en bewaren we altijd de ruwe
 *  inhoud, zodat een bericht dat we nu niet herkennen later alsnog te
 *  begrijpen is.
 * ------------------------------------------------------------------ */

type Willekeurig = Record<string, unknown>

function pak(bron: Willekeurig, ...paden: string[]): unknown {
  for (const pad of paden) {
    let waarde: unknown = bron
    for (const stuk of pad.split('.')) {
      if (waarde && typeof waarde === 'object' && stuk in (waarde as Willekeurig)) {
        waarde = (waarde as Willekeurig)[stuk]
      } else {
        waarde = undefined
        break
      }
    }
    if (waarde !== undefined && waarde !== null && waarde !== '') return waarde
  }
  return undefined
}

/** "Jan de Vries <jan@example.nl>" uit elkaar halen. */
function adres(ruw: unknown): { adres: string; naam?: string } {
  if (Array.isArray(ruw)) return adres(ruw[0])
  if (ruw && typeof ruw === 'object') {
    const o = ruw as Willekeurig
    return {
      adres: String(o.email ?? o.address ?? '').toLowerCase(),
      naam: o.name ? String(o.name) : undefined,
    }
  }
  const tekst = String(ruw ?? '')
  const match = tekst.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match) return { adres: match[2].trim().toLowerCase(), naam: match[1].trim() || undefined }
  return { adres: tekst.trim().toLowerCase() }
}

/** HTML naar iets leesbaars, voor als er geen platte tekst meekwam. */
function ontdoeVanHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TOEGESTAAN = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'image/gif', 'text/plain', 'text/csv', 'application/xml', 'text/xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

interface Bijlage {
  naam: string
  mime: string
  size: number
  /** Leeg als er niets is opgeslagen; dan valt er ook niets te openen. */
  path: string
  controle: string
  controleReden?: string
  controleOp: number
  scanner?: string
}

async function haalInhoud(
  a: Willekeurig,
  vanResend: Willekeurig | undefined,
  mime: string,
): Promise<{ bytes: Uint8Array | null; verslag: string[] }> {
  const verslag: string[] = []
  const verwacht = Number(a.size ?? a.content_length ?? vanResend?.size ?? 0) || undefined

  /*
   * Alle manieren proberen en de béste nemen, niet de eerste die iets
   * teruggeeft. Dat laatste was de fout: een afgekapte inhoud in de webhook
   * won het van het adres waar het hele bestand stond.
   */
  const kandidaten: { hoe: string; bytes: Uint8Array }[] = []

  // 1. Staat de inhoud er gewoon bij, als base64?
  const inhoud = a.content ?? a.data ?? a.body ?? a.base64
  if (typeof inhoud === 'string' && inhoud.length > 0) {
    try {
      const schoon = inhoud.replace(/^data:[^;]+;base64,/, '')
      kandidaten.push({
        hoe: 'inhoud uit de webhook',
        bytes: Uint8Array.from(atob(schoon), (c) => c.charCodeAt(0)),
      })
    } catch (e) {
      verslag.push('inhoud uit de webhook was geen geldige base64: ' + String(e))
    }
  }

  // 2. Een adres in de webhook zelf, of het adres dat Resend teruggaf.
  const adres = pak(a, 'url', 'download_url', 'content_url', 'href', 'link')
    ?? (vanResend ? pak(vanResend, 'download_url', 'url') : undefined)

  if (typeof adres === 'string' && /^https:\/\//.test(adres)) {
    // Een voorondertekend adres wil de sleutel meestal niet; lukt het zonder
    // niet, dan alsnog met.
    const uit = (await haalVan(adres)) ?? (await haalVan(adres, RESEND_KEY))
    if (uit) kandidaten.push({ hoe: 'opgehaald van het adres', bytes: uit })
    else verslag.push('het adres gaf niets bruikbaars terug')
  } else {
    verslag.push('er stond geen adres bij om het bestand op te halen')
  }

  /* ---- kiezen ---- */

  for (const k of kandidaten) {
    const mis = lijktEchtOp(k.bytes, mime, verwacht)
    if (!mis) {
      console.log(`[ontvang-mail] ${k.hoe}: ${k.bytes.byteLength} bytes, ziet er goed uit`)
      return { bytes: k.bytes, verslag }
    }
    verslag.push(`${k.hoe}: ${mis}`)
    console.warn(`[ontvang-mail] ${k.hoe} afgekeurd -- ${mis}`)
  }

  /*
   * Niets kwam er goed doorheen. Als er wél iets binnenkwam nemen we het
   * grootste alsnog, want een half bestand met een waarschuwing erbij is
   * beter dan niets -- maar het verslag gaat mee, zodat het scherm kan
   * vertellen wat er mis is in plaats van alleen dat het niet lukt.
   */
  const grootste = kandidaten.sort((x, y) => y.bytes.byteLength - x.bytes.byteLength)[0]
  return { bytes: grootste?.bytes ?? null, verslag }
}

/**
 * De bijlagen bij een binnengekomen mail opvragen bij Resend.
 *
 * Dit moest erbij nadat bleek dat de webhook alleen namen en soorten
 * meestuurt en niet de inhoud. Dat is op zich verstandig van Resend -- een
 * factuur van acht megabyte door een webhook duwen gaat een keer mis -- maar
 * het betekent wel dat er een tweede stap is die je moet zetten.
 *
 *   GET https://api.resend.com/emails/receiving/{id}/attachments
 *
 * Daar komt per bijlage een download_url uit die een uur geldig is. Lang
 * genoeg; wij halen hem meteen op en zetten hem in onze eigen emmer.
 */
async function haalBijlagenLijst(emailId: string | null): Promise<Willekeurig[]> {
  if (!RESEND_KEY || !emailId) return []
  try {
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${emailId}/attachments?limit=100`,
      { headers: { Authorization: `Bearer ${RESEND_KEY}` } },
    )
    if (!res.ok) {
      console.warn(
        `[ontvang-mail] bijlagenlijst opvragen gaf ${res.status}: ${await res.text()}`)

      /*
       * 401 hier betekent bijna altijd hetzelfde: de sleutel mag wel mail
       * versturen maar geen inkomende post lezen. Dat is een aparte
       * instelling bij Resend, en omdat het versturen gewoon blijft werken
       * merk je het nergens anders aan. Eén regel in het logboek scheelt
       * een middag zoeken.
       */
      if (res.status === 401 || res.status === 403) {
        console.error(
          '[ontvang-mail] RESEND_API_KEY mag geen inkomende post lezen. Maak in ' +
          'Resend een sleutel met volledige toegang en zet die als geheim; een ' +
          'sleutel met alleen verzendrechten levert bijlagen op die half of ' +
          'niet aankomen.')
      }
      return []
    }
    const body = await res.json()
    const lijst = Array.isArray(body?.data) ? body.data : []
    console.log(`[ontvang-mail] Resend kent ${lijst.length} bijlage(n) bij ${emailId}`)
    return lijst
  } catch (e) {
    console.warn('[ontvang-mail] bijlagenlijst opvragen mislukte: ' + String(e))
    return []
  }
}

/**
 * De regel uit de lijst die bij deze bijlage hoort.
 *
 * Hier stond een terugval op de volgorde: "die is bij één mail gelijk". Dat is
 * niet waar, en het kostte een factuur.
 *
 * In de lijst van Resend staan namelijk óók de inline afbeeldingen -- het logo
 * in de handtekening, de plaatjes uit de opmaak -- met content_disposition
 * "inline". Die staan er meestal vóór de echte bijlage. Bij een mail met een
 * logo en een factuur pakte de terugval op volgorde dus het logo, en dat werd
 * onder de naam van de factuur opgeslagen. Een PDF van 197 kB werd zo een
 * plaatje van 3 kB, met daarna in het scherm alleen "deze PDF is niet te
 * openen".
 *
 * Nu wordt er alleen gekoppeld als het écht past. Past het niet, dan is er
 * niets -- en dan zegt de bijlage waarom, in plaats van dat er stilletjes iets
 * verkeerds op de plek van de factuur belandt.
 */
function zoekBijResend(
  a: Willekeurig,
  lijst: Willekeurig[],
  index: number,
): Willekeurig | undefined {
  const naam = String(a.filename ?? a.name ?? '').toLowerCase()
  const contentId = String(a.content_id ?? a.contentId ?? '').replace(/^<|>$/g, '')

  // 1. Op content-id: dat is de enige echt harde koppeling.
  if (contentId) {
    const opId = lijst.find(
      (r) => String(r.content_id ?? '').replace(/^<|>$/g, '') === contentId)
    if (opId) return opId
  }

  // 2. Op bestandsnaam.
  if (naam) {
    const opNaam = lijst.find((r) => String(r.filename ?? '').toLowerCase() === naam)
    if (opNaam) return opNaam
  }

  /*
   * 3. Geen van beide. Dan alleen koppelen als er redelijkerwijs maar één
   *    kandidaat is: een echte bijlage, geen inline plaatje. Zijn het er
   *    meer, dan is gokken erger dan opgeven -- bij gokken krijg je het
   *    verkeerde bestand zonder dat iemand het merkt.
   */
  const echteBijlagen = lijst.filter(
    (r) => String(r.content_disposition ?? 'attachment') !== 'inline')

  if (echteBijlagen.length === 1) return echteBijlagen[0]

  console.warn(
    `[ontvang-mail] bijlage ${index + 1} (${naam || 'zonder naam'}) is niet te ` +
    `koppelen aan de lijst van Resend: ${lijst.length} regel(s), waarvan ` +
    `${echteBijlagen.length} echte bijlage(n). Op volgorde koppelen doen we ` +
    'niet meer -- daarmee werd het logo uit de handtekening opgeslagen als factuur.')
  return undefined
}

async function haalVan(url: string, sleutel?: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: sleutel ? { Authorization: `Bearer ${sleutel}` } : {},
    })
    if (!res.ok) {
      console.warn(`[ontvang-mail] ophalen ${url} gaf ${res.status}`)
      return null
    }
    return new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    console.warn(`[ontvang-mail] ophalen ${url} mislukte: ` + String(e))
    return null
  }
}

/**
 * De ruwe payload, zonder de blobs.
 *
 * Elke tekst van meer dan vijfhonderd tekens wordt vervangen door hoeveel
 * het er waren. Wat overblijft is de vorm van het bericht -- welke velden
 * er zijn en wat erin staat -- en dat is precies wat je wilt zien als een
 * bijlage niet aankomt.
 */
function kortePayload(ruw: string): string {
  let uit = ruw
  try {
    uit = JSON.stringify(
      JSON.parse(ruw),
      (_sleutel, waarde) =>
        typeof waarde === 'string' && waarde.length > 500
          ? `[… ${waarde.length} tekens weggelaten …]`
          : waarde,
      2,
    )
  } catch {
    /* geen geldige JSON: dan maar zoals het binnenkwam */
  }
  return uit.length > 12_000 ? uit.slice(0, 12_000) + '\n… (ingekort)' : uit
}

function veiligeNaam(naam: string): string {
  return naam
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 120) || 'bijlage'
}

/* ------------------------------------------------------------------ *
 *  Bij welke vestiging hoort deze post?
 *
 *  Elke vestiging heeft een eigen inkoopadres:
 *
 *    inkoop.oss@preview.truckwash.cloud   ->  de vestiging met slug "oss"
 *    inkoop@preview.truckwash.cloud       ->  geen vestiging, hoofdkantoor
 *
 *  Het voorvoegsel en het domein staan in de instellingen en zijn in het
 *  ontwikkelaarsscherm aan te passen -- want het domein hierboven is een
 *  voorlopige, en een vast ingebakken domein betekent dat de hele
 *  factuurstroom stilvalt zodra dat verhuist.
 *
 *  Herkent hij het adres niet, dan komt de bon gewoon zonder vestiging
 *  binnen. Post weggooien omdat het adres net anders is dan verwacht is het
 *  ergste wat een postbus kan doen.
 * ------------------------------------------------------------------ */

async function welkeVestiging(aanAdres: string): Promise<string | null> {
  const bak = (aanAdres ?? '').trim().toLowerCase()
  if (!bak.includes('@')) return null

  const [postvak, domein] = bak.split('@')

  const { data: rijen } = await admin
    .from('instellingen')
    .select('sleutel, waarde')
    .in('sleutel', ['inkoop_domein', 'inkoop_voorvoegsel'])

  const instelling = (sleutel: string, terugval: string) =>
    String((rijen ?? []).find((r: Willekeurig) => r.sleutel === sleutel)?.waarde ?? terugval)
      .trim().toLowerCase()

  const verwachtDomein = instelling('inkoop_domein', '')
  const voorvoegsel = instelling('inkoop_voorvoegsel', 'inkoop')

  // Staat er een domein ingesteld, dan telt post van een ander domein niet
  // mee. Anders zou inkoop.oss@ergensanders.nl ook een vestiging raken.
  if (verwachtDomein && domein !== verwachtDomein) return null

  if (!postvak.startsWith(voorvoegsel + '.')) return null

  /*
   * Wat er achter het voorvoegsel staat is de slug van de website. Die is
   * bewust hergebruikt: hij is al uniek, al kleingeschreven, en al zichtbaar
   * in truckwash1group.nl/vestigingen/oss. Een tweede lijstje met adressen
   * naast dat ene zou onherroepelijk uit elkaar lopen.
   *
   * Een plusadres (inkoop.oss+scan@) telt als hetzelfde vak; sommige
   * scanners plakken daar iets achter.
   */
  const slug = postvak.slice(voorvoegsel.length + 1).split('+')[0].trim()
  if (!slug) return null

  const { data: vestiging } = await admin
    .from('locations')
    .select('id')
    .eq('website_slug', slug)
    .maybeSingle()

  if (vestiging?.id) return String(vestiging.id)

  // Geen website-slug? Dan mag de code ook -- vestigingen hebben er altijd
  // een, en die is korter in te typen.
  const { data: opCode } = await admin
    .from('locations')
    .select('id')
    .ilike('code', slug)
    .maybeSingle()

  return opCode?.id ? String(opCode.id) : null
}

/* ------------------------------------------------------------------ *
 *  De factuur zichzelf laten boeken
 *
 *  Drie stappen, en elke stap mag los mislukken zonder de rest mee te nemen.
 *  Wat er niet lukt blijft gewoon werk voor een mens -- dat was het tot nu toe
 *  toch al.
 *
 *    1. uitlezen      de factuurlezer haalt bedrag, btw en leverancier eruit
 *    2. indelen       factuur_indelen kiest grootboekrekening en tags
 *    3. wegschrijven  alles op de kostenpost, met erbij waar het vandaan komt
 *
 *  Stap 1 gebeurt hier; 2 en 3 staan in ../_gedeeld/verwerking.ts, omdat er
 *  sinds 0049 twee lezers zijn. Wie er leest is een instelling:
 *
 *    claude            Claude leest nu, hier, en de verwerking volgt meteen
 *    lokaal            de bon gaat op "wacht"; de pc van Casper komt hem via
 *                      de functie lezer halen, leest hem met Ollama en stuurt
 *                      de lezing terug. De verwerking gebeurt dan daar.
 *    lokaal-terugval   als lokaal, maar de pc mag Claude erbij roepen als hij
 *                      het niet vertrouwt
 *
 *  Wat er NIET gebeurt is goedkeuren. De bon blijft op "open" staan en komt
 *  gewoon in de rij bij de administratie. Het verschil is dat hij daar nu
 *  ingevuld ligt in plaats van leeg -- nakijken in plaats van overtikken.
 * ------------------------------------------------------------------ */

async function boekAutomatisch(
  berichtId: string,
  expenseId: string,
  pad: string,
  vanNaam: string,
  onderwerp: string,
) {
  /* Uit mag: dan blijft alles zoals het was, en dat is een werkende situatie. */
  const { data: rijen } = await admin
    .from('instellingen').select('sleutel, waarde')
    .in('sleutel', ['factuur_automatisch', 'factuur_lezer'])
  const instelling = (sleutel: string) =>
    String((rijen ?? []).find((r: Willekeurig) => r.sleutel === sleutel)?.waarde ?? '')
      .trim().toLowerCase()

  if (instelling('factuur_automatisch') === 'nee') {
    console.log('[ontvang-mail] automatisch boeken staat uit')
    return
  }

  /*
   * Leest de pc thuis? Dan hier niets lezen: alleen klaarzetten. De richting
   * is met opzet omgedraaid -- de server belt de pc niet, de pc komt het werk
   * halen -- zodat er thuis geen poort open hoeft.
   *
   * De kolom komt uit 0049. Is die migratie nog niet gedraaid, dan mislukt het
   * klaarzetten, en dan leest Claude alsnog: een bon die op niemand wacht is
   * erger dan een bon die door de verkeerde lezer is gelezen.
   */
  const lezer = instelling('factuur_lezer')
  if (lezer === 'lokaal' || lezer === 'lokaal-terugval') {
    const { error } = await admin
      .from('expenses')
      .update({ lees_status: 'wacht', lezer: null })
      .eq('id', expenseId)
    if (!error) {
      console.log(`[ontvang-mail] ${expenseId} klaargezet voor de lokale lezer (${lezer})`)
      return
    }
    console.error(
      `[ontvang-mail] ${expenseId} niet kunnen klaarzetten voor de lokale lezer ` +
      `(${error.message}); is 0049 al gedraaid? Claude leest hem nu.`)
  }

  /* --- 1. uitlezen --- */

  const uit = await leesFactuur({ admin, expenseId, pad, doorWie: 'de post' })
  if (!uit.ok || !uit.lezing) {
    console.warn('[ontvang-mail] niet gelezen: ' + (uit.reden ?? 'onbekend'))
    return
  }

  /* --- 2 en 3: indelen en wegschrijven --- */

  await verwerkLezing(admin, {
    berichtId, expenseId, lezing: uit.lezing, vanNaam, onderwerp, bron: 'claude',
  })
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const ruw = await req.text()

  if (!WEBHOOK_SECRET) {
    console.error('[ontvang-mail] RESEND_WEBHOOK_SECRET ontbreekt; post wordt geweigerd.')
    return json({ error: 'Webhook niet ingesteld' }, 500)
  }
  if (!(await handtekeningKlopt(req, ruw))) {
    return json({ error: 'Handtekening klopt niet' }, 401)
  }

  let payload: Willekeurig
  try {
    payload = JSON.parse(ruw)
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const soort = String(payload.type ?? '')
  // Alleen binnenkomende post. De rest (bezorgd, geopend, geweigerd) laten
  // we door zonder er iets mee te doen; dan blijft Resend niet opnieuw
  // aanbieden.
  if (soort && !/received|inbound/i.test(soort)) {
    return json({ ok: true, skipped: soort })
  }

  const data = (payload.data ?? payload) as Willekeurig

  const van = adres(pak(data, 'from', 'sender', 'envelope.from'))
  const aan = adres(pak(data, 'to', 'recipient', 'envelope.to'))
  const onderwerp = String(pak(data, 'subject') ?? '(geen onderwerp)').slice(0, 300)

  const platteTekst = String(pak(data, 'text', 'text_body', 'plain') ?? '')
  const html = String(pak(data, 'html', 'html_body') ?? '')
  const tekst = (platteTekst || ontdoeVanHtml(html)).slice(0, MAX_TEKST)

  const providerId = String(
    pak(data, 'email_id', 'id', 'message_id') ?? payload.id ?? '') || null

  const berichtId = 'mb_' + crypto.randomUUID().replace(/-/g, '')

  /* ---- bijlagen ---- */

  const binnen = (pak(data, 'attachments', 'attachment', 'files') ?? []) as Willekeurig[]
  const bijlagen: Bijlage[] = []

  /** Bijlagen die zijn tegengehouden, voor in het bericht. */
  const geweigerd: string[] = []

  const lijst = Array.isArray(binnen) ? binnen : []

  /*
   * Resend zet de inhoud niet in de webhook, alleen de namen. De
   * download-adressen vraag je apart op -- één keer per mail, niet per
   * bijlage.
   */
  const viaResend = lijst.length ? await haalBijlagenLijst(providerId) : []
  console.log(`[ontvang-mail] ${berichtId}: ${lijst.length} bijlage(n) in de webhook`)

  for (const [i, a] of lijst.entries()) {
    const naam = veiligeNaam(String(a.filename ?? a.name ?? a.file_name ?? `bijlage-${i + 1}`))
    const bijResend = zoekBijResend(a, viaResend, i)
    const mime = String(
      a.content_type ?? a.contentType ?? a.type ?? a.mime_type ??
      bijResend?.content_type ?? 'application/octet-stream')

    /*
     * Eén regel per bijlage in het logboek van de functie, met de velden die
     * eraan hangen -- niet de inhoud. Zonder dit weet je bij een bijlage die
     * niet aankomt niet eens of hij er wel bij zat.
     */
    console.log(
      `[ontvang-mail] bijlage ${i + 1}: ${naam} (${mime}) velden=${Object.keys(a).join(',')}`)

    /** Wat er ook misgaat: de bijlage blijft in het bericht staan, met reden. */
    const mislukt = (reden: string): void => {
      console.warn(`[ontvang-mail] bijlage ${naam}: ${reden}`)
      bijlagen.push({
        naam, mime, size: Number(a.size ?? a.content_length ?? 0), path: '',
        controle: 'mislukt', controleReden: reden, controleOp: nu(),
      })
    }

    try {
      if (!TOEGESTAAN.has(mime)) {
        mislukt(`Dit soort bestand nemen we niet aan (${mime}).`)
        continue
      }

      const { bytes, verslag } = await haalInhoud(a, bijResend, mime)
      if (!bytes) {
        mislukt(
          'Het bestand zelf is niet opgehaald. ' +
          (verslag.length
            ? 'Wat er is geprobeerd: ' + verslag.join('; ') + '.'
            : 'Resend stuurt de inhoud niet mee in de webhook; die moet apart ' +
              'worden opgevraagd, en dat lukte niet.'),
        )
        continue
      }
      if (bytes.byteLength > MAX_BIJLAGE) {
        mislukt(`Te groot om te bewaren (${Math.round(bytes.byteLength / 1024 / 1024)} MB).`)
        continue
      }

      /*
       * Controleren vóór opslaan. Wat niet door de controle komt gaat de
       * opslag niet in -- dan kan het ook niet per ongeluk geopend worden,
       * en staat er niets waar iemand later op klikt.
       */
      const uitkomst = await controleerBijlage(bytes, naam, mime)

      if (uitkomst.uitkomst === 'verdacht') {
        console.warn(`[ontvang-mail] bijlage ${naam} geweigerd: ${uitkomst.reden}`)
        geweigerd.push(`${naam} — ${uitkomst.reden}`)
        bijlagen.push({
          naam, mime, size: bytes.byteLength, path: '',
          controle: 'verdacht', controleReden: uitkomst.reden, controleOp: nu(),
          scanner: uitkomst.scanner,
        })
        continue
      }

      const pad = `${berichtId}/${i + 1}-${naam}`
      const { error } = await admin.storage.from(EMMER).upload(pad, bytes, {
        contentType: mime,
        upsert: false,
      })
      if (error) {
        mislukt(
          `Opslaan in de emmer "${EMMER}" lukte niet: ${error.message}. ` +
          'Bestaat die emmer wel? Draai supabase/setup.sql opnieuw.',
        )
        continue
      }

      bijlagen.push({
        naam,
        mime,
        size: bytes.byteLength,
        path: pad,
        controle: uitkomst.uitkomst,
        /*
         * Kwam er onderweg iets niet in orde -- een manier die te weinig bytes
         * gaf, een adres dat niets teruggaf -- dan staat dat hier, ook als er
         * uiteindelijk iets is opgeslagen. Anders zie je in het scherm een
         * bijlage die er is maar niet klopt, zonder enige aanwijzing waarom.
         */
        controleReden: verslag.length
          ? [uitkomst.reden, 'Onderweg: ' + verslag.join('; ') + '.']
              .filter(Boolean).join(' ')
          : uitkomst.reden,
        controleOp: nu(),
        scanner: uitkomst.scanner,
      })
    } catch (e) {
      mislukt('Er ging iets mis bij het verwerken: ' + String(e))
    }
  }

  /* ---- het bericht ---- */

  const { error: bericht } = await admin.from('mailbox').insert({
    id: berichtId,
    richting: 'in',
    van: van.adres || 'onbekend',
    van_naam: van.naam ?? null,
    aan: aan.adres || '',
    onderwerp,
    tekst: geweigerd.length
      ? tekst + '\n\n---\nTegengehouden bijlagen:\n' + geweigerd.map((g) => '· ' + g).join('\n')
      : tekst,
    had_html: Boolean(html),
    at: nu(),
    status: 'nieuw',
    attachments: bijlagen,
    provider_id: providerId,
    /*
     * Ingekort, maar wel eerst de blobs eruit. Zomaar de eerste 8000 tekens
     * bewaren leverde bij een mail mét bijlage precies het verkeerde op: een
     * halve base64-sliert en niet het stuk waar je naar zoekt.
     */
    raw: kortePayload(ruw),
  })

  if (bericht) {
    // Twee keer dezelfde webhook: dan staat hij er al, en dat is prima.
    if (bericht.code === '23505') return json({ ok: true, duplicate: true })
    console.error('[ontvang-mail] opslaan mislukt: ' + bericht.message)
    return json({ error: bericht.message }, 500)
  }

  /*
   * Zonder bijlage valt er niets te lezen, en dus ook niets te sorteren: dat
   * is "overig". Mét bijlage blijft het leeg tot de lezer heeft gezegd of het
   * inkoop of verkoop is -- die uitkomst komt pas na dit antwoord.
   *
   * Als losse stap na het opslaan, niet in de insert hierboven. Zolang de
   * migratie met deze kolom nog niet is gedraaid zou de insert anders in zijn
   * geheel mislukken, en dan is de mail weg. Nu mislukt hoogstens dit label.
   */
  if (bijlagen.length === 0) {
    const { error } = await admin.from('mailbox').update({ soort: 'overig' }).eq('id', berichtId)
    if (error) console.warn('[ontvang-mail] soort zetten: ' + error.message)
  }

  /* ---- een kostenpost eruit halen ---- */

  let expenseId: string | null = null

  /* ------------------------------------------------------------------ *
   *  Eén kostenpost per bijlage
   *
   *  Hier werd er één gemaakt, met de "beste" bijlage eraan: eerst een PDF,
   *  anders een foto. Bij een mail met één bon klopte dat. Bij een mail met
   *  tien facturen en drie foto's verdwenen er twaalf: ze stonden wel in de
   *  postbus, maar er hing er één aan de boekhouding en de rest zag niemand.
   *
   *  Nu krijgt elke bijlage zijn eigen bon, en wordt elke bon los gelezen,
   *  los ingedeeld en los beoordeeld. Dan is achteraf te zien wat waar
   *  vandaan komt.
   *
   *  Twee remmen, want "alles" is hier niet de bedoeling
   *  ---------------------------------------------------
   *
   *  Een logo in de handtekening is ook een bijlage. Zou die een bon worden,
   *  dan staat er bij elke mail van dezelfde leverancier een lege kostenpost
   *  van drie kilobyte in de rij. Dus: een PDF telt altijd mee, een plaatje
   *  alleen als het groot genoeg is om een gefotografeerde bon te kunnen
   *  zijn -- of als er helemaal geen PDF bij zit, want dan is dat kleine
   *  plaatje het enige wat er is.
   *
   *  En een bovengrens. Een mail met zestig bijlagen is geen boekhouding maar
   *  een archief; daar hoort iemand naar te kijken in plaats van dat er
   *  zestig bonnen in de rij verschijnen.
   * ------------------------------------------------------------------ */

  /** Kleiner dan dit is een plaatje geen bon maar een logo of een streepje. */
  const MIN_FOTO = 40 * 1024

  /** Meer dan dit uit één mail: dan is er iets anders aan de hand. */
  const MAX_BONNEN = 20

  const opgeslagen = bijlagen.filter((b) => b.path)
  const pdfs = opgeslagen.filter((b) => b.mime === 'application/pdf')
  const fotos = opgeslagen.filter((b) => b.mime.startsWith('image/'))

  const kandidaten = [
    ...pdfs,
    ...fotos.filter((b) => pdfs.length === 0 || b.size >= MIN_FOTO),
  ].slice(0, MAX_BONNEN)

  const overgeslagen = opgeslagen.length - kandidaten.length
  if (overgeslagen > 0) {
    console.log(`[ontvang-mail] ${overgeslagen} bijlage(n) overgeslagen (te klein of boven het maximum)`)
  }

  const gemaakt: string[] = []

  if (kandidaten.length > 0) {
    const vestiging = await welkeVestiging(aan.adres)
    const vanNaam = van.naam ?? van.adres

    for (const [i, bon] of kandidaten.entries()) {
      /*
       * Het volgnummer hoort in de id. Bij één bijlage blijft de id precies
       * zoals hij was, zodat een mail die opnieuw wordt aangeboden dezelfde
       * kostenpost raakt en er geen tweede verschijnt.
       */
      const id = 'exp_mail_' + berichtId.slice(3, 15) + (i === 0 ? '' : '_' + (i + 1))

      /*
       * Bij meer dan één bon de bestandsnaam erbij, anders staan er dertien
       * regels met hetzelfde onderwerp en is er niets uit elkaar te houden.
       */
      const omschrijving = kandidaten.length > 1
        ? `${onderwerp} · ${bon.naam}`.slice(0, 300)
        : onderwerp

      const { error: kosten } = await admin.from('expenses').insert({
        id,
        expense_date: nu(),
        category: 'overig',
        supplier: vanNaam,
        description: omschrijving,
        // Bewust nul: het bedrag lezen uit een PDF is gokken, en een gok in
        // de boekhouding is erger dan een leeg veld. Even later vult de lezer
        // hem in als hij het bedrag zonder twijfel op de bon zag staan.
        amount_excl: 0,
        vat_pct: 21,
        status: 'open',
        submitted_by: null,
        submitted_by_name: vanNaam,
        source: 'mail',
        mailbox_id: berichtId,
        location_id: vestiging,
        attachment_path: bon.path,
        attachment_name: bon.naam,
      })

      if (kosten) {
        console.error(`[ontvang-mail] kostenpost ${id} niet aangemaakt: ${kosten.message}`)
        continue
      }

      gemaakt.push(id)

      /*
       * En meteen laten uitlezen en indelen.
       *
       * Hier stond dit niet, en dat was precies het handwerk dat weg moest: de
       * kostenpost verscheen met bedrag 0 en bleef zo staan tot iemand in de
       * app op "laat de factuur voorlezen" drukte. Wie de app een week niet
       * opent, heeft een week lang een lege bon.
       *
       * Er wordt niet op gewacht. Resend staat aan de andere kant van deze
       * webhook te wachten op een antwoord en geeft het op voordat een PDF is
       * gelezen; dan biedt hij dezelfde mail nog eens aan. Mislukt het lezen,
       * dan blijft de kostenpost staan zoals hij nu ook zou staan en werkt de
       * knop in de app nog steeds.
       *
       * Bij tien bijlagen gaan er dus tien tegelijk weg. Dat mag: ze komen
       * allemaal in dezelfde wachtrij terecht en worden daar één voor één
       * gelezen -- de server deelt ze uit, en de machine die leest bepaalt het
       * tempo.
       */
      void boekAutomatisch(berichtId, id, bon.path, vanNaam, omschrijving)
        .catch((e) => console.error(`[ontvang-mail] automatisch boeken ${id}: ` + String(e)))
    }

    /*
     * Het bericht wijst naar de eerste. Dat veld kan er maar één bevatten en
     * bestond al voordat er meer dan één bon per mail was; alle bonnen wijzen
     * andersom wél terug naar dit bericht (mailbox_id), en daar zoekt het
     * scherm op.
     */
    if (gemaakt.length > 0) {
      expenseId = gemaakt[0]
      await admin.from('mailbox').update({ expense_id: expenseId }).eq('id', berichtId)
    }
  }

  /* ---- het management een seintje ---- */

  await meldManagement(admin, berichtId, {
    kind: gemaakt.length > 0 ? 'taak' : 'info',
    title: gemaakt.length > 1
      ? `${gemaakt.length} bonnen per mail: ${onderwerp}`
      : gemaakt.length === 1
        ? `Bon per mail: ${onderwerp}`
        : `Post ontvangen: ${onderwerp}`,
    body: `Van ${van.naam ?? van.adres}` +
          (bijlagen.length ? ` · ${bijlagen.length} bijlage(n)` : '') +
          (overgeslagen > 0 ? `, waarvan ${overgeslagen} overgeslagen (te klein voor een bon)` : ''),
    link: gemaakt.length > 0 ? 'financieel' : 'postbus',
  })

  return json({
    ok: true,
    id: berichtId,
    attachments: bijlagen.length,
    expenseId,
    bonnen: gemaakt.length,
  })
})
