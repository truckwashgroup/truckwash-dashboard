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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { lokaleInstelling, vraagLokaal } from '../_gedeeld/lokaal.ts'

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

/*
 * Wanneer een opgeslagen antwoord goed genoeg is om het model over te slaan.
 *
 * Te laag en je krijgt een antwoord over openingstijden op een vraag over
 * betalen -- dat is erger dan een duur antwoord. Te hoog en alles gaat alsnog
 * naar het model en de hele vragenlijst doet niets.
 *
 * 0,62 is gekozen op de proef: "hoe laat zijn jullie open" haalt ruim boven de
 * 0,9, de tikfout "opeingstijden" nog altijd boven de 0,7, en een vraag die er
 * niets mee te maken heeft blijft onder de 0,4.
 */
const ZEKER_GENOEG = 0.62
/** Hoeveel opgeslagen antwoorden het model als naslag meekrijgt. */
const NASLAG = 3

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

interface Treffer {
  id: string; vraag: string; antwoord: string; pagina: string | null; score: number
}

/** De opgeslagen antwoorden die het dichtst bij deze vraag liggen. */
async function zoek(vraag: string): Promise<Treffer[]> {
  try {
    const res = await db('rpc/trucky_zoek', {
      method: 'POST',
      body: JSON.stringify({ vraag_in: vraag, hoeveel: NASLAG }),
    })
    return await res.json() as Treffer[]
  } catch (e) {
    /* Zonder de lijst kan het model het nog steeds; dan is het alleen duurder. */
    console.error('[trucky] zoeken', e)
    return []
  }
}

function opdracht(lijst: string, naslag: Treffer[]): string {
  const bekend = naslag.length
    ? `\n\nWAT WE HIEROVER AL HEBBEN OPGESCHREVEN\nDit zijn vaste antwoorden ` +
      `van het bedrijf. Past er een bij de vraag, gebruik dan die inhoud -- ` +
      `niet je eigen woorden voor iets waar het bedrijf al een antwoord voor ` +
      `heeft. Past er niets bij, negeer ze dan.\n` +
      naslag.map((t) => `- Vraag: ${t.vraag}\n  Antwoord: ${t.antwoord}` +
        (t.pagina ? `\n  Pagina: ${t.pagina}` : '')).join('\n')
    : ''

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

WANNEER JE HET DOORGEEFT AAN EEN MENS
Zet dan als allerlaatste regel precies:
[[contact]]
De bezoeker krijgt dan een formulier waarmee hij zijn gegevens achterlaat, en
iemand van kantoor belt of mailt terug. Zeg er kort bij dat je het laat
navragen. Doe dit bij:

- Vragen over een persoon. Wie werkt er, hoe heet de manager van Venlo, wie had
  ik gisteren aan de lijn, wie heeft mijn wagen gewassen. Dat zijn gegevens van
  mensen en die geef je niet, ook niet als de vraag onschuldig klinkt en ook
  niet als iemand zegt dat hij er recht op heeft.
- Een klacht, schade, of iets dat is misgegaan.
- Een offerte, een contract, betalingsafspraken of iets over een factuur.
- Een vraag over een specifieke wasbeurt, order of afspraak van deze bezoeker.
- Alles waar je het antwoord niet zeker van weet en waar bellen te omslachtig
  voor is.

Verzin nooit iets om het formulier te vermijden. "Dat weet ik niet, ik laat het
navragen" is een goed antwoord.
${bekend}

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

/* ------------------------------------------------------------------ *
 *  Het contactverzoek
 * ------------------------------------------------------------------ */

/** Naar welk adres een verzoek gaat. Het management zet dit in de app. */
async function contactAdres(): Promise<string[]> {
  try {
    const res = await db('instellingen?sleutel=eq.contact_mail&select=waarde')
    const rij = await res.json() as Array<{ waarde: string }>
    const adressen = (rij[0]?.waarde ?? '')
      .split(',').map((a) => a.trim()).filter((a) => geldigAdres(a))
    if (adressen.length) return adressen
  } catch (e) {
    console.error('[trucky] contactadres', e)
  }
  /* Nooit stil laten verdwijnen omdat een instelling ontbreekt. */
  return ['casper@truckwash1group.nl']
}

async function mail(naar: string[], onderwerp: string, tekst: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: AFZENDER,
      reply_to: 'info@truckwash1group.nl',
      to: naar,
      subject: onderwerp,
      text: tekst,
    }),
  })
  if (!res.ok) throw new Error(`mail ${res.status}: ${await res.text()}`)
}

