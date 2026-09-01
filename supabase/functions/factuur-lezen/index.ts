/* ===========================================================================
 *  Een factuur laten voorlezen
 *
 *  Er komen bonnen binnen als PDF en als foto, en iemand tikt daar de
 *  leverancier, het bedrag en het btw-percentage van over. Dat is werk dat
 *  niemand leuk vindt en waar precies daarom fouten in sluipen: een 6 die
 *  een 5 wordt, een bedrag inclusief in het veld exclusief.
 *
 *  Deze functie leest het stuk en geeft terug wat erin staat. Niet meer dan
 *  dat -- er wordt niets goedgekeurd, niets geboekt en niets overschreven.
 *  Wat eruit komt is een voorstel dat naast de factuur wordt gelegd.
 *
 *  Drie dingen zitten er met opzet in:
 *
 *    1. de uitkomst gaat in een eigen veld (gelezen), niet in de velden die
 *       een mens invult. Anders kun je achteraf niet meer zien wie wat heeft
 *       ingevuld -- en bij een goedgekeurde kostenpost is dat precies de
 *       vraag die je een jaar later stelt
 *    2. het model moet zeggen waar het niet uit kwam. Een half geraden
 *       bedrag is gevaarlijker dan een leeg veld: dat laatste vul je in, het
 *       eerste keur je goed
 *    3. het bestand wordt hier opgehaald en niet door de app meegestuurd.
 *       Anders kan iedereen die deze functie kan aanroepen er willekeurige
 *       inhoud doorheen halen, en dan is dit een gratis taalmodel
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const MODEL = 'claude-sonnet-5'
const EMMER = 'post'

/** Ruim boven een gewone factuur, ruim onder wat de API aankan. */
const MAX_BESTAND = 12 * 1024 * 1024

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const nu = () => Date.now()

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
 *  Het bestand
 * ------------------------------------------------------------------ */

