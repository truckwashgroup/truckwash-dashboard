import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications, timeEntries } from './repo'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type {
  HourRequest, HourRequestSoort, Location, TimeEntry, Trip, TripDoel, User,
} from './types'

/* ------------------------------------------------------------------ *
 *  Uren rechtzetten en kilometers verantwoorden
 *
 *  Klokken gaat via de kassa, en dat blijft zo. Maar wie vergeet in te
 *  klokken staat met lege handen: hij was er wel, het staat er niet, en hij
 *  kan er zelf niets aan doen. Vandaar een verzoek -- hij zegt wat er had
 *  moeten staan, zijn leidinggevende kijkt ernaar.
 *
 *  Bij de kilometers is het andersom. Daar mag hij juist niets invullen: de
 *  afstand komt van de routedienst, over de weg, van adres naar adres. Een
 *  vergoeding waarbij iedereen zijn eigen getal intypt is geen vergoeding
 *  maar een vertrouwenskwestie.
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<unknown> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

/** De leidinggevenden die over deze persoon gaan. */
async function leidinggevendenVan(user: Pick<User, 'id' | 'locationId' | 'supervisorId'>) {
  const iedereen = await db.users.toArray()
  const direct = user.supervisorId
    ? iedereen.filter((u) => u.id === user.supervisorId)
    : []
  if (direct.length) return direct

  return iedereen.filter((u) =>
    u.active &&
    (u.roles.includes('supervisor') || u.roles.includes('management')) &&
    (u.allLocations ||
      (!!user.locationId && (u.manages ?? []).includes(user.locationId)) ||
      u.locationId === user.locationId))
}

/* ================================================================== *
 *  Urenverzoeken
 * ================================================================== */

export const urenverzoeken = {
  async indienen(input: {
    door: Pick<User, 'id' | 'name' | 'locationId' | 'supervisorId'>
    soort: HourRequestSoort
    van: number
    tot?: number
    entryId?: string
    toelichting: string
  }) {
    const verzoek: HourRequest = {
      id: uid('hr'),
      userId: input.door.id,
      userName: input.door.name,
      entryId: input.entryId,
      locationId: input.door.locationId,
      soort: input.soort,
      van: input.van,
      tot: input.tot,
      toelichting: input.toelichting.trim().slice(0, 800),
      status: 'nieuw',
      aangevraagdOp: Date.now(),
      updatedAt: Date.now(),
    }
    await put('hourRequests', db.hourRequests, verzoek)

    for (const baas of await leidinggevendenVan(input.door)) {
      await notifications.send({
        to: { id: baas.id, name: baas.name },
        from: { id: input.door.id, name: input.door.name },
        kind: 'taak',
        title: `Urenverzoek van ${input.door.name}`,
        body: `${SOORT_LABEL[input.soort]} — ${input.toelichting.slice(0, 120)}`,
        link: 'uren',
      })
    }
    return verzoek
  },

  /** De aanvrager bedenkt zich. Het enige wat hij zelf aan zijn verzoek mag doen. */
  async intrekken(verzoek: HourRequest) {
    return put('hourRequests', db.hourRequests, { ...verzoek, status: 'ingetrokken' })
  },

  /**
   * Goedkeuren.
   *
   * Dit zet de uren ook werkelijk recht: bestaat de regel al, dan wordt hij
   * bijgewerkt; anders komt er een nieuwe. Een goedgekeurd verzoek dat de
   * urenstaat niet raakt is een goedkeuring die niets betekent.
   */
  async goedkeuren(verzoek: HourRequest, door: Pick<User, 'id' | 'name'>, reden?: string) {
    if (verzoek.entryId) {
      const bestaand = await db.timeEntries.get(verzoek.entryId)
      if (bestaand) {
        await put('timeEntries', db.timeEntries, {
          ...bestaand,
          start: verzoek.van,
          end: verzoek.tot ?? bestaand.end,
          note: [bestaand.note, 'rechtgezet na verzoek'].filter(Boolean).join(' · '),
        })
      }
    } else {
      const nieuw: TimeEntry = {
        id: uid('te'),
        userId: verzoek.userId,
        userName: verzoek.userName,
        locationId: verzoek.locationId,
        start: verzoek.van,
        end: verzoek.tot,
        note: 'toegevoegd na verzoek',
        updatedAt: Date.now(),
      }
      await put('timeEntries', db.timeEntries, nieuw)
    }

    const bij = await put('hourRequests', db.hourRequests, {
      ...verzoek,
      status: 'goedgekeurd',
      beslistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
      beslissingReden: reden?.trim() || undefined,
    })

    await notifications.send({
      to: { id: verzoek.userId, name: verzoek.userName },
      from: door,
      kind: 'info',
      title: 'Je uren zijn rechtgezet',
      body: reden?.trim() || 'Je verzoek is goedgekeurd en de uren staan aangepast.',
      link: 'uren',
      mail: true,
    })
    return bij
  },

  async afwijzen(verzoek: HourRequest, reden: string, door: Pick<User, 'id' | 'name'>) {
    const bij = await put('hourRequests', db.hourRequests, {
      ...verzoek,
      status: 'afgewezen',
      beslistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
      beslissingReden: reden.trim().slice(0, 400) || undefined,
    })

    await notifications.send({
      to: { id: verzoek.userId, name: verzoek.userName },
      from: door,
      kind: 'waarschuwing',
      title: 'Je urenverzoek is afgewezen',
      body: reden.trim() || 'Er is geen reden opgegeven.',
      link: 'uren',
      mail: true,
    })
    return bij
  },
}

