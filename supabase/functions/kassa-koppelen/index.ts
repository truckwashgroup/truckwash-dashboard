/* ===========================================================================
 *  Een kassa koppelen met een eenmalige code
 *
 *  Het kantoor maakt een kassa aan en zet er een code bij. Die code wordt op
 *  het apparaat ingetoetst; deze functie geeft dat apparaat daarna zijn eigen
 *  inlog en zet het in de lijst.
 *
 *  Waarom dit op de server staat: een inlogaccount aanmaken vraagt de
 *  servicesleutel, en die hoort niet in een app die op tablets staat.
 *
 *  Waarom een apparaat een eigen account krijgt en niet dat van een
 *  medewerker: anders staat het wachtwoord van een mens op een tablet achter
 *  de balie, en verliest die mens zijn toegang zodra het apparaat eruit gaat.
 *  Nu hoort bij elk apparaat een naam in een lijst, en kan het kantoor er van
 *  een afstand de stekker uit trekken.
 *
 *  Waarom deze functie zonder inlog te bereiken is (--no-verify-jwt): een
 *  kassa die nog niet gekoppeld is, heeft niets om zich mee aan te melden.
 *  Dat is precies de situatie waar dit voor bedoeld is. Wat de deur dichthoudt
 *  is de code zelf: acht tekens uit een alfabet van 32, één keer geldig, en
 *  hij verloopt. Verder komt er niets uit deze functie wat je zonder code al
 *  niet wist.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/**
 * Het domein waarop de apparaataccounts staan.
 *
 * Er gaat nooit post naar toe -- het account wordt met email_confirm
 * aangemaakt, dus Supabase stuurt niets. Het is een sleutel, geen postbus.
 */
const APPARAAT_DOMEIN = Deno.env.get('KASSA_DOMEIN') ?? 'apparaat.truckwash1group.nl'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const nu = () => Date.now()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ------------------------------------------------------------------ *
 *  De code
 *
 *  Zonder i, l, 1, O en 0. Iemand leest deze code van een scherm en tikt hem
 *  op een tablet in; die tekens worden dan door elkaar gehaald en dan belt er
 *  iemand dat het niet werkt.
 * ------------------------------------------------------------------ */

const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Zelfde opschoning als in de kassa (src/lib/koppelen.ts).
 *
 * Streepjes en spaties eruit, kleine letters omhoog. Iemand die "K7QJ-4M2P"
 * intikt omdat het scherm het zo groepeert, hoort niet op een foutmelding te
 * stuiten.
 */
