/* ===========================================================================
 *  nodig-uit -- een chauffeur toegang geven namens een werkgever
 *
 *  Uitrollen:
 *
 *    supabase functions deploy nodig-uit
 *
 *  Deze mag wél de JWT-controle houden: er komt hier niemand zonder account.
 *
 *  Waarom dit een serverfunctie is en geen knop in de app: een account
 *  aanmaken vereist de servicesleutel, en die hoort niet in iets dat op
 *  telefoons staat. Hier staat hij goed, achter een controle op wie er belt.
 *
 *  Twee wegen, afhankelijk van wat er al is:
 *
 *   1. Nog geen account op dit adres. Dan maken we er een, met een tijdelijk
 *      wachtwoord dat per mail gaat en nergens wordt bewaard. Het profiel
 *      krijgt de vlag must_change_password, zodat diegene bij de eerste
 *      inlog niet verder komt dan het scherm waar hij zelf iets kiest.
 *
 *   2. Wel een account. Dan maken we niets aan en sturen we een vraag: mag
 *      dit account aan deze werkgever gekoppeld worden? Iemand ongevraagd
 *      aan een bedrijf hangen is precies wat je niet wilt -- dan kan een
 *      werkgever met het adres van een willekeurige chauffeur diens
 *      wasbeurten gaan meelezen.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'
const APP_LINK = Deno.env.get('APP_LINK') ??
  'https://github.com/truckwashgroup/truckwash-dashboard/releases/latest'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const nu = () => Date.now()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function veilig(text: unknown): string {
  return String(text ?? '')
    .slice(0, 500)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ------------------------------------------------------------------ *
 *  Het tijdelijke wachtwoord
 *
 *  Leesbaar genoeg om over te typen van een telefoonscherm, en lang genoeg
 *  om niet te raden. Geen i, l, 1, O en 0: die worden verkeerd overgetypt,
 *  en dan belt er iemand.
 * ------------------------------------------------------------------ */

const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function tijdelijkWachtwoord(lengte = 14): string {
  const bytes = new Uint8Array(lengte)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALFABET[b % ALFABET.length]).join('')
}

/* ------------------------------------------------------------------ *
 *  Post
 * ------------------------------------------------------------------ */

interface Brief {
  onderwerp: string
  kop: string
  alineas: string[]
  gegevens?: [string, string][]
  voet?: string
}