export const SOORT_LABEL: Record<HourRequestSoort, string> = {
  'vergeten': 'Vergeten in te klokken',
  'verkeerde tijd': 'Verkeerde tijd geregistreerd',
  'te vroeg uitgeklokt': 'Te vroeg uitgeklokt',
  'anders': 'Anders',
}

/* ================================================================== *
 *  Ritten
 * ================================================================== */

export interface RouteUitkomst {
  ok: boolean
  km?: number
  minuten?: number
  van?: string
  naar?: string
  uitGeheugen?: boolean
  reden?: string
}

/**
 * Hoe ver is het van hier naar daar.
 *
 * Over de weg, opgezocht door de server. De app rekent hier niets zelf uit
 * en mag dat ook niet: dan zou het een voorstel zijn in plaats van een
 * afstand.
 */
export async function zoekAfstand(van: string, naar: string): Promise<RouteUitkomst> {
  if (!supabaseConfigured) return { ok: false, reden: 'Er is nog geen database ingesteld.' }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reden: 'Een route opzoeken lukt alleen met verbinding.' }
  }
  try {
    const { data, error } = await supabase().functions.invoke<RouteUitkomst>('route', {
      body: { van, naar },
    })
    if (error) {
      const detail = await leesFout(error)
      return { ok: false, reden: detail ?? String(error.message ?? error) }
    }
    return data ?? { ok: false, reden: 'Geen antwoord van de routedienst.' }
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

export const ritten = {
  /**
   * Een rit vastleggen.
   *
   * De afstand komt mee uit `zoekAfstand`; hier wordt niets uitgerekend. De
   * database weigert een rit met kilometers die niet van de routedienst
   * komen -- dat staat daar en niet alleen hier, want een scherm is een
   * afspraak en dat is een regel.
   */
  async toevoegen(input: {
    door: Pick<User, 'id' | 'name'>
    op: number
    vanLabel: string
    naarLabel: string
    vanAdres: string
    naarAdres: string
    km: number
    retour: boolean
    doel: TripDoel
    toelichting?: string
  }) {
    const rit: Trip = {
      id: uid('rit'),
      userId: input.door.id,
      userName: input.door.name,
      op: input.op,
      vanLabel: input.vanLabel,
      naarLabel: input.naarLabel,
      vanAdres: input.vanAdres,
      naarAdres: input.naarAdres,
      km: input.km,
      retour: input.retour,
      doel: input.doel,
      toelichting: input.toelichting?.trim() || undefined,
      bron: 'route',
      status: 'nieuw',
      updatedAt: Date.now(),
    }
    return put('trips', db.trips, rit)
  },

  async verwijderen(id: string) {
    await db.trips.delete(id)
    await enqueue('trips', 'delete', id, null)
  },

  async beoordelen(
    rit: Trip,
    status: 'goedgekeurd' | 'afgewezen',
    door: Pick<User, 'id' | 'name'>,
  ) {
    return put('trips', db.trips, {
      ...rit,
      status,
      beslistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
    })
  },
}

/* ------------------------------------------------------------------ *
 *  Wat je ervan ziet
 * ------------------------------------------------------------------ */

/**
 * Het volledige adres van een vestiging, zoals de routedienst het wil.
 *
 * Straat, dan postcode en plaats aan elkaar -- zo staat het op een envelop
 * en zo herkennen de adresdiensten het het beste. Postcode en plaats met een
 * komma ertussen levert vaker een misser op.
 */
export function adresVan(locatie?: Location): string {
  if (!locatie) return ''
  const straat = (locatie.address ?? '').trim()
  const plaats = [locatie.postcode, locatie.city]
    .map((d) => (d ?? '').trim()).filter(Boolean).join(' ')
  return [straat, plaats].filter(Boolean).join(', ')
}

/** Totaal aantal kilometers, met retour meegeteld. */
export function totaalKm(ritten: Trip[]): number {
  const som = ritten.reduce((a, r) => a + r.km * (r.retour ? 2 : 1), 0)
  return Math.round(som * 10) / 10
}

/** De vergoeding bij een tarief per kilometer. */
export function vergoeding(ritten: Trip[], tariefPerKm: number): number {
  return Math.round(totaalKm(ritten) * tariefPerKm * 100) / 100
}

/**
 * Het onbelaste tarief per kilometer.
 *
 * Staat hier als één getal, want het verandert af en toe en dan wil je het
 * op één plek kunnen aanpassen in plaats van in vier schermen.
 */
export const KM_TARIEF = 0.23

export function mijnRitten(alle: Trip[], userId: string, vanaf?: number): Trip[] {
  return alle
    .filter((r) => r.userId === userId && (!vanaf || r.op >= vanaf))
    .sort((a, b) => b.op - a.op)
}

export function openVerzoeken(alle: HourRequest[]): HourRequest[] {
  return alle
    .filter((v) => v.status === 'nieuw')
    .sort((a, b) => a.aangevraagdOp - b.aangevraagdOp)
}