function schoon(code: unknown): string {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function wachtwoord(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const alfabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(bytes, (b) => alfabet[b % alfabet.length]).join('')
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
}

/* ------------------------------------------------------------------ *
 *  Even wachten
 *
 *  Een gok kost hiermee tijd. Acht tekens uit 32 is ruim buiten bereik van
 *  raden, maar een halve seconde per poging maakt het onbetaalbaar in plaats
 *  van alleen onwaarschijnlijk -- en het valt niemand op die de code gewoon
 *  intikt.
 * ------------------------------------------------------------------ */

const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ *
 *  Wat een databasefout betekent
 *
 *  Een melding als "duplicate key value violates unique constraint
 *  profiles_auth_id_key" is voor iemand achter een balie geen melding. Hij
 *  weet niet wat een constraint is, hij weet alleen dat de kassa niet
 *  opstart -- en de naam van de index zegt niets over wat er nu moet gebeuren.
 *
 *  Dus zetten we de gevallen die we kennen om in een zin die zegt wat er is en
 *  wat eraan te doen valt. Wat we niet kennen komt er letterlijk bij, want een
 *  onbekende fout verzwijgen is erger dan een lelijke fout laten zien.
 * ------------------------------------------------------------------ */

function legUit(wat: string, melding: string): string {
  const m = melding.toLowerCase()

  if (m.includes('profiles_auth_id_key')) {
    return 'Aan dit inlogaccount hing al een ander dossier. Dat is een restant ' +
           'van een eerdere koppelpoging die halverwege afbrak. Probeer het nog ' +
           'een keer -- deze functie ruimt het nu zelf op. Blijft het staan, laat ' +
           'dan het apparaat in het dashboard intrekken en maak een nieuwe code.'
  }

  if (m.includes('pos_devices_register_key')) {
    return 'Op deze kassa staat al een ander apparaat. Trek dat eerst in het ' +
           'dashboard in; dan stuurt het eerst zijn wachtrij leeg en komt deze ' +
           'kassa daarna vrij.'
  }

  if (m.includes('violates foreign key') && m.includes('location')) {
    return 'De vestiging van deze kassa bestaat niet meer. Zet die in het ' +
           'dashboard goed en maak dan een nieuwe code.'
  }

  if (m.includes('column') && m.includes('does not exist')) {
    return 'De database mist een kolom die deze functie nodig heeft. Draai ' +
           'supabase/setup.sql opnieuw in de SQL-editor; dat mag altijd. ' +
           '(' + melding + ')'
  }

  return `Het ${wat} van deze kassa kon niet worden opgeslagen: ${melding}`
}

/* ================================================================== *
 *  Het inwisselen
 * ================================================================== */

interface Verzoek {
  code?: string
  apparaat?: {
    /** Wat het apparaat van zichzelf weet; blijft staan na herinstalleren. */
    sleutel?: string
    naam?: string
    platform?: string
    versie?: string
  }
}

async function koppel(req: Request): Promise<Response> {
  let body: Verzoek
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }

  const code = schoon(body.code)
  if (code.length < 6) {
    return json({ ok: false, reden: 'Vul de code in die in het dashboard staat.' }, 400)
  }

  await wacht(400)

  const { data: paar, error: paarFout } = await admin
    .from('pos_pairings')
    .select('id, code, location_id, register_id, expires_at, used_at')
    .eq('code', code)
    .maybeSingle()

  if (paarFout) {
    return json({ ok: false, reden: 'De database antwoordde niet: ' + paarFout.message }, 500)
  }
  if (!paar) {
    /*
     * 422 en niet 404, en dat is geen willekeur.
     *
     * 404 is wat het platform zelf teruggeeft als een functie niet uitgerold
     * is. Gebruikten wij dat ook voor "die code ken ik niet", dan zijn die twee
     * gevallen aan de statuscode niet te onderscheiden -- en dan vertelt de
     * kassa iemand dat de code fout is terwijl er niets op de server staat, of
     * omgekeerd. Dat is precies één keer gebeurd.
     */
    return json({
      ok: false,
      reden: 'Deze code kent de database niet. Let op de streepjes: die mag je ' +
             'weglaten, maar een letter O is een nul en een I is een 1 niet.',
    }, 422)
  }
  if (paar.used_at) {
    return json({
      ok: false,
      reden: 'Deze code is al gebruikt. Een code werkt één keer -- laat het ' +
             'kantoor een nieuwe aanmaken.',
    }, 409)
  }
  if (Number(paar.expires_at) < nu()) {
    return json({
      ok: false,
      reden: 'Deze code is verlopen. Laat het kantoor een nieuwe aanmaken.',
    }, 410)
  }
  if (!paar.register_id) {
    return json({
      ok: false,
      reden: 'Bij deze code hoort geen kassa. Dat hoort het kantoor erbij te ' +
             'zetten voordat de code wordt uitgedeeld.',
    }, 409)
  }

  /* ---- welke kassa, en welke vestiging ---- */

  const { data: kassa } = await admin
    .from('pos_registers')
    .select('id, code, name, location_id, active, printer, terminal, last_seq')
    .eq('id', paar.register_id)
    .maybeSingle()

  if (!kassa) {
    return json({ ok: false, reden: 'De kassa die bij deze code hoort bestaat niet meer.' }, 409)
  }
  if (!kassa.active) {
    return json({
      ok: false,
      reden: `Kassa ${kassa.code} staat uit. Zet hem in het dashboard weer aan ` +
             'en maak dan een nieuwe code.',
    }, 409)
  }

  const locatieId = kassa.location_id ?? paar.location_id
  const { data: locatie } = await admin
    .from('locations')
    .select('id, name, code')
    .eq('id', locatieId)
    .maybeSingle()

  /* ---- staat er al een apparaat op deze kassa? ---- */

  const sleutel = String(body.apparaat?.sleutel ?? '').slice(0, 120)

  const { data: bestaande } = await admin
    .from('pos_devices')
    .select('id, device_key, status, auth_user_id, profile_id')
    .eq('register_id', kassa.id)
    .in('status', ['actief', 'geblokkeerd'])
    .maybeSingle()

  /*
   * Hetzelfde apparaat opnieuw koppelen mag: dan is de app opnieuw
   * geïnstalleerd of is de opslag leeggegooid, en dat is precies wanneer
   * iemand een nieuwe code vraagt. Een ánder apparaat op een kassa waar er al
   * een staat is wél een fout, want twee apparaten op één kassa geven
   * dezelfde bonnummers.
   */
  if (bestaande && sleutel && bestaande.device_key && bestaande.device_key !== sleutel) {
    return json({
      ok: false,
      reden: `Op kassa ${kassa.code} staat al een ander apparaat. Trek dat eerst ` +
             'in het dashboard in; dan stuurt het eerst zijn wachtrij leeg.',
    }, 409)
  }

  /* ---- het inlogaccount van dit apparaat ---- */

  const email = `kassa.${kassa.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@${APPARAAT_DOMEIN}`
  const geheim = wachtwoord()

  let authId = bestaande?.auth_user_id ?? null

  if (authId) {
    const { error } = await admin.auth.admin.updateUserById(authId, { password: geheim })
    if (error) {
      // Het account is buiten ons om weggehaald; dan maken we een nieuw.
      authId = null
    }
  }

  if (!authId) {
    const { data: gemaakt, error } = await admin.auth.admin.createUser({
      email,
      password: geheim,
      email_confirm: true,
      user_metadata: { kassa: kassa.code, apparaat: true },
    })

    if (error || !gemaakt.user) {
      /*
       * Bestaat het account al maar kende pos_devices het niet? Dat kan als
       * een apparaat eerder is ingetrokken en de regel is opgeruimd. Dan
       * zoeken we het op en zetten er een nieuw wachtwoord op.
       */
      const { data: lijst } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      const gevonden = lijst?.users?.find((u) => u.email === email)
      if (!gevonden) {
        return json({
          ok: false,
          reden: 'Het inlogaccount voor deze kassa kon niet worden aangemaakt: ' +
                 (error?.message ?? 'onbekende fout'),
        }, 500)
      }
      await admin.auth.admin.updateUserById(gevonden.id, { password: geheim })
      authId = gevonden.id
    } else {
      authId = gemaakt.user.id
    }
  }

  /* ---- het dossier dat aan dat account hangt ----
   *
   * Nodig, want daar hangt de vestiging aan, en daarmee wat dit apparaat mag
   * zien. is_device houdt hem uit het personeel: geen rooster, geen uren, en
   * niet in de lijst waaruit je aan de kassa iemand kiest.
   *
   * Welk dossier dat is, zoeken we op via het inlogaccount en niet via
   * pos_devices. Dat is het verschil tussen werken en niet werken:
   *
   * Deze functie doet vier dingen achter elkaar -- account, dossier, apparaat,
   * code afstrepen -- en er kan er één misgaan. Struikelt hij bij het derde,
   * dan bestaan het account en het dossier al. Keek de volgende poging dan
   * alleen in pos_devices (leeg, want dat derde stuk was juist wat misging),
   * dan verzon hij een nieuw dossier-id en hing dat aan hetzelfde
   * inlogaccount -- en daar staat een unieke index op. Wat je dan te zien
   * krijgt is "duplicate key value violates unique constraint
   * profiles_auth_id_key", en dat is een melding waar niemand iets aan heeft.
   *
   * Nu kan elke poging opnieuw: hij vindt wat er al is en werkt dat bij.
   */

  const { data: bestaandProfiel } = await admin
    .from('profiles')
    .select('id, is_device')
    .eq('auth_id', authId)
    .maybeSingle()

  /*
   * Eén rem. Hoort dit inlogaccount bij een mens, dan houden we op: dan zouden
   * we het dossier van een collega omzetten in een kassa. Dat kan alleen als
   * iemand een medewerker heeft aangemaakt op het adres dat wij voor apparaten
   * gebruiken, maar juist dat soort ding gaat een keer gebeuren.
   */
  if (bestaandProfiel && bestaandProfiel.is_device === false) {
    return json({
      ok: false,
      reden: `Het inlogaccount ${email} hoort bij een medewerker en niet bij een ` +
             'apparaat. Laat dat dossier in het dashboard nakijken; deze kassa ' +
             'kan er niet op gekoppeld worden.',
    }, 409)
  }

  const profielId = bestaandProfiel?.id ?? bestaande?.profile_id ?? id('dev')

  const { error: profielFout } = await admin.from('profiles').upsert({
    id: profielId,
    auth_id: authId,
    email,
    name: `Kassa ${kassa.code}`,
    roles: ['employee'],
    location_id: locatieId,
    active: true,
    is_device: true,
  }, { onConflict: 'id' })

  if (profielFout) {
    return json({ ok: false, reden: legUit('dossier', profielFout.message) }, 500)
  }

  /* ---- het apparaat in de lijst ---- */

  const apparaatId = bestaande?.id ?? id('app')

  const { error: apparaatFout } = await admin.from('pos_devices').upsert({
    id: apparaatId,
    register_id: kassa.id,
    location_id: locatieId,
    device_key: sleutel,
    name: String(body.apparaat?.naam ?? '').slice(0, 120) || `Kassa ${kassa.code}`,
    platform: String(body.apparaat?.platform ?? '').slice(0, 60),
    app_version: String(body.apparaat?.versie ?? '').slice(0, 40) || null,
    auth_user_id: authId,
    profile_id: profielId,
    status: 'actief',
    paired_at: nu(),
    last_seen_at: nu(),
    wiped_at: null,
  }, { onConflict: 'id' })

  if (apparaatFout) {
    return json({ ok: false, reden: legUit('apparaat', apparaatFout.message) }, 500)
  }

  /* ---- de code is op ---- */

  await admin.from('pos_pairings')
    .update({ used_at: nu(), used_by_device: apparaatId })
    .eq('id', paar.id)

  return json({
    ok: true,
    apparaatId,
    email,
    wachtwoord: geheim,
    kassa: {
      id: kassa.id,
      code: kassa.code,
      name: kassa.name,
      locationId: locatieId,
      printer: kassa.printer ?? {},
      terminal: kassa.terminal ?? {},
      lastSeq: Number(kassa.last_seq ?? 0),
      active: true,
    },
    vestiging: locatie ? { id: locatie.id, code: locatie.code, name: locatie.name } : null,
  })
}

/* ================================================================== */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST.' }, 405)

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, reden: 'De serverfunctie is niet volledig ingesteld.' }, 500)
  }

  try {
    return await koppel(req)
  } catch (e) {
    return json({
      ok: false,
      reden: 'Koppelen mislukte: ' + (e instanceof Error ? e.message : String(e)),
    }, 500)
  }
})

/* ------------------------------------------------------------------ *
 *  Het alfabet staat hier ook, zodat het dashboard het kan overnemen.
 *  Een code die hier gemaakt wordt en een code die daar gemaakt wordt horen
 *  uit dezelfde tekens te bestaan -- anders bestaat er een code die deze
 *  functie niet herkent.
 * ------------------------------------------------------------------ */

export { ALFABET, schoon }
