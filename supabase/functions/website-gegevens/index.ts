/* ===========================================================================
 *  Wat de website mag weten
 *
 *  De site truckwash1group.nl wordt gebouwd uit een JSON-bestand dat met de
 *  hand is bijgehouden. Zolang dat zo is, staat het adres van een vestiging
 *  op twee plekken, en gaan die twee vroeg of laat uit elkaar lopen. Deze
 *  functie is de lijn waarlangs de sitebouw de gegevens uit het dashboard
 *  ophaalt, zodat de database de enige plek is waar ze staan.
 *
 *  Waarom dit op de server staat en niet in het bouwscript: de twee functies
 *  website_vestigingen() en website_aantal_medewerkers() zijn allebei security
 *  definer en mogen alleen door service_role worden uitgevoerd -- anon en
 *  authenticated zijn er in 0033 en 0034 met opzet van uitgesloten, en er
 *  staat een controle in scripts/sqltest.mjs die faalt zodra dat terugkomt.
 *  Aanroepen kan dus alleen met de servicesleutel, en die hoort niet in een
 *  bouwscript op een laptop. Hier staat hij in de omgeving van de functie en
 *  komt hij nergens anders.
 *
 *  Waarom deze functie zonder inlog te bereiken is (--no-verify-jwt): de
 *  sitebouw heeft geen inlog. Dat had ook gekund met verify_jwt aan en de
 *  anon-sleutel als bewijs, maar dat zou toneel zijn: die sleutel staat in de
 *  app en op de website, dus iedereen die de deur wil openen heeft de sleutel
 *  al. Een open deur is dan eerlijker dan een deur met een slot dat niet
 *  sluit.
 *
 *  Dat mag hier, omdat op een ding na alles wat hier uit komt al als HTML op
 *  truckwash1group.nl staat -- de coordinaten en de e-mailadressen staan daar
 *  zelfs al machineleesbaar in de JSON-LD van elke vestigingspagina. Wie dit
 *  adres raadt, krijgt dezelfde gegevens, netter opgemaakt.
 *
 *  Het ene ding: het aantal medewerkers. Dat staat nergens op de site, en het
 *  is een getal dat leeft. Op de vacaturepagina wordt het bij een bouw in de
 *  HTML gebakken -- een momentopname -- maar wie dit adres kent kan het elke
 *  week opvragen en er verloop uit lezen. Dat is echt, en het is klein. Het
 *  staat hier opgeschreven zodat niemand later hoeft te ontdekken dat het
 *  over het hoofd is gezien.
 *
 *  DE REGEL DIE DEZE FUNCTIE VEILIG HOUDT: hij leest geen enkele waarde uit
 *  het verzoek. Geen body, geen zoekterm, geen kopregel. Dat is geen luiheid,
 *  het is de hele beveiliging. Deze functie draait met service_role en kan
 *  overal bij. Zodra ze een waarde van de beller aanneemt -- een slug om op
 *  te filteren, een tabelnaam, een "handig voor later"-parameter -- wordt die
 *  waarde verwerkt door een proces dat overal bij kan, en dan is dit geen
 *  doorgeefluik meer maar een gat. Wie hier iets wil toevoegen: doe het in de
 *  SQL-functie, niet hier.
 *
 *  Om dezelfde reden staat er geen tweede query in en worden er geen kolommen
 *  bijgemaakt. Wat naar buiten mag staat op een plek vast, en die plek is
 *  website_vestigingen(). scripts/sqltest.mjs bewaakt dat daar geen interne
 *  notitie, geen vestigingsmanager en geen vestiging die uit staat in zit --
 *  sinds deze functie bestaat is dat niet alleen een privacycontrole maar een
 *  publicatiecontrole.
 *
 *  Er is een uitzondering op "geen kolommen bijgemaakt", en die staat hier
 *  hardop: bij elke foto komt een veld "url". Dat is geen nieuw gegeven maar
 *  het pad uit de database met het adres van de opslag ervoor -- en dat adres
 *  kent alleen deze functie. De site hoort niet te weten bij welk Supabase-
 *  project hij hoort; dan staat het projectadres op twee plekken en loopt het
 *  bij een verhuizing uit elkaar. Er wordt daarbij niets uit het verzoek
 *  gelezen, dus de regel hierboven blijft staan.
 *
 * ---------------------------------------------------------------------------
 *  WAT ERUIT KOMT
 *
 *  Goed:  200
 *    {
 *      "ok": true,
 *      "medewerkers": 5,
 *      "vestigingen": [ { ...zeventien velden... }, ... ]
 *    }
 *
 *  Mis:   405 of 500
 *    { "ok": false, "reden": "een zin die zegt wat er aan de hand is" }
 *
 *  De zeventien velden per vestiging, in de namen van de database. Dit is
 *  letterlijk wat website_vestigingen() teruggeeft, ongewijzigd (op de "url"
 *  per foto na, zie hierboven):
 *
 *    slug            text      het webadres, bijvoorbeeld "aalsmeer"
 *    naam            text      "Truckwash Aalsmeer" -- MET het voorvoegsel
 *    adres           text      straat en huisnummer
 *    postcode        text
 *    plaats          text
 *    telefoon        text
 *    email           text
 *    lat             float8
 *    lon             float8
 *    wasstraten      int       zie waarschuwing 3 hieronder
 *    openingstijden  jsonb     {"ma":{"van":"07:00","tot":"19:00"}, ..., "zo":null}
 *                              dag ontbreekt = niet ingevuld, null = dicht
 *    intro           text
 *    bereikbaar      text
 *    bijzonder       text      vrij veld; staat vandaag nergens op de site
 *    diensten        text[]    SLEUTELS naar dienstpagina's
 *    punten          text[]    de verkooptekst die op de pagina staat
 *    fotos           jsonb     de foto's uit het beheerscherm, omslag eerst:
 *                              [{ "pad": "loc_x/lfoto_y.jpg",
 *                                 "bijschrift": "De oprit" | null,
 *                                 "cover": true,
 *                                 "volgorde": 0,
 *                                 "url": "https://.../storage/v1/object/public/vestigingen/loc_x/lfoto_y.jpg" }]
 *                              "url" is hier toegevoegd (zie boven); de rest
 *                              komt zo uit de database. Een vestiging zonder
 *                              foto's heeft een lege lijst, geen null. De emmer
 *                              is openbaar leesbaar (0026), dus de url werkt
 *                              zonder sleutel -- de site zet hem zo in een
 *                              <img>.
 *
 *  Er staat met opzet geen tijdstempel in het antwoord. Wanneer iets is
 *  opgehaald weet de beller zelf beter dan deze functie, en het is geen
 *  gegeven dat uit de database komt.
 *
 * ---------------------------------------------------------------------------
 *  DRIE DINGEN DIE DE BELLER ZELF MOET DOEN
 *
 *  Deze functie vertaalt niets. Dat is met opzet: de vertaling naar de vorm
 *  die de site wil is sitekennis en hoort in het bouwscript, waar iemand die
 *  aan de site werkt hem tegenkomt. Maar deze drie gaan stil fout -- geen
 *  foutmelding, gewoon een verkeerde website -- dus ze staan hier ook.
 *
 *  1. DE VOLGORDE IS NIET DE VOLGORDE VAN DE SITE. De SQL eindigt op
 *     "order by l.name" en de site staat gesorteerd op plaats. Hazeldonk heet
 *     in de database "Truckwash Hazeldonk" maar ligt in Breda, en verspringt
 *     daardoor van plek 5 naar plek 9. Dat verandert de voetbalk op elke
 *     pagina, de nummering 01..18 op /locaties/, de sitemap, en de zes
 *     vestigingen die in de JSON-LD van elke vacature staan. Er gaat geen
 *     gegeven verloren en toch is de hele site anders. Sorteer op plaats.
 *
 *  2. "diensten" IS NIET WAT DE SITE "diensten" NOEMT. Wat op de pagina staat
 *     als opsomming is de kolom "punten" (vrije tekst). De kolom "diensten"
 *     bevat sleutels als "alcoa-velgen-reinigen" en hoort nergens op de
 *     pagina. Ze verwisselen breekt niets en zet acht sleutels met streepjes
 *     op alle achttien pagina's, precies waar een chauffeur leest wat hij
 *     hier kan laten doen.
 *
 *  3. "wasstraten" IS NIET NAGEKEKEN. De kolom heet in de database bays en
 *     heeft standaardwaarde 2; bij de invoer van de achttien vestigingen is
 *     hij niet gevuld. Bij Utrecht spreekt hij de eigen introtekst tegen. Hij
 *     komt hier mee omdat website_vestigingen() hem geeft en een doorgeefluik
 *     niets weglaat -- maar zet hem niet op de site voordat iemand alle
 *     achttien met de hand heeft nagelopen.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/*
 * Kopregels waarmee een browser deze functie mag aanroepen.
 *
 * Anders dan bij de andere functies is dit hier geen slot: het adres staat
 * open, dus alles wat een browser mag lezen kan een curl toch al lezen. Het
 * staat er omdat de eerste manier waarop iemand deze functie uitprobeert een
 * browser is, en omdat negen van de tien bestaande functies het ook hebben.
 *
 * De OPTIONS-tak wordt door een kale GET niet eens bereikt -- die geldt als
 * een eenvoudig verzoek en gaat zonder vooraf-vraag. Hij is er voor de beller
 * die wel eigen kopregels meestuurt, zoals de supabase-client met apikey en
 * authorization doet: die krijgt wel een vooraf-vraag, en zonder antwoord
 * daarop doet de browser het echte verzoek niet eens.
 *
 * Access-Control-Max-Age staat er niet bij. Dat bespaart vooraf-vragen bij
 * herhaald aanroepen, en de echte beller is een bouwscript dat dit een paar
 * keer per week doet. Er valt niets te besparen.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/*
 * Cache-Control: no-store is de enige kopregel hier die echt iets doet, en
 * hij staat er voor juistheid en niet voor snelheid.
 *
 * Zonder deze regel mag een tussenliggende cache een antwoord bewaren. Wie in
 * het dashboard het adres van Utrecht rechtzet en meteen de site bouwt, zou
 * dan het antwoord van vijf minuten geleden krijgen, het oude adres
 * publiceren, en concluderen dat de koppeling stuk is. Dat is precies de
 * scheefgroei die deze hele lijn moet wegnemen.
 *
 * Er valt ook niets te winnen met bewaren: bij een paar opvragingen per week
 * zou een ETag vijfentwintig kilobyte besparen en de kans op een verkeerd
 * antwoord vergroten.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/* ------------------------------------------------------------------ *
 *  De twee aanroepen
 *
 *  Ze zitten in een antwoord omdat ze dezelfde vraag beantwoorden ("wat mag
 *  de site weten") en omdat het tweede antwoord een geheel getal is.
 *  Splitsen levert twee uitrolregels op, twee CORS-blokken, twee foutpaden --
 *  en een half geslaagde bouw: als de telling faalt en de lijst niet, moet
 *  het bouwscript beslissen wat het wegschrijft. Een aanroep is een moment,
 *  en een bouw wil een volledige momentopname of anders de vorige.
 *
 *  Om diezelfde reden faalt hier alles of niets. Ook bij een lege lijst.
 * ------------------------------------------------------------------ */

