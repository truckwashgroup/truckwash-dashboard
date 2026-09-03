/**
 * Trucksupply -- de mails over de voorraad, en de pakbon.
 *
 * De database maakt een alarm zodra een artikel onder zijn minimum zakt
 * (0048, trigger op inventory_items). Een alarm in een tabel is alleen iets
 * waard als iemand het te zien krijgt, en de leverancier zit niet de hele dag
 * in het dashboard. Dus mailen we. Twee keer, met een andere reden:
 *
 *   direct    elk kwartier: alles wat sinds de vorige keer is ontstaan en nog
 *             niet gemaild is. Eén mail per ronde, per vestiging gegroepeerd.
 *   ochtend   één keer per dag, om het uur uit de instelling: alles wat nog
 *             open staat en waar niemand naar gekeken heeft. De directe mail
 *             van gisteren is dan al onder de stapel verdwenen.
 *
 * Wie hem wekt is een GitHub-workflow (.github/workflows/voorraad.yml), met
 * een geheim dat hier vergeleken wordt. De functie staat zonder inlogcontrole
 * (functions:open, --no-verify-jwt), want een cron heeft geen inlog; daarom
 * controleert ze zelf, per actie:
 *
 *   direct / ochtend / test   het geheim VOORRAAD_CRON_SECRET
 *   test-mail                 een ingelogde gebruiker die de instellingen mag (supply.settings)
 *   mail-bestelling           een ingelogde gebruiker die bestellingen mag
 *
 * Uitrollen:  npm run functions:open
 * NOOIT kaal deployen: zonder --no-verify-jwt weigert Supabase de wekker.
 *
 * Nodig op de server:
 *   VOORRAAD_CRON_SECRET  zelf kiezen; hetzelfde in GitHub (Settings > Secrets)
 *                         en hier: supabase secrets set VOORRAAD_CRON_SECRET=...
 *   RESEND_API_KEY        staat er al (stuur-mail, trucky)
 *   MAIL_FROM             staat er al; zie de uitleg in trucky/index.ts
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  zet Supabase zelf klaar
 *
 * Alles wat gemaild wordt is platte tekst. Er gaat invoer van gebruikers in
 * (een opmerking, een bericht bij de pakbon) en tekst kan niets uitvoeren.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET = Deno.env.get('VOORRAAD_CRON_SECRET') ?? ''
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'

/** Waar de mails over gaan. Vast, zodat een filter in de mailbox erop kan. */
const ONDERWERP_KOP = '[Voorraad]'
const TIJDZONE = 'Europe/Amsterdam'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/* ------------------------------------------------------------------ *
 *  Tijd, in Nederland
 *
 *  De server staat in UTC en de wekker ook. Wat "acht uur 's ochtends" is
 *  hangt af van zomer- en wintertijd, en dat rekent Intl voor ons uit --
 *  zelf een uur optellen gaat twee keer per jaar mis.
 * ------------------------------------------------------------------ */

function uurNL(ms = Date.now()): number {
  const uur = new Intl.DateTimeFormat('nl-NL', {
    timeZone: TIJDZONE, hour: 'numeric', hourCycle: 'h23',
  }).format(new Date(ms))
  return parseInt(uur, 10)
}

/** De datum als jjjj-mm-dd, Nederlandse tijd. Om "vandaag" mee te vergelijken. */
function datumNL(ms = Date.now()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIJDZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))
}

function tijdstipNL(ms: number): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: TIJDZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms))
}

/* ------------------------------------------------------------------ *
 *  Instellingen en de mail
 * ------------------------------------------------------------------ */

async function instelling(sleutel: string, standaard: string): Promise<string> {
  const { data } = await admin
    .from('instellingen').select('waarde').eq('sleutel', sleutel).maybeSingle()
  const waarde = String(data?.waarde ?? '').trim()
  return waarde || standaard
}

function geldigAdres(a: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(a.trim())
}

/**
 * Naar wie de alarmen gaan. Meerdere adressen mag, met een komma. Staat er
 * niets bruikbaars, dan het adres van Casper -- een alarm dat nergens
 * heen kan is erger dan een alarm op het verkeerde adres.
 */
