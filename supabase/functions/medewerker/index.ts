/* ===========================================================================
 *  Een medewerker uitnodigen, uitschrijven of wissen
 *
 *  Waarom dit op de server staat: alle drie hebben de servicesleutel nodig.
 *  Een inlogaccount aanmaken of weghalen kan niet vanuit een app die op
 *  telefoons staat, en dat hoort ook niet.
 *
 *  Waarom uitnodigen bestaat: zonder uitnodiging moest iemand zich zelf
 *  aanmelden. Dat doet hij dan met zijn privé-adres, en dan staan er twee
 *  dossiers van dezelfde man -- de koppeling kijkt op e-mailadres en ziet
 *  twee verschillende mensen. Het kantoor maakt het dossier; wij sturen de
 *  uitnodiging; hij hoeft zich nergens aan te melden.
 *
 *  De mail komt van ons, via Resend, met onze opmaak. Supabase stuurt zelf
 *  niets: het account wordt aangemaakt met email_confirm, dus er gaat geen
 *  bevestigingsmail van Supabase uit.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'Truckwash1 Group <dashboard@preview.truckwash.cloud>'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const nu = () => Date.now()

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
 *  Een tijdelijk wachtwoord
 *
 *  Zonder i, l, 1, O en 0: die worden verkeerd overgetypt van een scherm of
 *  uit een mail, en dan belt iemand omdat het niet werkt.
 * ------------------------------------------------------------------ */

function tijdelijkWachtwoord(): string {
  const alfabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes, (b) => alfabet[b % alfabet.length]).join('')
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
  return {
    id: profiel.id as string,
    naam: (profiel.name ?? '') as string,
    rollen: (profiel.roles ?? []) as string[],
  }
}

/* ------------------------------------------------------------------ *
 *  De uitnodiging
 * ------------------------------------------------------------------ */

function ontsnap(t: string) {
  return t.replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] ?? c))
}

