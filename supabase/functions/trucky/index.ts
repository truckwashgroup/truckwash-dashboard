/**
 * Trucky -- de chatbot op de website.
 *
 * De website is statisch en staat bij Cloudflare. Die kan dus niet zelf met
 * Claude praten: daar is een sleutel voor nodig, en een sleutel in een
 * webpagina is geen sleutel maar een openbaar gemaakt wachtwoord. Deze functie
 * staat ertussen. Hij is bereikbaar zonder inlog -- een bezoeker heeft er geen
 * -- en houdt daarom zelf de kosten in de gaten.
 *
 * Uitrollen:  npm run functions:open
 * NOOIT kaal deployen: zonder --no-verify-jwt gaat de inlogcontrole aan en
 * krijgt elke bezoeker een 401.
 *
 * Nodig op de server:
 *   ANTHROPIC_API_KEY   staat er al (factuur-lezen gebruikt hem ook)
 *   RESEND_API_KEY      staat er al (stuur-mail gebruikt hem)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  zet Supabase zelf klaar
 *
 * Waarom rechtstreeks met fetch en niet met de SDK: factuur-lezen doet het al
 * zo, en één patroon in één map is meer waard dan de netste van twee. Een
 * pakket erbij is bovendien wachttijd bij elke koude start.
 */

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

/*
 * Hetzelfde afzenderadres als stuur-mail, en om dezelfde reden dezelfde
 * instelling: Resend weigert alles wat niet van een geverifieerd domein komt.
 *
 * Hier stond eerst info@truckwash1group.nl hardgecodeerd. Dat is het adres dat
 * op de site staat en dat een bezoeker zou verwachten -- maar het domein is bij
 * Resend niet geverifieerd, dus elke mail kwam terug met een weigering. Het
 * adres dat je wilt tonen en het adres waarvandaan je mag versturen zijn twee
 * verschillende dingen.
 *
 * Wil je hier alsnog info@truckwash1group.nl: verifieer dat domein bij Resend
 * en zet MAIL_FROM. Dan gaat stuur-mail vanzelf mee.
 */
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/*
 * Het lichtste model dat het werk aankan, op uitdrukkelijk verzoek.
 *
 * Dit is vragen beantwoorden over openingstijden, vestigingen en vacatures --
 * geen redeneerwerk. Haiku kost $1 per miljoen tokens invoer tegen $5 voor de
 * modellen erboven, en het verschil merkt een chauffeur hier niet.
 *
 * Geen denkstand aangezet: die bestaat op dit model in de oude vorm en levert
 * voor een vraag als "hoe laat is Venlo open" niets op behalve wachttijd.
 */
const MODEL = 'claude-haiku-4-5'

/* ------------------------------------------------------------------ *
 *  De grenzen
 *
 *  Hier en niet in de database, zodat bijstellen geen migratie kost.
 *
 *  De getallen zijn gekozen op wat een echt gesprek nodig heeft. Twaalf vragen
 *  is ruim: wie daarna nog vragen heeft, kan beter bellen -- en dat zegt Trucky
 *  dan ook. De dag-grenzen zijn er voor het geval dat iemand het adres vindt en
 *  gaat spelen; bij de huidige prijzen is de dagrekening dan hooguit een paar
 *  euro in plaats van onbeperkt.
 * ------------------------------------------------------------------ */

const MAX_VRAGEN_PER_GESPREK = 12
const MAX_GESPREKKEN_PER_DAG = 400
const MAX_TOKENS_PER_DAG = 2_000_000
/** Wat een bezoeker in één bericht kwijt kan. Voorkomt een geplakt boek. */
const MAX_TEKENS_PER_BERICHT = 1500
/** Hoeveel eerdere beurten er terug de API in gaan. Ouder is zelden nodig. */
const MAX_BEURTEN_TERUG = 12

/* ------------------------------------------------------------------ *
 *  Wat Trucky mag weten
 *
 *  De vestigingen komen uit de database, want die veranderen. De rest staat
 *  hier: dat is de vorm van de site en die verandert alleen als iemand een
 *  pagina toevoegt.
 * ------------------------------------------------------------------ */

const PAGINAS = [
  ['/', 'de startpagina'],
  ['/locaties/', 'alle achttien vestigingen met kaart en zoeken op postcode'],
  ['/diensten/', 'alle behandelingen'],
  ['/prijzen/', 'de tarieven'],
  ['/werken-bij/', 'vacatures en solliciteren'],
  ['/over-ons/', 'het bedrijf'],
  ['/veelgestelde-vragen/', 'veelgestelde vragen'],
  ['/contact/', 'telefoon, mail en het contactformulier'],
  ['/medewerkers/', 'de app voor medewerkers -- alleen voor eigen personeel'],
]

