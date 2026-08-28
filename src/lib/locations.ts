import { create } from 'zustand'
import type { Location, User } from './types'
import { effectivePermissions } from './permissions'

/* ------------------------------------------------------------------ *
 *  Wie mag waar bij?
 *
 *  De organisatie heeft vestigingen en een hoofdkantoor. Rechten zeggen
 *  *wat* iemand mag; locaties zeggen *waar*. Een leidinggevende met het recht
 *  om roosters te maken, maakt ze alleen voor de vestigingen die aan hem
 *  hangen -- niet voor de andere achttien.
 *
 *  Drie niveaus:
 *    hoofdkantoor  -> allLocations, of het recht locations.all: overal bij
 *    leidinggevende -> zijn eigen vestiging plus wat in `manages` staat
 *    werknemer      -> alleen de eigen vestiging
 * ------------------------------------------------------------------ */

export function seesAllLocations(user: User | null): boolean {
  if (!user) return false
  if (user.allLocations) return true
  return effectivePermissions(user).has('locations.all')
}

/** De locaties waar deze persoon iets mag zien of doen. */
export function scopeOf(user: User | null): Set<string> | 'alle' {
  if (!user) return new Set()
  if (seesAllLocations(user)) return 'alle'

  const set = new Set<string>()
  if (user.locationId) set.add(user.locationId)
  for (const id of user.manages ?? []) set.add(id)
  return set
}

export function mayAccessLocation(user: User | null, locationId?: string): boolean {
  if (!locationId) return true // niet aan een locatie gebonden
  const scope = scopeOf(user)
  return scope === 'alle' || scope.has(locationId)
}

/** Filtert een lijst records op de locaties waar iemand bij mag. */
export function withinScope<T extends { locationId?: string }>(
  user: User | null,
  rows: T[],
): T[] {
  const scope = scopeOf(user)
  if (scope === 'alle') return rows
  return rows.filter((r) => !r.locationId || scope.has(r.locationId))
}

/** De locaties zelf, gefilterd op wat iemand mag zien. */
export function visibleLocations(user: User | null, locations: Location[]): Location[] {
  const scope = scopeOf(user)
  const list = scope === 'alle' ? locations : locations.filter((l) => scope.has(l.id))
  return [...list].sort((a, b) => {
    // hoofdkantoor bovenaan, daarna op naam
    if (a.kind !== b.kind) return a.kind === 'hoofdkantoor' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/* ------------------------------------------------------------------ *
 *  Welke locatie kijk je nu?
 *
 *  Wie meerdere vestigingen ziet, kiest er bovenin één uit of kijkt naar
 *  alles tegelijk. Die keuze geldt door de hele app.
 * ------------------------------------------------------------------ */

interface LocationStore {
  /** null betekent: alle locaties waar ik bij mag */
  current: string | null
  setCurrent: (id: string | null) => void
}

const STORAGE_KEY = 'tw.location'

function initial(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw && raw !== 'null' ? raw : null
  } catch {
    return null
  }
}

export const useLocationFilter = create<LocationStore>((set) => ({
  current: initial(),
  setCurrent: (id) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* private mode */ }
    set({ current: id })
  },
}))

/**
 * Filtert records op de gekozen locatie én op wat iemand mag zien.
 * Staat de keuze op "alles", dan blijft de scope van de gebruiker gelden.
 */
export function filterByLocation<T extends { locationId?: string }>(
  user: User | null,
  rows: T[],
  current: string | null,
): T[] {
  const allowed = withinScope(user, rows)
  if (!current) return allowed
  return allowed.filter((r) => !r.locationId || r.locationId === current)
}

/** Korte omschrijving van waar je nu naar kijkt. */
export function scopeLabel(
  user: User | null,
  locations: Location[],
  current: string | null,
): string {
  if (current) {
    const loc = locations.find((l) => l.id === current)
    return loc ? loc.name : 'Onbekende vestiging'
  }
  const visible = visibleLocations(user, locations)
  if (seesAllLocations(user)) return `Alle vestigingen (${visible.length})`
  if (visible.length === 1) return visible[0].name
  return `${visible.length} vestigingen`
}
