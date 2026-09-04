/* ===========================================================================
 *  Het gesprek bij een melding, en het plan dat eruit komt
 *
 *  Twee dingen, één functie, omdat het dezelfde stof is:
 *
 *    doel: 'vraag'  -> wat is de volgende zinnige vraag aan de melder?
 *    doel: 'plan'   -> maak er een plan van, in stappen die los aan en uit
 *                      kunnen
 *
 *  Waarom dit op de server staat en niet in de app: de sleutel. Een sleutel
 *  die in de app zit, zit op iedere telefoon waar de app op staat.
 *
 *  Wat hier bewust niet gebeurt: iets wegschrijven. Deze functie leest de
 *  melding, denkt na, en geeft antwoord. Het opslaan doet de app, langs de
 *  gewone weg, met de gewone beveiligingsregels. Een functie met de
 *  servicesleutel die ook nog mag schrijven is een functie waar je heel
 *  zeker van moet zijn.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { lokaleInstelling, vraagLokaal } from '../_gedeeld/lokaal.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
/*
 * Voor het postvak naar de eigen AI (0051). Deze functie schrijft verder
 * niets met de servicesleutel -- alleen een opdracht neerleggen en het
 * antwoord ophalen. Het opslaan van de melding zelf blijft langs de gewone
 * weg gaan, met de gewone beveiligingsregels.
 */
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const MODEL = 'claude-sonnet-5'

/** Hoeveel beurten een gesprek hoogstens duurt. Ook een kostenrem. */
const MAX_BEURTEN = 12
const MAX_TEKST = 4000

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

interface Beurt { vraag: string; antwoord: string }

/* ------------------------------------------------------------------ *
 *  Wat de assistent moet doen
 * ------------------------------------------------------------------ */

const ROL = `
Je helpt bij Truckwash1 Group, een Nederlands bedrijf met negentien
vrachtwagenwasstraten en een hoofdkantoor. Je praat met iemand die zojuist
een melding heeft gemaakt in het dashboard: een wasmedewerker, een voorman,
iemand van kantoor, een chauffeur of een klant.

Je schrijft Nederlands. Gewone taal, geen jargon, geen Engels waar een
Nederlands woord bestaat. Je tutoyeert. Je bent kort.

De mensen die je spreekt staan meestal in een natte wasstraat met
werkhandschoenen aan. Ze hebben geen zin in een vragenlijst en ze weten niet
wat een "stack trace" is. Vraag naar wat ze deden en wat ze zagen, niet naar
techniek.
`.trim()

const VRAAG_OPDRACHT = `
Stel één vraag die je nog niet weet en die echt uitmaakt voor wat er moet
gebeuren. Geen twee vragen in één zin.

Vraag niet naar dingen die de app zelf al weet: de versie, het apparaat, het
scherm waar hij vandaan kwam, of hoe laat het was. Dat staat er allemaal al
bij.

Ben je er wel zo'n beetje -- je weet wat er misging of wat iemand wil, wanneer
het gebeurt en wat het hem kost -- geef dan aan dat je klaar bent. Liever drie
goede vragen dan acht plichtmatige.

Antwoord met alleen JSON:
{"klaar": false, "vraag": "..."}
of
{"klaar": true}
`.trim()

const PLAN_OPDRACHT = `
Maak van deze melding een plan in stappen.

Elke stap is één ding dat je los kunt besluiten. Iemand gaat er straks
vinkjes bij zetten, dus "vervang de knop en herschrijf het scherm" zijn twee
stappen. Twee tot zes stappen is normaal; meer betekent meestal dat je te
klein snijdt.

Per stap:
- titel: kort, wat er verandert
- wat: in gewone woorden wat de gebruiker straks anders ziet of kan
- waarom: waar de melder om vroeg, in zijn eigen woorden waar dat kan
- raakt: welk deel van de app (Planning, Postbus, Rooster, Personeel...)
- risico: "klein" | "gemiddeld" | "groot" -- groot als het gegevens raakt die
  al bestaan, of iets wat op negentien vestigingen tegelijk anders gaat werken
- omvang: "klein" | "middel" | "groot"

Verzin er niets bij. Vraagt iemand om één ding, maak er dan geen drie van.
Wat je zou willen doen maar wat buiten de vraag valt, zet je in
"buitenScope" -- dan staat het er wel, maar niet als besluit.

Antwoord met alleen JSON:
{
  "titel": "...",
  "aanleiding": "één alinea: wat de melder wil en waarom",
  "stappen": [{"titel":"...","wat":"...","waarom":"...","raakt":"...","risico":"klein","omvang":"klein"}],
  "buitenScope": "... of laat weg"
}
`.trim()

/* ------------------------------------------------------------------ *
 *  Anthropic
 * ------------------------------------------------------------------ */

/**
 * Nadenken over deze melding.
 *
 * Sinds 0051 kan dat ook op de eigen pc. Wat er gebeurt hangt af van de
 * instelling ai_melding:
 *
 *   claude            zoals altijd
 *   lokaal            alleen de eigen pc; is die er niet, dan geen antwoord
 *   lokaal-terugval   eerst de eigen pc, en anders alsnog Claude
 *
 * De uitkomst is in alle gevallen hetzelfde: het JSON-object dat de app
 * verwacht, of null. Welk model het deed staat in het logboek, niet in het
 * antwoord -- daar heeft de melder niets aan.
 */
