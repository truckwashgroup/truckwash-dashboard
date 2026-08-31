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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? ''

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

function veiligeNaam(naam: string): string {
  return naam
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 120) || 'bijlage'
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

  const binnen = (pak(data, 'attachments') ?? []) as Willekeurig[]
  const bijlagen: {
    naam: string; mime: string; size: number; path: string
  }[] = []

  for (const [i, a] of (Array.isArray(binnen) ? binnen : []).entries()) {
    try {
      const naam = veiligeNaam(String(a.filename ?? a.name ?? `bijlage-${i + 1}`))
      const mime = String(a.content_type ?? a.contentType ?? a.type ?? 'application/octet-stream')
      if (!TOEGESTAAN.has(mime)) {
        console.warn(`[ontvang-mail] bijlage ${naam} overgeslagen: ${mime}`)
        continue
      }

      const inhoud = a.content ?? a.data ?? a.body
      if (typeof inhoud !== 'string') continue

      // Base64, eventueel met een data-URL ervoor.
      const schoon = inhoud.replace(/^data:[^;]+;base64,/, '')
      const bytes = Uint8Array.from(atob(schoon), (c) => c.charCodeAt(0))
      if (bytes.byteLength > MAX_BIJLAGE) {
        console.warn(`[ontvang-mail] bijlage ${naam} te groot: ${bytes.byteLength}`)
        continue
      }

      const pad = `${berichtId}/${i + 1}-${naam}`
      const { error } = await admin.storage.from(EMMER).upload(pad, bytes, {
        contentType: mime,
        upsert: false,
      })
      if (error) {
        console.error(`[ontvang-mail] bijlage ${naam} niet opgeslagen: ${error.message}`)
        continue
      }

      bijlagen.push({ naam, mime, size: bytes.byteLength, path: pad })
    } catch (e) {
      console.error('[ontvang-mail] bijlage overslaan: ' + String(e))
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
    tekst,
    had_html: Boolean(html),
    at: nu(),
    status: 'nieuw',
    attachments: bijlagen,
    provider_id: providerId,
    // Ingekort: genoeg om te zien wat er binnenkwam, niet zoveel dat de
    // tabel volloopt met bijlagen in base64.
    raw: ruw.length > 8000 ? ruw.slice(0, 8000) + '\n… (ingekort)' : ruw,
  })

  if (bericht) {
    // Twee keer dezelfde webhook: dan staat hij er al, en dat is prima.
    if (bericht.code === '23505') return json({ ok: true, duplicate: true })
    console.error('[ontvang-mail] opslaan mislukt: ' + bericht.message)
    return json({ error: bericht.message }, 500)
  }

  /* ---- een kostenpost eruit halen ---- */

  let expenseId: string | null = null

  if (bijlagen.length > 0) {
    const bon = bijlagen.find((b) =>
      b.mime === 'application/pdf' || b.mime.startsWith('image/')) ?? bijlagen[0]

    expenseId = 'exp_mail_' + berichtId.slice(3, 15)

    const { error: kosten } = await admin.from('expenses').insert({
      id: expenseId,
      expense_date: nu(),
      category: 'overig',
      supplier: van.naam ?? van.adres,
      description: onderwerp,
      // Bewust nul: het bedrag lezen uit een PDF is gokken, en een gok in
      // de boekhouding is erger dan een leeg veld. Iemand vult hem in bij
      // het goedkeuren.
      amount_excl: 0,
      vat_pct: 21,
      status: 'open',
      submitted_by: null,
      submitted_by_name: van.naam ?? van.adres,
      source: 'mail',
      mailbox_id: berichtId,
      attachment_path: bon.path,
      attachment_name: bon.naam,
    })

    if (kosten) {
      console.error('[ontvang-mail] kostenpost niet aangemaakt: ' + kosten.message)
      expenseId = null
    } else {
      await admin.from('mailbox').update({ expense_id: expenseId }).eq('id', berichtId)
    }
  }

  /* ---- het management een seintje ---- */

  const { data: bazen } = await admin
    .from('profiles')
    .select('id, name')
    .contains('roles', ['management'])
    .eq('active', true)

  for (const baas of bazen ?? []) {
    await admin.from('notifications').insert({
      id: 'nt_' + berichtId + '_' + baas.id.slice(-6),
      to_user_id: baas.id,
      kind: expenseId ? 'taak' : 'info',
      title: expenseId
        ? `Bon per mail: ${onderwerp}`
        : `Post ontvangen: ${onderwerp}`,
      body: `Van ${van.naam ?? van.adres}` +
            (bijlagen.length ? ` · ${bijlagen.length} bijlage(n)` : ''),
      from_name: 'Postbus',
      created_at: nu(),
      link: expenseId ? 'financieel' : 'postbus',
    })
  }

  return json({ ok: true, id: berichtId, attachments: bijlagen.length, expenseId })
})
