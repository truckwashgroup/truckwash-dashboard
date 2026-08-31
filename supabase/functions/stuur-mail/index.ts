/* ===========================================================================
 *  stuur-mail -- de enige plek waar de sleutel van Resend staat
 *
 *  Uitrollen:
 *
 *    supabase secrets set RESEND_API_KEY=re_...
 *    supabase functions deploy stuur-mail --no-verify-jwt
 *
 *  Dat --no-verify-jwt is nodig omdat één verzoek van een bezoeker zonder
 *  account moet kunnen komen: de bevestiging van zijn eigen aanmelding. De
 *  controle gebeurt hieronder zelf, en strenger dan een JWT-check alleen.
 *
 *  De twee regels waar alles op rust:
 *
 *   1. De aanroeper geeft nooit een e-mailadres op dat wordt gebruikt. Hij
 *      geeft een id -- van een dossier of van een aanmelding -- en deze
 *      functie zoekt het adres erbij. Zo is dit geen doorgeefluik waarmee
 *      iemand namens truckwash.cloud post de wereld in stuurt.
 *
 *   2. De aanroeper geeft nooit opmaak op. Alleen een sjabloonnaam en wat
 *      losse woorden, die hieronder ontdaan worden van tekens die iets
 *      zouden kunnen betekenen in HTML.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Het geverifieerde domein bij Resend. */
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'
const ANTWOORD_NAAR = Deno.env.get('MAIL_REPLY_TO') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/* ------------------------------------------------------------------ *
 *  Hulpjes
 * ------------------------------------------------------------------ */

