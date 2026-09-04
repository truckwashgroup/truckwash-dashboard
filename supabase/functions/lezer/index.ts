/* ===========================================================================
 *  lezer -- het loket waar de pc thuis zijn werk komt halen
 *
 *  Uitrollen:  npm run functions:open   (staat in functions:open, --no-verify-jwt)
 *  Nodig:      supabase secrets set LEZER_SECRET=<lange willekeurige tekst>
 *              en hetzelfde geheim in lezer/.env op de pc.
 *
 *  Waarom dit bestaat
 *  ------------------
 *
 *  Casper heeft een pc met een RTX 5090 waarop Ollama met gemma4:26b draait,
 *  en die leest een factuur net zo goed als Claude -- in acht seconden, zonder
 *  dat de bon het huis uit gaat en zonder kosten per stuk. Dus mag die pc het
 *  lezen doen (instelling factuur_lezer, 0049).
 *
 *  De richting is met opzet omgedraaid. De server belt de pc niet: dan moet er
 *  thuis een poort open en een adres bekend zijn, en dat is precies wat je
 *  niet wilt op een netwerk waar ook de rest van het bedrijf aan hangt. De pc
 *  komt in plaats daarvan elke halve minuut hier vragen of er werk ligt, met
 *  één geheim. Hij kent geen servicesleutel en geen API-sleutel; hij krijgt
 *  een tijdelijke link naar de bijlage (een kwartier geldig) en stuurt het
 *  ruwe antwoord van zijn model terug.
 *
 *  Alles wat daarna komt gebeurt hier, niet op de pc: opschonen
 *  (factuurlezer.ts), de verkoopcontrole, indelen en wegschrijven
 *  (verwerking.ts). Dezelfde code die ook na Claude draait. Daardoor is een
 *  lokaal gelezen bon in de app niet te onderscheiden van een die Claude las,
 *  op het veld lezer na.
 *
 *  De vier acties, alle POST JSON met { geheim, actie, ... }:
 *
 *    werk      instellingen lezer_laatst_gezien/lezer_model bijwerken, dan
 *              hoogstens max bonnen claimen (wacht, of bezig maar langer dan
 *              tien minuten -- dan is de pc er halverwege mee opgehouden) en
 *              teruggeven met prompt, schema en tijdelijke links.
 *    klaar     het ruwe JSON van het model; hier opgeschoond, bewaard en
 *              verwerkt.
 *    terugval  de pc vertrouwt zijn eigen lezing niet. Staat de instelling op
 *              lokaal-terugval, dan leest Claude hem hier alsnog; anders wordt
 *              de bon "mislukt" met de reden erbij.
 *    mislukt   de pc kon het niet. Met tijdelijk:true (Ollama onbereikbaar,
 *              time-out) gaat de bon terug op wacht -- een herstart van
 *              Ollama mag geen bon kosten. Anders geldt hetzelfde als bij
 *              terugval: Claude als de stand dat toelaat, en anders
 *              "mislukt" met de reden in de twijfel van de lezing, zodat hij
 *              in de app bij de bon staat.
 *
 *  Alle vier kijken ze ook naar expenses.status: alleen een bon die nog
 *  "open" staat wordt geclaimd of bijgewerkt. Een bon op wacht kan lang
 *  liggen (pc uit), en intussen kan een mens hem met de knop hebben gelezen
 *  en goedgekeurd of geboekt. Zou de pc hem dan alsnog claimen, dan schrijft
 *  verwerkLezing leverancier, bedragen en grootboek over een goedgekeurde bon
 *  -- of haalt hem als verkoopfactuur zelfs weg. Toen het lezen nog meteen na
 *  het aanmaken gebeurde kon dat niet; met een wachtrij wel. Om dezelfde
 *  reden nemen klaar, terugval en mislukt alleen een bon aan die nog "bezig"
 *  is voor de pc: een melding over een bon die een eerdere ronde (of een mens
 *  met de knop) al afmaakte krijgt 409 en verandert niets.
 *
 *  --no-verify-jwt is onvermijdelijk: de pc heeft geen account en dus geen
 *  token. De echtheid zit in LEZER_SECRET, en zonder dat geheim op de server
 *  weigert deze functie alles -- liever een 500 met een duidelijke reden dan
 *  een loket dat open staat omdat iemand het geheim vergat te zetten.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import {
  bijlagenVan,
  LEZING_SCHEMA,
  leesFactuur,
  opschonen,
  SYSTEEM,
  type Lezing,
} from '../_gedeeld/factuurlezer.ts'
import { twijfelErbij, verwerkLezing } from '../_gedeeld/verwerking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const LEZER_SECRET = Deno.env.get('LEZER_SECRET') ?? ''

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const EMMER = 'post'

/**
 * Hoe lang een tijdelijke link naar een bijlage geldig is. De pc haalt elke
 * bijlage pas op vlak vóór hij hem leest, en de links van een hele ronde
 * (tot tien bonnen) worden in één keer gemaakt; één trage scan in
 * plaatjesmodus kan de laatste bon van de ronde dus een flink stuk later
 * aan de beurt laten komen. Een uur is ruim, en de link geeft alleen
 * leesrecht op die ene bijlage.
 */
