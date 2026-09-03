/* ===========================================================================
 *  De factuurlezer
 *
 *  Dit stuk zat eerst helemaal in de functie factuur-lezen, en dat werkte
 *  prima zolang er een mens op een knop drukte. Zodra de post het ook zelf
 *  moest kunnen liep het vast op iets banaals: factuur-lezen wil een
 *  ingelogde gebruiker zien, en een webhook van Resend is niemand.
 *
 *  De uitweg was niet om die controle te verzwakken. Wie die functie kan
 *  aanroepen kan er willekeurige bestanden doorheen halen, en dan is het een
 *  gratis taalmodel voor de hele wereld. Dus staat het lezen nu hier, los van
 *  de vraag wie het vraagt:
 *
 *    factuur-lezen   een mens drukt op de knop -- eerst inloggen, dan lezen
 *    ontvang-mail    er komt post binnen      -- geen mens, dus geen token
 *    lezer           de pc thuis leest met Ollama en valt zo nodig terug op
 *                    Claude; gebruikt SYSTEEM, LEZING_SCHEMA en opschonen()
 *                    zodat de uitkomst dezelfde is (0049)
 *
 *  Alle drie komen ze hier. Geen tweede kopie van de aanwijzingen aan het
 *  model, en geen verzoek van de ene functie naar de andere waarbij onderweg
 *  bedacht moet worden hoe die zich legitimeert.
 *
 *  Wat hier met opzet NIET gebeurt: goedkeuren, boeken of velden overschrijven
 *  die een mens heeft ingevuld. Er komt een lezing uit. Wat daarmee gebeurt is
 *  aan de beller.
 * =========================================================================== */

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

export const MODEL = 'claude-sonnet-5'
const EMMER = 'post'

/** Ruim boven een gewone factuur, ruim onder wat de API aankan. */
const MAX_BESTAND = 12 * 1024 * 1024

const nu = () => Date.now()

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

/** Bytes naar base64, in stukken -- in een keer loopt de stack over. */
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

export const SYSTEEM = [
  'Je leest een factuur of kassabon die per mail is binnengekomen bij een',
  'Nederlands truckwash-bedrijf, en geeft terug wat er letterlijk op staat.',
  '',
  'Regels:',
  '- Neem over wat er staat. Reken niets uit dat er niet staat, en vul niets',
  '  aan uit ervaring. Staat er geen factuurnummer, laat het veld dan weg.',
  '- Bedragen als getal, met een punt als decimaalteken, zonder valutateken.',
  '  Een Nederlands bedrag van 1.234,56 wordt 1234.56.',
  '- Een getal dat niet op het stuk staat is null, niet 0. Een 0 betekent dat',
  '  er letterlijk nul staat (0% btw, een gratis regel). Staat er per regel',
  '  geen btw-percentage, dan is "btwPct" null; staat er geen btw-bedrag, dan',
  '  is "btwBedrag" null.',
  '- Datums als jjjj-mm-dd.',
  '- Twijfel je over een waarde -- onscherpe scan, doorgehaald bedrag, twee',
  '  bedragen die elkaar tegenspreken -- zet die waarde er dan NIET in, en zet',
  '  in "twijfel" een korte Nederlandse zin die uitlegt wat er aan de hand is.',
  '- Tellen de regels niet op tot het subtotaal, meld dat in "twijfel". Pas de',
  '  getallen niet aan om het kloppend te maken.',
  '- Is dit geen factuur of bon maar bijvoorbeeld een pakbon of een aanmaning,',
  '  zet dat in "soort" en geef terug wat je wel ziet.',
  '- "richting" zegt wie hier aan wie factureert. Het bedrijf dat dit leest',
  '  heet Truckwash 1 Group, met vestigingen die "Truckwash" in de naam hebben',
  '  (Truckwash Oss, Truckwash 1 Utrecht, enzovoort).',
  '    "inkoop":  Truckwash staat als ontvanger op het stuk -- bij "aan",',
  '               "factuuradres", "klant" of "t.a.v." -- en een ANDER bedrijf',
  '               staat als afzender bovenaan, met zijn eigen KvK- en',
  '               btw-nummer, IBAN en logo. Dan is dit een rekening die',
  '               Truckwash moet betalen.',
  '    "verkoop": Truckwash staat zelf als afzender bovenaan, met KvK, btw-',
  '               nummer en IBAN van Truckwash, en een ander bedrijf staat als',
  '               klant. Dan is dit een rekening die Truckwash zelf heeft',
  '               gestuurd en die iemand heeft doorgestuurd.',
  '    "onbekend": je kunt het niet met zekerheid zeggen, bijvoorbeeld omdat',
  '               er geen namen op staan of Truckwash nergens voorkomt.',
  '  Kijk naar wie het stuk heeft opgemaakt, niet naar wie de mail stuurde.',
  '  Zeg alleen "verkoop" als Truckwash zelf het stuk heeft opgemaakt. Een',
  '  stempel of aantekening "ontvangen" van Truckwash maakt Truckwash niet de',
  '  afzender. Een ander bedrijf met "Truckwash" in de naam dat niet Truckwash',
  '  1 Group of een van zijn vestigingen is (een buitenlandse wasserij, een',
  '  leverancier van wasinstallaties) is een ander bedrijf: dan "inkoop". Een',
  '  creditnota van een leverancier aan Truckwash is ook "inkoop". Twijfel je,',
  '  dan "onbekend" -- dat is nooit fout.',
  '  "leverancier" is altijd de afzender op het stuk, ook bij verkoop.',
  '- "kenmerk" is de korte omschrijving waar deze factuur over gaat, zoals je',
  '  hem zelf in een boekhouding zou zetten: "elektra maart", "afvalcontainer",',
  '  "osmosefilters". Niet de bedrijfsnaam en niet het factuurnummer.',
  '',
  'Antwoord met alleen JSON, zonder uitleg eromheen:',
  '',
  '{',
  '  "soort": "factuur" | "bon" | "pakbon" | "aanmaning" | "onbekend",',
  '  "richting": "inkoop" | "verkoop" | "onbekend",',
  '  "leverancier": "string",',
  '  "factuurnummer": "string",',
  '  "datum": "jjjj-mm-dd",',
  '  "vervaldatum": "jjjj-mm-dd",',
  '  "iban": "string",',
  '  "betalingskenmerk": "string",',
  '  "btwNummer": "string",',
  '  "kvk": "string",',
  '  "valuta": "EUR",',
  '  "kenmerk": "string",',
  '  "regels": [',
  '    { "omschrijving": "string", "aantal": 0, "eenheid": "string",',
  '      "stukprijs": 0, "btwPct": 0, "bedragExcl": 0 }',
  '  ],',
  '  "subtotaalExcl": 0,',
  '  "btwBedrag": 0,',
  '  "totaalIncl": 0,',
  '  "voorstelCategorie": "materiaal" | "energie" | "onderhoud" | "personeel" | "transport" | "overig",',
  '  "twijfel": ["string"]',
  '}',
].join('\n')

