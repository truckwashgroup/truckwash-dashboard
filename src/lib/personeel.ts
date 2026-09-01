import { db } from './db'
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
  reden?: string
  mailVerstuurd?: boolean
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
      return { ok: false, reden: detail ?? String(error.message ?? error) }
    }
    return data ?? { ok: false, reden: 'Geen antwoord van de server.' }
  } catch (e) {
    return { ok: false, reden: e instanceof Error ? e.message : String(e) }
  }
}

async function leesFout(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!context || typeof context !== 'object') return null
  try {
    const response = context as Response
    if (typeof response.json !== 'function') return null
    const body = await response.json()
    return body?.reden ?? body?.error ?? null
  } catch {
    return null
  }
}

export const personeel = {
  /** Account aanmaken en de inloggegevens mailen. */
  uitnodigen: (userId: string) => roep({ actie: 'uitnodigen', userId }),

  /**
   * Uitschrijven.
   *
   * Inlog en dossier gaan dicht en de persoon is nergens meer te kiezen,
   * maar zijn uren, wasbeurten en getekende contracten blijven staan. Dat
   * moet ook: loonadministratie en contracten bewaar je zeven jaar.
   */
  uitschrijven: (userId: string, reden: string) =>
    roep({ actie: 'uitschrijven', userId, reden }),

  terugzetten: (userId: string) => roep({ actie: 'terugzetten', userId }),

  /**
   * Wissen.
   *
   * Werkelijk alles weg, onomkeerbaar. Voor een AVG-verzoek, en pas als de
   * bewaarplicht voorbij is. De reden blijft staan nadat de persoon weg is
   * -- anders kan later niemand meer nagaan dat het is gebeurd.
   */
  wissen: (userId: string, reden: string) => roep({ actie: 'wissen', userId, reden }),
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

/** Iedereen die niet is uitgeschreven. */
export function inDienst(alle: User[]): User[] {
  return alle.filter((u) => !u.archivedAt)
}

/** Snel opzoeken of dit adres al ergens in de app bekend is. */
export async function adresAlBekend(email: string): Promise<User | undefined> {
  const schoon = email.trim().toLowerCase()
  if (!schoon) return undefined
  return (await db.users.toArray()).find((u) => u.email.toLowerCase() === schoon)
}