const LINK_SECONDEN = 60 * 60

/** Standaard en bovengrens voor het aantal bonnen per ronde. */
const STANDAARD_MAX = 3
const HOOGSTE_MAX = 10

/**
 * Staat een bon langer dan dit op "bezig", dan is de pc er halverwege mee
 * opgehouden (stroom, Ctrl+C, Ollama vastgelopen) en mag de volgende ronde
 * hem opnieuw pakken. Tien minuten is ook de tijd die de pc zelf hoogstens
 * op Ollama wacht. Let wel: de claim geldt per bon vanaf het uitdelen, en de
 * pc werkt de ronde één voor één af -- met max op 10 en een paar trage
 * scans kan de laatste bon dus verlopen zijn voordat hij aan de beurt is.
 * Met de standaard 3 komt dat in de praktijk niet voor.
 */
const VASTGELOPEN_NA = 10 * 60 * 1000

const nu = () => Date.now()

type Willekeurig = Record<string, unknown>

/*
 * De pc belt vanuit Node, niet vanuit een browser; CORS is hier dus niet
 * nodig voor de werking. Hij staat er toch, net als bij de andere open
 * functies, zodat een toekomstige statuspagina in de browser niet op een
 * ontbrekende kopregel strandt.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

const tekst = (waarde: unknown, max = 500): string => String(waarde ?? '').trim().slice(0, max)

/* ------------------------------------------------------------------ *
 *  Instellingen
 * ------------------------------------------------------------------ */

async function instelling(sleutel: string): Promise<string> {
  const { data } = await admin
    .from('instellingen').select('waarde').eq('sleutel', sleutel).maybeSingle()
  return String(data?.waarde ?? '').trim().toLowerCase()
}

/**
 * Een instelling zetten of aanmaken. Het id volgt de sleutel ('in_' + sleutel),
 * zoals de seed in 0049 hem ook aanmaakt; bestaat de rij al, dan wint de
 * sleutel en wordt alleen de waarde bijgewerkt.
 */
async function zetInstelling(sleutel: string, waarde: string) {
  const { error } = await admin
    .from('instellingen')
    .upsert({ id: 'in_' + sleutel, sleutel, waarde, updated_at: nu() }, { onConflict: 'sleutel' })
  if (error) console.warn(`[lezer] instelling ${sleutel} zetten: ${error.message}`)
}

/* ------------------------------------------------------------------ *
 *  De bon
 * ------------------------------------------------------------------ */

