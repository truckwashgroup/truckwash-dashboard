import { db, alleMensen } from './db'
import { users } from './repo'
import { useSync } from './sync'
import { logLive } from './trail'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type { User } from './types'

/* ------------------------------------------------------------------ *
 *  Uitnodigen, uitschrijven en wissen
 *
 *  Alle drie via de serverfunctie, want alle drie hebben de servicesleutel
 *  nodig. Een inlogaccount aanmaken of weghalen kan niet vanuit een app die
 *  op telefoons staat, en dat hoort ook niet.
 *
 *  Waarom uitnodigen bestaat: zonder uitnodiging moest iemand zich zelf
 *  aanmelden. Dat doet hij dan met zijn privé-adres, en dan staan er twee
 *  dossiers van dezelfde man -- de koppeling kijkt op e-mailadres en ziet
 *  twee verschillende mensen.
 * ------------------------------------------------------------------ */

export interface Uitkomst {
  ok: boolean
  soort?: 'nieuw account' | 'gekoppeld' | 'uitgeschreven' | 'teruggezet' | 'gewist'
         | 'alleen hier gewist'
  reden?: string
  mailVerstuurd?: boolean
  /** De code van de server, als die er was. 404 = dit dossier staat er niet. */
  status?: number
}

async function roep(body: Record<string, unknown>): Promise<Uitkomst> {
  if (!supabaseConfigured) {
    return { ok: false, reden: 'Er is nog geen database ingesteld.' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reden: 'Dit lukt alleen met verbinding.' }
  }
  try {
    const { data, error } = await supabase().functions.invoke<Uitkomst>('medewerker', { body })
    if (error) {
      const detail = await leesFout(error)
      return {
        ok: false,
        reden: detail?.reden ?? String(error.message ?? error),
        status: detail?.status,
      }
    }
    return data ?? { ok: false, reden: 'Geen antwoord van de server.' }
  } catch (e) {
    return { ok: false, reden: e instanceof Error ? e.message : String(e) }
  }
}