async function ontvangers(): Promise<string[]> {
  const ruw = await instelling('trucksupply_mail', '')
  const adressen = ruw.split(',').map((a) => a.trim()).filter(geldigAdres)
  return adressen.length ? adressen : ['casper@truckwash1group.nl']
}

async function mail(naar: string[], onderwerp: string, tekst: string) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY ontbreekt op de server')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: AFZENDER, to: naar, subject: onderwerp, text: tekst }),
  })
  if (!res.ok) throw new Error(`mail ${res.status}: ${await res.text()}`)
}

/* ------------------------------------------------------------------ *
 *  De alarmen
 * ------------------------------------------------------------------ */

interface Alarm {
  id: string
  item_id: string | null
  item_naam: string
  location_id: string | null
  stand: number
  minimum: number
  ontstaan_at: number
  gezien_at: number | null
  gemaild_at: number | null
  ochtend_gemaild_at: number | null
}

interface Vestiging { id: string; name: string; city: string | null }

async function vestigingen(): Promise<Map<string, Vestiging>> {
  const { data } = await admin.from('locations').select('id, name, city')
  return new Map(((data ?? []) as Vestiging[]).map((v) => [v.id, v]))
}

/** De open alarmen, oudste eerst. Het filter erbovenop kiest de aanleiding. */
async function openAlarmen(filter: (q: any) => any): Promise<Alarm[]> {
  let q = admin.from('voorraad_alarmen')
    .select('id, item_id, item_naam, location_id, stand, minimum, ontstaan_at, gezien_at, gemaild_at, ochtend_gemaild_at')
    .is('opgelost_at', null)
    .order('ontstaan_at', { ascending: true })
  q = filter(q)
  const { data, error } = await q
  if (error) throw new Error(`alarmen lezen: ${error.message}`)
  return (data ?? []) as Alarm[]
}

/**
 * Per vestiging een kopje, daaronder de artikelen. De vestigingsnaam en niet
 * het id: wie dit leest pakt er dozen bij.
 */
function perVestiging(alarmen: Alarm[], namen: Map<string, Vestiging>): string {
  const groepen = new Map<string, Alarm[]>()
  for (const a of alarmen) {
    const sleutel = a.location_id ?? ''
    if (!groepen.has(sleutel)) groepen.set(sleutel, [])
    groepen.get(sleutel)!.push(a)
  }

  const naamVan = (id: string) => {
    if (!id) return 'Zonder vestiging'
    const v = namen.get(id)
    return v ? (v.city && v.city !== v.name ? `${v.name} (${v.city})` : v.name) : id
  }

  return [...groepen.entries()]
    .sort(([a], [b]) => naamVan(a).localeCompare(naamVan(b), 'nl'))
    .map(([loc, lijst]) =>
      `${naamVan(loc)}\n${'-'.repeat(naamVan(loc).length)}\n` +
      lijst.map((a) =>
        `  ${a.item_naam || a.item_id || '?'}: ${a.stand} (minimum ${a.minimum}), ` +
        `sinds ${tijdstipNL(Number(a.ontstaan_at))}`).join('\n'))
    .join('\n\n')
}

async function markeer(ids: string[], kolom: 'gemaild_at' | 'ochtend_gemaild_at') {
  if (!ids.length) return
  const nu = Date.now()
  const { error } = await admin.from('voorraad_alarmen')
    .update({ [kolom]: nu, updated_at: nu }).in('id', ids)
  if (error) throw new Error(`${kolom} zetten: ${error.message}`)
}

/* ------------------------------------------------------------------ *
 *  Wie belt hier
 *
 *  Voor de acties die een mens vraagt. Het token gaat naar de auth-dienst,
 *  en dan kijken we in het dossier wat die persoon mag. Rollen ziet de
 *  database niet -- die staan in permissions.ts -- dus hier staat hetzelfde
 *  rijtje als mag_leverancier() in 0048: trucksupply, management, of het
 *  losse recht supply.orders.
 *
 *  Een kleinigheid die bewust zo is: een management-account met het recht in
 *  revokes wordt hier geweigerd, terwijl mag_leverancier() in SQL het
 *  management onvoorwaardelijk doorlaat (heeft_recht kijkt alleen naar
 *  grants). De functie is dus iets strenger dan de database; dat kan geen
 *  kwaad, want strenger lekt niets, en wie het recht bewust intrekt bij een
 *  beheerder bedoelt dat ook zo.
 * ------------------------------------------------------------------ */

