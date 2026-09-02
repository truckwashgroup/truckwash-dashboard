/* ===========================================================================
 *  Een kassa-apparaat definitief wissen
 *
 *  Het weghalen van een inlogaccount vraagt de servicesleutel, en die hoort
 *  niet in een app die op laptops en telefoons staat. Vandaar hier.
 *
 *  Wat deze functie NIET doet, en met opzet: een apparaat blokkeren,
 *  vrijgeven of intrekken. Dat zijn gewone wijzigingen op pos_devices en die
 *  gaan langs de gewone weg, met de gewone beveiligingsregels. Een functie
 *  met de servicesleutel gebruik je voor het ene ding dat niet anders kan,
 *  niet voor alles wat er in de buurt ligt.
 *
 *  De volgorde is hier het belangrijkste. Intrekken is een opdracht: de kassa
 *  ziet hem, stuurt eerst zijn wachtrij leeg, wist zichzelf en zet dan pas
 *  wiped_at. Zolang dat leeg is kan er omzet op het apparaat staan die nooit
 *  binnenkomt als je het account nu weghaalt. Dus dat weigeren we.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

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
    .select('id, name, roles, active, grants')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active) return null
  return {
    id: profiel.id as string,
    naam: (profiel.name ?? '') as string,
    rollen: (profiel.roles ?? []) as string[],
    rechten: (profiel.grants ?? []) as string[],
  }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)

  const mag = beller.rollen.includes('management') || beller.rechten.includes('pos.manage')
  if (!mag) return json({ error: 'Geen rechten' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  if (String(body.actie ?? '') !== 'wissen') {
    return json({ error: 'Onbekende actie' }, 400)
  }

  const deviceId = String(body.deviceId ?? '')
  if (!deviceId) return json({ error: 'Geen apparaat opgegeven' }, 400)

  const { data: apparaat } = await admin
    .from('pos_devices')
    .select('id, name, status, wiped_at, auth_user_id, profile_id, register_id')
    .eq('id', deviceId)
    .maybeSingle()

  if (!apparaat) return json({ error: 'Apparaat niet gevonden' }, 404)

  if (apparaat.status !== 'ingetrokken') {
    return json({
      ok: false,
      reden: 'Dit apparaat is nog niet ingetrokken. Gooi het er eerst uit; ' +
             'dan maakt het zijn wachtrij leeg en wist het zichzelf.',
    })
  }

  /*
   * De hele reden dat deze controle er is. Zonder wiped_at heeft het apparaat
   * zich niet afgemeld, en dan kan er omzet op staan die nog niet is
   * verstuurd. Het account nu weghalen betekent dat die omzet nooit meer
   * binnenkomt -- en dat merk je pas bij de maandafsluiting.
   */
  if (!apparaat.wiped_at) {
    return json({
      ok: false,
      reden: 'Dit apparaat heeft zich nog niet afgemeld. Er kan omzet op ' +
             'staan die nog niet is verstuurd; wacht tot het zich meldt.',
    })
  }

  /* ---- het inlogaccount ---- */

  if (apparaat.auth_user_id) {
    const { error } = await admin.auth.admin.deleteUser(String(apparaat.auth_user_id))
    if (error) console.warn('[kassa-apparaat] inlogaccount weghalen: ' + error.message)
  }

  /* ---- het dossier ---- */

  if (apparaat.profile_id) {
    const { error } = await admin.from('profiles').delete().eq('id', apparaat.profile_id)
    if (error) {
      // Hangt er nog iets aan, dan blijft het dossier staan maar wel dicht.
      console.warn('[kassa-apparaat] dossier weghalen: ' + error.message)
      await admin.from('profiles')
        .update({ active: false })
        .eq('id', apparaat.profile_id)
    }
  }

  /* ---- de regel zelf ---- */

  const { error: weg } = await admin.from('pos_devices').delete().eq('id', apparaat.id)
  if (weg) return json({ ok: false, reden: `Weghalen mislukte: ${weg.message}` })

  console.log(`[kassa-apparaat] ${beller.naam} wiste ${apparaat.name || apparaat.id}`)
  return json({ ok: true })
})
