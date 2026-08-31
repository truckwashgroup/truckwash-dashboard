import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import { dossier } from './dossier'
import { users as userRepo } from './repo'
import {
  VELD_LABELS,
  type DossierWijziging, type Location, type PersonnelPrivate,
  type User, type WijzigbaarVeld, type WijzigingVeld,
} from './types'

/* ------------------------------------------------------------------ *
 *  Wijzigingen in een dossier
 *
 *  Een leidinggevende stelt voor, het management beslist. Wat er precies
 *  verandert staat per veld vast -- oude waarde naast nieuwe -- zodat er
 *  niets goedgekeurd wordt waarvan de inhoud pas later blijkt.
 *
 *  Het doorvoeren zelf gebeurt in de database, met een trigger die aan de
 *  goedkeuring vastzit. Hier in de app doen we het ook, zodat het meteen op
 *  het scherm staat en offline werkt -- maar de database is de baas.
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

/** De huidige waarde van een veld, uit het profiel of uit het dossier. */
export function huidigeWaarde(
  veld: WijzigbaarVeld,
  persoon: User,
  prive?: PersonnelPrivate,
): unknown {
  switch (veld) {
    case 'function': return persoon.function
    case 'contractHours': return persoon.contractHours
    case 'hourlyRate': return prive?.hourlyRate
    case 'locationId': return persoon.locationId
    case 'manages': return persoon.manages ?? []
    case 'supervisorId': return persoon.supervisorId
    case 'startDate': return persoon.startDate
    case 'endDate': return persoon.endDate
    case 'roles': return persoon.roles
  }
}

/** Hoe een waarde eruitziet in het scherm. */
export function toonWaarde(
  veld: WijzigbaarVeld,
  waarde: unknown,
  hulp: { locaties: Location[]; mensen: User[] },
): string {
  if (waarde === undefined || waarde === null || waarde === '') return '—'

  switch (veld) {
    case 'hourlyRate':
      return '€ ' + Number(waarde).toFixed(2).replace('.', ',')
    case 'contractHours':
      return `${waarde} uur per week`
    case 'startDate':
    case 'endDate':
      return new Date(Number(waarde)).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    case 'locationId':
      return hulp.locaties.find((l) => l.id === waarde)?.name ?? String(waarde)
    case 'supervisorId':
      return hulp.mensen.find((u) => u.id === waarde)?.name ?? String(waarde)
    case 'manages': {
      const ids = Array.isArray(waarde) ? waarde : []
      if (ids.length === 0) return 'Nergens'
      return ids.map((id) => hulp.locaties.find((l) => l.id === id)?.name ?? id).join(', ')
    }
    case 'roles':
      return Array.isArray(waarde) ? waarde.join(', ') : String(waarde)
    default:
      return String(waarde)
  }
}

/** Twee waarden gelijk? Ook voor lijsten, ongeacht de volgorde. */
export function gelijk(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const links = [...a].map(String).sort()
    const rechts = [...b].map(String).sort()
    return links.every((v, i) => v === rechts[i])
  }
  if (a === undefined || a === null || a === '') return b === undefined || b === null || b === ''
  return String(a) === String(b)
}

/* ------------------------------------------------------------------ */