interface Beller {
  id: string
  naam: string
  magBestellingen: boolean
  /* De instellingen (mailadres, uur): dezelfde groep als de exact-functie
     en de policy op public.instellingen in 0048, zodat de knop 'Proefmail'
     die de app op supply.settings toont hier niet alsnog een 403 krijgt. */
  magInstellingen: boolean
  isBeheer: boolean
}

async function wieBelt(req: Request): Promise<Beller | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token === (Deno.env.get('SUPABASE_ANON_KEY') ?? '')) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, roles, active, grants, revokes')
    .eq('auth_id', data.user.id)
    .maybeSingle()
  if (!profiel?.active) return null

  const rollen = (profiel.roles ?? []) as string[]
  const toegekend = (profiel.grants ?? []) as string[]
  const ingetrokken = (profiel.revokes ?? []) as string[]
  const isBeheer = rollen.includes('trucksupply') || rollen.includes('management')

  return {
    id: profiel.id as string,
    naam: (profiel.name ?? '') as string,
    isBeheer,
    magBestellingen: !ingetrokken.includes('supply.orders')
      && (isBeheer || toegekend.includes('supply.orders')),
    magInstellingen: !ingetrokken.includes('supply.settings')
      && (isBeheer || toegekend.includes('supply.settings')),
  }
}

/* ------------------------------------------------------------------ *
 *  De acties
 * ------------------------------------------------------------------ */

/** Elk kwartier: wat er nieuw is. */
async function direct(): Promise<Response> {
  const alarmen = await openAlarmen((q) => q.is('gemaild_at', null))
  if (!alarmen.length) return json({ ok: true, verstuurd: 0 })

  const namen = await vestigingen()
  const naar = await ontvangers()
  const n = alarmen.length
  await mail(naar,
    `${ONDERWERP_KOP} ${n} ${n === 1 ? 'artikel' : 'artikelen'} onder het minimum`,
    `Er ${n === 1 ? 'is' : 'zijn'} ${n} ${n === 1 ? 'artikel' : 'artikelen'} onder het ` +
    `minimum gezakt.\n\n${perVestiging(alarmen, namen)}\n\n` +
    `Bestellen en afhandelen doe je in het dashboard, bij Voorraad.\n\n` +
    `--\nTruckwash 1 Group, automatisch bericht`)

  /*
   * Pas na de mail markeren. Andersom -- markeren en dan mailen -- verliest
   * bij een haperende mailserver een alarm voorgoed: gemarkeerd, nooit
   * verzonden, en de volgende ronde kijkt er niet meer naar. Nu kan hij bij
   * een fout hoogstens twee keer komen, en dat is de goede kant om op te
   * vallen.
   */
  await markeer(alarmen.map((a) => a.id), 'gemaild_at')
  return json({ ok: true, verstuurd: n, naar })
}