function omhulsel(b: Brief): string {
  return `<!doctype html>
<html lang="nl"><body style="margin:0;padding:0;background:#f2f4f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;
                    border:1px solid #e6e9ef;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
        <tr><td style="background:#0b1220;padding:20px 26px">
          <span style="color:#f8c010;font-size:17px;font-weight:800">TRUCKWASH1</span>
          <span style="color:#8b9ab5;font-size:13px;margin-left:8px">Dashboard</span>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#0b1220">${veilig(b.kop)}</h1>
          ${b.alineas.map((a) =>
            `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#243044">${veilig(a)}</p>`).join('')}
          ${b.gegevens?.length ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="margin:6px 0 18px;border:1px solid #e6e9ef;border-radius:10px;background:#fafbfd">
              ${b.gegevens.map(([k, v]) => `
                <tr>
                  <td style="padding:10px 14px;font-size:13px;color:#6b7891;width:38%">${veilig(k)}</td>
                  <td style="padding:10px 14px;font-size:15px;color:#0b1220;font-weight:700;
                             font-family:Consolas,Menlo,monospace">${veilig(v)}</td>
                </tr>`).join('')}
            </table>` : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
            <tr><td style="border-radius:9px;background:#f8c010">
              <a href="${veilig(APP_LINK)}"
                 style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;
                        color:#14202f;text-decoration:none">De app openen</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 26px;background:#fafbfd;border-top:1px solid #e6e9ef">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8b9ab5">
            ${veilig(b.voet ?? 'Dit bericht komt uit het Truckwash1-dashboard.')}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

async function verstuur(naar: string, brief: Brief, template: string): Promise<boolean> {
  const id = 'em_' + crypto.randomUUID().replace(/-/g, '')
  let ok = false
  let fout: string | undefined
  let providerId: string | undefined

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: AFZENDER,
        to: [naar],
        subject: brief.onderwerp,
        html: omhulsel(brief),
        text: [brief.kop, '', ...brief.alineas,
               ...(brief.gegevens ?? []).map(([k, v]) => `${k}: ${v}`)].join('\n'),
      }),
    })
    const body = await res.json().catch(() => ({}))
    ok = res.ok
    providerId = body?.id
    if (!ok) fout = String(body?.message ?? res.status).slice(0, 400)
  } catch (e) {
    fout = String(e instanceof Error ? e.message : e).slice(0, 400)
  }

  await admin.from('email_log').insert({
    id, template, to_email: naar, subject: brief.onderwerp,
    status: ok ? 'verstuurd' : 'mislukt',
    provider_id: providerId ?? null, error: fout ?? null, at: nu(),
  })

  return ok
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
    .select('id, name, email, roles, active')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active) return null
  return profiel as { id: string; name: string; email: string; roles: string[] }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)
  if (!RESEND_KEY) return json({ error: 'RESEND_API_KEY ontbreekt op de server' }, 500)

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const werkgeverId = String(body.werkgeverId ?? '')
  const email = String(body.email ?? '').trim().toLowerCase()
  const naam = String(body.naam ?? '').trim().slice(0, 120)

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return json({ error: 'Geen geldig e-mailadres' }, 400)
  }
  if (naam.length < 2) return json({ error: 'Vul de naam van de chauffeur in' }, 400)

  /* --- mag deze persoon uitnodigen namens dit bedrijf? --- */

  const { data: werkgever } = await admin
    .from('employers')
    .select('id, naam, status, beheerders')
    .eq('id', werkgeverId)
    .maybeSingle()

  if (!werkgever) return json({ error: 'Werkgever niet gevonden' }, 404)

  const isManagement = beller.roles.includes('management')
  const isBeheerder = (werkgever.beheerders ?? []).includes(beller.id)
  if (!isManagement && !isBeheerder) return json({ error: 'Geen rechten' }, 403)
  if (werkgever.status !== 'actief' && !isManagement) {
    return json({ error: 'Deze werkgever staat nog niet op actief' }, 403)
  }

  /* --- staat deze koppeling er al? --- */

  const { data: bestaandeKoppeling } = await admin
    .from('employer_links')
    .select('id, status')
    .eq('werkgever_id', werkgeverId)
    .ilike('email', email)
    .in('status', ['uitgenodigd', 'wacht op akkoord', 'actief'])
    .maybeSingle()

  if (bestaandeKoppeling) {
    return json({
      ok: false,
      reden: `Deze chauffeur staat al in de lijst (${bestaandeKoppeling.status}).`,
    })
  }

  /* --- bestaat er al een account op dit adres? --- */

  const { data: bestaandProfiel } = await admin
    .from('profiles')
    .select('id, name, email, roles, active')
    .ilike('email', email)
    .maybeSingle()

  const koppelingId = 'wgk_' + crypto.randomUUID().replace(/-/g, '')

  /* =============== 1. Er is al een account =============== */

  if (bestaandProfiel) {
    await admin.from('employer_links').insert({
      id: koppelingId,
      werkgever_id: werkgeverId,
      werkgever_naam: werkgever.naam,
      user_id: bestaandProfiel.id,
      naam: bestaandProfiel.name || naam,
      email,
      status: 'wacht op akkoord',
      uitgenodigd_op: nu(),
      uitgenodigd_door: beller.id,
      uitgenodigd_door_naam: beller.name,
      bestaand_account: true,
    })

    // Vragen, niet doen. Iemand ongevraagd aan een bedrijf hangen zou
    // betekenen dat een werkgever met andermans adres kan meelezen.
    await admin.from('notifications').insert({
      id: 'nt_' + koppelingId,
      to_user_id: bestaandProfiel.id,
      kind: 'taak',
      title: `${werkgever.naam} wil je koppelen`,
      body: `${beller.name} vraagt of je account gekoppeld mag worden aan ${werkgever.naam}. ` +
            'Daarna ziet dit bedrijf de wasbeurten die op zijn naam staan.',
      from_user_id: beller.id,
      from_name: beller.name,
      created_at: nu(),
      link: 'koppelverzoek',
    })

    await verstuur(email, {
      onderwerp: `${werkgever.naam} wil je koppelen in het Truckwash1-dashboard`,
      kop: `Dag ${(bestaandProfiel.name || naam).split(' ')[0]}`,
      alineas: [
        `${beller.name} van ${werkgever.naam} vraagt of jouw account aan dat bedrijf gekoppeld mag worden.`,
        'Ga je akkoord, dan ziet dat bedrijf voortaan de wasbeurten die op zijn naam staan. Je eigen gegevens en je wachtwoord blijven van jou; daar komt niemand bij.',
        'Je vindt het verzoek in de app bij je berichten. Je hoeft niets te doen als je het niet wilt.',
      ],
      gegevens: [['Bedrijf', werkgever.naam], ['Aangevraagd door', beller.name]],
    }, 'koppelverzoek')

    return json({ ok: true, soort: 'koppelverzoek', koppelingId })
  }

  /* =============== 2. Nieuw account =============== */

  const wachtwoord = tijdelijkWachtwoord()

  const { data: nieuw, error: authFout } = await admin.auth.admin.createUser({
    email,
    password: wachtwoord,
    email_confirm: true,
    user_metadata: { name: naam, uitgenodigd_door: werkgever.naam },
  })

  if (authFout || !nieuw.user) {
    return json({ error: `Account aanmaken mislukte: ${authFout?.message ?? 'onbekend'}` }, 500)
  }

  const profielId = 'u_' + nieuw.user.id.replace(/-/g, '')

  /*
   * De trigger op auth.users heeft inmiddels een dossier neergezet -- zonder
   * rollen en op inactief, want dat is wat er met een zelfaanmelding gebeurt.
   * Dit is geen zelfaanmelding, dus zetten we het goed: chauffeur, actief,
   * en het wachtwoord moet bij de eerste inlog gewijzigd worden.
   */
  await admin.from('profiles').update({
    name: naam,
    roles: ['employee'],
    active: true,
    must_change_password: true,
  }).eq('id', profielId)

  // De aanmelding die de trigger neerlegde hoort hier niet: er is niets te
  // beoordelen, dit is een uitnodiging.
  await admin.from('signups').delete().eq('auth_id', nieuw.user.id)

  await admin.from('employer_links').insert({
    id: koppelingId,
    werkgever_id: werkgeverId,
    werkgever_naam: werkgever.naam,
    user_id: profielId,
    naam,
    email,
    status: 'actief',
    uitgenodigd_op: nu(),
    uitgenodigd_door: beller.id,
    uitgenodigd_door_naam: beller.name,
    bestaand_account: false,
    gekoppeld_op: nu(),
  })

  const verstuurd = await verstuur(email, {
    onderwerp: 'Je inloggegevens voor het Truckwash1-dashboard',
    kop: `Welkom, ${naam.split(' ')[0]}`,
    alineas: [
      `${beller.name} van ${werkgever.naam} heeft een account voor je aangemaakt in het Truckwash1-dashboard. Daarmee zie je de wasbeurten van je wagens.`,
      'Log in met de gegevens hieronder. Bij de eerste keer vraagt de app je meteen om een eigen wachtwoord te kiezen — dit tijdelijke wachtwoord werkt daarna niet meer.',
      'Dat is met opzet: een wachtwoord dat per mail is verstuurd staat in jouw postvak, in dat van de afzender, en op elke server ertussenin.',
    ],
    gegevens: [
      ['E-mailadres', email],
      ['Tijdelijk wachtwoord', wachtwoord],
    ],
    voet: 'Deel dit wachtwoord met niemand. Truckwash1 vraagt er nooit naar.',
  }, 'uitnodiging')

  return json({
    ok: true,
    soort: 'nieuw account',
    koppelingId,
    profielId,
    mailVerstuurd: verstuurd,
  })
})