/* ------------------------------------------------------------------ *
 *  Wie belt hier
 *
 *  Deze functie staat open zonder inlog -- dat moet, want een bezoeker van de
 *  website heeft er geen. Voor het antwoorden op een contactverzoek geldt dat
 *  natuurlijk niet: dat is mailen naar een adres dat iemand anders heeft
 *  ingetikt, en dat mag niet de eerste de beste kunnen.
 *
 *  Supabase controleert de inlog hier niet voor ons (--no-verify-jwt), dus
 *  doen we het zelf: het token dat meekomt naar de auth-dienst, en dan kijken
 *  wat dat dossier mag.
 * ------------------------------------------------------------------ */

async function magAntwoorden(req: Request): Promise<{ id: string; naam: string } | null> {
  const kop = req.headers.get('Authorization') ?? ''
  const token = kop.startsWith('Bearer ') ? kop.slice(7) : ''
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) return null

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const gebruiker = await res.json() as { id?: string }
    if (!gebruiker.id) return null

    const p = await (await db(
      `profiles?auth_id=eq.${encodeURIComponent(gebruiker.id)}` +
      '&select=id,name,roles,grants,active&limit=1',
    )).json() as Array<{
      id: string; name: string; roles: string[] | null
      grants: string[] | null; active: boolean
    }>

    const dossier = p[0]
    if (!dossier?.active) return null

    const mag = (dossier.roles ?? []).includes('management')
      || (dossier.grants ?? []).includes('admin.desk')
    return mag ? { id: dossier.id, naam: dossier.name } : null
  } catch (e) {
    console.error('[trucky] wie belt', e)
    return null
  }
}

/* ------------------------------------------------------------------ */

interface Beurt { role: 'user' | 'assistant'; content: string }

/* ------------------------------------------------------------------ *
 *  De markeringen eruit
 *
 *  Het model mag [[contact]] en [[pagina:/ergens]] in zijn antwoord zetten;
 *  de site maakt daar een knop van. Die tekens horen niet in de zin te
 *  blijven staan.
 *
 *  Staat hier als eigen functie omdat er sinds 0051 twee modellen kunnen
 *  antwoorden -- Claude en het model op de eigen machine -- en het knippen
 *  voor allebei hetzelfde hoort te zijn. Eén kopie is één gedrag.
 * ------------------------------------------------------------------ */