/** Eén keer per dag, om het ingestelde uur: alles waar niemand naar keek. */
async function ochtend(): Promise<Response> {
  const uur = parseInt(await instelling('trucksupply_ochtend_uur', '8'), 10)
  const nu = uurNL()
  if (nu !== uur) {
    return json({ ok: true, overgeslagen: `het is ${nu} uur in Nederland; de ochtendmail gaat om ${uur} uur` })
  }

  /*
   * De wekker loopt om 6 en 7 uur UTC, omdat 8 uur Nederlandse tijd de ene
   * helft van het jaar het ene en de andere helft het andere is. De uurcheck
   * hierboven laat er maar één door -- maar iemand kan de workflow ook met de
   * hand starten, en dan mag er alsnog niet een tweede mail uit.
   */
  const { data: laatste } = await admin.from('voorraad_alarmen')
    .select('ochtend_gemaild_at').not('ochtend_gemaild_at', 'is', null)
    .order('ochtend_gemaild_at', { ascending: false }).limit(1).maybeSingle()
  const laatsteAt = Number(laatste?.ochtend_gemaild_at ?? 0)
  if (laatsteAt && datumNL(laatsteAt) === datumNL()) {
    return json({ ok: true, overgeslagen: 'de ochtendmail van vandaag is al verstuurd' })
  }

  const alarmen = await openAlarmen((q) => q.is('gezien_at', null))
  if (!alarmen.length) return json({ ok: true, verstuurd: 0 })

  const namen = await vestigingen()
  const naar = await ontvangers()
  const n = alarmen.length
  await mail(naar,
    `${ONDERWERP_KOP} Ochtendoverzicht: ${n} open ${n === 1 ? 'alarm' : 'alarmen'}`,
    `Goedemorgen,\n\nDit staat open en is nog door niemand gezien:\n\n` +
    `${perVestiging(alarmen, namen)}\n\n` +
    `Open het dashboard bij Voorraad om ze af te handelen; wat je daar ` +
    `aanvinkt als gezien komt morgen niet terug.\n\n` +
    `--\nTruckwash 1 Group, automatisch bericht`)

  await markeer(alarmen.map((a) => a.id), 'ochtend_gemaild_at')
  return json({ ok: true, verstuurd: n, naar })
}

/**
 * Proefdraaien zonder te mailen. Voor de workflow: dan zie je of het geheim
 * klopt en wat er verstuurd zóu worden, zonder dat er een mail uitgaat.
 */
async function test(): Promise<Response> {
  const alles = await openAlarmen((q) => q)
  return json({
    ok: true,
    open: alles.length,
    nogNietGemaild: alles.filter((a) => !a.gemaild_at).length,
    nogNietGezien: alles.filter((a) => !a.gezien_at).length,
    uurNu: uurNL(),
    ochtendUur: parseInt(await instelling('trucksupply_ochtend_uur', '8'), 10),
    naar: await ontvangers(),
    mailIngesteld: Boolean(RESEND_KEY),
  })
}

/** Een mens drukt op "stuur een testmail": is het adres goed, komt hij aan. */
async function testMail(beller: Beller): Promise<Response> {
  const naar = await ontvangers()
  const alles = await openAlarmen((q) => q)
  await mail(naar, `${ONDERWERP_KOP} Testmail`,
    `Dit is een testmail uit het dashboard, gestuurd door ${beller.naam || 'iemand'}.\n\n` +
    `Er staan op dit moment ${alles.length} alarmen open. Komt deze mail aan, ` +
    `dan komen de voorraadalarmen ook aan.\n\n--\nTruckwash 1 Group`)
  return json({ ok: true, naar })
}

/* ------------------------------------------------------------------ *
 *  De pakbon
 * ------------------------------------------------------------------ */

interface Bestelling {
  id: string; nummer: string | null; location_id: string | null; status: string
  bron: string; aangemaakt_at: number; opmerking: string | null
  vervoerder: string | null; track_trace: string | null
}
interface Regel { item_naam: string; aantal: number; eenheid: string; prijs: number | null }
interface Adres { name: string; address: string | null; postcode: string | null; city: string | null; phone: string | null }

function pakbonTekst(b: Bestelling, regels: Regel[], v: Adres | null, van: string, bericht: string): string {
  const kop = `PAKBON ${b.nummer ?? b.id}`
  const adres = v
    ? [v.name, v.address, `${v.postcode ?? ''} ${v.city ?? ''}`.trim(), v.phone ? `Tel ${v.phone}` : '']
        .filter(Boolean).join('\n')
    : '(geen vestiging)'
  const lijst = regels.length
    ? regels.map((r) =>
        `  ${String(r.aantal).padStart(6)} ${(r.eenheid || 'stuk').padEnd(8)} ${r.item_naam}` +
        (r.prijs != null ? `  (à ${Number(r.prijs).toFixed(2)})` : '')).join('\n')
    : '  (geen regels)'

  return [
    kop, '='.repeat(kop.length), '',
    bericht ? `${bericht}\n` : '',
    `Leveren aan:\n${adres}`, '',
    `Status:     ${b.status}`,
    `Aangemaakt: ${tijdstipNL(Number(b.aangemaakt_at))}`,
    b.vervoerder ? `Vervoerder: ${b.vervoerder}` : '',
    b.track_trace ? `Track & trace: ${b.track_trace}` : '',
    '', 'Artikelen:', lijst, '',
    b.opmerking ? `Opmerking bij de bestelling:\n${b.opmerking}\n` : '',
    `Doorgestuurd door ${van || 'Trucksupply'} vanuit het Truckwash1-dashboard.`,
  ].filter((r) => r !== null && r !== undefined).join('\n').replace(/\n{3,}/g, '\n\n')
}

