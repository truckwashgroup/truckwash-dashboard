/**
 * Exact -- de koppeling met Exact Online, en voorlopig alleen de koppeling.
 *
 * Exact werkt met OAuth: je stuurt iemand naar Exact, die logt daar in en
 * geeft toestemming, en Exact stuurt hem terug met een code die je inwisselt
 * voor tokens. Die tokens zijn de sleutel tot de boekhouding. Ze horen dus
 * niet in de app en niet in een tabel die de app synchroniseert, maar op
 * één plek waar alleen de server bij kan: exact_koppeling (0048), RLS aan,
 * geen enkele policy, alleen de servicesleutel.
 *
 * Deze functie doet vier dingen en niets meer:
 *
 *   verbind-url   een link naar Exact maken, met een state die we onthouden
 *   terug         Exact komt terug met code en state: eerst de state, dan pas iets schrijven
 *   status        is er een koppeling, welke administratie, tot wanneer
 *   los           de tokens wissen
 *
 * Geen artikelen, geen facturen, geen synchronisatie. Dat komt later, als
 * eerst duidelijk is dat de koppeling zelf staat en blijft staan.
 *
 * Uitrollen:  npm run functions:open
 * NOOIT kaal deployen: de terugkeer van Exact is een gewone GET uit een
 * browser zonder token, en die weigert Supabase zodra verify_jwt aan staat.
 *
 * Nodig op de server:
 *   EXACT_CLIENT_ID / EXACT_CLIENT_SECRET   uit het Exact App Center
 *   EXACT_REDIRECT_URI   optioneel; standaard <SUPABASE_URL>/functions/v1/exact
 *                        Moet letterlijk overeenkomen met wat bij Exact staat.
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  zet Supabase zelf klaar
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CLIENT_ID = Deno.env.get('EXACT_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('EXACT_CLIENT_SECRET') ?? ''
const REDIRECT_URI = Deno.env.get('EXACT_REDIRECT_URI') ?? `${SUPABASE_URL}/functions/v1/exact`

const EXACT = 'https://start.exactonline.nl'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/*
 * De pagina die Exact na de terugkeer laat zien.
 *
 * Statische tekst, met opzet: er komt niets uit de URL of uit Exact in
 * terecht. Een foutmelding van Exact in een pagina plakken is een pagina
 * waar iemand anders de tekst van bepaalt.
 */