interface Bon {
  id: string
  /** De gewone status van de kostenpost: open, goedgekeurd of afgekeurd. Alleen "open" mag de pc aanraken. */
  status: string | null
  mailbox_id: string | null
  supplier: string | null
  description: string | null
  attachment_path: string | null
  attachment_name: string | null
  gelezen: Lezing | null
  lees_status: string | null
}

const BON_VELDEN = 'id, status, mailbox_id, supplier, description, attachment_path, attachment_name, gelezen, lees_status'

/**
 * Wat er ligt voor de pc: op wacht, of op bezig maar te lang (de pc is er
 * halverwege mee opgehouden). Als PostgREST-filter, zodat zoeken en claimen
 * letterlijk dezelfde voorwaarde gebruiken. De grens gaat mee als argument
 * omdat hij per ronde anders is.
 */
const LIGT_KLAAR = (grens: number) =>
  `lees_status.eq.wacht,and(lees_status.eq.bezig,lees_geclaimd_at.lt.${grens})`

/**
 * De bon is niet meer van de pc: iemand heeft hem intussen goedgekeurd of
 * geboekt. Dan blijft alles zoals het is -- geen lezing eroverheen, geen
 * lees_status die een badge oplevert op een afgehandelde bon. 409, zodat het
 * lokale programma het logt en verder gaat; het is geen fout van de pc.
 */
function nietMeerOpen(bon: Bon) {
  return json({
    ok: false,
    reden: `Deze kostenpost staat niet meer op "open" (nu: ${bon.status ?? 'leeg'}); ` +
           'iemand heeft hem intussen afgehandeld. De lezing van de pc is niet gebruikt.',
  }, 409)
}

/**
 * De bon is niet (meer) "bezig" voor de pc: een eerdere ronde heeft hem al
 * afgemaakt (klaar of mislukt), of een mens heeft hem intussen met de knop
 * laten lezen (factuur-lezen zet lees_status dan leeg). Een trage pc waarvan
 * de claim na tien minuten was verlopen meldt zich zo niet nog eens over een
 * bon die al verwerkt is -- verwerkLezing zou dan twee keer draaien en in de
 * verkoop-route de tweede keer op een weggehaalde bon stuiten.
 */
function nietMeerBezig(bon: Bon) {
  return json({
    ok: false,
    reden: `Deze kostenpost staat niet meer op "bezig" voor de lokale lezer (nu: ${bon.lees_status ?? 'leeg'}); ` +
           'een andere ronde of een mens heeft hem al afgehandeld. Deze melding is niet gebruikt.',
  }, 409)
}

async function haalBon(expenseId: string): Promise<Bon | null> {
  const { data, error } = await admin
    .from('expenses').select(BON_VELDEN).eq('id', expenseId).maybeSingle()
  if (error) {
    console.error('[lezer] bon ophalen: ' + error.message)
    return null
  }
  return (data as Bon | null) ?? null
}

/** Wat verwerkLezing over de bon wil weten, uit de kolommen die de post vulde. */
function herkomst(bon: Bon) {
  return {
    berichtId: String(bon.mailbox_id ?? ''),
    vanNaam: String(bon.supplier ?? ''),
    onderwerp: String(bon.description ?? ''),
  }
}

async function zetStatus(expenseId: string, status: 'bezig' | 'klaar' | 'mislukt', extra: Willekeurig = {}) {
  const { error } = await admin
    .from('expenses').update({ lees_status: status, ...extra }).eq('id', expenseId)
  if (error) console.error(`[lezer] ${expenseId} op ${status} zetten: ${error.message}`)
}

/**
 * De bon op "mislukt" zetten en de reden bij de lezing schrijven.
 *
 * Is er nog geen lezing -- de pc viel om vóór het model iets teruggaf -- dan
 * komt er een lege, via opschonen() zodat hij dezelfde vorm heeft als elke
 * andere lezing. Anders zou de app een bon zien met een reden maar zonder
 * het kader waar die reden in hoort.
 */
