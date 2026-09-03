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
 *
 *  Allebei roepen ze leesFactuur() aan. Geen tweede kopie van de aanwijzingen
 *  aan het model, en geen verzoek van de ene functie naar de andere waarbij
 *  onderweg bedacht moet worden hoe die zich legitimeert.
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

const SYSTEEM = [
  'Je leest een inkoopfactuur of kassabon van een Nederlands truckwash-bedrijf',
  'en geeft terug wat er letterlijk op staat.',
  '',
  'Regels:',
  '- Neem over wat er staat. Reken niets uit dat er niet staat, en vul niets',
  '  aan uit ervaring. Staat er geen factuurnummer, laat het veld dan weg.',
  '- Bedragen als getal, met een punt als decimaalteken, zonder valutateken.',
  '  Een Nederlands bedrag van 1.234,56 wordt 1234.56.',
  '- Datums als jjjj-mm-dd.',
  '- Twijfel je over een waarde -- onscherpe scan, doorgehaald bedrag, twee',
  '  bedragen die elkaar tegenspreken -- zet die waarde er dan NIET in, en zet',
  '  in "twijfel" een korte Nederlandse zin die uitlegt wat er aan de hand is.',
  '- Tellen de regels niet op tot het subtotaal, meld dat in "twijfel". Pas de',
  '  getallen niet aan om het kloppend te maken.',
  '- Is dit geen factuur of bon maar bijvoorbeeld een pakbon of een aanmaning,',
  '  zet dat in "soort" en geef terug wat je wel ziet.',
  '- "kenmerk" is de korte omschrijving waar deze factuur over gaat, zoals je',
  '  hem zelf in een boekhouding zou zetten: "elektra maart", "afvalcontainer",',
  '  "osmosefilters". Niet de bedrijfsnaam en niet het factuurnummer.',
  '',
  'Antwoord met alleen JSON, zonder uitleg eromheen:',
  '',
  '{',
  '  "soort": "factuur" | "bon" | "pakbon" | "aanmaning" | "onbekend",',
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

export interface Lezing {
  soort: string
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
  const kandidaten: { pad: string; naam: string; mime?: string; gemarkeerd?: string }[] = []

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

  /*
   * Zonder aanwijzing niet zomaar de eerste bijlage.
   *
   * Bij mail met een logo in de handtekening staat er een plaatje voor de
   * factuur, en dan werd er een bedrijfslogo gelezen terwijl de PDF eronder
   * bleef liggen. Een PDF gaat daarom voor.
   */
  const gekozen = gevraagd
    ? kandidaten.find((k) => k.pad === gevraagd)
    : (kandidaten.find((k) => soortVan(k.naam, k.mime) === PDF) ?? kandidaten[0])

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

  const lezing: Lezing = {
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
    kenmerk: tekst(uit.kenmerk, 200),
    regels,
    subtotaalExcl: getal(uit.subtotaalExcl),
    btwBedrag: getal(uit.btwBedrag),
    totaalIncl: getal(uit.totaalIncl),
    voorstelCategorie: voorstel && CATEGORIEEN.includes(voorstel) ? voorstel : undefined,
    twijfel,
    gelezenOp: nu(),
    gelezenDoor: doorWie,
    gemarkeerd: gekozen.gemarkeerd,
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
    console.warn('[factuurlezer] bewaren mislukte: ' + bewaarFout.message)
  }

  return { ok: true, lezing, bewaard: !bewaarFout }
}
