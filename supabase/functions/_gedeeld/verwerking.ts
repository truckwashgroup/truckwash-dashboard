/* ===========================================================================
 *  De verwerking -- wat er met een lezing gebeurt nádat er gelezen is
 *
 *  Dit stond eerst in ontvang-mail, in boekAutomatisch(), direct achter de
 *  aanroep van de factuurlezer. Dat was logisch zolang er één lezer was.
 *
 *  Nu zijn het er twee. Claude in de cloud, en Ollama op de pc van Casper
 *  (Edge Function lezer). De afspraak is dat de uitkomst voor de administratie
 *  DEZELFDE is, wie er ook las: dezelfde verkoopcontrole, dezelfde indeling,
 *  dezelfde velden op de kostenpost. Dat kan alleen als het denken erna op één
 *  plek staat en beide lezers daar naartoe gaan. Dat is deze module.
 *
 *    ontvang-mail   Claude las de bijlage        -> verwerkLezing(bron 'claude')
 *    lezer          de pc stuurde zijn lezing    -> verwerkLezing(bron 'lokaal: <model>')
 *    lezer          de pc gaf op, Claude las     -> verwerkLezing(bron 'claude (terugval)')
 *
 *  Wat hier NIET gebeurt is lezen, en ook niet goedkeuren. Er komt een lezing
 *  binnen die al is opgeschoond (factuurlezer.ts, opschonen()); hier wordt
 *  beslist wat die betekent en wat er op de kostenpost komt. De bon blijft op
 *  "open" staan en komt gewoon in de rij bij de administratie -- ingevuld in
 *  plaats van leeg, nakijken in plaats van overtikken.
 *
 *  De code is letterlijk overgenomen uit ontvang-mail, met het commentaar dat
 *  vertelt waarom het zo is. Eén verschil: de databaseverbinding (admin) komt
 *  van de beller, omdat elke functie de zijne heeft.
 * =========================================================================== */

import type { Lezing } from './factuurlezer.ts'

type Willekeurig = Record<string, unknown>

const nu = () => Date.now()