async function markeerMislukt(bon: Bon, reden: string, doorWie: string, model: string) {
  await zetStatus(bon.id, 'mislukt')
  const lezing = bon.gelezen ?? opschonen({}, { doorWie, bestand: '', model })
  await twijfelErbij(admin, bon.id, lezing, reden)
  console.log(`[lezer] ${bon.id} mislukt: ${reden}`)
}

/* ------------------------------------------------------------------ *
 *  werk -- claimen en uitdelen
 * ------------------------------------------------------------------ */

async function werk(body: Willekeurig) {
  const model = tekst(body.model, 60) || 'onbekend'
  const gevraagd = Number(body.max)
  const max = Number.isFinite(gevraagd)
    ? Math.min(HOOGSTE_MAX, Math.max(0, Math.floor(gevraagd)))
    : STANDAARD_MAX

  /*
   * Eerst laten weten dat de pc er is, ook als er geen werk ligt. Het
   * ontwikkelaarsscherm leest deze twee sleutels om "laatst gezien" te tonen
   * en rood te worden als het langer dan vijf minuten geleden is.
   */
  await zetInstelling('lezer_laatst_gezien', String(nu()))
  await zetInstelling('lezer_model', model)

  const terugvalToegestaan = (await instelling('factuur_lezer')) === 'lokaal-terugval'

  const stukken: Willekeurig[] = []

  if (max > 0) {
    /*
     * Wat er ligt: op wacht, of op bezig maar te lang. Oudste eerst, zodat
     * een bon die al een keer is blijven liggen niet nog eens achteraan komt.
     */
    const grens = nu() - VASTGELOPEN_NA
    const { data: kandidaten, error: zoekFout } = await admin
      .from('expenses')
      .select(BON_VELDEN)
      .eq('status', 'open')
      .or(LIGT_KLAAR(grens))
      .order('updated_at', { ascending: true })
      .limit(max)

    if (zoekFout) {
      /*
       * In de praktijk: 0049 is nog niet gedraaid en de kolom bestaat niet.
       * Dat is geen reden om de pc een fout te geven -- die zou dan elke
       * halve minuut een melding loggen -- maar wel om het hier te zeggen.
       */
      console.error('[lezer] werk zoeken: ' + zoekFout.message + ' (is 0049 al gedraaid?)')
    }

    for (const bon of (kandidaten ?? []) as Bon[]) {
      /*
       * Claimen met dezelfde voorwaarden als het zoeken, zodat twee pc's die
       * tegelijk vragen niet dezelfde bon krijgen en een bon die tussen
       * zoeken en claimen werd goedgekeurd alsnog blijft liggen: alleen wie
       * de rij nog in de oude stand aantreft, krijgt hem terug uit de update.
       */
      const { data: geclaimd, error: claimFout } = await admin
        .from('expenses')
        .update({ lees_status: 'bezig', lees_geclaimd_at: nu() })
        .eq('id', bon.id)
        .eq('status', 'open')
        .or(LIGT_KLAAR(grens))
        .select('id')
      if (claimFout || !geclaimd?.length) {
        if (claimFout) console.warn(`[lezer] ${bon.id} claimen: ${claimFout.message}`)
        continue
      }

      /*
       * Dezelfde bijlagen als leesFactuur zou zien, in dezelfde volgorde. De
       * pc kiest daaruit zoals kiesBijlage() -- PDF voor plaatje -- zodat
       * beide lezers hetzelfde bestand pakken.
       */
      const kandidatenBijlage = await bijlagenVan(admin, bon)
      if (!kandidatenBijlage.length) {
        await markeerMislukt(bon,
          'Bij deze kostenpost zit geen bijlage om te lezen.', 'lokaal: ' + model, model)
        continue
      }

      const bijlagen: Willekeurig[] = []
      for (const k of kandidatenBijlage) {
        const { data: link, error: linkFout } = await admin.storage
          .from(EMMER).createSignedUrl(k.pad, LINK_SECONDEN)
        if (linkFout || !link?.signedUrl) {
          console.warn(`[lezer] ${bon.id}: geen link voor ${k.pad}: ${linkFout?.message ?? 'leeg'}`)
          continue
        }
        bijlagen.push({ pad: k.pad, naam: k.naam, mime: k.mime ?? null, url: link.signedUrl })
      }

      if (!bijlagen.length) {
        await markeerMislukt(bon,
          'De bijlage is niet op te halen uit de opslag.', 'lokaal: ' + model, model)
        continue
      }

      const { berichtId, vanNaam, onderwerp } = herkomst(bon)
      stukken.push({ expenseId: bon.id, berichtId, vanNaam, onderwerp, bijlagen })
    }
  }

  if (stukken.length) console.log(`[lezer] ${stukken.length} bon(nen) uitgedeeld aan ${model}`)

  return json({
    ok: true,
    prompt: SYSTEEM,
    schema: LEZING_SCHEMA,
    terugvalToegestaan,
    werk: stukken,
  })
}