const PDF = 'application/pdf'
const PLAATJES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function soortVan(naam: string, mime?: string | null): string {
  if (mime && (mime === PDF || PLAATJES.includes(mime))) return mime
  const ext = (naam.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (ext === 'pdf') return PDF
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

/** Bytes naar base64, in stukken -- in één keer loopt de stack over. */
function naarBase64(bytes: Uint8Array): string {
  let ruw = ''
  const stap = 0x8000
  for (let i = 0; i < bytes.length; i += stap) {
    ruw += String.fromCharCode(...bytes.subarray(i, i + stap))
  }
  return btoa(ruw)
}

/* ------------------------------------------------------------------ *
 *  Wat we het model vragen
 * ------------------------------------------------------------------ */

const SYSTEEM = `
Je leest een inkoopfactuur of kassabon van een Nederlands truckwash-bedrijf en
geeft terug wat er letterlijk op staat.

Regels:
- Neem over wat er staat. Reken niets uit dat er niet staat, en vul niets aan
  uit ervaring. Staat er geen factuurnummer, laat het veld dan weg.
- Bedragen als getal, met een punt als decimaalteken, zonder valutateken.
  Een Nederlands bedrag van 1.234,56 wordt 1234.56.
- Datums als jjjj-mm-dd.
- Twijfel je over een waarde -- onscherpe scan, doorgehaald bedrag, twee
  bedragen die elkaar tegenspreken -- zet die waarde er dan NIET in, en zet
  in "twijfel" een korte Nederlandse zin die uitlegt wat er aan de hand is.
- Tellen de regels niet op tot het subtotaal, meld dat in "twijfel". Pas de
  getallen niet aan om het kloppend te maken.
- Is dit geen factuur of bon maar bijvoorbeeld een pakbon of een aanmaning,
  zet dat in "soort" en geef terug wat je wél ziet.

Antwoord met alleen JSON, zonder uitleg eromheen:

{
  "soort": "factuur" | "bon" | "pakbon" | "aanmaning" | "onbekend",
  "leverancier": "string",
  "factuurnummer": "string",
  "datum": "jjjj-mm-dd",
  "vervaldatum": "jjjj-mm-dd",
  "iban": "string",
  "betalingskenmerk": "string",
  "btwNummer": "string",
  "kvk": "string",
  "valuta": "EUR",
  "regels": [
    { "omschrijving": "string", "aantal": 0, "eenheid": "string",
      "stukprijs": 0, "btwPct": 0, "bedragExcl": 0 }
  ],
  "subtotaalExcl": 0,
  "btwBedrag": 0,
  "totaalIncl": 0,
  "voorstelCategorie": "materiaal" | "energie" | "onderhoud" | "personeel" | "transport" | "overig",
  "twijfel": ["string"]
}
`.trim()

function leesJson(tekst: string): Record<string, unknown> | null {
  const schoon = tekst.trim().replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/, '').trim()
  try {
    return JSON.parse(schoon)
  } catch {
    const eerste = schoon.indexOf('{')
    const laatste = schoon.lastIndexOf('}')
    if (eerste < 0 || laatste <= eerste) return null
    try {
      return JSON.parse(schoon.slice(eerste, laatste + 1))
    } catch {
      return null
    }
  }
}

/** "2025-09-01" naar epoch ms; alles anders naar niets. */
function datum(waarde: unknown): number | undefined {
  if (typeof waarde !== 'string') return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(waarde.trim())
  if (!m) return undefined
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(t) ? t : undefined
}

function getal(waarde: unknown): number | undefined {
  const n = typeof waarde === 'string' ? Number(waarde.replace(',', '.')) : Number(waarde)
  return Number.isFinite(n) ? n : undefined
}

function tekst(waarde: unknown, max = 200): string | undefined {
  if (typeof waarde !== 'string') return undefined
  const schoon = waarde.trim().slice(0, max)
  return schoon || undefined
}

const CATEGORIEEN = ['materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig']

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ error: 'Niet ingelogd' }, 401)
  if (!beller.mag) return json({ error: 'Geen rechten' }, 403)

  if (!ANTHROPIC_KEY) {
    return json({
      ok: false,
      reden: 'De leesdienst is nog niet ingesteld. Zet ANTHROPIC_API_KEY als ' +
             'geheim bij de functies.',
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const expenseId = String(body.expenseId ?? '')
  if (!expenseId) return json({ error: 'Geen kostenpost opgegeven' }, 400)

  const { data: bon } = await admin
    .from('expenses')
    .select('id, supplier, attachment_path, attachment_name, mailbox_id')
    .eq('id', expenseId)
    .maybeSingle()

  if (!bon) return json({ error: 'Kostenpost niet gevonden' }, 404)

  /*
   * Welk bestand. De app mag er een aanwijzen als er meer bijlagen bij de
   * mail zaten, maar alleen uit de bijlagen die bij déze bon horen -- niet
   * een willekeurig pad uit de emmer.
   */
  const gevraagd = tekst(body.pad, 400)
  const kandidaten: { pad: string; naam: string; mime?: string }[] = []

  if (bon.attachment_path) {
    kandidaten.push({
      pad: String(bon.attachment_path),
      naam: String(bon.attachment_name ?? 'bijlage'),
    })
  }

  if (bon.mailbox_id) {
    const { data: post } = await admin
      .from('mailbox')
      .select('attachments')
      .eq('id', bon.mailbox_id)
      .maybeSingle()

    for (const b of (post?.attachments ?? []) as Record<string, unknown>[]) {
      if (!b?.path) continue
      // Wat niet door de bijlagecontrole kwam gaat hier ook niet doorheen.
      if (b.controle && b.controle !== 'schoon') continue
      kandidaten.push({
        pad: String(b.path),
        naam: String(b.naam ?? 'bijlage'),
        mime: b.mime ? String(b.mime) : undefined,
      })
    }
  }

  const gekozen = gevraagd
    ? kandidaten.find((k) => k.pad === gevraagd)
    : kandidaten[0]

  if (!gekozen) {
    return json({
      ok: false,
      reden: gevraagd
        ? 'Dat bestand hoort niet bij deze kostenpost.'
        : 'Bij deze kostenpost zit geen bijlage om te lezen.',
    })
  }

  /* ---- ophalen ---- */

  const { data: bestand, error: haalFout } = await admin.storage.from(EMMER).download(gekozen.pad)
  if (haalFout || !bestand) {
    return json({ ok: false, reden: 'De bijlage is niet op te halen.' })
  }
  if (bestand.size > MAX_BESTAND) {
    return json({
      ok: false,
      reden: `Deze bijlage is ${Math.round(bestand.size / 1024 / 1024)} MB en dat is ` +
             'te groot om te laten lezen. Stuur een kleiner bestand of een foto ' +
             'van de factuur.',
    })
  }

  const soort = soortVan(gekozen.naam, gekozen.mime ?? bestand.type)
  const b64 = naarBase64(new Uint8Array(await bestand.arrayBuffer()))

  const blok = soort === PDF
    ? { type: 'document', source: { type: 'base64', media_type: PDF, data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: soort, data: b64 } }

  /* ---- lezen ---- */

  let uit: Record<string, unknown> | null = null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEEM,
        messages: [{
          role: 'user',
          content: [
            blok,
            { type: 'text', text: 'Lees dit stuk en geef de JSON terug.' },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error(`[factuur-lezen] Anthropic gaf ${res.status}: ${detail}`)
      return json({
        ok: false,
        reden: res.status === 400 && /media_type|document/i.test(detail)
          ? 'Dit bestandstype kan niet worden gelezen. PDF en foto’s wel.'
          : 'De leesdienst gaf geen antwoord. Probeer het straks nog eens.',
      })
    }

    const antwoord = await res.json()
    const platte = (antwoord?.content ?? [])
      .filter((c: { type?: string }) => c?.type === 'text')
      .map((c: { text?: string }) => c.text ?? '')
      .join('')
    uit = leesJson(platte)
  } catch (e) {
    console.error('[factuur-lezen] ' + String(e))
    return json({ ok: false, reden: 'De leesdienst gaf geen antwoord.' })
  }

  if (!uit) {
    return json({
      ok: false,
      reden: 'Er kwam geen leesbaar antwoord uit. Dit gebeurt bij scans die ' +
             'te onscherp zijn; een rechtere foto helpt meestal.',
    })
  }

  /* ---- opschonen ----
   *
   * Alles wat terugkomt gaat langs een filter. Niet omdat het model kwaad wil,
   * maar omdat een tekstveld dat rechtstreeks in de database landt vroeg of
   * laat iets bevat waar niemand op rekende.
   */

  const regels = Array.isArray(uit.regels)
    ? (uit.regels as Record<string, unknown>[]).slice(0, 100).map((r) => ({
        omschrijving: tekst(r.omschrijving, 300) ?? '',
        aantal: getal(r.aantal),
        eenheid: tekst(r.eenheid, 20),
        stukprijs: getal(r.stukprijs),
        btwPct: getal(r.btwPct),
        bedragExcl: getal(r.bedragExcl),
      })).filter((r) => r.omschrijving)
    : []

  const twijfel = Array.isArray(uit.twijfel)
    ? (uit.twijfel as unknown[]).slice(0, 10)
        .map((t) => tekst(t, 300)).filter(Boolean) as string[]
    : []

  const voorstel = tekst(uit.voorstelCategorie, 20)

  const lezing = {
    soort: ['factuur', 'bon', 'pakbon', 'aanmaning', 'onbekend']
      .includes(String(uit.soort)) ? String(uit.soort) : 'onbekend',
    leverancier: tekst(uit.leverancier),
    factuurnummer: tekst(uit.factuurnummer, 60),
    datum: datum(uit.datum),
    vervaldatum: datum(uit.vervaldatum),
    iban: tekst(uit.iban, 40),
    betalingskenmerk: tekst(uit.betalingskenmerk, 60),
    btwNummer: tekst(uit.btwNummer, 30),
    kvk: tekst(uit.kvk, 20),
    valuta: tekst(uit.valuta, 8) ?? 'EUR',
    regels,
    subtotaalExcl: getal(uit.subtotaalExcl),
    btwBedrag: getal(uit.btwBedrag),
    totaalIncl: getal(uit.totaalIncl),
    voorstelCategorie: voorstel && CATEGORIEEN.includes(voorstel) ? voorstel : undefined,
    twijfel,
    gelezenOp: nu(),
    gelezenDoor: beller.naam,
    model: MODEL,
    bestand: gekozen.naam,
  }

  /*
   * Nog een controle die het model zelf niet doet: telt subtotaal plus btw op
   * tot het totaal? Zo niet, dan is er iets overgeslagen -- een kortingsregel,
   * statiegeld, verzendkosten -- en dat hoort de beoordelaar te weten.
   */
  const som = (lezing.subtotaalExcl ?? 0) + (lezing.btwBedrag ?? 0)
  if (lezing.subtotaalExcl != null && lezing.btwBedrag != null
      && lezing.totaalIncl != null && Math.abs(som - lezing.totaalIncl) > 0.02) {
    lezing.twijfel.push(
      `Subtotaal plus btw is ${som.toFixed(2)}, maar er staat ${lezing.totaalIncl.toFixed(2)} ` +
      'als totaal. Er zit iets tussen dat hier niet in staat.')
  }

  const { error: bewaarFout } = await admin
    .from('expenses')
    .update({ gelezen: lezing })
    .eq('id', expenseId)

  if (bewaarFout) {
    // Het lezen is gelukt; alleen het bewaren niet. Dan geven we het toch
    // terug -- dan kan het scherm er wel wat mee.
    console.warn('[factuur-lezen] bewaren mislukte: ' + bewaarFout.message)
  }

  console.log(`[factuur-lezen] ${beller.naam} las ${gekozen.naam} bij ${expenseId}`)
  return json({ ok: true, lezing, bewaard: !bewaarFout })
})