async function leesFout(
  error: unknown,
): Promise<{ reden: string | null; status?: number } | null> {
  const context = (error as { context?: unknown })?.context
  if (!context || typeof context !== 'object') return null
  try {
    const response = context as Response
    const status = typeof response.status === 'number' ? response.status : undefined
    if (typeof response.json !== 'function') return { reden: null, status }
    const body = await response.json()
    return { reden: body?.reden ?? body?.error ?? null, status }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 *  Iemand die alleen op dit apparaat staat
 *
 *  Er is een tijd geweest dat een nieuw dossier de server niet haalde. De
 *  app stuurde een veld mee dat daar niet bestond, de server weigerde de
 *  hele rij, en na acht pogingen werd hij uit de wachtrij gegooid. Wat je
 *  overhoudt is iemand die in jouw lijst staat en verder nergens.
 *
 *  Die kon je niet meer weg krijgen. Wissen gaat via de server, en die zei
 *  "dossier niet gevonden" -- volkomen terecht, en volkomen onbruikbaar.
 *
 *  Dus: staat hij daar niet, dan is hier weghalen precies wat er moet
 *  gebeuren. Er is niets om mee te synchroniseren.
 * ------------------------------------------------------------------ */

async function alleenHierWeg(userId: string) {
  await db.users.delete(userId)
  await db.personnelPrivate.delete(userId)

  // Ook uit de wachtrij, anders probeert hij het straks alsnog.
  const wachtend = await db.outbox.where('recordId').equals(userId).primaryKeys()
  if (wachtend.length) await db.outbox.bulkDelete(wachtend)
}

/**
 * Zorgt dat de server dit dossier kent voordat we er iets mee vragen.
 *
 * Aanleiding: iemand maakte een medewerker aan, kreeg "staat erin", drukte op
 * uitnodigen en las "dossier niet gevonden". De mail ging nooit uit. Het
 * dossier stond wél in de lijst op dat apparaat, maar niet op de server -- de
 * wijziging was op weg daarheen blijven steken en toen weggegooid.
 *
 * De uitnodiging gaat via de server, dus zonder dossier daar valt er niets uit
 * te nodigen. Dat is terecht. Maar doodlopen is het niet: het dossier staat
 * hier, dus we kunnen hem alsnog aanbieden en het opnieuw proberen.
 *
 * Geeft terug of de server hem nu kent.
 */
export async function zorgDatHijErStaat(userId: string): Promise<boolean> {
  /*
   * Elke stap wordt opgeschreven, en dat is niet overdreven.
   *
   * Dit liep drie keer achter elkaar stuk zonder één spoor: de wachtrij was
   * leeg, het logboek schoon, en op de server stond niets. Vijf oorzaken zijn
   * daarop uitgesloten -- de rechtenregel, twee triggers, een botsend
   * personeelsnummer en Resend -- zonder de echte te vinden. Zoeken zonder
   * meting is gokken.
   *
   * Dus meldt elke stap zichzelf. Faalt het opnieuw, dan staat er in
   * Ontwikkeling > Meekijken precies wáár het misgaat in plaats van alleen dat
   * het misging.
   */
  const persoon = await db.users.get(userId)
  if (!persoon) {
    logLive('netwerk', `Uitnodigen: ${userId} staat niet eens in de lokale lijst`)
    return false
  }
  if (!supabaseConfigured) {
    logLive('netwerk', 'Uitnodigen: er is geen database ingesteld')
    return false
  }

  const voor = await db.outbox.where('recordId').equals(userId).count()

  // Opnieuw aanbieden. put() zet hem in de wachtrij; stond hij daar al, dan
  // wordt die regel bijgewerkt in plaats van verdubbeld.
  await users.update(userId, {})

  const na = await db.outbox.where('recordId').equals(userId).count()
  logLive('netwerk',
    `Uitnodigen: ${persoon.name} opnieuw aangeboden`,
    { detail: `wachtrij voor ${voor}, na ${na}` })
  if (na === 0) {
    logLive('netwerk', 'Uitnodigen: hij komt niet in de wachtrij terecht')
    return false
  }

  try {
    await useSync.getState().sync({ silent: true })
  } catch (e) {
    logLive('netwerk', 'Uitnodigen: de ronde liep stuk',
      { detail: e instanceof Error ? e.message : String(e) })
  }

  const rest = await db.outbox.where('recordId').equals(userId).toArray()
  logLive('netwerk',
    `Uitnodigen: na de ronde staan er nog ${rest.length} wijziging(en)`,
    { detail: rest.map((r) => `${r.entity} ${r.tries}x ${r.lastError ?? '—'}`).join(' | ') })

  const { data, error } = await supabase()
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  logLive('netwerk',
    `Uitnodigen: de server ${data ? 'kent hem nu' : 'kent hem niet'}`,
    { detail: error ? `${error.code ?? ''} ${error.message}`.trim() : 'geen fout' })

  return !error && !!data
}

export const personeel = {
  /**
   * Account aanmaken en de inloggegevens mailen.
   *
   * Kent de server het dossier niet, dan bieden we het eerst alsnog aan en
   * proberen we het daarna nog één keer. Twee keer dezelfde foutmelding
   * teruggeven terwijl het probleem op te lossen is, is geen antwoord.
   */
  async uitnodigen(userId: string): Promise<Uitkomst> {
    const uit = await roep({ actie: 'uitnodigen', userId })
    if (uit.ok || uit.status !== 404) return uit

    const staatEr = await zorgDatHijErStaat(userId)
    if (!staatEr) {
      const persoon = await db.users.get(userId)
      return {
        ok: false,
        status: 404,
        reden:
          `${persoon?.name ?? 'Dit dossier'} staat alleen op dit apparaat; de ` +
          'server kent hem niet. Het versturen is blijven steken. Kijk bij ' +
          'Ontwikkeling > Meekijken wat de wachtrij zegt -- daar staat de reden.',
      }
    }

    return roep({ actie: 'uitnodigen', userId })
  },

  /**
   * Uitschrijven.
   *
   * Inlog en dossier gaan dicht en de persoon is nergens meer te kiezen,
   * maar zijn uren, wasbeurten en getekende contracten blijven staan. Dat
   * moet ook: loonadministratie en contracten bewaar je zeven jaar.
   */
  async uitschrijven(userId: string, reden: string): Promise<Uitkomst> {
    const uit = await roep({ actie: 'uitschrijven', userId, reden })
    if (uit.ok || uit.status !== 404) return uit

    /*
     * Uitschrijven bewaart wat er is. Staat er niets, dan valt er ook niets
     * te bewaren -- en dan is uitschrijven het verkeerde gereedschap. Dat
     * zeggen we, in plaats van hier stilletjes iets anders te doen.
     */
    const persoon = await db.users.get(userId)
    return {
      ok: false,
      status: 404,
      reden: `${persoon?.name ?? 'Dit dossier'} staat niet op de server; hij is ` +
             'daar nooit aangekomen. Er valt dus niets uit te schrijven. ' +
             'Gebruik "wissen" om hem van dit apparaat te halen.',
    }
  },

  terugzetten: (userId: string) => roep({ actie: 'terugzetten', userId }),

  /**
   * Wissen.
   *
   * Werkelijk alles weg, onomkeerbaar. Voor een AVG-verzoek, en pas als de
   * bewaarplicht voorbij is. De reden blijft staan nadat de persoon weg is
   * -- anders kan later niemand meer nagaan dat het is gebeurd.
   */
  async wissen(userId: string, reden: string): Promise<Uitkomst> {
    const uit = await roep({ actie: 'wissen', userId, reden })

    /*
     * Gelukt: dan ook meteen hier weg.
     *
     * Wachten op de volgende ronde kan niet. Het ophalen vraagt om alles wat
     * is veranderd, en een rij die er niet meer is verandert nooit meer -- die
     * komt dus nooit mee. Zonder deze regel bleef de gewiste persoon in de
     * lijst staan en kon je hem niet opnieuw aanmaken, want de dubbelcontrole
     * zag hem daar nog.
     *
     * De andere apparaten horen het via de verwijderlijst bij het ophalen.
     */
    if (uit.ok) {
      await alleenHierWeg(userId)
      return uit
    }

    if (uit.status !== 404) return uit

    /*
     * De server kent dit dossier niet. Dat is geen fout maar een antwoord:
     * hij is daar nooit aangekomen. Weghalen wat hier staat is dan precies
     * wat er gevraagd werd, en het enige dat er nog te doen valt.
     */
    const persoon = await db.users.get(userId)
    await alleenHierWeg(userId)
    return {
      ok: true,
      soort: 'alleen hier gewist',
      reden: `${persoon?.name ?? 'Dit dossier'} stond alleen op dit apparaat en is ` +
             'nooit op de server aangekomen. Nu is hij ook hier weg.',
    }
  },
}

/* ------------------------------------------------------------------ *
 *  Dubbele mensen opsporen
 *
 *  Het vangnet naast het uitnodigen. Twee dossiers van dezelfde man
 *  ontstaan doordat het kantoor er een aanmaakt op zijn werkadres en hij
 *  zich daarna zelf aanmeldt met zijn privé-adres. Op e-mailadres zijn dat
 *  twee mensen; op naam en telefoonnummer valt het wél op.
 * ------------------------------------------------------------------ */

export interface Verdenking {
  user: User
  waarom: string
  /** Hoe zeker: op adres is zeker, op naam is een vermoeden. */
  hard: boolean
}

/** Namen vergelijken zonder te struikelen over hoofdletters en tussenvoegsels. */
export function normaliseerNaam(naam: string): string {
  return naam
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(van|de|der|den|het|ten|ter|te|op|aan|in)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

/** Telefoonnummers vergelijken zonder streepjes, spaties en landcode. */
export function normaliseerTelefoon(nummer?: string): string {
  if (!nummer) return ''
  const cijfers = nummer.replace(/\D+/g, '')
  return cijfers.replace(/^0031/, '0').replace(/^31(?=6|[1-9])/, '0')
}

/**
 * Staat deze persoon er misschien al?
 *
 * Geeft alles terug wat erop lijkt, met erbij waaróm. Dat laatste is het
 * belangrijkste: "zelfde naam" is iets anders dan "zelfde mailadres", en
 * wie de knop indrukt hoort dat verschil te zien.
 */
export function mogelijkDubbel(
  bestaand: User[],
  kandidaat: { naam: string; email?: string; telefoon?: string },
  negeerId?: string,
): Verdenking[] {
  const naam = normaliseerNaam(kandidaat.naam)
  const email = (kandidaat.email ?? '').trim().toLowerCase()
  const tel = normaliseerTelefoon(kandidaat.telefoon)

  const uit: Verdenking[] = []

  for (const u of bestaand) {
    if (u.id === negeerId) continue

    if (email && u.email.toLowerCase() === email) {
      uit.push({ user: u, waarom: 'zelfde e-mailadres', hard: true })
      continue
    }
    if (naam && normaliseerNaam(u.name) === naam) {
      uit.push({
        user: u,
        waarom: tel && normaliseerTelefoon(u.phone) === tel
          ? 'zelfde naam én telefoonnummer'
          : 'zelfde naam',
        hard: !!(tel && normaliseerTelefoon(u.phone) === tel),
      })
      continue
    }
    if (tel && normaliseerTelefoon(u.phone) === tel) {
      uit.push({ user: u, waarom: 'zelfde telefoonnummer', hard: false })
    }
  }

  // Het zekerste bovenaan; daar wil je als eerste naar kijken.
  return uit.sort((a, b) => Number(b.hard) - Number(a.hard))
}

/**
 * Bestaan deze mensen nog wel echt?
 *
 * De dubbelcontrole kijkt in de lokale kopie, en daar kan iemand in staan die
 * op de server allang weg is. Dat gebeurde: een gewiste medewerker bleef in
 * beeld, en de controle blokkeerde daarmee het opnieuw aanmaken van precies
 * die persoon. De melding klopte niet en er was geen weg omheen.
 *
 * Dus vragen we het na voordat we iemand tegenhouden. Eén vraag voor de hele
 * lijst, en wie er niet meer is wordt meteen lokaal opgeruimd -- dan is het
 * de laatste keer dat hij in de weg zit.
 *
 * Zonder verbinding gebeurt er niets. Dan wéten we het niet, en dan is een
 * onterechte waarschuwing beter dan stilletjes een dossier weggooien.
 */
export async function zonderSpoken(verdacht: Verdenking[]): Promise<Verdenking[]> {
  if (!verdacht.length) return verdacht
  if (!supabaseConfigured) return verdacht
  if (typeof navigator !== 'undefined' && !navigator.onLine) return verdacht

  const ids = verdacht.map((v) => v.user.id)

  try {
    const { data, error } = await supabase()
      .from('profiles')
      .select('id')
      .in('id', ids)

    // Geen duidelijk antwoord? Dan blijft alles staan zoals het was.
    if (error || !data) return verdacht

    const bestaat = new Set(data.map((r) => String(r.id)))
    const spoken = ids.filter((id) => !bestaat.has(id))

    for (const id of spoken) {
      await db.users.delete(id)
      await db.personnelPrivate.delete(id)
      const wachtend = await db.outbox.where('recordId').equals(id).primaryKeys()
      if (wachtend.length) await db.outbox.bulkDelete(wachtend)
    }

    return verdacht.filter((v) => bestaat.has(v.user.id))
  } catch {
    return verdacht
  }
}

/** Iedereen die niet is uitgeschreven. */
export function inDienst(alle: User[]): User[] {
  return alle.filter((u) => !u.archivedAt)
}

/** Snel opzoeken of dit adres al ergens in de app bekend is. */
export async function adresAlBekend(email: string): Promise<User | undefined> {
  const schoon = email.trim().toLowerCase()
  if (!schoon) return undefined
  return (await alleMensen()).find((u) => u.email.toLowerCase() === schoon)
}