function pagina(titel: string, tekst: string, status = 200) {
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>${titel}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e5e7eb;
display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem}
p{color:#9ca3af;line-height:1.5}</style></head>
<body><main><h1>${titel}</h1><p>${tekst}</p></main></body></html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/* ------------------------------------------------------------------ *
 *  De ene rij
 * ------------------------------------------------------------------ */

interface Koppeling {
  id: string
  division: string | null
  access_token: string | null
  refresh_token: string | null
  token_verloopt_at: number | null
  status: string
  verbonden_door: string | null
  verbonden_at: number | null
  laatste_fout: string | null
  state: string | null
  state_at: number | null
}

/* Hoe lang een uitgegeven state geldig blijft. Inloggen bij Exact duurt een
   minuut; een kwartier is ruim, en daarna is een verlaten poging geen deur meer. */
const STATE_GELDIG_MS = 15 * 60 * 1000

async function koppeling(): Promise<Koppeling | null> {
  const { data, error } = await admin.from('exact_koppeling').select('*').eq('id', 'exact').maybeSingle()
  if (error) throw new Error(`exact_koppeling lezen: ${error.message}`)
  return (data ?? null) as Koppeling | null
}

async function bewaar(velden: Partial<Koppeling>) {
  const { error } = await admin.from('exact_koppeling')
    .upsert({ id: 'exact', ...velden, updated_at: Date.now() }, { onConflict: 'id' })
  if (error) throw new Error(`exact_koppeling schrijven: ${error.message}`)
}

/* ------------------------------------------------------------------ *
 *  Wie belt hier
 *
 *  Voor de POST-acties. Rollen kent de database niet (permissions.ts), dus
 *  hier het rijtje dat bij supply.settings hoort: trucksupply heeft dat
 *  recht standaard, management altijd, en verder wie het los kreeg.
 * ------------------------------------------------------------------ */

async function wieBelt(req: Request): Promise<{ id: string; naam: string } | null> {
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

  const mag = !ingetrokken.includes('supply.settings')
    && (rollen.includes('trucksupply') || rollen.includes('management')
      || toegekend.includes('supply.settings'))

  return mag ? { id: profiel.id as string, naam: (profiel.name ?? '') as string } : null
}

/* ------------------------------------------------------------------ *
 *  Exact komt terug
 * ------------------------------------------------------------------ */

interface TokenAntwoord {
  access_token?: string
  refresh_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

async function terug(url: URL): Promise<Response> {
  const code = url.searchParams.get('code') ?? ''
  const state = url.searchParams.get('state') ?? ''
  const fout = url.searchParams.get('error') ?? ''

  /*
   * Dit is een open GET: geen token, geen login, iedereen die de URL kent
   * kan hem sturen. Daarom wordt hier pas iets in exact_koppeling geschreven
   * als de state klopt. Een eerdere versie ruimde bij een mismatch de state
   * op en zette de fout uit de URL in laatste_fout; daarmee kon een vreemde
   * met één verzoek een lopende koppelpoging van Casper laten mislukken, en
   * eigen tekst in het dashboard zetten. Bij een mismatch nu: alleen de
   * pagina, verder niets.
   *
   * De state is het bewijs dat deze terugkeer hoort bij een link die wíj
   * hebben uitgegeven. Zonder die controle kan iemand een code van zijn eigen
   * Exact-account hier naar binnen sturen, en dan boekt Truckwash straks in
   * de administratie van een vreemde.
   */
  const huidig = await koppeling()
  const verlopen = !huidig?.state_at || Date.now() - huidig.state_at > STATE_GELDIG_MS
  if (!state || !huidig?.state || state !== huidig.state || verlopen) {
    return pagina('Niet gekoppeld',
      'Deze koppelpoging is niet herkend of verlopen. Begin opnieuw vanuit het dashboard, bij Instellingen.', 400)
  }

  if (fout || !code) {
    /* De state klopt, dus dit is echt Exact: iemand heeft daar op "weigeren"
       gedrukt, of Exact kwam zonder code terug. Nu mag de poging dicht. */
    await bewaar({ state: null, state_at: null, laatste_fout: fout ? `Exact: ${fout.slice(0, 200)}` : 'Teruggekomen zonder code' })
    return pagina('Niet gekoppeld',
      'Exact heeft de koppeling niet toegestaan. Je kunt dit venster sluiten en het in het dashboard opnieuw proberen.')
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    await bewaar({ state: null, state_at: null, laatste_fout: 'EXACT_CLIENT_ID of EXACT_CLIENT_SECRET ontbreekt op de server' })
    return pagina('Niet gekoppeld', 'De server mist de Exact-sleutels. Zet EXACT_CLIENT_ID en EXACT_CLIENT_SECRET.', 500)
  }

  const res = await fetch(`${EXACT}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })

  let antwoord: TokenAntwoord = {}
  try { antwoord = await res.json() as TokenAntwoord } catch { /* geen json: hieronder afgevangen */ }

  if (!res.ok || !antwoord.access_token || !antwoord.refresh_token) {
    const reden = `token ${res.status}: ${antwoord.error ?? 'geen tokens in het antwoord'}`
    console.error('[exact] inwisselen', reden, antwoord.error_description ?? '')
    await bewaar({ state: null, state_at: null, laatste_fout: reden.slice(0, 300) })
    return pagina('Niet gekoppeld',
      'Het inwisselen van de code bij Exact is mislukt. Probeer het vanuit het dashboard opnieuw.', 502)
  }

  /*
   * Welke administratie. Een instelling gaat voor; staat die leeg, dan wat
   * Exact zelf als huidige administratie van dit account opgeeft. Lukt dat
   * niet, dan is de koppeling er nog steeds -- alleen zonder division, en
   * dat staat dan zichtbaar in het dashboard.
   */
  let division: string | null = null
  try {
    const { data } = await admin.from('instellingen').select('waarde').eq('sleutel', 'exact_division').maybeSingle()
    division = String(data?.waarde ?? '').trim() || null
    if (!division) {
      const me = await fetch(`${EXACT}/api/v1/current/Me?$select=CurrentDivision`, {
        headers: { Authorization: `Bearer ${antwoord.access_token}`, Accept: 'application/json' },
      })
      if (me.ok) {
        const uit = await me.json() as { d?: { results?: Array<{ CurrentDivision?: number }> } }
        const cd = uit.d?.results?.[0]?.CurrentDivision
        if (cd != null) division = String(cd)
      }
    }
  } catch (e) {
    console.error('[exact] division ophalen', e)
  }

  /* Exact geeft de looptijd in seconden (doorgaans 600). */
  const seconden = Number(antwoord.expires_in ?? 600) || 600
  await bewaar({
    division,
    access_token: antwoord.access_token,
    refresh_token: antwoord.refresh_token,
    token_verloopt_at: Date.now() + seconden * 1000,
    status: 'verbonden',
    verbonden_at: Date.now(),
    laatste_fout: null,
    state: null,
    state_at: null,
  })

  return pagina('Gekoppeld', 'Exact Online is gekoppeld. Je kunt dit venster sluiten.')
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)

  /* --- de redirect van Exact: een browser, geen token --- */
  if (req.method === 'GET') {
    const actie = url.searchParams.get('actie') ?? ''
    if (actie === 'terug' || url.searchParams.has('code') || url.searchParams.has('error')) {
      try {
        return await terug(url)
      } catch (e) {
        console.error('[exact] terug', e)
        return pagina('Niet gekoppeld', 'Er ging iets mis bij het opslaan van de koppeling. Probeer het opnieuw.', 500)
      }
    }
    return pagina('Exact-koppeling', 'Deze pagina is alleen bedoeld voor de terugkeer vanuit Exact Online.', 404)
  }

  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen GET of POST.' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }
  const actie = String(body.actie ?? '')

  try {
    if (actie === 'status') {
      const k = await koppeling()
      return json({
        ok: true,
        verbonden: Boolean(k?.refresh_token) && k?.status === 'verbonden',
        division: k?.division ?? null,
        verlooptAt: k?.token_verloopt_at ?? null,
        verbondenAt: k?.verbonden_at ?? null,
        verbondenDoor: k?.verbonden_door ?? null,
        laatsteFout: k?.laatste_fout ?? null,
        ingesteld: Boolean(CLIENT_ID && CLIENT_SECRET),
      })
    }

    if (actie === 'verbind-url') {
      if (!CLIENT_ID) {
        return json({ ok: false, reden: 'EXACT_CLIENT_ID staat niet op de server.' }, 500)
      }
      /* Een nieuwe state per poging; de vorige vervalt daarmee. */
      const state = crypto.randomUUID()
      await bewaar({ state, state_at: Date.now(), verbonden_door: beller.naam || beller.id, laatste_fout: null })

      const link = new URL(`${EXACT}/api/oauth2/auth`)
      link.searchParams.set('client_id', CLIENT_ID)
      link.searchParams.set('redirect_uri', REDIRECT_URI)
      link.searchParams.set('response_type', 'code')
      link.searchParams.set('state', state)
      /* Altijd opnieuw inloggen bij Exact: dit is de boekhouding, en de
         browser van een kantoormedewerker staat de hele dag open. */
      link.searchParams.set('force_login', '1')
      return json({ ok: true, url: link.toString() })
    }

    if (actie === 'los') {
      await bewaar({
        access_token: null,
        refresh_token: null,
        token_verloopt_at: null,
        status: 'los',
        state: null,
        state_at: null,
        laatste_fout: null,
      })
      return json({ ok: true })
    }

    return json({ ok: false, reden: 'Onbekende actie.' }, 400)
  } catch (e) {
    console.error(`[exact] ${actie}`, e)
    return json({ ok: false, reden: String((e as Error).message ?? e) }, 502)
  }
})