function briefUitnodiging(input: {
  naam: string
  email: string
  wachtwoord: string
  door: string
  rollen: string[]
}) {
  const rolTekst: Record<string, string> = {
    employee: 'medewerker',
    supervisor: 'leidinggevende',
    technician: 'technische dienst',
    management: 'management',
    customer: 'klant',
    employer: 'werkgever',
    developer: 'ontwikkelaar',
  }
  const rollen = input.rollen.map((r) => rolTekst[r] ?? r).join(' en ') || 'medewerker'

  return {
    onderwerp: 'Je account voor het Truckwash1 dashboard staat klaar',
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#1a1d23">
  <div style="font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px">Truckwash1 Group</div>
  <div style="height:3px;width:52px;background:#f8c010;border-radius:2px;margin-bottom:22px"></div>

  <p style="font-size:15px;line-height:1.65;margin:0 0 14px">Hoi ${ontsnap(input.naam)},</p>

  <p style="font-size:15px;line-height:1.65;margin:0 0 14px">
    ${ontsnap(input.door)} heeft een account voor je klaargezet in het
    dashboard van Truckwash1. Daarin vind je je rooster, je uren en je eigen
    dossier. Je komt binnen als <strong>${ontsnap(rollen)}</strong>.
  </p>

  <div style="border:1px solid #e6e8ec;border-radius:10px;padding:16px;margin:20px 0;background:#fafbfc">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Inloggegevens</div>
    <div style="font-size:14px;line-height:1.9">
      <div>E-mailadres: <strong>${ontsnap(input.email)}</strong></div>
      <div>Wachtwoord: <strong style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;letter-spacing:.05em">${ontsnap(input.wachtwoord)}</strong></div>
    </div>
  </div>

  <p style="font-size:14px;line-height:1.65;margin:0 0 14px;color:#4b5563">
    Dit wachtwoord werkt één keer. Bij je eerste inlog kies je meteen je
    eigen — dat moet ook, want een wachtwoord dat per mail is verstuurd staat
    in je postvak, in het onze, en op elke server ertussenin.
  </p>

  <p style="font-size:14px;line-height:1.65;margin:0 0 6px;color:#4b5563">
    De eerste keer krijg je een korte rondleiding door de app. Die duurt twee
    minuten en je mag hem overslaan.
  </p>

  <p style="font-size:13px;line-height:1.6;color:#9099a6;margin:26px 0 0;border-top:1px solid #eceef1;padding-top:16px">
    Verwacht je dit niet? Laat het dan weten aan het kantoor en gebruik deze
    gegevens niet.
  </p>
</div>`.trim(),
  }
}

async function verstuurMail(naar: string, onderwerp: string, html: string, wie: string) {
  if (!RESEND_KEY) {
    console.error('[medewerker] RESEND_API_KEY ontbreekt; er gaat geen post uit.')
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [naar], subject: onderwerp, html }),
    })
    const gelukt = res.ok
    if (!gelukt) console.error(`[medewerker] Resend gaf ${res.status}: ${await res.text()}`)

    await admin.from('email_log').insert({
      id: 'em_' + crypto.randomUUID().replace(/-/g, ''),
      template: 'uitnodiging',
      to_email: naar,
      to_user_id: wie,
      subject: onderwerp,
      status: gelukt ? 'verstuurd' : 'mislukt',
      at: nu(),
    })
    return gelukt
  } catch (e) {
    console.error('[medewerker] versturen mislukte: ' + String(e))
    return false
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
  if (!beller.rollen.includes('management')) return json({ error: 'Geen rechten' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const actie = String(body.actie ?? '')
  const dossierId = String(body.userId ?? '')
  if (!dossierId) return json({ error: 'Geen dossier opgegeven' }, 400)

  const { data: dossier } = await admin
    .from('profiles')
    .select('id, auth_id, email, name, roles, active, personnel_number, archived_at')
    .eq('id', dossierId)
    .maybeSingle()

  if (!dossier) return json({ error: 'Dossier niet gevonden' }, 404)

  /* --------------------------- uitnodigen ------------------------- */

  if (actie === 'uitnodigen') {
    if (!dossier.email) {
      return json({ ok: false, reden: 'Bij dit dossier staat geen e-mailadres.' })
    }
    if (dossier.auth_id) {
      return json({
        ok: false,
        reden: 'Deze persoon heeft al een inlogaccount. Een tweede zou een ' +
               'tweede dossier opleveren, en dat is precies wat we willen voorkomen.',
      })
    }

    /*
     * Bestaat er al een inlogaccount op dit adres zonder dat het aan dit
     * dossier hangt? Dan koppelen we dat in plaats van er een tweede te
     * maken. Dat is hoe de dubbele mensen ontstonden.
     */
    const { data: bestaande } = await admin.auth.admin.listUsers()
    const alBekend = bestaande?.users?.find(
      (u) => (u.email ?? '').toLowerCase() === String(dossier.email).toLowerCase())

    if (alBekend) {
      await admin.from('profiles').update({ auth_id: alBekend.id }).eq('id', dossier.id)
      return json({
        ok: true,
        soort: 'gekoppeld',
        reden: 'Er bestond al een inlogaccount op dit adres. Dat is nu aan ' +
               'dit dossier gekoppeld; er is geen nieuw account gemaakt en ' +
               'geen mail verstuurd.',
      })
    }

    const wachtwoord = tijdelijkWachtwoord()
    const { data: nieuw, error: authFout } = await admin.auth.admin.createUser({
      email: String(dossier.email),
      password: wachtwoord,
      // Zelf bevestigen: dan stuurt Supabase geen eigen mail, en die ziet er
      // uit als iets van Supabase in plaats van iets van ons.
      email_confirm: true,
      user_metadata: { name: dossier.name },
    })

    if (authFout || !nieuw?.user) {
      return json({ ok: false, reden: authFout?.message ?? 'Account aanmaken lukte niet.' })
    }

    /*
     * De trigger op auth.users koppelt hem aan dit dossier, want het adres
     * komt overeen en er hing nog geen account aan. Voor de zekerheid nog
     * eens expliciet, plus het vinkje dat hij zijn wachtwoord moet wijzigen.
     */
    await admin.from('profiles').update({
      auth_id: nieuw.user.id,
      must_change_password: true,
      active: true,
    }).eq('id', dossier.id)

    // De aanmelding die de trigger heeft neergelegd hoort hier niet: deze
    // persoon meldt zich niet aan, hij wordt uitgenodigd.
    await admin.from('signups').delete().eq('auth_id', nieuw.user.id)

    const brief = briefUitnodiging({
      naam: String(dossier.name ?? ''),
      email: String(dossier.email),
      wachtwoord,
      door: beller.naam,
      rollen: (dossier.roles ?? []) as string[],
    })
    const verstuurd = await verstuurMail(
      String(dossier.email), brief.onderwerp, brief.html, dossier.id)

    return json({ ok: true, soort: 'nieuw account', mailVerstuurd: verstuurd })
  }

  /* -------------------------- uitschrijven ------------------------ */

  if (actie === 'uitschrijven' || actie === 'terugzetten') {
    const uit = actie === 'uitschrijven'

    await admin.from('profiles').update({
      active: !uit,
      archived_at: uit ? nu() : null,
      archived_by: uit ? beller.id : null,
      archive_reason: uit ? String(body.reden ?? '').slice(0, 400) : null,
    }).eq('id', dossier.id)

    /*
     * Het inlogaccount blijft bestaan maar komt er niet meer in: de app
     * weigert een dossier dat niet actief is. Weghalen zou betekenen dat
     * terugzetten niet meer kan, en een vergissing hoort terug te draaien.
     */
    return json({ ok: true, soort: uit ? 'uitgeschreven' : 'teruggezet' })
  }

  /* ----------------------------- wissen --------------------------- */

  if (actie === 'wissen') {
    const reden = String(body.reden ?? '').trim()
    if (reden.length < 5) {
      return json({ ok: false, reden: 'Geef een reden op; die blijft staan nadat de persoon weg is.' })
    }
    if (dossier.id === beller.id) {
      return json({ ok: false, reden: 'Jezelf wissen gaat niet.' })
    }

    // Eerst de regel die blijft, dan pas weghalen -- andersom en het
    // misgaan halverwege laat niets achter.
    await admin.from('deletion_log').insert({
      id: 'dl_' + crypto.randomUUID().replace(/-/g, ''),
      soort: 'medewerker',
      naam: String(dossier.name ?? ''),
      kenmerk: dossier.personnel_number ?? null,
      reden,
      door: beller.id,
      door_naam: beller.naam,
      at: nu(),
    })

    if (dossier.auth_id) {
      const { error } = await admin.auth.admin.deleteUser(String(dossier.auth_id))
      if (error) console.warn('[medewerker] inlogaccount weghalen: ' + error.message)
    }

    const { error: weg } = await admin.from('profiles').delete().eq('id', dossier.id)
    if (weg) return json({ ok: false, reden: `Weghalen mislukte: ${weg.message}` })

    console.log(`[medewerker] ${beller.naam} wiste ${dossier.name}: ${reden}`)
    return json({ ok: true, soort: 'gewist' })
  }

  return json({ error: `Onbekende actie: ${actie}` }, 400)
})
