/* ===========================================================================
 *  Hoe ver is het van hier naar daar
 *
 *  Over de weg, niet hemelsbreed. Dat verschil is voor Nederland al gauw
 *  twintig tot dertig procent, en bij een kilometervergoeding is dat geen
 *  getal dat je aan de Belastingdienst wilt laten zien.
 *
 *  Waarom dit op de server staat en niet in de app:
 *
 *   1. De sleutel van de routedienst. Die staat in een app op telefoons voor
 *      iedereen open, en dan draait er straks iemand anders op jouw tegoed.
 *
 *   2. Het is de enige plek waar een afstand vandaan mag komen. Zou de app
 *      hem mogen wegschrijven, dan vult iedereen zijn eigen kilometers in en
 *      is de hele berekening een formaliteit.
 *
 *  De uitkomst wordt onthouden. Woon-werk is elke dag dezelfde route; die
 *  hoeft niet elke dag opnieuw te worden opgevraagd.
 *
 *  De dienst is verwisselbaar. Nu OpenRouteService -- gratis tot tweeduizend
 *  opvragingen per dag, dezelfde OpenStreetMap-gegevens waar de gewone
 *  routeplanners op draaien. Wil je later Google, dan is dat een andere
 *  sleutel en één functie hieronder.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ORS_KEY = Deno.env.get('ORS_API_KEY') ?? ''

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

/** Adressen vergelijkbaar maken, zodat het geheugen ook raak is bij een spatie meer. */
function sleutelVan(van: string, naar: string): string {
  const schoon = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-')
  return `rc_${schoon(van)}__${schoon(naar)}`.slice(0, 200)
}

/* ------------------------------------------------------------------ *
 *  OpenRouteService
 * ------------------------------------------------------------------ */

interface Punt { lon: number; lat: number; naam: string }

async function zoekAdres(adres: string): Promise<Punt | null> {
  const url = new URL('https://api.openrouteservice.org/geocode/search')
  url.searchParams.set('api_key', ORS_KEY)
  url.searchParams.set('text', adres)
  url.searchParams.set('boundary.country', 'NL')
  url.searchParams.set('size', '1')

  const res = await fetch(url)
  if (!res.ok) {
    console.warn(`[route] adres zoeken gaf ${res.status}: ${await res.text()}`)
    return null
  }
  const body = await res.json()
  const eerste = body?.features?.[0]
  if (!eerste?.geometry?.coordinates) return null

  return {
    lon: Number(eerste.geometry.coordinates[0]),
    lat: Number(eerste.geometry.coordinates[1]),
    naam: String(eerste.properties?.label ?? adres),
  }
}

async function rijafstand(a: Punt, b: Punt): Promise<{ km: number; minuten: number } | null> {
  const res = await fetch(
    'https://api.openrouteservice.org/v2/directions/driving-car',
    {
      method: 'POST',
      headers: {
        Authorization: ORS_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }),
    },
  )
  if (!res.ok) {
    console.warn(`[route] route berekenen gaf ${res.status}: ${await res.text()}`)
    return null
  }
  const body = await res.json()
  const samenvatting = body?.routes?.[0]?.summary
  if (!samenvatting) return null

  return {
    km: Math.round((Number(samenvatting.distance) / 1000) * 10) / 10,
    minuten: Math.round(Number(samenvatting.duration) / 60),
  }
}

/* ------------------------------------------------------------------ *
 *  Wie belt er?
 * ------------------------------------------------------------------ */

async function wieBelt(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, roles, active')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active) return null
  return { id: profiel.id as string, rollen: (profiel.roles ?? []) as string[] }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const van = String(body.van ?? '').trim().slice(0, 200)
  const naar = String(body.naar ?? '').trim().slice(0, 200)
  if (!van || !naar) return json({ error: 'Geef een begin- en eindadres' }, 400)

  const sleutel = sleutelVan(van, naar)

  /* ---- staat hij al in het geheugen? ---- */

  const { data: bekend } = await admin
    .from('route_cache')
    .select('km, minuten, van, naar')
    .eq('id', sleutel)
    .maybeSingle()

  if (bekend) {
    return json({
      ok: true,
      km: Number(bekend.km),
      minuten: bekend.minuten,
      van: bekend.van,
      naar: bekend.naar,
      uitGeheugen: true,
    })
  }

  if (!ORS_KEY) {
    return json({
      ok: false,
      reden: 'De routedienst is nog niet ingesteld. Zet ORS_API_KEY als ' +
             'geheim bij de functies; een sleutel haal je gratis bij ' +
             'openrouteservice.org.',
    })
  }

  /* ---- opzoeken ---- */

  try {
    const a = await zoekAdres(van)
    if (!a) return json({ ok: false, reden: `Dit adres is niet gevonden: ${van}` })

    const b = await zoekAdres(naar)
    if (!b) return json({ ok: false, reden: `Dit adres is niet gevonden: ${naar}` })

    const afstand = await rijafstand(a, b)
    if (!afstand) {
      return json({ ok: false, reden: 'Er is geen route gevonden tussen deze twee adressen.' })
    }

    await admin.from('route_cache').insert({
      id: sleutel,
      van: a.naam,
      naar: b.naam,
      km: afstand.km,
      minuten: afstand.minuten,
      dienst: 'ors',
      at: nu(),
    })

    return json({
      ok: true,
      km: afstand.km,
      minuten: afstand.minuten,
      van: a.naam,
      naar: b.naam,
      uitGeheugen: false,
    })
  } catch (e) {
    console.error('[route] ' + String(e))
    return json({ ok: false, reden: 'De routedienst gaf geen antwoord.' })
  }
})
