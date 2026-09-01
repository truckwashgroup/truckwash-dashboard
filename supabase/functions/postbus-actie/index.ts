/* ===========================================================================
 *  Twee dingen die je met een bericht uit de postbus wilt kunnen
 *
 *    actie: 'bijlagen'  -> haal de bijlagen (alsnog) op bij Resend
 *    actie: 'deel'      -> maak een link waarmee je de mail kunt laten zien
 *
 *  Waarom die eerste bestaat: Resend zet de inhoud van een bijlage niet in
 *  de webhook, alleen de naam en het type. Het ophalen is een tweede stap,
 *  en die deden we een tijd lang niet. Alle post die in die periode
 *  binnenkwam heeft dus wel de namen van zijn bijlagen, maar niets erachter.
 *  Met deze actie haal je ze alsnog binnen zonder de mail opnieuw te hoeven
 *  laten sturen.
 *
 *  De tweede is voor het geval waarin je iemand een factuur wilt laten zien
 *  die geen toegang heeft tot het dashboard -- de boekhouder, een leverancier
 *  die zegt dat hij iets anders heeft gestuurd.
 *
 *  Deze functie eist wél een inlog. Dat is het verschil met ontvang-mail,
 *  die een webhook is en zichzelf met een handtekening verdedigt.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { controleerBijlage, lijktEchtOp } from '../ontvang-mail/controle.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

const EMMER = 'post'
const MAX_BIJLAGE = 25 * 1024 * 1024

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

const TOEGESTAAN = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'image/gif', 'text/plain', 'text/csv', 'application/xml', 'text/xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

function veiligeNaam(naam: string): string {
  return naam.replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').slice(0, 120) || 'bijlage'
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
 *  De bijlagen alsnog ophalen
 * ------------------------------------------------------------------ */

async function haalBijlagen(bericht: Record<string, unknown>) {
  const emailId = String(bericht.provider_id ?? '')
  if (!emailId) {
    return { ok: false, reden: 'Bij dit bericht is geen Resend-id bewaard.' }
  }
  if (!RESEND_KEY) {
    return { ok: false, reden: 'RESEND_API_KEY staat niet ingesteld bij de functies.' }
  }

  const res = await fetch(
    `https://api.resend.com/emails/receiving/${emailId}/attachments?limit=100`,
    { headers: { Authorization: `Bearer ${RESEND_KEY}` } },
  )
  if (!res.ok) {
    const tekst = await res.text()
    console.warn(`[postbus-actie] bijlagenlijst gaf ${res.status}: ${tekst}`)
    return {
      ok: false,
      reden: res.status === 404
        ? 'Resend kent dit bericht niet (meer). Bijlagen worden na verloop ' +
          'van tijd opgeruimd; een oude mail is niet meer op te halen.'
        /*
         * Dit geval kostte een middag zoeken. De sleutel werkte prima voor
         * het versturen van mail, dus er leek niets aan de hand -- maar een
         * sleutel met alleen verzendrechten mag inkomende post niet lezen.
         * Het gevolg was een bijlage die half binnenkwam zonder dat iemand
         * zag waarom. Daarom staat het antwoord van Resend er letterlijk bij.
         */
        : res.status === 401 || res.status === 403
          ? 'Resend weigert deze sleutel voor inkomende post. Waarschijnlijk ' +
            'is het een sleutel met alleen verzendrechten ("restricted to only ' +
            'send emails"). Maak in Resend een sleutel met volledige toegang ' +
            'en zet die als RESEND_API_KEY bij de functies. Resend zei: ' +
            tekst.slice(0, 200)
          : `Resend gaf ${res.status}. ${tekst.slice(0, 200)}`,
    }
  }

  const body = await res.json()
  const lijst = Array.isArray(body?.data) ? body.data : []
  if (lijst.length === 0) {
    return { ok: true, aantal: 0, reden: 'Resend kent geen bijlagen bij dit bericht.' }
  }

  const bijlagen: Record<string, unknown>[] = []

  for (const [i, a] of lijst.entries()) {
    const naam = veiligeNaam(String(a.filename ?? `bijlage-${i + 1}`))
    const mime = String(a.content_type ?? 'application/octet-stream')

    const mislukt = (reden: string) => {
      console.warn(`[postbus-actie] ${naam}: ${reden}`)
      bijlagen.push({
        naam, mime, size: Number(a.size ?? 0), path: '',
        controle: 'mislukt', controleReden: reden, controleOp: nu(),
      })
    }

    try {
      if (!TOEGESTAAN.has(mime)) {
        mislukt(`Dit soort bestand nemen we niet aan (${mime}).`)
        continue
      }
      const adres = String(a.download_url ?? '')
      if (!adres) { mislukt('Resend gaf geen adres om hem op te halen.'); continue }

      const bestand = await fetch(adres)
      if (!bestand.ok) { mislukt(`Ophalen gaf ${bestand.status}.`); continue }

      const bytes = new Uint8Array(await bestand.arrayBuffer())

      /*
       * Nakijken of dit werkelijk het bestand is. Zonder deze controle sla je
       * op wat er ook maar terugkwam -- en dat was precies wat er misging: een
       * PDF van 197 kB die als 3 kB in de opslag belandde, met in het scherm
       * niets anders dan "deze PDF is niet te openen".
       */
      const mis = lijktEchtOp(bytes, mime, Number(a.size ?? 0) || undefined)
      if (mis) { mislukt(`Wat er binnenkwam klopt niet: ${mis}.`); continue }

      if (bytes.byteLength > MAX_BIJLAGE) {
        mislukt(`Te groot om te bewaren (${Math.round(bytes.byteLength / 1024 / 1024)} MB).`)
        continue
      }

      const uitkomst = await controleerBijlage(bytes, naam, mime)
      if (uitkomst.uitkomst === 'verdacht') {
        bijlagen.push({
          naam, mime, size: bytes.byteLength, path: '',
          controle: 'verdacht', controleReden: uitkomst.reden, controleOp: nu(),
          scanner: uitkomst.scanner,
        })
        continue
      }

      const pad = `${bericht.id}/${i + 1}-${naam}`
      const { error } = await admin.storage.from(EMMER)
        .upload(pad, bytes, { contentType: mime, upsert: true })
      if (error) { mislukt(`Opslaan lukte niet: ${error.message}`); continue }

      bijlagen.push({
        naam, mime, size: bytes.byteLength, path: pad,
        controle: uitkomst.uitkomst, controleReden: uitkomst.reden,
        controleOp: nu(), scanner: uitkomst.scanner,
      })
    } catch (e) {
      mislukt('Er ging iets mis: ' + String(e))
    }
  }

  const { error } = await admin.from('mailbox')
    .update({ attachments: bijlagen })
    .eq('id', bericht.id)
  if (error) return { ok: false, reden: `Bijwerken mislukte: ${error.message}` }

  const gelukt = bijlagen.filter((b) => b.path).length
  return { ok: true, aantal: bijlagen.length, gelukt }
}