/* ------------------------------------------------------------------ *
 *  klaar -- de pc heeft gelezen
 * ------------------------------------------------------------------ */

async function klaar(body: Willekeurig) {
  const expenseId = tekst(body.expenseId, 80)
  const model = tekst(body.model, 60) || 'onbekend'
  const bestand = tekst(body.bestand, 200)
  const ruw = body.lezing

  if (!expenseId) return json({ ok: false, reden: 'expenseId ontbreekt.' }, 400)
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) {
    return json({ ok: false, reden: 'lezing moet het JSON-object van het model zijn.' }, 400)
  }

  const bon = await haalBon(expenseId)
  if (!bon) return json({ ok: false, reden: 'Kostenpost niet gevonden.' }, 404)
  if (bon.status !== 'open') return nietMeerOpen(bon)
  if (bon.lees_status !== 'bezig') return nietMeerBezig(bon)

  /*
   * Was het bestand er een dat de bijlagecontrole tegenhield, dan hoort dat
   * bij de lezing te staan -- net als wanneer Claude hem las.
   */
  const gemarkeerd = (await bijlagenVan(admin, bon)).find((k) => k.naam === bestand)?.gemarkeerd

  const doorWie = 'lokaal: ' + model
  const lezing = opschonen(ruw as Willekeurig, { doorWie, bestand, model, gemarkeerd })

  /*
   * Bewaren met "bezig" als voorwaarde, zodat twee meldingen over dezelfde bon
   * (een verlopen claim die alsnog afkomt) niet allebei tot verwerkLezing
   * leiden: alleen de eerste treft de rij nog op bezig aan.
   */
  const { data: bewaard, error } = await admin
    .from('expenses')
    .update({ gelezen: lezing, lees_status: 'klaar' })
    .eq('id', expenseId)
    .eq('lees_status', 'bezig')
    .select('id')
  if (error) {
    console.error(`[lezer] ${expenseId} lezing bewaren: ${error.message}`)
    return json({ ok: false, reden: 'De lezing is niet te bewaren: ' + error.message }, 500)
  }
  if (!bewaard?.length) {
    return json({
      ok: false,
      reden: 'Deze kostenpost was net niet meer "bezig" voor de lokale lezer; een andere ronde was eerder. Deze lezing is niet gebruikt.',
    }, 409)
  }

  await verwerkLezing(admin, { ...herkomst(bon), expenseId, lezing, bron: doorWie })

  return json({ ok: true })
}

/* ------------------------------------------------------------------ *
 *  Claude of mislukt -- wat er gebeurt als de pc het niet kon of niet
 *  vertrouwde
 *
 *  Eén route voor 'terugval' en 'mislukt', omdat de belofte van de stand
 *  lokaal-terugval voor allebei geldt. De seed in 0049 zegt: "als die het
 *  niet vertrouwt óf niet kan lezen alsnog Claude". Eerst deed alleen
 *  terugval dat en zette mislukt de bon meteen terminaal op mislukt -- stond
 *  Ollama vijf minuten uit, dan haalde de lus elke halve minuut drie bonnen
 *  en was de hele wachtrij binnen een paar minuten leeg-gemislukt, ook in de
 *  terugval-stand, en niets las ze later opnieuw.
 * ------------------------------------------------------------------ */