/* ------------------------------------------------------------------ *
 *  De factuur zichzelf laten boeken
 *
 *  Drie stappen, en elke stap mag los mislukken zonder de rest mee te nemen.
 *  Wat er niet lukt blijft gewoon werk voor een mens -- dat was het tot nu toe
 *  toch al.
 *
 *    1. uitlezen      is al gebeurd; de lezing komt binnen
 *    2. indelen       factuur_indelen kiest grootboekrekening en tags
 *    3. wegschrijven  alles op de kostenpost, met erbij waar het vandaan komt
 *
 *  Goedkeuren gebeurt hier bijna nooit: de bon blijft op "open" staan en komt
 *  gewoon in de rij bij de administratie. Het verschil is dat hij daar nu
 *  ingevuld ligt in plaats van leeg -- nakijken in plaats van overtikken.
 *
 *  De uitzondering is stap 4, en die staat standaard uit. Heeft een MENS
 *  dezelfde leverancier al drie keer voor ongeveer hetzelfde bedrag
 *  goedgekeurd, dan mag de vierde vanzelf door (0050). De database beslist
 *  dat, niet deze functie: mag_automatisch_goedkeuren() kijkt naar de
 *  gewoonte, het plafond, de marge en de dubbele nummers, en geeft ja of nee
 *  met de reden erbij.
 * ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
export async function verwerkLezing(admin: any, opties: {
  berichtId: string
  expenseId: string
  lezing: Lezing
  vanNaam: string
  onderwerp: string
  /** Wie las: 'claude', 'claude (terugval)' of 'lokaal: <model>'. Komt in expenses.lezer. */
  bron: string
}): Promise<void> {
  const { berichtId, expenseId, lezing, vanNaam, onderwerp, bron } = opties

  /*
   * Wie las gaat er eerst op, apart van de rest. Twee redenen. Deze functie
   * heeft drie uitgangen vóór het wegschrijven (verkoop, niet bevestigd,
   * pakbon), en ook dan wil je achteraf kunnen zien welke lezer dat vond. En
   * de kolom komt uit 0049; is die migratie nog niet gedraaid, dan mislukt
   * alleen dit regeltje en niet het invullen van de bon.
   */
  const { error: lezerFout } = await admin
    .from('expenses').update({ lezer: bron }).eq('id', expenseId)
  if (lezerFout) console.warn('[verwerking] lezer vastleggen: ' + lezerFout.message)

  /*
   * Een verkoopfactuur is geen kostenpost.
   *
   * Tot hier is alles wat met een PDF binnenkwam een kostenpost geworden, ook
   * een factuur die Truckwash zélf aan een klant stuurde -- een klant die hem
   * terugmailt met een vraag, een collega die hem doorstuurt "voor de
   * administratie". Die stond dan aan de kostenkant, met het eigen btw-nummer
   * als leverancier, en niemand zag het verschil met een echte rekening.
   *
   * Staat Truckwash als afzender op het stuk, dan gaat de kostenpost die de
   * post zojuist aanmaakte weer weg. Dat kan hier nog veilig: er heeft nog
   * geen mens naar gekeken, en het bericht zelf blijft staan, gemerkt als
   * verkoopfactuur zodat het in de postbus bij elkaar staat. Wat er verder
   * mee moet is aan de administratie -- dit is geen verkoopadministratie.
   *
   * Maar niet op het woord van het model alleen. Weghalen is de enige stap in
   * deze functie die niet vanzelf goed komt als hij fout was, en het model
   * zit er soms naast: een andere wasserij met "Truckwash" in de naam, een
   * creditnota, een scan met alleen het stempel "ontvangen" van Truckwash
   * erop. Dus pas weg als het stuk óók een nummer van Truckwash zelf draagt
   * -- KvK, btw of IBAN -- en dat is geen lezing maar een vergelijking.
   */
  if (lezing.richting === 'verkoop') {
    const slot = await eigenNummerOpHetStuk(admin, lezing)

    if (slot.bevestigd) {
      console.log(`[verwerking] ${expenseId} is een verkoopfactuur: ${slot.waarom}`)
      if (await zetAlsVerkoopfactuur(admin, berichtId, expenseId, vanNaam, onderwerp)) return
      /*
       * Het merken lukte niet -- in de praktijk: 0047 is nog niet gedraaid en
       * de kolom soort bestaat niet. Dan is dit gewoon een bon zoals vroeger,
       * en die hoort wél ingevuld te worden in plaats van met bedrag nul te
       * blijven staan. Dus doorvallen naar het gewone invullen.
       */
      console.error(`[verwerking] ${expenseId}: verkoop niet kunnen merken, wordt gewoon ingevuld`)
    } else {

      /*
       * Het model zegt verkoop, het tweede slot niet. Dan gebeurt er niets dat
       * niet terug kan: de kostenpost blijft staan met de lezing erop, en er
       * komt één regel twijfel bij die zegt wat er aan de hand is -- die staat
       * in de app bij de bon. Bedragen gaan er niet op. Een leeg veld vraagt om
       * een mens, en die moet hier toch al naar kijken.
       */
      await twijfelErbij(admin, expenseId, lezing,
        'De lezer denkt dat dit een factuur van Truckwash zelf is (verkoop), ' +
        `maar ${slot.waarom}. Daarom is dit toch een kostenpost gebleven, zonder ` +
        'bedragen. Is het inderdaad een verkoopfactuur, keur hem dan af.')
      console.log(`[verwerking] ${expenseId}: model zegt verkoop, niet bevestigd (${slot.waarom})`)
      return
    }
  }

  /*
   * Het omgekeerde ook vastleggen, zodat het scherm "inkoop" kan zeggen in
   * plaats van niets. Alleen als de lezer het zeker wist; bij twijfel blijft
   * het leeg en gaat de bon gewoon de rij in, zoals altijd.
   */
  if (lezing.richting === 'inkoop') {
    await admin.from('mailbox').update({ soort: 'inkoop' }).eq('id', berichtId)
  }

  /*
   * Een pakbon is geen rekening.
   *
   * Er staan wel bedragen op, en die zou je zo kunnen overnemen -- en dan
   * staat dezelfde levering twee keer in de kosten zodra de echte factuur
   * een week later binnenkomt. De lezing blijft bewaard, het invullen niet.
   */
  if (lezing.soort === 'pakbon') {
    console.log(`[verwerking] ${expenseId} is een pakbon, niet ingevuld`)
    return
  }

  /*
   * De naam van de leverancier van de factuur zelf gaat voor die uit het
   * mailadres. "facturatie@" of "noreply@" zegt niets; wat er op de bon staat
   * wel. En de indeling hangt aan die naam, dus dit is niet cosmetisch.
   */
  const naam = lezing.leverancier ?? vanNaam

  /* --- 2. indelen --- */

  let indeling: { grootboek_code: string | null; tags: string[]; bron: string } | null = null
  try {
    const { data, error } = await admin.rpc('factuur_indelen', {
      leverancier_in: naam,
      omschrijving_in: [lezing.kenmerk, onderwerp].filter(Boolean).join(' '),
    })
    if (error) throw new Error(error.message)
    const rij = Array.isArray(data) ? data[0] : data
    if (rij) indeling = rij
  } catch (e) {
    console.warn('[verwerking] indelen mislukte: ' + String(e))
  }

  /* --- 3. wegschrijven --- */

  const bij: Willekeurig = { updated_at: nu() }

  const bedrag = lezing.subtotaalExcl
  /*
   * Nul niet wegschrijven, en een negatief bedrag ook niet.
   *
   * Een leeg veld vraagt om invullen; een nul ziet eruit als een gelezen
   * bedrag en gaat zo de boekhouding in. Dat is het verschil tussen "dit moet
   * nog" en "dit klopt".
   */
  if (bedrag != null && bedrag > 0) bij.amount_excl = bedrag

  if (lezing.btwBedrag != null && lezing.btwBedrag >= 0) bij.btw_bedrag = lezing.btwBedrag

  /*
   * Het percentage staat zelden apart op een factuur; het staat per regel.
   * Uitrekenen uit btw gedeeld door subtotaal mag alleen als er één tarief
   * in het spel is -- anders is 14% het antwoord, en dat bestaat niet.
   */
  const tarieven = new Set<number>(
    lezing.regels.map((r) => (r as { btwPct?: number }).btwPct)
      .filter((p): p is number => typeof p === 'number'))
  if (tarieven.size === 1) {
    const enige = [...tarieven][0]
    if (enige >= 0 && enige <= 30) bij.vat_pct = enige
  } else if (bedrag != null && bedrag > 0 && lezing.btwBedrag != null) {
    const afgeleid = Math.round((lezing.btwBedrag / bedrag) * 100)
    if ([0, 9, 21].includes(afgeleid)) bij.vat_pct = afgeleid
  }

  if (lezing.leverancier) bij.supplier = lezing.leverancier
  if (lezing.factuurnummer) bij.factuurnummer = lezing.factuurnummer
  if (lezing.vervaldatum) bij.vervaldatum = lezing.vervaldatum
  if (lezing.datum) bij.expense_date = lezing.datum
  if (lezing.kenmerk) bij.description = `${lezing.kenmerk} -- ${onderwerp}`.slice(0, 300)
  if (lezing.voorstelCategorie) bij.category = lezing.voorstelCategorie

  if (indeling?.grootboek_code) {
    bij.grootboek_code = indeling.grootboek_code
    bij.tags = indeling.tags ?? []
    bij.indeling_bron = indeling.bron
  }

  const { error } = await admin.from('expenses').update(bij).eq('id', expenseId)
  if (error) {
    console.error('[verwerking] kostenpost bijwerken: ' + error.message)
    return
  }

  console.log('[verwerking] geboekt ' + JSON.stringify({
    expenseId,
    lezer: bron,
    leverancier: naam,
    bedrag: bij.amount_excl ?? null,
    btw: bij.vat_pct ?? null,
    rekening: bij.grootboek_code ?? null,
    bron: bij.indeling_bron ?? null,
    twijfel: lezing.twijfel.length,
  }))

  /* --- 4. en misschien meteen goedkeuren --- */

  await misschienGoedkeuren(admin, {
    expenseId,
    berichtId,
    lezing,
    leverancier: String(bij.supplier ?? naam),
    bedrag: typeof bij.amount_excl === 'number' ? bij.amount_excl : null,
    grootboek: typeof bij.grootboek_code === 'string' ? bij.grootboek_code : null,
    indelingBron: typeof bij.indeling_bron === 'string' ? bij.indeling_bron : null,
  })
}