/** Alles wat in HTML iets betekent onschadelijk maken. */
function veilig(text: unknown): string {
  return String(text ?? '')
    .slice(0, 2000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const nu = () => Date.now()

/* ------------------------------------------------------------------ *
 *  De opmaak
 *
 *  Eén omhulsel voor alles, zodat elke mail er hetzelfde uitziet en er
 *  maar op één plek iets te veranderen is. Tabellen in plaats van moderne
 *  opmaak: postprogramma's kunnen daar het beste tegen.
 * ------------------------------------------------------------------ */

interface Brief {
  onderwerp: string
  kop: string
  alineas: string[]
  /** Regels in een kader, bijv. "Rollen: werknemer" */
  gegevens?: [string, string][]
  knop?: { tekst: string; link: string }
  voet?: string
}

function omhulsel(b: Brief): string {
  const alineas = b.alineas
    .map((a) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#243044">${veilig(a)}</p>`)
    .join('')

  const gegevens = b.gegevens?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="margin:6px 0 18px;border:1px solid #e6e9ef;border-radius:10px;background:#fafbfd">
         ${b.gegevens.map(([k, v]) => `
           <tr>
             <td style="padding:9px 14px;font-size:13px;color:#6b7891;width:40%">${veilig(k)}</td>
             <td style="padding:9px 14px;font-size:13px;color:#243044;font-weight:600">${veilig(v)}</td>
           </tr>`).join('')}
       </table>`
    : ''

  const knop = b.knop
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
         <tr><td style="border-radius:9px;background:#f8c010">
           <a href="${veilig(b.knop.link)}"
              style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;
                     color:#14202f;text-decoration:none">${veilig(b.knop.tekst)}</a>
         </td></tr>
       </table>`
    : ''

  return `<!doctype html>
<html lang="nl"><body style="margin:0;padding:0;background:#f2f4f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;
                    border:1px solid #e6e9ef;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
        <tr><td style="background:#0b1220;padding:20px 26px">
          <span style="color:#f8c010;font-size:17px;font-weight:800;letter-spacing:-.3px">TRUCKWASH1</span>
          <span style="color:#8b9ab5;font-size:13px;margin-left:8px">Dashboard</span>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#0b1220">${veilig(b.kop)}</h1>
          ${alineas}
          ${gegevens}
          ${knop}
        </td></tr>
        <tr><td style="padding:16px 26px;background:#fafbfd;border-top:1px solid #e6e9ef">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8b9ab5">
            ${veilig(b.voet ?? 'Dit bericht komt uit het Truckwash1-dashboard. Je hoeft er niet op te antwoorden.')}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function platteTekst(b: Brief): string {
  const regels = [b.kop, '', ...b.alineas]
  if (b.gegevens?.length) {
    regels.push('')
    for (const [k, v] of b.gegevens) regels.push(`${k}: ${v}`)
  }
  if (b.knop) regels.push('', `${b.knop.tekst}: ${b.knop.link}`)
  regels.push('', b.voet ?? 'Truckwash1 Group')
  return regels.join('\n')
}

/* ------------------------------------------------------------------ *
 *  Versturen en vastleggen
 * ------------------------------------------------------------------ */

async function verstuur(
  naar: string,
  brief: Brief,
  meta: { template: string; toUserId?: string },
): Promise<boolean> {
  const id = 'em_' + crypto.randomUUID().replace(/-/g, '')
  let ok = false
  let providerId: string | undefined
  let fout: string | undefined

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: AFZENDER,
        to: [naar],
        subject: brief.onderwerp,
        html: omhulsel(brief),
        text: platteTekst(brief),
        ...(ANTWOORD_NAAR ? { reply_to: ANTWOORD_NAAR } : {}),
      }),
    })

    const body = await res.json().catch(() => ({}))
    ok = res.ok
    providerId = body?.id
    if (!ok) fout = String(body?.message ?? body?.error ?? res.status).slice(0, 400)
  } catch (e) {
    fout = String(e instanceof Error ? e.message : e).slice(0, 400)
  }

  // Altijd vastleggen, ook wat mislukt is -- dat is juist wat je wilt zien.
  await admin.from('email_log').insert({
    id,
    template: meta.template,
    to_email: naar,
    to_user_id: meta.toUserId ?? null,
    subject: brief.onderwerp,
    status: ok ? 'verstuurd' : 'mislukt',
    provider_id: providerId ?? null,
    error: fout ?? null,
    at: nu(),
  })

  return ok
}

/**
 * Ruwe rem: niet meer dan dit per adres per uur. Voorkomt dat een fout in
 * de app -- of iemand die het probeert -- een postbus volgooit.
 */
async function teVaak(naar: string, max = 12): Promise<boolean> {
  const { count } = await admin
    .from('email_log')
    .select('id', { count: 'exact', head: true })
    .eq('to_email', naar)
    .gt('at', nu() - 3_600_000)
  return (count ?? 0) >= max
}

/** Is dit sjabloon voor deze aanmelding al eens verstuurd? */
async function alGestuurd(naar: string, template: string): Promise<boolean> {
  const { count } = await admin
    .from('email_log')
    .select('id', { count: 'exact', head: true })
    .eq('to_email', naar)
    .eq('template', template)
    .eq('status', 'verstuurd')
  return (count ?? 0) > 0
}

/* ------------------------------------------------------------------ *
 *  Wie vraagt dit?
 * ------------------------------------------------------------------ */

interface Beller {
  profileId: string
  naam: string
  rollen: string[]
}

async function wieBelt(req: Request): Promise<Beller | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, roles, active')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel || !profiel.active) return null
  return {
    profileId: profiel.id,
    naam: profiel.name ?? '',
    rollen: profiel.roles ?? [],
  }
}

const isManagement = (b: Beller | null) => !!b?.rollen.includes('management')

/* ------------------------------------------------------------------ *
 *  De sjablonen
 * ------------------------------------------------------------------ */

const APP_LINK = Deno.env.get('APP_LINK') ??
  'https://github.com/truckwashgroup/truckwash-dashboard/releases/latest'

function briefAanmelding(naam: string): Brief {
  return {
    onderwerp: 'We hebben je aanmelding ontvangen',
    kop: `Dag ${naam}, je aanmelding staat klaar`,
    alineas: [
      'Bedankt voor je aanmelding bij Truckwash1 Group. Iemand van het kantoor kijkt ernaar en zet je daarna klaar met de juiste vestiging en de juiste rechten.',
      'Zodra dat gebeurd is krijg je van ons bericht en kun je inloggen met het e-mailadres en het wachtwoord dat je zelf hebt gekozen. Tot die tijd kom je nog niet binnen.',
      'Heb je je per ongeluk aangemeld? Dan hoef je niets te doen; zonder goedkeuring gebeurt er niets.',
    ],
  }
}

function briefManagement(naam: string, soort: string, email: string, bericht?: string): Brief {
  return {
    onderwerp: `Nieuwe aanmelding: ${naam}`,
    kop: 'Er staat een aanmelding klaar',
    alineas: [
      `${naam} heeft zich aangemeld via de app en wacht op beoordeling.`,
      ...(bericht ? [`Wat diegene erbij schreef: "${bericht}"`] : []),
      'Je vindt de aanmelding in het dashboard onder Personeel, tabblad Aanmeldingen. Daar bepaal je meteen de rollen en de vestiging.',
    ],
    gegevens: [
      ['Naam', naam],
      ['E-mailadres', email],
      ['Meldt zich aan als', soort],
    ],
  }
}

function briefGoedgekeurd(naam: string, rollen: string): Brief {
  return {
    onderwerp: 'Je kunt inloggen op het Truckwash1-dashboard',
    kop: `Welkom, ${naam}`,
    alineas: [
      'Je aanmelding is goedgekeurd. Je kunt nu inloggen met het e-mailadres en het wachtwoord dat je bij het aanmelden hebt gekozen.',
      'De app werkt ook zonder internet: wat je invult blijft staan en gaat vanzelf door zodra je weer bereik hebt.',
    ],
    gegevens: rollen ? [['Je krijgt toegang tot', rollen]] : undefined,
    knop: { tekst: 'De app ophalen', link: APP_LINK },
  }
}

function briefAfgewezen(naam: string, reden: string): Brief {
  return {
    onderwerp: 'Over je aanmelding bij Truckwash1',
    kop: `Dag ${naam}`,
    alineas: [
      'We hebben je aanmelding voor het Truckwash1-dashboard niet goedgekeurd.',
      ...(reden ? [`Toelichting: ${reden}`] : []),
      'Klopt dit niet, of heb je je met het verkeerde adres aangemeld? Neem dan contact op met je contactpersoon bij Truckwash1.',
    ],
  }
}

/**
 * Een mail die iemand zelf heeft opgesteld.
 *
 * Dit is het enige sjabloon waarbij de aanroeper het adres bepaalt. Dat is
 * bewust smal gehouden: het mag alleen met de rol management of ontwikkelaar,
 * er zit een stevige rem op, en elke verzending komt in het logboek te staan
 * mét de naam van wie hem verstuurde.
 */
function briefVrij(onderwerp: string, tekst: string, van: string): Brief {
  return {
    onderwerp,
    kop: onderwerp,
    // Een lege regel scheidt alinea's, zoals iemand het intypt.
    alineas: tekst.split(/\n{2,}/).slice(0, 25),
    voet: `Verstuurd door ${van} vanuit het Truckwash1-dashboard.`,
  }
}

function briefBericht(titel: string, tekst: string, van?: string): Brief {
  return {
    onderwerp: titel,
    kop: titel,
    alineas: [tekst, ...(van ? [`Dit bericht komt van ${van}.`] : [])],
    knop: { tekst: 'Openen in het dashboard', link: APP_LINK },
    voet: 'Je krijgt deze mail omdat er in het dashboard iets voor je klaarstaat.',
  }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  if (!RESEND_KEY) {
    return json({ error: 'RESEND_API_KEY ontbreekt op de server' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const template = String(body.template ?? '')
  const vars = (body.vars ?? {}) as Record<string, string>

  /* --- 1. De aanmelding: het enige geval zonder inlog ---------------- */

  if (template === 'aanmelding') {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email) return json({ error: 'Geen adres' }, 400)

    // Alleen als er bij dit adres werkelijk net een aanmelding binnenkwam.
    const { data: aanmelding } = await admin
      .from('signups')
      .select('id, name, email, kind, message, created_at, status')
      .ilike('email', email)
      .eq('status', 'nieuw')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!aanmelding) return json({ sent: 0, skipped: 'geen openstaande aanmelding' })
    if (nu() - Number(aanmelding.created_at) > 15 * 60_000) {
      return json({ sent: 0, skipped: 'aanmelding is te oud' })
    }
    if (await alGestuurd(aanmelding.email, 'aanmelding')) {
      return json({ sent: 0, skipped: 'al bevestigd' })
    }
    if (await teVaak(aanmelding.email, 3)) {
      return json({ sent: 0, skipped: 'te vaak' })
    }

    const naam = String(aanmelding.name ?? '').split(' ')[0] || 'daar'
    let verstuurd = 0

    if (await verstuur(aanmelding.email, briefAanmelding(naam), { template: 'aanmelding' })) {
      verstuurd++
    }

    // En het management, zodat het niet blijft liggen.
    const { data: bazen } = await admin
      .from('profiles')
      .select('id, email, active, roles')
      .contains('roles', ['management'])
      .eq('active', true)

    for (const baas of bazen ?? []) {
      if (!baas.email) continue
      if (await teVaak(baas.email, 30)) continue
      const ok = await verstuur(
        baas.email,
        briefManagement(
          String(aanmelding.name ?? ''),
          String(aanmelding.kind ?? ''),
          aanmelding.email,
          String(aanmelding.message ?? '') || undefined,
        ),
        { template: 'nieuwe-aanmelding', toUserId: baas.id },
      )
      if (ok) verstuurd++
    }

    return json({ sent: verstuurd })
  }

  /* --- 2. Alles daarna vraagt om een geldige inlog ------------------- */

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)

  if (template === 'aanmelding-goedgekeurd' || template === 'aanmelding-afgewezen') {
    if (!isManagement(beller)) return json({ error: 'Geen rechten' }, 403)

    const signupId = String(body.signupId ?? '')
    const { data: aanmelding } = await admin
      .from('signups')
      .select('id, name, email')
      .eq('id', signupId)
      .maybeSingle()

    if (!aanmelding?.email) return json({ sent: 0, skipped: 'aanmelding niet gevonden' })
    if (await teVaak(aanmelding.email, 6)) return json({ sent: 0, skipped: 'te vaak' })

    const naam = String(vars.naam ?? aanmelding.name ?? '').split(' ')[0] || 'daar'
    const brief = template === 'aanmelding-goedgekeurd'
      ? briefGoedgekeurd(naam, String(vars.rollen ?? ''))
      : briefAfgewezen(naam, String(vars.reden ?? ''))

    const ok = await verstuur(aanmelding.email, brief, { template })
    return json({ sent: ok ? 1 : 0 })
  }

  if (template === 'vrij') {
    const magVersturen = beller.rollen.includes('management')
      || beller.rollen.includes('developer')
    if (!magVersturen) return json({ error: 'Geen rechten' }, 403)

    const naar = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(naar)) {
      return json({ error: 'Geen geldig e-mailadres' }, 400)
    }

    const onderwerp = String(vars.onderwerp ?? '').trim().slice(0, 160)
    const tekst = String(vars.tekst ?? '').trim().slice(0, 6000)
    if (!onderwerp || !tekst) return json({ error: 'Onderwerp en tekst zijn nodig' }, 400)

    // Twee remmen: niet te vaak naar hetzelfde adres, en niet te veel in
    // totaal vanuit één account. De tweede vangt een fout in een lus af.
    if (await teVaak(naar, 6)) return json({ sent: 0, skipped: 'te vaak naar dit adres' })

    const { count: eigen } = await admin
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('template', 'vrij')
      .eq('to_user_id', beller.profileId)
      .gt('at', nu() - 3_600_000)
    if ((eigen ?? 0) >= 40) {
      return json({ sent: 0, skipped: 'te veel verstuurd dit uur' })
    }

    const ok = await verstuur(naar, briefVrij(onderwerp, tekst, beller.naam), {
      template: 'vrij',
      // Wie hem verstuurde, niet wie hem krijgt: bij een vrije mail is de
      // ontvanger vaak iemand buiten het bedrijf.
      toUserId: beller.profileId,
    })
    return json({ sent: ok ? 1 : 0 })
  }

  if (template === 'bericht') {
    const toUserId = String(body.toUserId ?? '')
    if (!toUserId) return json({ error: 'Geen ontvanger' }, 400)

    // Het adres komt uit de database, nooit uit het verzoek.
    const { data: ontvanger } = await admin
      .from('profiles')
      .select('id, email, active')
      .eq('id', toUserId)
      .maybeSingle()

    if (!ontvanger?.email || !ontvanger.active) {
      return json({ sent: 0, skipped: 'ontvanger niet bereikbaar' })
    }
    if (await teVaak(ontvanger.email)) return json({ sent: 0, skipped: 'te vaak' })

    const titel = String(vars.titel ?? '').slice(0, 140)
    const tekst = String(vars.tekst ?? '').slice(0, 1200)
    if (!titel) return json({ error: 'Geen onderwerp' }, 400)

    const ok = await verstuur(
      ontvanger.email,
      briefBericht(titel, tekst, String(vars.van ?? '') || undefined),
      { template: 'bericht', toUserId: ontvanger.id },
    )
    return json({ sent: ok ? 1 : 0 })
  }

  return json({ error: `Onbekend sjabloon: ${template}` }, 400)
})