async function denk(systeem: string, gebruiker: string): Promise<unknown | null> {
  if (SERVICE_KEY) {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const inst = await lokaleInstelling(admin, 'ai_melding')

    if (inst.keuze !== 'claude') {
      const uit = await vraagLokaal(admin, {
        soort: 'melding',
        systeem,
        gebruiker,
        model: inst.model,
        wachtMs: inst.wachtMs,
      })
      if (uit.tekst) return leesJson(uit.tekst)

      if (inst.keuze === 'lokaal') {
        console.warn('[melding-gesprek] eigen AI gaf niets en terugval staat uit: ' + uit.reden)
        return null
      }
      console.warn('[melding-gesprek] eigen AI gaf niets, Claude neemt over: ' + uit.reden)
    }
  }

  if (!ANTHROPIC_KEY) return null

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systeem,
      messages: [{ role: 'user', content: gebruiker }],
    }),
  })

  if (!res.ok) {
    console.error(`[melding-gesprek] Anthropic gaf ${res.status}: ${await res.text()}`)
    return null
  }

  const body = await res.json()
  const tekst = (body?.content ?? [])
    .filter((c: { type?: string }) => c?.type === 'text')
    .map((c: { text?: string }) => c.text ?? '')
    .join('')

  return leesJson(tekst)
}

/**
 * De JSON eruit vissen.
 *
 * Soms komt er een zin omheen, ook als je erom vraagt van niet. Dat is geen
 * reden om het hele antwoord weg te gooien.
 */
function leesJson(tekst: string): unknown | null {
  const zonderHek = tekst.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(zonderHek.trim())
  } catch { /* dan met de hand zoeken */ }

  const begin = zonderHek.indexOf('{')
  const eind = zonderHek.lastIndexOf('}')
  if (begin < 0 || eind <= begin) return null
  try {
    return JSON.parse(zonderHek.slice(begin, eind + 1))
  } catch {
    console.error('[melding-gesprek] antwoord was geen bruikbare JSON')
    return null
  }
}

/* ------------------------------------------------------------------ *
 *  De melding in woorden
 * ------------------------------------------------------------------ */

function beschrijf(ticket: Record<string, unknown>, gesprek: Beurt[]): string {
  const soort: Record<string, string> = {
    fout: 'Er gaat iets fout',
    wens: 'Een wens',
    traag: 'Traag of hapert',
    vraag: 'Een vraag',
  }

  const regels = [
    `Soort melding: ${soort[String(ticket.kind)] ?? String(ticket.kind)}`,
    `Titel: ${String(ticket.title ?? '').slice(0, 300)}`,
    `Wat hij zelf schreef: ${String(ticket.description ?? '').slice(0, MAX_TEKST)}`,
  ]
  if (ticket.fromPage) regels.push(`Gemeld vanaf het scherm: ${String(ticket.fromPage)}`)
  if (ticket.fromRole) regels.push(`Hij werkt hier als: ${String(ticket.fromRole)}`)
  if (ticket.priority) regels.push(`Prioriteit die hij koos: ${String(ticket.priority)}`)

  if (gesprek.length) {
    regels.push('', 'Wat er daarna is gevraagd en geantwoord:')
    for (const b of gesprek) {
      regels.push(`V: ${b.vraag}`)
      regels.push(`A: ${b.antwoord}`)
    }
  }

  return regels.join('\n')
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  if (!ANTHROPIC_KEY) {
    // Geen sleutel is geen storing: de app valt dan terug op de vragenlijst.
    return json({ ok: false, reden: 'geen-sleutel' })
  }

  /* ---- wie belt er? ---- */

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'Niet ingelogd' }, 401)

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: wie, error: wieFout } = await client.auth.getUser()
  if (wieFout || !wie?.user) return json({ error: 'Niet ingelogd' }, 401)

  /*
   * Actief account vereist. Een aanmelding die nog op beoordeling wacht mag
   * hier niet bij -- anders is dit een gratis taalmodel voor iedereen die
   * een e-mailadres heeft.
   */
  const { data: profiel } = await client
    .from('profiles')
    .select('id, active')
    .eq('auth_id', wie.user.id)
    .maybeSingle()

  if (!profiel?.active) return json({ error: 'Geen toegang' }, 403)

  /* ---- wat wil hij? ---- */

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Onleesbaar verzoek' }, 400)
  }

  const doel = String(body.doel ?? 'vraag')
  const ticket = (body.ticket ?? {}) as Record<string, unknown>
  const gesprek = (Array.isArray(body.gesprek) ? body.gesprek : [])
    .slice(0, MAX_BEURTEN)
    .map((b: Beurt) => ({
      vraag: String(b?.vraag ?? '').slice(0, 500),
      antwoord: String(b?.antwoord ?? '').slice(0, 2000),
    }))
    .filter((b: Beurt) => b.antwoord)

  if (!ticket.title && !ticket.description) {
    return json({ error: 'Er staat nog geen melding in' }, 400)
  }

  const verhaal = beschrijf(ticket, gesprek)

  try {
    if (doel === 'plan') {
      const uit = await denk(`${ROL}\n\n${PLAN_OPDRACHT}`, verhaal) as Record<string, unknown> | null
      if (!uit) return json({ ok: false, reden: 'geen-antwoord' })
      return json({ ok: true, plan: uit })
    }

    // Genoeg is genoeg, ook als het model dat zelf niet vindt.
    if (gesprek.length >= MAX_BEURTEN) return json({ ok: true, klaar: true })

    const uit = await denk(`${ROL}\n\n${VRAAG_OPDRACHT}`, verhaal) as
      { klaar?: boolean; vraag?: string } | null
    if (!uit) return json({ ok: false, reden: 'geen-antwoord' })

    if (uit.klaar || !uit.vraag) return json({ ok: true, klaar: true })
    return json({ ok: true, klaar: false, vraag: String(uit.vraag).slice(0, 500) })
  } catch (e) {
    console.error('[melding-gesprek] ' + String(e))
    return json({ ok: false, reden: 'fout' })
  }
})