/* ------------------------------------------------------------------ *
 *  Wat drie keer hetzelfde was
 *
 *  De vraag was eenvoudig: is dezelfde leverancier al een paar keer voor
 *  hetzelfde bedrag goedgekeurd, dan hoeft de volgende niet opnieuw langs
 *  iemand. Het antwoord staat in de database (0050,
 *  mag_automatisch_goedkeuren), want daar staan de eerdere goedkeuringen en
 *  daar horen de vier sloten: alleen wat een mens goedkeurde telt mee, het
 *  bedrag moet binnen een marge van de mediaan liggen, er is een plafond, en
 *  een factuurnummer dat al bestaat gaat nooit vanzelf door.
 *
 *  Hier staan de drie voorwaarden die de database niet kan zien, omdat ze
 *  over de LEZING gaan en niet over de boekhouding:
 *
 *    - de lezer twijfelde nergens over
 *    - de rekening komt uit het geheugen, niet uit een gok op trefwoorden
 *    - het is een factuur of een bon, geen aanmaning of iets onbekends
 *
 *  Alle drie zijn ze streng met opzet. Twijfel betekent dat er een mens naar
 *  moet kijken; dat is de hele reden dat het veld bestaat. Een geraden
 *  rekening betekent dat het systeem deze leverancier nog niet kent, en dan
 *  kan het ook niet weten dat dit "hetzelfde" is. En een aanmaning is per
 *  definitie een tweede keer.
 *
 *  Mislukt hier iets -- de migratie is nog niet gedraaid, de functie bestaat
 *  niet -- dan blijft de bon gewoon open staan. Dat is de veilige uitkomst en
 *  precies wat er zonder dit stuk zou gebeuren.
 * ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
async function misschienGoedkeuren(admin: any, opties: {
  expenseId: string
  berichtId: string
  lezing: Lezing
  leverancier: string
  bedrag: number | null
  grootboek: string | null
  indelingBron: string | null
}): Promise<void> {
  const { expenseId, berichtId, lezing, leverancier, bedrag, grootboek, indelingBron } = opties

  if (lezing.twijfel.length > 0) return
  if (!grootboek || indelingBron !== 'geheugen') return
  if (lezing.soort !== 'factuur' && lezing.soort !== 'bon') return
  if (bedrag == null || bedrag <= 0) return

  let oordeel: { mag: boolean; waarom: string; keren: number; gewoonte: number | null } | null = null
  try {
    const { data, error } = await admin.rpc('mag_automatisch_goedkeuren', {
      leverancier_in: leverancier,
      bedrag_in: bedrag,
      factuurnummer_in: lezing.factuurnummer ?? null,
      expense_in: expenseId,
    })
    if (error) throw new Error(error.message)
    const rij = Array.isArray(data) ? data[0] : data
    if (rij) oordeel = rij
  } catch (e) {
    console.warn('[verwerking] automatisch goedkeuren niet beoordeeld: ' + String(e))
    return
  }

  if (!oordeel?.mag) {
    /*
     * Niet loggen als het gewoon uit staat -- dat is de normale toestand en
     * zou elke factuur een regel ruis geven.
     */
    if (oordeel && !/staat uit/i.test(oordeel.waarom)) {
      console.log(`[verwerking] ${expenseId} niet vanzelf goedgekeurd: ${oordeel.waarom}`)
    }
    return
  }

  const { error } = await admin.from('expenses').update({
    status: 'goedgekeurd',
    approved_at: nu(),
    approved_by: null,
    approved_by_name: 'Automatisch',
    goedkeuring_bron: 'automatisch',
    goedkeuring_reden: oordeel.waarom.slice(0, 400),
    updated_at: nu(),
  }).eq('id', expenseId).eq('status', 'open')

  if (error) {
    console.error('[verwerking] automatisch goedkeuren mislukte: ' + error.message)
    return
  }

  console.log(`[verwerking] ${expenseId} automatisch goedgekeurd: ${oordeel.waarom}`)

  /*
   * En zeggen dat het gebeurd is. Een goedkeuring die niemand ziet is het
   * verschil tussen "dit gaat vanzelf" en "hier let niemand op"; een melding
   * per stuk houdt het het eerste. Info en geen taak: er hoeft niets gedaan
   * te worden, alleen geweten.
   */
  await meldManagement(admin, berichtId + '_auto', {
    kind: 'info',
    title: `Vanzelf goedgekeurd: ${leverancier}`.slice(0, 200),
    body: `${euro(bedrag)} exclusief btw. ${oordeel.waarom} ` +
          'Klopt het niet, dan keur je hem alsnog af bij Kostenposten.',
    link: 'financieel',
  })
}