async function haalOp(): Promise<Response> {
  const { data: vest, error: vestFout } = await admin.rpc('website_vestigingen')
  if (vestFout) {
    return json({ ok: false, reden: 'De database antwoordde niet: ' + vestFout.message }, 500)
  }

  /*
   * Nul vestigingen is geen databasefout, maar wel bijna altijd een
   * vergissing: iemand heeft op_website in bulk uitgezet, of de migratie is
   * niet gedraaid. Zou hier ok:true met een lege lijst uit komen, dan bouwt
   * de site een vestigingenpagina zonder vestigingen en een lege voetbalk, en
   * merkt niemand het. Nu houdt het bouwscript het vorige bestand en blijven
   * de achttien staan. Dit is een oordeel en geen meting -- het staat hier zo
   * opgeschreven zodat het teruggedraaid kan worden door wie het er niet mee
   * eens is.
   */
  if (!Array.isArray(vest) || vest.length === 0) {
    return json({
      ok: false,
      reden: 'De lijst met vestigingen is leeg. Staat op_website nog aan?',
    }, 500)
  }

  const { data: aantal, error: aantalFout } = await admin.rpc('website_aantal_medewerkers')
  if (aantalFout) {
    return json({ ok: false, reden: 'De database antwoordde niet: ' + aantalFout.message }, 500)
  }

  /*
   * De telling hoort een geheel getal te zijn en kan dat volgens de SQL ook
   * niet niet zijn. De controle staat er omdat het alternatief een zin op een
   * openbare vacaturepagina is waarin "null mensen" werken.
   */
  if (typeof aantal !== 'number' || !Number.isFinite(aantal)) {
    return json({ ok: false, reden: 'De personeelstelling gaf geen getal terug.' }, 500)
  }

  return json({ ok: true, medewerkers: aantal, vestigingen: vest.map(metFotoUrls) })
}