/* ------------------------------------------------------------------ *
 *  Een deelbare link
 * ------------------------------------------------------------------ */

async function deel(bericht: Record<string, unknown>, geldig: string) {
  const emailId = String(bericht.provider_id ?? '')
  if (!emailId) return { ok: false, reden: 'Bij dit bericht is geen Resend-id bewaard.' }
  if (!RESEND_KEY) return { ok: false, reden: 'RESEND_API_KEY staat niet ingesteld.' }

  const res = await fetch(`https://api.resend.com/emails/${emailId}/share`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: geldig }),
  })

  if (!res.ok) {
    const tekst = await res.text()
    console.warn(`[postbus-actie] delen gaf ${res.status}: ${tekst}`)
    return {
      ok: false,
      reden: res.status === 404
        ? 'Resend kent dit bericht niet (meer).'
        : `Resend gaf ${res.status}. ${tekst.slice(0, 200)}`,
    }
  }

  const body = await res.json()
  if (!body?.url) return { ok: false, reden: 'Resend gaf geen link terug.' }
  return { ok: true, url: String(body.url), geldig }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)

  /*
   * De postbus is van het kantoor. Wie de post niet mag lezen, hoort hem ook
   * niet te kunnen delen -- een deelbare link is een factuur zonder slot.
   */
  const mag = beller.rollen.includes('management') || beller.rechten.includes('mail.read')
  if (!mag) return json({ error: 'Geen rechten' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const berichtId = String(body.berichtId ?? '')
  if (!berichtId) return json({ error: 'Geen bericht opgegeven' }, 400)

  const { data: bericht } = await admin
    .from('mailbox')
    .select('id, provider_id, onderwerp')
    .eq('id', berichtId)
    .maybeSingle()

  if (!bericht) return json({ error: 'Bericht niet gevonden' }, 404)

  const actie = String(body.actie ?? '')

  try {
    if (actie === 'bijlagen') {
      return json(await haalBijlagen(bericht))
    }
    if (actie === 'deel') {
      // Resend staat hoogstens 48 uur toe.
      const geldig = ['1 hour', '8 hours', '24 hours', '48 hours']
        .includes(String(body.geldig)) ? String(body.geldig) : '24 hours'
      const uit = await deel(bericht, geldig)

      if (uit.ok) {
        console.log(
          `[postbus-actie] ${beller.naam} deelde "${bericht.onderwerp}" voor ${geldig}`)
      }
      return json(uit)
    }
    return json({ error: `Onbekende actie: ${actie}` }, 400)
  } catch (e) {
    console.error('[postbus-actie] ' + String(e))
    return json({ ok: false, reden: String(e) }, 500)
  }
})