async function claudeOfMislukt(bon: Bon, reden: string, model: string) {
  /*
   * De instelling wordt hier opnieuw gelezen en niet vertrouwd op wat de pc
   * bij 'werk' te horen kreeg. Is hij tussendoor op 'lokaal' gezet, dan is
   * dat een beslissing om Claude niet meer te gebruiken, en die geldt meteen.
   */
  if ((await instelling('factuur_lezer')) !== 'lokaal-terugval') {
    await markeerMislukt(bon,
      `Lokale lezer: ${reden}. Terugval op Claude staat uit (instelling factuur_lezer).`,
      'lokaal: ' + model, model)
    return 'mislukt' as const
  }

  const uit = await leesFactuur({ admin, expenseId: bon.id, doorWie: 'de post (terugval)' })
  if (!uit.ok || !uit.lezing) {
    /*
     * Twee lezers, allebei niet gelukt. Beide redenen erbij: die van de pc
     * zegt waarom hij het opgaf, die van Claude waarom het daar ook niet
     * ging (meestal: bestand te groot of niet te lezen).
     */
    await markeerMislukt(bon,
      `Lokale lezer: ${reden}. Claude als terugval: ${uit.reden ?? 'onbekend'}`,
      'claude (terugval)', model)
    return 'mislukt' as const
  }

  await zetStatus(bon.id, 'klaar')
  await verwerkLezing(admin, {
    ...herkomst(bon), expenseId: bon.id, lezing: uit.lezing, bron: 'claude (terugval)',
  })

  console.log(`[lezer] ${bon.id} door Claude gelezen als terugval: ${reden}`)
  return 'claude' as const
}

/* ------------------------------------------------------------------ *
 *  terugval -- de pc vertrouwt het niet, mag Claude?
 * ------------------------------------------------------------------ */

async function terugval(body: Willekeurig) {
  const expenseId = tekst(body.expenseId, 80)
  const reden = tekst(body.reden) || 'De lokale lezer vertrouwde zijn lezing niet.'
  const model = tekst(body.model, 60) || (await instelling('lezer_model')) || 'onbekend'

  if (!expenseId) return json({ ok: false, reden: 'expenseId ontbreekt.' }, 400)

  const bon = await haalBon(expenseId)
  if (!bon) return json({ ok: false, reden: 'Kostenpost niet gevonden.' }, 404)
  if (bon.status !== 'open') return nietMeerOpen(bon)
  if (bon.lees_status !== 'bezig') return nietMeerBezig(bon)

  const gedaan = await claudeOfMislukt(bon, reden, model)
  return json({ ok: true, gedaan })
}

/* ------------------------------------------------------------------ *
 *  mislukt -- de pc kon het niet
 * ------------------------------------------------------------------ */