async function mailBestelling(beller: Beller, body: Record<string, unknown>): Promise<Response> {
  const bestellingId = String(body.bestellingId ?? '').trim()
  const naar = String(body.naar ?? '').trim()
  const bericht = String(body.bericht ?? '').trim().slice(0, 2000)

  if (!bestellingId) return json({ ok: false, reden: 'Geen bestelling opgegeven.' }, 400)
  if (!geldigAdres(naar)) return json({ ok: false, reden: 'Dat lijkt geen e-mailadres.' }, 400)

  const { data: b } = await admin.from('bestellingen')
    .select('id, nummer, location_id, status, bron, aangemaakt_at, opmerking, vervoerder, track_trace')
    .eq('id', bestellingId).maybeSingle()
  if (!b) return json({ ok: false, reden: 'Die bestelling bestaat niet.' }, 404)

  const { data: regels } = await admin.from('bestelregels')
    .select('item_naam, aantal, eenheid, prijs').eq('bestelling_id', bestellingId)
    .order('item_naam', { ascending: true })

  let vestiging: Adres | null = null
  if (b.location_id) {
    const { data: v } = await admin.from('locations')
      .select('name, address, postcode, city, phone').eq('id', b.location_id).maybeSingle()
    vestiging = (v ?? null) as Adres | null
  }

  const tekst = pakbonTekst(b as Bestelling, (regels ?? []) as Regel[], vestiging, beller.naam, bericht)
  await mail([naar], `Pakbon ${b.nummer ?? b.id} - Truckwash1 ${vestiging?.name ?? ''}`.trim(), tekst)

  /* Na de mail, net als bij de alarmen: wat niet verzonden is, staat ook
     niet als doorgestuurd. */
  const nu = Date.now()
  const { error } = await admin.from('bestellingen')
    .update({ doorgestuurd_naar: naar, doorgestuurd_at: nu, updated_at: nu })
    .eq('id', bestellingId)
  if (error) console.error('[trucksupply] doorgestuurd noteren', error.message)

  return json({ ok: true, naar })
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST.' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }

  const actie = String(body.actie ?? '')

  try {
    /* --- de wekker --- */
    if (actie === 'direct' || actie === 'ochtend' || actie === 'test') {
      if (!CRON_SECRET) {
        return json({ ok: false, reden: 'VOORRAAD_CRON_SECRET staat niet op de server.' }, 500)
      }
      if (String(body.geheim ?? '') !== CRON_SECRET) {
        return json({ ok: false, reden: 'Verkeerd geheim.' }, 403)
      }
      if (actie === 'direct') return await direct()
      if (actie === 'ochtend') return await ochtend()
      return await test()
    }

    /* --- een mens --- */
    const beller = await wieBelt(req)
    if (!beller) return json({ ok: false, reden: 'Niet ingelogd.' }, 401)

    if (actie === 'test-mail') {
      if (!beller.magInstellingen) return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)
      return await testMail(beller)
    }

    if (actie === 'mail-bestelling') {
      if (!beller.magBestellingen) return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)
      return await mailBestelling(beller, body)
    }

    return json({ ok: false, reden: 'Onbekende actie.' }, 400)
  } catch (e) {
    console.error(`[trucksupply] ${actie}`, e)
    return json({ ok: false, reden: String((e as Error).message ?? e) }, 502)
  }
})