/* ------------------------------------------------------------------ *
 *  De foto's een adres geven
 *
 *  De database kent van een foto alleen het pad in de emmer. Waar die emmer
 *  staat weet zij niet en hoort de site ook niet te weten -- dat is het
 *  projectadres, en dat staat hier al in de omgeving. Dus wordt het hier
 *  aan elkaar geplakt, en nergens anders.
 *
 *  Per segment gecodeerd en niet de hele string in een keer: encodeURI laat
 *  een schuine streep staan (goed) maar ook een vraagteken of een hekje
 *  (fout), en encodeURIComponent op het geheel zou de scheidende strepen
 *  wegcoderen. De paden die de app maakt zijn <vestiging-id>/<foto-id>.<ext>
 *  en bevatten niets van dat alles, maar een url die alleen goed gaat als
 *  de invoer zich netjes gedraagt is geen url.
 * ------------------------------------------------------------------ */

const EMMER = 'vestigingen'

function publiekeUrl(pad: string): string {
  const schoon = pad.split('/').map(encodeURIComponent).join('/')
  return `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${EMMER}/${schoon}`
}

function metFotoUrls(v: Record<string, unknown>) {
  const fotos = Array.isArray(v.fotos) ? v.fotos : []
  return {
    ...v,
    fotos: fotos
      .filter((f): f is Record<string, unknown> =>
        !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).pad === 'string')
      .map((f) => ({ ...f, url: publiekeUrl(f.pad as string) })),
  }
}

/* ================================================================== */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  /*
   * GET en POST allebei goed. De huisstijl van de andere tien is POST, maar
   * die hebben allemaal een body -- deze functie neemt niets aan, dus het
   * werkwoord betekent hier niets. GET zodat je hem met een browser of een
   * kale curl kunt nakijken, POST omdat wie de huisstijl volgt daarnaar
   * grijpt en dan geen 405 verdient. Wat er ook binnenkomt: het verzoek zelf
   * wordt niet gelezen, alleen de methode.
   */
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, reden: 'Alleen GET of POST.' }, 405)
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, reden: 'De serverfunctie is niet volledig ingesteld.' }, 500)
  }

  try {
    return await haalOp()
  } catch (e) {
    return json({
      ok: false,
      reden: 'Het ophalen mislukte: ' + (e instanceof Error ? e.message : String(e)),
    }, 500)
  }
})