const DIENSTEN = [
  'alcoa-velgen-reinigen', 'bus-wasstraat', 'camper-wasstraat',
  'catering-op-locatie', 'haal-en-brengservice',
  'haccp-certificaat-en-behandeling', 'interieur-reinigen', 'nao-wasplaats',
  'truck-shop', 'truckparking', 'vogelgriep', 'vrachtwagen-polijsten',
  'wasboxen', 'wegrestaurant-a2',
]

/* ------------------------------------------------------------------ */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function db(pad: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pad}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`database ${res.status}: ${await res.text()}`)
  return res
}

/** De vestigingen zoals ze op de site staan. Zelfde bron als de site zelf. */
async function vestigingen(): Promise<string> {
  try {
    const res = await db('rpc/website_vestigingen', { method: 'POST', body: '{}' })
    const rijen = await res.json() as Array<Record<string, unknown>>
    return rijen.map((v) => {
      const u = v.openingstijden as Record<string, { van: string; tot: string } | null> ?? {}
      const tijden = Object.entries(u)
        .map(([d, w]) => `${d} ${w ? `${w.van}-${w.tot}` : 'dicht'}`).join(', ')
      return `- ${v.naam} (/locaties/${v.slug}/): ${v.adres}, ${v.postcode} ${v.plaats}. ` +
             `Tel ${v.telefoon}. Open: ${tijden || 'onbekend'}.`
    }).join('\n')
  } catch {
    /*
     * Zonder vestigingen kan Trucky nog steeds de weg wijzen. Een chatbot die
     * niets zegt omdat één vraag mislukte is slechter dan een die zegt "kijk
     * even op de locatiepagina".
     */
    return '(de vestigingslijst is nu niet op te halen -- verwijs naar /locaties/)'
  }
}

function opdracht(lijst: string): string {
  return `Je bent Trucky, de assistent op de website van Truckwash 1 Group.

Truckwash 1 Group wast vrachtwagens, bussen en campers op achttien vestigingen
in Nederland. Wassen kan zonder afspraak.

HOE JE PRAAT
- Nederlands, tutoyeren, korte zinnen. Je praat met chauffeurs en
  wagenparkbeheerders, niet met marketeers.
- Kort. Twee tot vier zinnen is bijna altijd genoeg.
- Weet je iets niet, zeg dat en verwijs naar 088 - 0600 100 of
  info@truckwash1group.nl. Verzin nooit een prijs, een openingstijd of een
  dienst die hieronder niet staat.
- Je bent geen verkoper. Niet aandringen.

DE WEG WIJZEN
Past er een pagina bij het antwoord, zet dan als ALLERLAATSTE regel precies:
[[pagina:/het/pad/]]
Die regel komt niet in beeld; de bezoeker krijgt er een knop van. Hoogstens
één per antwoord, en alleen als hij echt helpt. Noem het pad niet in je tekst.

DE PAGINA'S
${PAGINAS.map(([p, w]) => `${p} -- ${w}`).join('\n')}
Diensten hebben een eigen pagina op /diensten/<naam>/ met:
${DIENSTEN.join(', ')}
Elke vestiging heeft /locaties/<plaats>/.

WAT ER NIET VOOR JOU IS
/medewerkers/ is voor eigen personeel. Vraagt iemand naar inloggen of de app,
verwijs daarheen, maar ga er verder niet over.

DE VESTIGINGEN
${lijst}

Openingstijden die je hier niet ziet, weet je niet. Zeg dat dan.`
}

/* ------------------------------------------------------------------ *
 *  Het verslag per mail
 * ------------------------------------------------------------------ */

function geldigAdres(a: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(a.trim())
}

async function stuurVerslag(adres: string, beurten: Beurt[]) {
  const regels = beurten.map((b) =>
    `${b.role === 'user' ? 'Jij' : 'Trucky'}: ${b.content}`).join('\n\n')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: AFZENDER,
      /* Antwoorden gaan wél naar het adres dat de bezoeker kent. */
      reply_to: 'info@truckwash1group.nl',
      to: [adres.trim()],
      subject: 'Je gesprek met Trucky',
      // Platte tekst: dit gaat naar een adres dat een onbekende heeft
      // ingetikt, en dan is HTML alleen maar meer om fout te doen.
      text: `Hoi,\n\nHier is het gesprek dat je net met Trucky voerde.\n\n` +
            `${regels}\n\n---\nTruckwash 1 Group\n088 - 0600 100\n` +
            `truckwash1group.nl\n\nJe krijgt deze mail omdat je er in de chat ` +
            `zelf om hebt gevraagd. We bewaren je adres niet voor iets anders.`,
    }),
  })
  if (!res.ok) throw new Error(`mail ${res.status}: ${await res.text()}`)
}