/*
 * Hetzelfde antwoord, maar als JSON-schema.
 *
 * Claude krijgt de vorm hierboven als tekst en houdt zich eraan. Een lokaal
 * model via Ollama krijgt dit schema als "format" mee, en dan kán het niet
 * anders antwoorden. Uit de proef op de eigen pc bleek één ding doorslaggevend:
 * velden die niet als verplicht staan laat het model weg, ook als ze op de
 * factuur staan. Daarom is hier bijna alles verplicht.
 *
 * Verplicht betekent wel dat het model áltijd iets moet geven, ook als het
 * er niet staat. Voor tekst is dat een lege tekst en die maakt opschonen()
 * undefined, net als een weggelaten veld. Voor getallen lag daar een val: een
 * verplicht getal zonder waarde werd 0, en 0 is een echte waarde. Een
 * kassabon zonder btw per regel kreeg zo btwPct 0 op elke regel en btwBedrag
 * 0, en verwerkLezing schreef dan 0% en 0,00 btw op de bon -- waar Claude,
 * die de velden gewoon weglaat, 21% afleidt uit btw en subtotaal. Precies het
 * verschil dat er niet mag zijn. Daarom mag elk getal hier ook null zijn,
 * zegt SYSTEEM dat onbekend null is en niet 0, en maakt getal() van null
 * undefined.
 *
 * De velden en hun betekenis staan in SYSTEEM; verander je daar iets, dan
 * hier ook. De server is de enige plek waar dit staat -- het lokale programma
 * haalt prompt en schema bij elke ronde hier op.
 */
const GETAL_OF_NIETS = { type: ['number', 'null'] }

