/* ===========================================================================
 *  Een factuur laten voorlezen -- op verzoek van een mens
 *
 *  Er komen bonnen binnen als PDF en als foto, en iemand tikt daar de
 *  leverancier, het bedrag en het btw-percentage van over. Dat is werk dat
 *  niemand leuk vindt en waar precies daarom fouten in sluipen: een 6 die
 *  een 5 wordt, een bedrag inclusief in het veld exclusief.
 *
 *  Het lezen zelf staat in ../_gedeeld/factuurlezer.ts, want de post doet het
 *  tegenwoordig ook uit zichzelf zodra er een factuur binnenkomt. Wat hier
 *  overblijft is de deur: wie mag dit vragen.
 *
 *  Die deur is er niet voor niets. Zonder controle kan iedereen die het adres
 *  van deze functie kent er willekeurige bestanden doorheen halen, en dan is
 *  dit een gratis taalmodel voor de hele wereld.
 *
 *  Wat er uit komt is een lezing, geen boeking. Die gaat in een eigen veld
 *  (gelezen) en niet in de velden die een mens invult -- anders kun je
 *  achteraf niet meer zien wie wat heeft ingevuld, en bij een goedgekeurde
 *  kostenpost is dat precies de vraag die je een jaar later stelt.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { leesFactuur } from '../_gedeeld/factuurlezer.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/*
 * Kopregels waarmee een browser deze functie mag aanroepen.
 *
 * Zonder dit bestaat de functie wel en is hij onbereikbaar zodra de app in
 * een browser draait op een eigen adres: de browser stuurt eerst een
 * vooraf-vraag (OPTIONS), krijgt geen toestemming terug, en doet het echte
 * verzoek niet eens. Je ziet dan een knop die niets doet.
 *
 * Allow-Origin op * kan hier: wie deze functie aanroept moet nog steeds een
 * geldig token meesturen, en dat token geeft de browser niet zomaar weg.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
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
    .select('id, name, roles, active, grants, revokes')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active) return null

  const rollen = (profiel.roles ?? []) as string[]
  const toegekend = (profiel.grants ?? []) as string[]
  const ingetrokken = (profiel.revokes ?? []) as string[]

  const mag = !ingetrokken.includes('expenses.read')
    && (rollen.includes('management')
      || rollen.includes('administratie')
      || toegekend.includes('expenses.read'))

  return { id: profiel.id as string, naam: (profiel.name ?? '') as string, mag }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)
  if (!beller.mag) return json({ error: 'Geen rechten' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const expenseId = String(body.expenseId ?? '')
  if (!expenseId) return json({ error: 'Geen kostenpost opgegeven' }, 400)

  const pad = typeof body.pad === 'string' ? body.pad : undefined

  const uit = await leesFactuur({
    admin,
    expenseId,
    pad,
    doorWie: beller.naam || 'onbekend',
  })

  if (!uit.ok) return json({ ok: false, reden: uit.reden })

  /*
   * Stond deze bon klaar voor de lokale lezer (0049: lees_status wacht,
   * bezig of mislukt), dan is dat nu voorbij: een mens heeft hem laten lezen.
   * Zonder dit blijft de badge "wacht op de lokale lezer" staan en pakt de pc
   * hem later alsnog, over de lezing van nu heen. Apart van het bewaren in
   * leesFactuur, zodat een database zonder 0049 hier alleen een logregel
   * oplevert en geen mislukte lezing.
   */
  const { error: overdrachtFout } = await admin
    .from('expenses')
    .update({ lees_status: null, lees_geclaimd_at: null, lezer: 'claude' })
    .eq('id', expenseId)
  if (overdrachtFout) {
    console.warn(`[factuur-lezen] ${expenseId} uit de wachtrij van de lokale lezer halen: ${overdrachtFout.message} (is 0049 al gedraaid?)`)
  }

  console.log(`[factuur-lezen] ${beller.naam} las ${uit.lezing?.bestand} bij ${expenseId}`)
  return json({ ok: true, lezing: uit.lezing, bewaard: uit.bewaard })
})