async function mislukt(body: Willekeurig) {
  const expenseId = tekst(body.expenseId, 80)
  const reden = tekst(body.reden) || 'De lokale lezer kon deze bijlage niet lezen.'
  const model = tekst(body.model, 60) || (await instelling('lezer_model')) || 'onbekend'
  const tijdelijk = body.tijdelijk === true

  if (!expenseId) return json({ ok: false, reden: 'expenseId ontbreekt.' }, 400)

  const bon = await haalBon(expenseId)
  if (!bon) return json({ ok: false, reden: 'Kostenpost niet gevonden.' }, 404)
  if (bon.status !== 'open') return nietMeerOpen(bon)
  if (bon.lees_status !== 'bezig') return nietMeerBezig(bon)

  /*
   * Ligt de oorzaak bij de pc zelf -- Ollama onbereikbaar, een time-out --
   * dan zegt dat niets over de bon. Die gaat terug op wacht, met de claim
   * leeg, en komt bij de volgende ronde gewoon weer mee. Zo kost een
   * herstart van Ollama alleen wachttijd en geen bon. Of het tijdelijk is weet
   * alleen de pc; die stuurt daarvoor tijdelijk:true mee (lezer.mjs).
   *
   * Dit gaat vóór de stand: ook met Claude als terugval is een halve minuut
   * wachten beter dan meteen betalen voor iets dat de pc zo weer zelf kan.
   * Blijft Ollama weg, dan blijft de bon op wacht staan met de badge in de
   * app, en op het ontwikkelaarsscherm staat waarom (laatst gezien, model).
   */
  if (tijdelijk) {
    const { error } = await admin
      .from('expenses')
      .update({ lees_status: 'wacht', lees_geclaimd_at: null })
      .eq('id', expenseId)
    if (error) console.error(`[lezer] ${expenseId} terug op wacht zetten: ${error.message}`)
    console.log(`[lezer] ${expenseId} terug op wacht, de pc kon tijdelijk niet: ${reden}`)
    return json({ ok: true, gedaan: 'wacht' })
  }

  const gedaan = await claudeOfMislukt(bon, reden, model)
  return json({ ok: true, gedaan })
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  De eigen AI: opdrachten ophalen en beantwoorden (0051)
 *
 *  Niet alleen facturen. Sinds 0051 kunnen ook het gesprek bij een melding en
 *  de chatbot op de website door het model op de eigen machine beantwoord
 *  worden. Die twee zijn anders dan een factuur: er zit iemand te wachten.
 *
 *  Vandaar de lange lijn. De machine vraagt om werk en deze functie houdt dat
 *  verzoek open tot er iets is -- hoogstens LANGE_LIJN_MS. Zo is de
 *  vertraging een fractie van een seconde in plaats van de tijd tot de
 *  volgende ronde, en zijn het toch maar een paar verzoeken per minuut in
 *  plaats van een paar per seconde.
 *
 *  Belangrijk voor later: dit is één machine, niet de computer van de
 *  bezoeker. Een chauffeur die op de website een vraag stelt praat met de
 *  functie trucky; wat daarachter gebeurt gaat buiten hem om. Straks staat
 *  het model op de eigen server en verandert er aan deze kant niets -- het
 *  programma in lezer/ draait dan daar in plaats van op de pc op kantoor.
 * ------------------------------------------------------------------ */

/** Hoe lang een verzoek om AI-werk open blijft staan als er niets is. */
const LANGE_LIJN_MS = 25_000

/** Hoe vaak er in die tijd gekeken wordt of er werk is. */
const LIJN_KIJK_MS = 400

/** Een opdracht die te lang op 'bezig' staat is blijven hangen. */
const AI_VASTGELOPEN_NA = 3 * 60_000

const rust = (ms: number) => new Promise((klaar) => setTimeout(klaar, ms))

async function aiWerk(body: Willekeurig): Promise<Response> {
  /*
   * Bij elke ronde even opruimen. Geen aparte wekker nodig: er komt hier toch
   * elke halve minuut iemand langs, en gebeurt dat niet, dan draait er ook
   * niets dat rijen achterlaat.
   */
  try { await admin.rpc('ai_opdrachten_opruimen') } catch { /* niet belangrijk */ }

  const grens = Date.now() - AI_VASTGELOPEN_NA
  const tot = Date.now() + LANGE_LIJN_MS

  for (;;) {
    const { data, error } = await admin
      .from('ai_opdrachten')
      .select('id, soort, systeem, gebruiker, model, schema, status, geclaimd_at')
      .or(`status.eq.wacht,and(status.eq.bezig,geclaimd_at.lt.${grens})`)
      .order('created_at', { ascending: true })
      .limit(1)

    if (error) {
      /* Tabel bestaat niet: 0051 is nog niet gedraaid. Eerlijk zeggen. */
      return json({ ok: false, reden: 'Geen postvak voor AI-opdrachten: ' + error.message }, 500)
    }

    const rij = (data ?? [])[0]
    if (rij) {
      /*
       * Opeisen met de status erin. Draaien er twee machines, dan wint er
       * precies één -- de ander raakt nul rijen en zoekt verder.
       */
      const { data: mijn } = await admin
        .from('ai_opdrachten')
        .update({ status: 'bezig', geclaimd_at: Date.now(), updated_at: Date.now() })
        .eq('id', rij.id)
        .eq('status', rij.status)
        .select('id')

      if ((mijn ?? []).length > 0) {
        return json({
          ok: true,
          opdracht: {
            id: rij.id,
            soort: rij.soort,
            systeem: rij.systeem,
            gebruiker: rij.gebruiker,
            model: rij.model,
            schema: rij.schema ?? null,
          },
        })
      }
      continue
    }

    if (Date.now() >= tot) return json({ ok: true, opdracht: null })
    await rust(LIJN_KIJK_MS)
  }
}

async function aiKlaar(body: Willekeurig): Promise<Response> {
  const id = String(body.id ?? '')
  if (!id) return json({ ok: false, reden: 'Geen opdracht opgegeven.' }, 400)

  const antwoord = typeof body.antwoord === 'string' ? body.antwoord : null
  const fout = typeof body.fout === 'string' ? body.fout.slice(0, 500) : null
  const model = typeof body.model === 'string' ? body.model.slice(0, 120) : null

  if (!antwoord && !fout) {
    return json({ ok: false, reden: 'Geen antwoord en geen reden.' }, 400)
  }

  const { data, error } = await admin
    .from('ai_opdrachten')
    .update({
      status: antwoord ? 'klaar' : 'mislukt',
      antwoord,
      fout,
      gebruikt_model: model,
      klaar_at: Date.now(),
      updated_at: Date.now(),
    })
    .eq('id', id)
    .eq('status', 'bezig')
    .select('id')

  if (error) return json({ ok: false, reden: error.message }, 500)

  /*
   * Nul rijen betekent dat de functie die zat te wachten het al had opgegeven
   * en de opdracht is opgeruimd, of dat een andere machine hem overnam. Geen
   * fout: het antwoord is alleen te laat. Dat zeggen we, zodat het in het
   * logboek van de machine staat en niet als stilte verdwijnt.
   */
  if ((data ?? []).length === 0) {
    return json({ ok: true, teLaat: true })
  }

  return json({ ok: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST.' }, 405)

  if (!LEZER_SECRET) {
    return json({
      ok: false,
      reden: 'LEZER_SECRET staat niet op de server. Zet hem met "supabase secrets set LEZER_SECRET=..." ' +
             'en gebruik hetzelfde geheim in lezer/.env op de pc.',
    }, 500)
  }

  let body: Willekeurig
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }

  if (String(body.geheim ?? '') !== LEZER_SECRET) {
    return json({ ok: false, reden: 'Verkeerd geheim.' }, 403)
  }

  const actie = String(body.actie ?? '')

  try {
    if (actie === 'werk') return await werk(body)
    if (actie === 'klaar') return await klaar(body)
    if (actie === 'terugval') return await terugval(body)
    if (actie === 'mislukt') return await mislukt(body)
    if (actie === 'ai-werk') return await aiWerk(body)
    if (actie === 'ai-klaar') return await aiKlaar(body)
    return json({
      ok: false,
      reden: `Onbekende actie "${actie}". Ken: werk, klaar, terugval, mislukt, ai-werk, ai-klaar.`,
    }, 400)
  } catch (e) {
    console.error(`[lezer] ${actie}: ` + String(e))
    return json({ ok: false, reden: 'Er ging iets mis op de server; kijk in de log van de functie lezer.' }, 500)
  }
})