/* ------------------------------------------------------------------ */

interface Beurt { role: 'user' | 'assistant'; content: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST.' }, 405)

  if (!ANTHROPIC_KEY) {
    return json({
      ok: false,
      reden: 'Trucky is nog niet ingesteld. Zet ANTHROPIC_API_KEY op de server.',
    }, 500)
  }

  let body: {
    gesprek?: string
    bericht?: string
    beurten?: Beurt[]
    actie?: 'verslag'
    email?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }

  const gesprek = String(body.gesprek ?? '').slice(0, 64)
  if (!/^[a-z0-9-]{8,64}$/.test(gesprek)) {
    return json({ ok: false, reden: 'Geen geldig gespreks-id.' }, 400)
  }

  const eerdere: Beurt[] = Array.isArray(body.beurten)
    ? body.beurten
        .filter((b) => b && (b.role === 'user' || b.role === 'assistant'))
        .map((b) => ({ role: b.role, content: String(b.content).slice(0, MAX_TEKENS_PER_BERICHT) }))
        .slice(-MAX_BEURTEN_TERUG)
    : []

  /* --- het verslag per mail --- */

  if (body.actie === 'verslag') {
    const adres = String(body.email ?? '')
    if (!geldigAdres(adres)) {
      return json({ ok: false, reden: 'Dat lijkt geen e-mailadres.' }, 400)
    }
    if (!RESEND_KEY) {
      return json({ ok: false, reden: 'Mailen is nog niet ingesteld.' }, 500)
    }
    if (!eerdere.length) {
      return json({ ok: false, reden: 'Er valt nog niets te versturen.' }, 400)
    }
    try {
      await stuurVerslag(adres, eerdere)
    } catch (e) {
      console.error('[trucky] verslag versturen', e)
      return json({
        ok: false,
        reden: 'Versturen lukte niet. Probeer het later nog eens, of mail ' +
          'info@truckwash1group.nl.',
      }, 502)
    }

    /*
     * De boekhouding pas hierna, en apart.
     *
     * De mail is op dit punt de deur uit. Zou een mislukte schrijfactie hier
     * alsnog een fout teruggeven, dan drukt de bezoeker nog een keer op
     * versturen en krijgt hij hem twee keer -- en wij een raadsel, want de
     * eerste is wel degelijk aangekomen.
     */
    try {
      await db(`trucky_gesprekken?id=eq.${encodeURIComponent(gesprek)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          email: adres.trim().toLowerCase(),
          verslag_at: Date.now(),
          updated_at: Date.now(),
        }),
      })
    } catch (e) {
      console.error('[trucky] verslag noteren', e)
    }

    return json({ ok: true })
  }

  /* --- een vraag --- */

  const vraag = String(body.bericht ?? '').trim()
  if (!vraag) return json({ ok: false, reden: 'Lege vraag.' }, 400)
  if (vraag.length > MAX_TEKENS_PER_BERICHT) {
    return json({
      ok: false,
      reden: `Houd het even korter -- maximaal ${MAX_TEKENS_PER_BERICHT} tekens.`,
    }, 400)
  }

  /*
   * De grenzen, vóór het geld wordt uitgegeven.
   *
   * Eerst de dag: is die op, dan hoeft er geen rij voor dit gesprek te komen.
   */
  try {
    const dag = await (await db('rpc/trucky_verbruik_vandaag', {
      method: 'POST', body: '{}',
    })).json() as Array<{ gesprekken: number; tokens: number }>
    const d = dag[0] ?? { gesprekken: 0, tokens: 0 }

    if (d.gesprekken >= MAX_GESPREKKEN_PER_DAG || d.tokens >= MAX_TOKENS_PER_DAG) {
      return json({
        ok: true,
        op: true,
        antwoord: 'Ik heb er voor vandaag genoeg op zitten -- er is even te veel ' +
          'tegelijk gevraagd. Bel gerust 088 - 0600 100, daar helpen ze je meteen.',
      })
    }

    /* Dan dit gesprek. Bestaat de rij niet, dan is dit de eerste vraag. */
    const bestaand = await (await db(
      `trucky_gesprekken?id=eq.${encodeURIComponent(gesprek)}` +
      '&select=aantal_vragen,invoer_tokens,uitvoer_tokens',
    )).json() as Array<{
      aantal_vragen: number; invoer_tokens: number; uitvoer_tokens: number
    }>

    const tot = bestaand[0] ?? { aantal_vragen: 0, invoer_tokens: 0, uitvoer_tokens: 0 }
    const alGesteld = tot.aantal_vragen
    if (alGesteld >= MAX_VRAGEN_PER_GESPREK) {
      return json({
        ok: true,
        op: true,
        antwoord: 'We zijn al aardig ver gekomen samen. Voor de rest kun je beter ' +
          'even bellen: 088 - 0600 100. Zal ik dit gesprek nog naar je mailen?',
      })
    }

    /* --- het echte werk --- */

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        /*
         * De opdracht in de cache.
         *
         * Gemeten na de eerste gesprekken: 5433 tokens invoer voor twee
         * vragen. Vrijwel alles daarvan is deze opdracht -- de achttien
         * vestigingen met hun openingstijden zijn er ruim tweeduizend, en die
         * gingen bij elke vraag opnieuw mee.
         *
         * Deze tekst is voor iedere bezoeker identiek en verandert alleen als
         * er in de app een vestiging wordt gewijzigd. Precies waar caching
         * voor is: een herlezing kost ongeveer een tiende. De vraag van de
         * bezoeker staat er ná, dus die breekt de cache niet.
         *
         * Belangrijk voor later: alles wat per bezoeker verschilt moet ACHTER
         * dit blok blijven. Zet er ooit een naam of een tijdstip in, dan is de
         * cache voor iedereen stuk en zie je dat alleen terug op de rekening.
         */
        system: [{
          type: 'text',
          text: opdracht(await vestigingen()),
          cache_control: { type: 'ephemeral' },
        }],
        messages: [...eerdere, { role: 'user', content: vraag }],
      }),
    })

    if (!res.ok) {
      console.error('[trucky] anthropic', res.status, await res.text())
      return json({
        ok: false,
        reden: 'Ik kan er even niet bij. Probeer het zo nog eens, of bel ' +
          '088 - 0600 100.',
      }, 502)
    }

    const uit = await res.json() as {
      content?: Array<{ type: string; text?: string }>
      usage?: {
        input_tokens?: number; output_tokens?: number
        cache_creation_input_tokens?: number; cache_read_input_tokens?: number
      }
      stop_reason?: string
    }

    let tekst = (uit.content ?? [])
      .filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()

    /* De verwijzing eruit knippen; de site maakt er een knop van. */
    let pagina: string | null = null
    tekst = tekst.replace(/\[\[pagina:\s*(\/[a-z0-9\-/]*)\s*\]\]/gi, (_m, p: string) => {
      pagina = p
      return ''
    }).trim()

    /* Gelezen uit de cache telt ook mee -- het is goedkoper, niet gratis. */
    const inTok = (uit.usage?.input_tokens ?? 0)
      + (uit.usage?.cache_creation_input_tokens ?? 0)
      + (uit.usage?.cache_read_input_tokens ?? 0)

    /*
     * De verdeling in het logboek, want alleen daaraan zie je of de cache
     * werkelijk aanslaat. De teller in de database telt alles bij elkaar op --
     * goed voor de dagrekening, maar dan zie je niet of "gelezen" nul blijft.
     *
     * Blijft cache_read op nul staan terwijl er verkeer is, dan is er iets in
     * de opdracht gaan verschillen per bezoeker. Dat kost geld en meldt zich
     * verder niet.
     */
    console.log('[trucky] tokens', JSON.stringify({
      nieuw: uit.usage?.input_tokens ?? 0,
      cache_geschreven: uit.usage?.cache_creation_input_tokens ?? 0,
      cache_gelezen: uit.usage?.cache_read_input_tokens ?? 0,
      uit: uit.usage?.output_tokens ?? 0,
    }))
    const uitTok = uit.usage?.output_tokens ?? 0

    /*
     * Bijschrijven. Als dit misgaat telt deze vraag niet mee -- vervelend voor
     * de boekhouding, maar geen reden om de bezoeker zijn antwoord te
     * onthouden dat al betaald is.
     */
    try {
      await db('trucky_gesprekken?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          id: gesprek,
          aantal_vragen: alGesteld + 1,
          invoer_tokens: tot.invoer_tokens + inTok,
          uitvoer_tokens: tot.uitvoer_tokens + uitTok,
          laatst_at: Date.now(),
          updated_at: Date.now(),
        }),
      })
    } catch (e) {
      console.error('[trucky] tellen', e)
    }

    return json({
      ok: true,
      antwoord: tekst || 'Daar weet ik zo even geen antwoord op. Bel gerust ' +
        '088 - 0600 100.',
      pagina,
      resterend: Math.max(0, MAX_VRAGEN_PER_GESPREK - (alGesteld + 1)),
    })
  } catch (e) {
    console.error('[trucky]', e)
    return json({
      ok: false,
      reden: 'Er ging iets mis aan onze kant. Probeer het zo nog eens.',
    }, 500)
  }
})