export const LEZING_SCHEMA = {
  type: 'object',
  properties: {
    soort: { type: 'string', enum: ['factuur', 'bon', 'pakbon', 'aanmaning', 'onbekend'] },
    richting: { type: 'string', enum: ['inkoop', 'verkoop', 'onbekend'] },
    leverancier: { type: 'string' },
    factuurnummer: { type: 'string' },
    datum: { type: 'string' },
    vervaldatum: { type: 'string' },
    iban: { type: 'string' },
    betalingskenmerk: { type: 'string' },
    btwNummer: { type: 'string' },
    kvk: { type: 'string' },
    valuta: { type: 'string' },
    kenmerk: { type: 'string' },
    regels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          omschrijving: { type: 'string' },
          aantal: GETAL_OF_NIETS,
          eenheid: { type: 'string' },
          stukprijs: GETAL_OF_NIETS,
          btwPct: GETAL_OF_NIETS,
          bedragExcl: GETAL_OF_NIETS,
        },
        required: ['omschrijving', 'aantal', 'eenheid', 'stukprijs', 'btwPct', 'bedragExcl'],
      },
    },
    subtotaalExcl: GETAL_OF_NIETS,
    btwBedrag: GETAL_OF_NIETS,
    totaalIncl: GETAL_OF_NIETS,
    voorstelCategorie: {
      type: 'string',
      enum: ['materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig'],
    },
    twijfel: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'soort', 'richting', 'leverancier', 'factuurnummer', 'datum', 'vervaldatum',
    'iban', 'btwNummer', 'kvk', 'kenmerk', 'regels', 'subtotaalExcl', 'btwBedrag',
    'totaalIncl', 'voorstelCategorie', 'twijfel',
  ],
}