/**
 * Een bedrag zoals je het schrijft: € 1.234,56.
 *
 * Met de hand en niet met Intl: dit draait in Deno op een server waar de
 * landinstelling niet vastligt, en een mail met "€ 1,234.56" erin leest een
 * Nederlander verkeerd -- dat is precies een factor duizend.
 */
function euro(bedrag: number): string {
  const [heel, cent] = Math.abs(bedrag).toFixed(2).split('.')
  const metPunten = heel.replace(/\d(?=(\d{3})+$)/g, '$&.')
  return (bedrag < 0 ? '-€ ' : '€ ') + metPunten + ',' + cent
}

/* ------------------------------------------------------------------ *
 *  Is dit écht een stuk van Truckwash zelf?
 *
 *  Het tweede slot op de verkoopfactuur. De nummers van Truckwash 1 Group
 *  staan in de instellingen -- eigen_kvk, eigen_btw, eigen_iban, met een
 *  komma ertussen als het er meer zijn -- en worden vergeleken met wat de
 *  lezer op het stuk zag. Vergeleken zonder spaties, punten en streepjes:
 *  "NL 1234.56.789.B01" en "NL123456789B01" zijn hetzelfde nummer.
 *
 *  Staat er niets ingesteld, dan kan er niets bevestigd worden. Dat is een
 *  bewuste keuze: liever een verkoopfactuur die als kostenpost blijft staan
 *  (met de twijfel erop, dus zichtbaar) dan een echte rekening die verdwijnt
 *  omdat de instelling nog leeg was.
 * ------------------------------------------------------------------ */