export const wijzigingen = {
  /**
   * Een voorstel indienen.
   *
   * Velden die niet werkelijk veranderen vallen eruit. Een verzoek met
   * "functie: Wasmedewerker → Wasmedewerker" erin kost iemand tijd om te
   * lezen en levert niets op.
   */
  async aanvragen(input: {
    persoon: User
    prive?: PersonnelPrivate
    voorstel: Partial<Record<WijzigbaarVeld, unknown>>
    reden: string
    ingaandOp?: number
    door: Pick<User, 'id' | 'name'>
  }) {
    const velden: WijzigingVeld[] = []

    for (const [veld, nieuw] of Object.entries(input.voorstel) as [WijzigbaarVeld, unknown][]) {
      const oud = huidigeWaarde(veld, input.persoon, input.prive)
      if (gelijk(oud, nieuw)) continue
      velden.push({ veld, oud, nieuw })
    }

    if (velden.length === 0) return null

    const verzoek: DossierWijziging = {
      id: uid('cr'),
      userId: input.persoon.id,
      userName: input.persoon.name,
      velden,
      reden: input.reden.trim().slice(0, 600),
      ingaandOp: input.ingaandOp,
      status: 'open',
      aangevraagdDoor: input.door.id,
      aangevraagdDoorNaam: input.door.name,
      aangevraagdOp: Date.now(),
      updatedAt: Date.now(),
    }

    await put('changeRequests', db.changeRequests, verzoek)

    // Het management moet erover beslissen; laat het niet weken liggen.
    const bazen = (await db.users.toArray()).filter(
      (u) => u.active && u.roles.includes('management') && u.id !== input.door.id)

    for (const baas of bazen) {
      await notifications.send({
        to: { id: baas.id, name: baas.name },
        from: input.door,
        kind: 'taak',
        title: `Wijziging voorgesteld voor ${input.persoon.name}`,
        body: `${velden.map((v) => VELD_LABELS[v.veld]).join(', ')} — ${verzoek.reden}`,
        link: 'personeel',
        mail: true,
      })
    }

    return verzoek
  },

  /**
   * Goedkeuren, en meteen doorvoeren.
   *
   * De database doet dit ook, met een trigger die aan de goedkeuring
   * vastzit. Hier gebeurt het zodat het meteen op het scherm staat en het
   * ook zonder verbinding werkt; komt de wijziging straks binnen van de
   * server, dan staat er hetzelfde.
   */
  async goedkeuren(verzoek: DossierWijziging, door: Pick<User, 'id' | 'name'>) {
    if (verzoek.status !== 'open') return verzoek

    const patch: Partial<User> = {}
    let uurloon: number | undefined

    for (const v of verzoek.velden) {
      switch (v.veld) {
        case 'function': patch.function = (v.nieuw as string) || undefined; break
        case 'contractHours': patch.contractHours = v.nieuw as number | undefined; break
        case 'locationId': patch.locationId = (v.nieuw as string) || undefined; break
        case 'supervisorId': patch.supervisorId = (v.nieuw as string) || undefined; break
        case 'startDate': patch.startDate = v.nieuw as number | undefined; break
        case 'endDate': patch.endDate = v.nieuw as number | undefined; break
        case 'manages': patch.manages = (v.nieuw as string[])?.length
          ? (v.nieuw as string[]) : undefined; break
        case 'roles': patch.roles = v.nieuw as User['roles']; break
        case 'hourlyRate': uurloon = v.nieuw as number | undefined; break
      }
    }

    if (Object.keys(patch).length > 0) await userRepo.update(verzoek.userId, patch)
    if (uurloon !== undefined) await dossier.save(verzoek.userId, { hourlyRate: uurloon })

    const bijgewerkt = await put('changeRequests', db.changeRequests, {
      ...verzoek,
      status: 'goedgekeurd',
      besistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
    })

    // De aanvrager hoort het te weten, en de betrokkene ook: het gaat over
    // zijn functie, zijn uren of zijn loon.
    for (const wie of [verzoek.aangevraagdDoor, verzoek.userId]) {
      if (wie === door.id) continue
      const persoon = await db.users.get(wie)
      if (!persoon) continue
      await notifications.send({
        to: { id: persoon.id, name: persoon.name },
        from: door,
        kind: 'info',
        title: wie === verzoek.userId
          ? 'Je gegevens zijn bijgewerkt'
          : `Wijziging voor ${verzoek.userName} goedgekeurd`,
        body: verzoek.velden.map((v) => VELD_LABELS[v.veld]).join(', '),
        link: wie === verzoek.userId ? 'dossier' : 'personeel',
        mail: true,
      })
    }

    return bijgewerkt
  },

  async afwijzen(
    verzoek: DossierWijziging,
    reden: string,
    door: Pick<User, 'id' | 'name'>,
  ) {
    if (verzoek.status !== 'open') return verzoek

    const bijgewerkt = await put('changeRequests', db.changeRequests, {
      ...verzoek,
      status: 'afgewezen',
      besistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
      afwijzingReden: reden.trim().slice(0, 400) || undefined,
    })

    const aanvrager = await db.users.get(verzoek.aangevraagdDoor)
    if (aanvrager && aanvrager.id !== door.id) {
      await notifications.send({
        to: { id: aanvrager.id, name: aanvrager.name },
        from: door,
        kind: 'waarschuwing',
        title: `Wijziging voor ${verzoek.userName} afgewezen`,
        body: reden.trim().slice(0, 200) || 'Geen reden opgegeven.',
        link: 'personeel',
        mail: true,
      })
    }

    return bijgewerkt
  },

  /** De aanvrager bedenkt zich. Kan alleen zolang er niets over gezegd is. */
  async intrekken(verzoek: DossierWijziging) {
    if (verzoek.status !== 'open') return verzoek
    return put('changeRequests', db.changeRequests, { ...verzoek, status: 'ingetrokken' })
  },
}

/* ------------------------------------------------------------------ */

export function openVerzoeken(alle: DossierWijziging[]): DossierWijziging[] {
  return alle
    .filter((v) => v.status === 'open')
    .sort((a, b) => a.aangevraagdOp - b.aangevraagdOp)
}

export function verzoekenVan(alle: DossierWijziging[], userId: string): DossierWijziging[] {
  return alle
    .filter((v) => v.userId === userId)
    .sort((a, b) => b.aangevraagdOp - a.aangevraagdOp)
}