function leesJson(ruw: string): Record<string, unknown> | null {
  const hek = String.fromCharCode(96, 96, 96)
  let schoon = ruw.trim()
  if (schoon.startsWith(hek)) schoon = schoon.slice(hek.length).replace(/^json/i, '').trim()
  if (schoon.endsWith(hek)) schoon = schoon.slice(0, -hek.length).trim()
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

/**
 * Een getal, of niets. Alleen een echt getal of een tekst met een getal erin
 * telt. null en een lege tekst zijn "niet op het stuk" en worden undefined --
 * niet 0, want Number(null) en Number('') zijn allebei 0, en een 0 die er niet
 * stond wordt verderop een btw-tarief van 0%.
 */
function getal(waarde: unknown): number | undefined {
  if (typeof waarde === 'number') return Number.isFinite(waarde) ? waarde : undefined
  if (typeof waarde !== 'string' || !waarde.trim()) return undefined
  const n = Number(waarde.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/**
 * Wat een model invult als het een verplicht tekstveld niet kan vullen. Claude
 * laat het veld weg; gemma schrijft met het afgedwongen schema soms letterlijk
 * "null" of "onbekend" (gezien bij de eenheid van een regel). Dat is geen
 * waarde van het stuk en hoort dus ook niet in de lezing.
 */
const NIETS_GEZEGD = new Set(['null', 'none', 'onbekend', 'n/a', 'n.v.t.', 'nvt', '-', '--'])

function tekst(waarde: unknown, max = 200): string | undefined {
  if (typeof waarde !== 'string') return undefined
  const schoon = waarde.trim().slice(0, max)
  if (!schoon || NIETS_GEZEGD.has(schoon.toLowerCase())) return undefined
  return schoon
}

const CATEGORIEEN = ['materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig']

export interface Lezing {
  soort: string
  /**
   * Wie factureert hier aan wie. "inkoop" is een rekening aan Truckwash,
   * "verkoop" een rekening ván Truckwash die iemand heeft doorgestuurd.
   *
   * Dit veld bestaat omdat alles wat met een PDF binnenkwam een kostenpost
   * werd -- ook een factuur die Truckwash zelf aan een klant had gestuurd.
   * Die stond dan aan de kostenkant, en niemand zag het.
   */
  richting: 'inkoop' | 'verkoop' | 'onbekend'
  leverancier?: string
  factuurnummer?: string
  datum?: number
  vervaldatum?: number
  iban?: string
  betalingskenmerk?: string
  btwNummer?: string
  kvk?: string
  valuta: string
  kenmerk?: string
  regels: Record<string, unknown>[]
  subtotaalExcl?: number
  btwBedrag?: number
  totaalIncl?: number
  voorstelCategorie?: string
  twijfel: string[]
  gelezenOp: number
  gelezenDoor: string
  gemarkeerd?: string
  model: string
  bestand: string
}

export interface Uitkomst {
  ok: boolean
  lezing?: Lezing
  reden?: string
  bewaard?: boolean
}

/* ------------------------------------------------------------------ *
 *  Welke bijlage
 *
 *  Los van het lezen, omdat de functie lezer dezelfde keuze moet maken voor
 *  de pc thuis: die krijgt een lijst met bijlagen en moet dezelfde pakken die
 *  Claude hier gepakt zou hebben. Anders leest de ene lezer de factuur en de
 *  andere het logo uit de handtekening.
 * ------------------------------------------------------------------ */

export interface Kandidaat {
  pad: string
  naam: string
  mime?: string
  /** De reden waarom de bijlagecontrole dit bestand tegenhield, als dat zo was. */
  gemarkeerd?: string
}

/**
 * De bijlagen die bij een kostenpost horen: eerst de aangewezen bijlage
 * (attachment_path), dan alles wat bij het mailbox-bericht zat.
 */
// deno-lint-ignore no-explicit-any
export async function bijlagenVan(admin: any, bon: {
  attachment_path?: string | null
  attachment_name?: string | null
  mailbox_id?: string | null
}): Promise<Kandidaat[]> {
  const kandidaten: Kandidaat[] = []

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

      /*
       * Een tegengehouden bijlage wordt hier wel gelezen, en dat is met opzet.
       *
       * Hier stond dat alles wat niet 'schoon' was werd overgeslagen. Gevolg:
       * een factuur die de bijlagecontrole niet aanstond werd niet getoond en
       * niet gelezen -- dubbel niets, terwijl juist zo'n bon aandacht vraagt.
       *
       * Lezen is ook iets anders dan openen. De bytes gaan naar een API en
       * komen terug als tekst; er wordt niets uitgevoerd, niets geopend en
       * niets opgeslagen. Het risico van actieve inhoud in een PDF zit in de
       * lezer op iemands bureau, niet hier.
       */
      kandidaten.push({
        pad: String(b.path),
        naam: String(b.naam ?? 'bijlage'),
        mime: b.mime ? String(b.mime) : undefined,
        gemarkeerd: b.controle && b.controle !== 'schoon'
          ? String(b.controleReden ?? 'De bijlagecontrole hield dit bestand tegen.')
          : undefined,
      })
    }
  }

  return kandidaten
}

/**
 * Zonder aanwijzing niet zomaar de eerste bijlage.
 *
 * Bij mail met een logo in de handtekening staat er een plaatje voor de
 * factuur, en dan werd er een bedrijfslogo gelezen terwijl de PDF eronder
 * bleef liggen. Een PDF gaat daarom voor.
 */
export function kiesBijlage(kandidaten: Kandidaat[]): Kandidaat | undefined {
  return kandidaten.find((k) => soortVan(k.naam, k.mime) === PDF) ?? kandidaten[0]
}

/* ------------------------------------------------------------------ *
 *  Opschonen
 *
 *  Alles wat uit een model terugkomt gaat langs dit filter. Niet omdat het
 *  model kwaad wil, maar omdat een tekstveld dat rechtstreeks in de database
 *  landt vroeg of laat iets bevat waar niemand op rekende.
 *
 *  Het staat los van leesFactuur omdat de lokale lezer (Ollama op de pc van
 *  Casper) het ruwe antwoord van zijn model naar de server stuurt en de
 *  server het hier doorheen haalt. Zo is de lezing die in de database landt
 *  op precies dezelfde manier schoongemaakt, wie er ook las.
 * ------------------------------------------------------------------ */

export function opschonen(
  uit: Record<string, unknown>,
  meta: { doorWie: string; bestand: string; model: string; gemarkeerd?: string },
): Lezing {
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

  const lezing: Lezing = {
    soort: ['factuur', 'bon', 'pakbon', 'aanmaning', 'onbekend']
      .includes(String(uit.soort)) ? String(uit.soort) : 'onbekend',
    // Alleen de drie waarden die de beller kent. Alles anders is "onbekend",
    // en onbekend wordt gewoon een kostenpost -- zoals het altijd al ging.
    richting: uit.richting === 'inkoop' || uit.richting === 'verkoop'
      ? uit.richting : 'onbekend',
    leverancier: tekst(uit.leverancier),
    factuurnummer: tekst(uit.factuurnummer, 60),
    datum: datum(uit.datum),
    vervaldatum: datum(uit.vervaldatum),
    iban: tekst(uit.iban, 40),
    betalingskenmerk: tekst(uit.betalingskenmerk, 60),
    btwNummer: tekst(uit.btwNummer, 30),
    kvk: tekst(uit.kvk, 20),
    valuta: tekst(uit.valuta, 8) ?? 'EUR',
    kenmerk: tekst(uit.kenmerk, 200),
    regels,
    subtotaalExcl: getal(uit.subtotaalExcl),
    btwBedrag: getal(uit.btwBedrag),
    totaalIncl: getal(uit.totaalIncl),
    voorstelCategorie: voorstel && CATEGORIEEN.includes(voorstel) ? voorstel : undefined,
    twijfel,
    gelezenOp: nu(),
    gelezenDoor: meta.doorWie,
    gemarkeerd: meta.gemarkeerd,
    model: meta.model,
    bestand: meta.bestand,
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

  return lezing
}

/* ------------------------------------------------------------------ *
 *  Lezen
 * ------------------------------------------------------------------ */

/**
 * Leest de bijlage bij een kostenpost en zet de uitkomst in het veld gelezen.
 *
 * doorWie komt in de lezing te staan, zodat later te zien is of een mens
 * hierom vroeg of dat de post het uit zichzelf deed.
 */
// deno-lint-ignore no-explicit-any
export async function leesFactuur(opties: {
  admin: any
  expenseId: string
  pad?: string
  doorWie: string
}): Promise<Uitkomst> {
  const { admin, expenseId, doorWie } = opties

  if (!ANTHROPIC_KEY) {
    return {
      ok: false,
      reden: 'De leesdienst is nog niet ingesteld. Zet ANTHROPIC_API_KEY als ' +
             'geheim bij de functies.',
    }
  }

  const { data: bon } = await admin
    .from('expenses')
    .select('id, supplier, attachment_path, attachment_name, mailbox_id')
    .eq('id', expenseId)
    .maybeSingle()

  if (!bon) return { ok: false, reden: 'Kostenpost niet gevonden' }

  /*
   * Welk bestand. De beller mag er een aanwijzen als er meer bijlagen bij de
   * mail zaten, maar alleen uit de bijlagen die bij deze bon horen -- niet
   * een willekeurig pad uit de emmer.
   */
  const gevraagd = tekst(opties.pad, 400)
  const kandidaten = await bijlagenVan(admin, bon)

  /* Zonder aanwijzing kiest kiesBijlage(): een PDF gaat voor een plaatje. */
  const gekozen = gevraagd
    ? kandidaten.find((k) => k.pad === gevraagd)
    : kiesBijlage(kandidaten)

  if (!gekozen) {
    return {
      ok: false,
      reden: gevraagd
        ? 'Dat bestand hoort niet bij deze kostenpost.'
        : 'Bij deze kostenpost zit geen bijlage om te lezen.',
    }
  }

  /* ---- ophalen ---- */

  const { data: bestand, error: haalFout } = await admin.storage.from(EMMER).download(gekozen.pad)
  if (haalFout || !bestand) {
    return { ok: false, reden: 'De bijlage is niet op te halen.' }
  }
  if (bestand.size > MAX_BESTAND) {
    return {
      ok: false,
      reden: `Deze bijlage is ${Math.round(bestand.size / 1024 / 1024)} MB en dat is ` +
             'te groot om te laten lezen. Stuur een kleiner bestand of een foto ' +
             'van de factuur.',
    }
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
      console.error(`[factuurlezer] Anthropic gaf ${res.status}: ${detail}`)
      return {
        ok: false,
        reden: res.status === 400 && /media_type|document/i.test(detail)
          ? 'Dit bestandstype kan niet worden gelezen. PDF en foto’s wel.'
          : 'De leesdienst gaf geen antwoord. Probeer het straks nog eens.',
      }
    }

    const antwoord = await res.json()
    const platte = (antwoord?.content ?? [])
      .filter((c: { type?: string }) => c?.type === 'text')
      .map((c: { text?: string }) => c.text ?? '')
      .join('')
    uit = leesJson(platte)
  } catch (e) {
    console.error('[factuurlezer] ' + String(e))
    return { ok: false, reden: 'De leesdienst gaf geen antwoord.' }
  }

  if (!uit) {
    return {
      ok: false,
      reden: 'Er kwam geen leesbaar antwoord uit. Dit gebeurt bij scans die ' +
             'te onscherp zijn; een rechtere foto helpt meestal.',
    }
  }

  /* ---- opschonen ---- */

  const lezing = opschonen(uit, {
    doorWie,
    bestand: gekozen.naam,
    model: MODEL,
    gemarkeerd: gekozen.gemarkeerd,
  })

  const { error: bewaarFout } = await admin
    .from('expenses')
    .update({ gelezen: lezing })
    .eq('id', expenseId)

  if (bewaarFout) {
    // Het lezen is gelukt; alleen het bewaren niet. Dan geven we het toch
    // terug -- dan kan het scherm er wel wat mee.
    console.warn('[factuurlezer] bewaren mislukte: ' + bewaarFout.message)
  }

  return { ok: true, lezing, bewaard: !bewaarFout }
}