/** Alleen letters en cijfers, in hoofdletters -- zo vergelijk je nummers. */
export function kaal(waarde: unknown): string {
  return String(waarde ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// deno-lint-ignore no-explicit-any
export async function eigenNummerOpHetStuk(
  admin: any,
  lezing: Lezing,
): Promise<{ bevestigd: boolean; waarom: string }> {
  const { data: rijen, error } = await admin
    .from('instellingen')
    .select('sleutel, waarde')
    .in('sleutel', ['eigen_kvk', 'eigen_btw', 'eigen_iban'])

  if (error) {
    console.warn('[verwerking] eigen nummers lezen: ' + error.message)
    return { bevestigd: false, waarom: 'de eigen nummers waren niet op te halen uit de instellingen' }
  }

  const eigen = (sleutel: string): string[] =>
    String((rijen ?? []).find((r: Willekeurig) => r.sleutel === sleutel)?.waarde ?? '')
      .split(',').map(kaal).filter(Boolean)

  const kvk = eigen('eigen_kvk')
  const btw = eigen('eigen_btw')
  const iban = eigen('eigen_iban')

  if (!kvk.length && !btw.length && !iban.length) {
    return {
      bevestigd: false,
      waarom: 'het eigen KvK-nummer, btw-nummer en IBAN van Truckwash staan nog niet ' +
              'in de instellingen (eigen_kvk, eigen_btw, eigen_iban)',
    }
  }

  const opStuk = { kvk: kaal(lezing.kvk), btw: kaal(lezing.btwNummer), iban: kaal(lezing.iban) }

  if (opStuk.kvk && kvk.includes(opStuk.kvk)) {
    return { bevestigd: true, waarom: `KvK-nummer ${lezing.kvk} is dat van Truckwash` }
  }
  if (opStuk.btw && btw.includes(opStuk.btw)) {
    return { bevestigd: true, waarom: `btw-nummer ${lezing.btwNummer} is dat van Truckwash` }
  }
  if (opStuk.iban && iban.includes(opStuk.iban)) {
    return { bevestigd: true, waarom: `IBAN ${lezing.iban} is die van Truckwash` }
  }

  const gezien = [
    lezing.kvk ? `KvK ${lezing.kvk}` : null,
    lezing.btwNummer ? `btw ${lezing.btwNummer}` : null,
    lezing.iban ? `IBAN ${lezing.iban}` : null,
  ].filter(Boolean)

  return {
    bevestigd: false,
    waarom: gezien.length
      ? `op het stuk staat ${gezien.join(', ')} en dat is niet van Truckwash`
      : 'er staat geen KvK-nummer, btw-nummer of IBAN op het stuk om dat aan te toetsen',
  }
}

/**
 * Eén regel twijfel bij de lezing zetten die al op de kostenpost staat.
 *
 * De lezer heeft zijn lezing net bewaard; dit schrijft dezelfde lezing terug
 * met één zin erbij. Zo staat in de app, bij de bon, waarom de post hem niet
 * heeft ingevuld -- in plaats van een lege bon zonder uitleg.
 */
// deno-lint-ignore no-explicit-any
export async function twijfelErbij(admin: any, expenseId: string, lezing: Lezing, zin: string) {
  const { error } = await admin
    .from('expenses')
    .update({ gelezen: { ...lezing, twijfel: [...lezing.twijfel, zin] } })
    .eq('id', expenseId)
  if (error) console.warn('[verwerking] twijfel bijschrijven: ' + error.message)
}

/**
 * De kostenpost weghalen en het bericht als verkoopfactuur merken.
 *
 * De volgorde is met opzet: eerst het bericht, dan de kostenpost, dan de
 * melding. Valt het halverwege om, dan staat er hoogstens een bericht dat
 * "verkoop" zegt met nog een kostenpost eraan -- en dat ziet een mens in de
 * postbus. Andersom, een verdwenen kostenpost bij een bericht dat nog "bon"
 * zegt, wijst nergens naar.
 *
 * De verwijzing expense_id gaat expliciet leeg. De database doet dat ook al
 * (on delete set null), maar de app leest het bericht misschien net tussen
 * de twee stappen; dan wijst hij liever naar niets dan naar iets dat weg is.
 */
// deno-lint-ignore no-explicit-any
export async function zetAlsVerkoopfactuur(
  admin: any,
  berichtId: string,
  expenseId: string,
  vanNaam: string,
  onderwerp: string,
): Promise<boolean> {
  const { error: merk } = await admin
    .from('mailbox')
    .update({ soort: 'verkoop', expense_id: null })
    .eq('id', berichtId)
  if (merk) {
    console.error('[verwerking] bericht merken als verkoop: ' + merk.message)
    return false
  }

  const { error: weg } = await admin.from('expenses').delete().eq('id', expenseId)
  if (weg) {
    // Het bericht zegt al "verkoop"; de bon die blijft staan valt daar op.
    console.error('[verwerking] kostenpost van verkoopfactuur weghalen: ' + weg.message)
  }

  /*
   * De melding aan het management is al de deur uit -- die gaat mee met het
   * antwoord aan Resend, terwijl het lezen daarna pas klaar is. Dus wordt hij
   * hier overschreven, onder dezelfde id's. Geen taak meer voor de kostenposten
   * maar een seintje dat er een verkoopfactuur ligt.
   */
  await meldManagement(admin, berichtId, {
    kind: 'info',
    title: `Verkoopfactuur binnengekomen: ${onderwerp}`.slice(0, 200),
    body: `Van ${vanNaam} · een factuur van Truckwash zelf, geen kostenpost. ` +
          'Zit het toch anders, dan maak je er in de postbus alsnog een kostenpost van.',
    link: 'postbus',
  }, true)

  console.log(`[verwerking] ${expenseId} was een verkoopfactuur; kostenpost weggehaald`)
  return true
}

/* ------------------------------------------------------------------ *
 *  Het management een seintje
 *
 *  Eén melding per manager, met een id dat uit het bericht volgt. Dat laatste
 *  is geen gemak maar noodzaak: de melding gaat weg vóór de factuur is
 *  gelezen, en blijkt het daarna een verkoopfactuur, dan moet dezelfde
 *  melding een andere kop krijgen -- niet een tweede erbij.
 *
 *  Het eerste bericht wordt ingevoegd, niet ge-upsert. Zou het lezen sneller
 *  klaar zijn dan dit stuk (het gebeurt niet, maar de code weet dat niet),
 *  dan wint de tweede versie: een invoeging op een bestaand id mislukt
 *  stil, en dat is hier precies goed.
 *
 *  Staat hier en niet in ontvang-mail, omdat zetAlsVerkoopfactuur hem nodig
 *  heeft en ontvang-mail hem ook: het eerste seintje bij binnenkomst gaat
 *  vanuit de webhook, het tweede (verkoopfactuur) vanuit welke lezer dan ook.
 * ------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
export async function meldManagement(
  admin: any,
  berichtId: string,
  melding: { kind: 'taak' | 'info'; title: string; body: string; link: string },
  overschrijf = false,
) {
  const { data: bazen } = await admin
    .from('profiles')
    .select('id, name')
    .contains('roles', ['management'])
    .eq('active', true)

  for (const baas of bazen ?? []) {
    const rij = {
      id: 'nt_' + berichtId + '_' + baas.id.slice(-6),
      to_user_id: baas.id,
      kind: melding.kind,
      title: melding.title,
      body: melding.body,
      from_name: 'Postbus',
      created_at: nu(),
      link: melding.link,
    }
    const { error } = overschrijf
      ? await admin.from('notifications').upsert(rij, { onConflict: 'id' })
      : await admin.from('notifications').insert(rij)
    if (error && error.code !== '23505') {
      console.warn('[verwerking] melding aan management: ' + error.message)
    }
  }
}