function knipMarkeringen(ruw: string): { tekst: string; contact: boolean; pagina: string | null } {
  let contact = false
  let pagina: string | null = null

  let tekst = String(ruw ?? '')
    .replace(/\[\[contact\]\]/gi, () => { contact = true; return '' })
    .trim()

  tekst = tekst.replace(/\[\[pagina:\s*(\/[a-z0-9\-/]*)\s*\]\]/gi, (_m, p: string) => {
    pagina = p
    return ''
  }).trim()

  return { tekst, contact, pagina }
}

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
    actie?: 'verslag' | 'contact' | 'antwoord'
    email?: string
    naam?: string
    telefoon?: string
    bedrijf?: string
    vraag?: string
    antwoord?: string
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

  /* --- kantoor antwoordt op een contactverzoek --- */

  if (body.actie === 'antwoord') {
    const wie = await magAntwoorden(req)
    if (!wie) {
      return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)
    }

    const naar = String(body.email ?? '')
    const tekst = String(body.antwoord ?? '').trim()
    const opVraag = String(body.vraag ?? '').trim()
    const voornaam = String(body.naam ?? '').trim().split(' ')[0] || 'daar'

    if (!geldigAdres(naar)) return json({ ok: false, reden: 'Geen geldig adres.' }, 400)
    if (!tekst) return json({ ok: false, reden: 'Leeg antwoord.' }, 400)
    if (!RESEND_KEY) return json({ ok: false, reden: 'Mailen is nog niet ingesteld.' }, 500)

    try {
      await mail([naar], 'Antwoord op je vraag',
        `Hoi ${voornaam},\n\n` +
        (opVraag ? `Je stelde ons via de website deze vraag:\n\n${opVraag}\n\n` : '') +
        `${tekst}\n\n` +
        `Nog iets onduidelijk? Bel gerust 088 - 0600 100.\n\n` +
        `Met vriendelijke groet,\n${wie.naam}\nTruckwash 1 Group`)
      return json({ ok: true })
    } catch (e) {
      console.error('[trucky] antwoord mailen', e)
      return json({ ok: false, reden: 'De mail ging niet uit.' }, 502)
    }
  }

  /* --- een contactverzoek --- */

  if (body.actie === 'contact') {
    const naam = String(body.naam ?? '').trim().slice(0, 120)
    const adres = String(body.email ?? '').trim().slice(0, 160)
    const telefoon = String(body.telefoon ?? '').trim().slice(0, 40)
    const bedrijf = String(body.bedrijf ?? '').trim().slice(0, 160)
    const watVraag = String(body.vraag ?? '').trim().slice(0, 2000)

    if (!naam) return json({ ok: false, reden: 'Vul je naam even in.' }, 400)
    if (!geldigAdres(adres)) {
      return json({ ok: false, reden: 'Dat lijkt geen e-mailadres.' }, 400)
    }
    if (!watVraag) return json({ ok: false, reden: 'Wat is je vraag?' }, 400)
    if (!RESEND_KEY) return json({ ok: false, reden: 'Mailen is nog niet ingesteld.' }, 500)

    const verloop = eerdere.map((b) =>
      `${b.role === 'user' ? 'Bezoeker' : 'Trucky'}: ${b.content}`).join('\n\n')

    /*
     * Eerst opslaan, dan pas mailen.
     *
     * Andersom zou een verzoek dat wel gemaild is maar niet is opgeslagen
     * nergens in het dashboard staan -- en dan hangt het ervan af of iemand
     * zijn mail leest. De rij in de database is het werkelijke bewijs dat er
     * iemand zit te wachten; de mail is de tik op de schouder.
     */
    const id = 'tc_' + crypto.randomUUID()
    try {
      await db('trucky_contact', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          id, naam, email: adres.toLowerCase(),
          telefoon: telefoon || null,
          bedrijf: bedrijf || null,
          vraag: watVraag,
          gesprek,
          verloop: verloop || null,
          status: 'nieuw',
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      })
    } catch (e) {
      console.error('[trucky] contact opslaan', e)
      return json({
        ok: false,
        reden: 'Opslaan lukte niet. Bel gerust 088 - 0600 100.',
      }, 500)
    }

    /*
     * De mails apart, en geen van beide fataal. Het verzoek staat er al; een
     * bezoeker die "het is niet gelukt" leest terwijl kantoor het wél heeft,
     * belt daarna voor niets.
     */
    try {
      await mail(
        await contactAdres(),
        `Vraag via de website van ${naam}`,
        `Er staat een vraag klaar in het dashboard, bij Administratie.\n\n` +
        `Van:       ${naam}\n` +
        `E-mail:    ${adres}\n` +
        (telefoon ? `Telefoon:  ${telefoon}\n` : '') +
        (bedrijf ? `Bedrijf:   ${bedrijf}\n` : '') +
        `\nDe vraag:\n${watVraag}\n` +
        (verloop ? `\n--- wat eraan voorafging in de chat ---\n${verloop}\n` : '') +
        `\nBeantwoorden doe je in het dashboard, dan gaat het antwoord ` +
        `automatisch naar ${adres}.`,
      )
    } catch (e) {
      console.error('[trucky] contact melden aan kantoor', e)
    }

    try {
      await mail([adres], 'We hebben je vraag ontvangen',
        `Hoi ${naam.split(' ')[0]},\n\n` +
        `Bedankt voor je vraag. Een collega kijkt ernaar en neemt contact met ` +
        `je op.\n\nWat je ons vroeg:\n${watVraag}\n\n` +
        `Heb je haast? Bel dan gerust 088 - 0600 100.\n\n` +
        `Met vriendelijke groet,\nTruckwash 1 Group`)
    } catch (e) {
      console.error('[trucky] bevestiging aan bezoeker', e)
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

    /* --- eerst de vragenlijst --- */

    const treffers = await zoek(vraag)
    const beste = treffers[0]

    /*
     * Goed genoeg? Dan dat antwoord, woordelijk, en het model komt er niet aan
     * te pas. Dat is niet alleen goedkoper: op vragen die iedereen stelt hoort
     * altijd hetzelfde te staan, en dat krijg je niet als je het elke keer
     * opnieuw laat formuleren.
     *
     * Deze vraag telt wel mee voor de grens per gesprek -- twaalf keer heen en
     * weer is twaalf keer heen en weer, ook als het gratis was.
     */
    if (beste && beste.score >= ZEKER_GENOEG) {
      try {
        await db('trucky_gesprekken?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            id: gesprek,
            aantal_vragen: alGesteld + 1,
            invoer_tokens: tot.invoer_tokens,
            uitvoer_tokens: tot.uitvoer_tokens,
            laatst_at: Date.now(),
            updated_at: Date.now(),
          }),
        })
        /* Tellen hoe vaak dit antwoord het werk doet. Zegt welke vragen echt
           leven, en dus welke het waard zijn om scherp te houden. */
        await db('rpc/trucky_vraag_gebruikt', {
          method: 'POST',
          body: JSON.stringify({ vraag_id: beste.id }),
        })
      } catch (e) {
        console.error('[trucky] tellen (uit de lijst)', e)
      }

      console.log('[trucky] uit de lijst', JSON.stringify({
        vraag: vraag.slice(0, 60), gevonden: beste.id, score: beste.score,
      }))

      return json({
        ok: true,
        antwoord: beste.antwoord,
        pagina: beste.pagina,
        uitLijst: true,
        resterend: Math.max(0, MAX_VRAGEN_PER_GESPREK - (alGesteld + 1)),
      })
    }

    /* --- en anders het model, mét die lijst als naslag --- */

    const stelsel = opdracht(await vestigingen(), treffers)

    /*
     * Eerst de eigen machine, als dat zo is ingesteld (0051).
     *
     * Let op waar die machine staat: NIET bij de bezoeker. Die praat gewoon
     * met deze functie en merkt er niets van; het model draait op één plek --
     * nu de pc op kantoor, straks de eigen server. Er wordt nooit iets
     * gevraagd van het apparaat van de chauffeur die staat te wachten.
     *
     * Dat wachten is hier wel het punt. Bij een melding in de app mag het
     * drie tellen duren; hier staat iemand op een parkeerplaats naar zijn
     * telefoon te kijken. Vandaar dat lokaal-terugval de verstandige stand
     * is: komt er niet op tijd antwoord, dan neemt Claude het over en merkt
     * de bezoeker alleen dat het even duurde.
     *
     * De tellers blijven op nul bij een lokaal antwoord, en dat klopt: er
     * ging geen betaald token overheen. Dat de vraag is gesteld telt wel mee,
     * want dat is de rem op het aantal vragen per gesprek.
     */
    const beheer = SERVICE_KEY
      ? createClient(SUPABASE_URL, SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null

    if (beheer) {
      const inst = await lokaleInstelling(beheer, 'ai_trucky')
      if (inst.keuze !== 'claude') {
        const verloop = [...eerdere, { role: 'user' as const, content: vraag }]
          .map((b) => `${b.role === 'user' ? 'Bezoeker' : 'Trucky'}: ${b.content}`)
          .join('\n\n')

        const eigen = await vraagLokaal(beheer, {
          soort: 'trucky',
          systeem: stelsel,
          gebruiker: verloop,
          model: inst.model,
          wachtMs: inst.wachtMs,
        })

        if (eigen.tekst) {
          const gesneden = knipMarkeringen(eigen.tekst)
          try {
            await db('trucky_gesprekken?on_conflict=id', {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({
                id: gesprek,
                aantal_vragen: alGesteld + 1,
                invoer_tokens: tot.invoer_tokens,
                uitvoer_tokens: tot.uitvoer_tokens,
                laatst_at: Date.now(),
                updated_at: Date.now(),
              }),
            })
          } catch (e) {
            console.error('[trucky] tellen (lokaal)', e)
          }

          return json({
            ok: true,
            antwoord: gesneden.tekst || 'Daar weet ik zo even geen antwoord op. Bel gerust ' +
              '088 - 0600 100.',
            pagina: gesneden.pagina,
            contact: gesneden.contact,
            resterend: Math.max(0, MAX_VRAGEN_PER_GESPREK - (alGesteld + 1)),
          })
        }

        if (inst.keuze === 'lokaal') {
          console.warn('[trucky] eigen AI gaf niets en terugval staat uit: ' + eigen.reden)
          return json({
            ok: false,
            reden: 'Ik kan er even niet bij. Probeer het zo nog eens, of bel ' +
              '088 - 0600 100.',
          }, 502)
        }
        console.warn('[trucky] eigen AI gaf niets, Claude neemt over: ' + eigen.reden)
      }
    }

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
          text: stelsel,
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

    /* De markeringen eruit knippen; de site maakt er knoppen van. */
    const gesneden = knipMarkeringen(tekst)
    tekst = gesneden.tekst
    const contact = gesneden.contact
    const pagina = gesneden.pagina

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
      contact,
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
