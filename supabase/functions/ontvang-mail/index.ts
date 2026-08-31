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
import { controleerBijlage } from './controle.ts'

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

/**
 * De inhoud van een bijlage te pakken krijgen.
 *
 * Drie manieren, in deze volgorde:
 *
 *  1. de inhoud zit in de webhook zelf, als base64
 *  2. er staat een adres bij waar hij te halen is
 *  3. er staat alleen een id bij; dan vragen we hem op bij Resend
 *
 * Welke van de drie het is verschilt per aanbieder en per formaat van de
 * mail. Ze alle drie proberen is goedkoper dan uitzoeken welke het deze
 * keer was.
 */
async function haalInhoud(
  a: Willekeurig,
  vanResend: Willekeurig | undefined,
): Promise<Uint8Array | null> {
  // 1. Staat de inhoud er gewoon bij? Dan zijn we klaar.
  const inhoud = a.content ?? a.data ?? a.body ?? a.base64
  if (typeof inhoud === 'string' && inhoud.length > 0) {
    try {
      const schoon = inhoud.replace(/^data:[^;]+;base64,/, '')
      return Uint8Array.from(atob(schoon), (c) => c.charCodeAt(0))
    } catch (e) {
      console.warn('[ontvang-mail] inhoud niet te lezen als base64: ' + String(e))
    }
  }

  // 2. Een adres in de webhook zelf, of het adres dat Resend teruggaf.
  const adres = pak(a, 'url', 'download_url', 'content_url', 'href', 'link')
    ?? (vanResend ? pak(vanResend, 'download_url', 'url') : undefined)

  if (typeof adres === 'string' && /^https:\/\//.test(adres)) {
    // Een voorondertekend adres wil de sleutel meestal niet; lukt het zonder
    // niet, dan alsnog met.
    return (await haalVan(adres)) ?? (await haalVan(adres, RESEND_KEY))
  }

  return null
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

/** De regel uit de lijst die bij deze bijlage hoort. */
function zoekBijResend(
  a: Willekeurig,
  lijst: Willekeurig[],
  index: number,
): Willekeurig | undefined {
  const naam = String(a.filename ?? a.name ?? '').toLowerCase()
  const contentId = String(a.content_id ?? a.contentId ?? '')

  return (
    (contentId && lijst.find((r) => String(r.content_id ?? '') === contentId)) ||
    (naam && lijst.find((r) => String(r.filename ?? '').toLowerCase() === naam)) ||
    // Geen naam om op te matchen? Dan op volgorde; die is bij één mail gelijk.
    lijst[index]
  )
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

      const bytes = await haalInhoud(a, bijResend)
      if (!bytes) {
        mislukt(
          'Het bestand zelf is niet opgehaald. Resend stuurt de inhoud niet ' +
          'mee in de webhook; die moet apart worden opgevraagd, en dat lukte ' +
          'niet. Kijk in het logboek van de functie ontvang-mail wat de ' +
          'bijlagenlijst terugzei.',
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
        controleReden: uitkomst.reden,
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
