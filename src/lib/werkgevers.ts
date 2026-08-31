import { db, uid } from './db'
import { enqueue } from './sync'
import { notifications, users as userRepo } from './repo'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type {
  ServiceKind, User, WashJob, Werkgever, WerkgeverKoppeling, WerkgeverRegel,
  WerkgeverStatus,
} from './types'

/* ------------------------------------------------------------------ *
 *  Werkgevers
 *
 *  Een transportbedrijf waarvan de chauffeurs hier komen wassen.
 *
 *  De kern van het ontwerp zit in de koppeling. Die is geen kolom op het
 *  profiel maar een eigen regel, om twee redenen:
 *
 *   - een chauffeur kan bij twee bedrijven rijden
 *   - als hij ergens weggaat verdwijnt alleen die koppeling, en daarmee de
 *     wasbeurten van dat bedrijf uit zijn beeld -- ook die hij zelf bracht
 *
 *  Dat laatste is de vraag die dit moest oplossen, en het is precies waarom
 *  een beëindigde koppeling wél blijft bestaan maar niet meer meetelt.
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

/* ================================================================== *
 *  Het bedrijf
 * ================================================================== */

export const werkgevers = {
  /** Aangemaakt door Truckwash1: meteen actief. */
  async aanmaken(input: {
    naam: string
    contactNaam: string
    email: string
    kvk?: string
    telefoon?: string
    adres?: string
    postcode?: string
    plaats?: string
    companyId?: string
    beheerders?: string[]
    door: Pick<User, 'id' | 'name'>
  }) {
    const werkgever: Werkgever = {
      id: uid('wg'),
      naam: input.naam.trim(),
      kvk: input.kvk?.trim() || undefined,
      contactNaam: input.contactNaam.trim(),
      email: input.email.trim().toLowerCase(),
      telefoon: input.telefoon?.trim() || undefined,
      adres: input.adres?.trim() || undefined,
      postcode: input.postcode?.trim() || undefined,
      plaats: input.plaats?.trim() || undefined,
      companyId: input.companyId,
      status: 'actief',
      beheerders: input.beheerders ?? [],
      aangevraagdDoor: input.door.id,
      aangevraagdDoorNaam: input.door.name,
      aangevraagdOp: Date.now(),
      beslistDoor: input.door.id,
      beslistDoorNaam: input.door.name,
      beslistOp: Date.now(),
      updatedAt: Date.now(),
    }
    return put('employers', db.employers, werkgever)
  },

  /** Aangevraagd door de werkgever zelf: wacht op akkoord. */
  async aanvragen(input: {
    naam: string
    contactNaam: string
    email: string
    kvk?: string
    telefoon?: string
    plaats?: string
    notitie?: string
    door: Pick<User, 'id' | 'name'>
  }) {
    const werkgever: Werkgever = {
      id: uid('wg'),
      naam: input.naam.trim(),
      kvk: input.kvk?.trim() || undefined,
      contactNaam: input.contactNaam.trim(),
      email: input.email.trim().toLowerCase(),
      telefoon: input.telefoon?.trim() || undefined,
      plaats: input.plaats?.trim() || undefined,
      status: 'aangevraagd',
      beheerders: [input.door.id],
      aangevraagdDoor: input.door.id,
      aangevraagdDoorNaam: input.door.name,
      aangevraagdOp: Date.now(),
      notitie: input.notitie?.trim() || undefined,
      updatedAt: Date.now(),
    }
    await put('employers', db.employers, werkgever)

    const bazen = (await db.users.toArray()).filter(
      (u) => u.active && u.roles.includes('management'))
    for (const baas of bazen) {
      await notifications.send({
        to: { id: baas.id, name: baas.name },
        from: input.door,
        kind: 'taak',
        title: `Nieuwe werkgever: ${werkgever.naam}`,
        body: `${input.contactNaam} vraagt toegang aan voor ${werkgever.naam}.`,
        link: 'werkgevers',
        mail: true,
      })
    }

    return werkgever
  },

  async update(id: string, patch: Partial<Werkgever>) {
    const wg = await db.employers.get(id)
    if (!wg) return
    return put('employers', db.employers, { ...wg, ...patch, id })
  },

  /**
   * Toelaten.
   *
   * De contactpersoon krijgt de rol werkgever erbij; zonder die rol komt hij
   * niet in het dashboard, ook al staat zijn naam bij de beheerders.
   */
  async goedkeuren(wg: Werkgever, door: Pick<User, 'id' | 'name'>) {
    if (wg.status === 'actief') return wg

    const bijgewerkt = await werkgevers.update(wg.id, {
      status: 'actief',
      beslistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
      afwijzingReden: undefined,
    })

    for (const beheerderId of wg.beheerders) {
      const persoon = await db.users.get(beheerderId)
      if (!persoon) continue
      if (!persoon.roles.includes('employer')) {
        await userRepo.setRoles(persoon.id, [...persoon.roles, 'employer'])
      }
      await notifications.send({
        to: { id: persoon.id, name: persoon.name },
        from: door,
        kind: 'info',
        title: `${wg.naam} is toegelaten`,
        body: 'Je kunt nu chauffeurs uitnodigen en afspraken vastleggen.',
        link: 'werkgevers',
        mail: true,
      })
    }

    return bijgewerkt
  },

  async afwijzen(wg: Werkgever, reden: string, door: Pick<User, 'id' | 'name'>) {
    const bijgewerkt = await werkgevers.update(wg.id, {
      status: 'afgewezen',
      beslistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
      afwijzingReden: reden.trim().slice(0, 400) || undefined,
    })

    if (wg.aangevraagdDoor) {
      const persoon = await db.users.get(wg.aangevraagdDoor)
      if (persoon) {
        await notifications.send({
          to: { id: persoon.id, name: persoon.name },
          from: door,
          kind: 'waarschuwing',
          title: `Aanvraag voor ${wg.naam} afgewezen`,
          body: reden.trim().slice(0, 200) || 'Geen reden opgegeven.',
          mail: true,
        })
      }
    }

    return bijgewerkt
  },

  /**
   * Blokkeren.
   *
   * Het bedrijf blijft bestaan met alles wat erbij hoort; alleen de toegang
   * gaat dicht. Weggooien zou de historie meenemen, en die heb je later
   * juist nodig.
   */
  async blokkeren(wg: Werkgever, door: Pick<User, 'id' | 'name'>, blokkeren = true) {
    return werkgevers.update(wg.id, {
      status: blokkeren ? 'geblokkeerd' : 'actief',
      beslistDoor: door.id,
      beslistDoorNaam: door.name,
      beslistOp: Date.now(),
    })
  },
}

/* ================================================================== *
 *  Chauffeurs
 * ================================================================== */

export interface UitnodigingUitkomst {
  ok: boolean
  soort?: 'nieuw account' | 'koppelverzoek'
  reden?: string
  mailVerstuurd?: boolean
}

export const koppelingen = {
  /**
   * Een chauffeur uitnodigen.
   *
   * Dit loopt via een serverfunctie, want een account aanmaken vereist de
   * servicesleutel en die hoort niet in een app op telefoons. Bestaat er al
   * een account op dat adres, dan wordt er niets aangemaakt maar gevraagd of
   * het gekoppeld mag worden.
   */
  async uitnodigen(input: {
    werkgever: Werkgever
    naam: string
    email: string
  }): Promise<UitnodigingUitkomst> {
    if (!supabaseConfigured) {
      return { ok: false, reden: 'Er is nog geen database ingesteld.' }
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { ok: false, reden: 'Uitnodigen lukt alleen met verbinding.' }
    }

    try {
      const { data, error } = await supabase().functions.invoke<{
        ok: boolean
        soort?: 'nieuw account' | 'koppelverzoek'
        reden?: string
        error?: string
        mailVerstuurd?: boolean
      }>('nodig-uit', {
        body: {
          werkgeverId: input.werkgever.id,
          naam: input.naam,
          email: input.email,
        },
      })

      if (error) {
        const detail = await leesFout(error)
        return { ok: false, reden: detail ?? String(error.message ?? error) }
      }
      if (!data?.ok) return { ok: false, reden: data?.reden ?? data?.error }

      return { ok: true, soort: data.soort, mailVerstuurd: data.mailVerstuurd }
    } catch (e) {
      return { ok: false, reden: e instanceof Error ? e.message : String(e) }
    }
  },

  /** De chauffeur gaat akkoord met een koppelverzoek. */
  async aannemen(koppeling: WerkgeverKoppeling, door: Pick<User, 'id' | 'name'>) {
    const bijgewerkt = await put('employerLinks', db.employerLinks, {
      ...koppeling,
      status: 'actief',
      userId: koppeling.userId ?? door.id,
      gekoppeldOp: Date.now(),
    })

    const uitnodiger = await db.users.get(koppeling.uitgenodigdDoor)
    if (uitnodiger) {
      await notifications.send({
        to: { id: uitnodiger.id, name: uitnodiger.name },
        from: door,
        kind: 'info',
        title: `${door.name} is gekoppeld`,
        body: `Aan ${koppeling.werkgeverNaam}.`,
        link: 'werknemers',
      })
    }

    return bijgewerkt
  },

  /** De chauffeur wil niet. */
  async weigeren(koppeling: WerkgeverKoppeling, door: Pick<User, 'id' | 'name'>) {
    const bijgewerkt = await put('employerLinks', db.employerLinks, {
      ...koppeling,
      status: 'geweigerd',
      beeindigdOp: Date.now(),
      beeindigdDoor: door.id,
      beeindigdDoorNaam: door.name,
    })

    const uitnodiger = await db.users.get(koppeling.uitgenodigdDoor)
    if (uitnodiger) {
      await notifications.send({
        to: { id: uitnodiger.id, name: uitnodiger.name },
        from: door,
        kind: 'waarschuwing',
        title: `${door.name} gaat niet akkoord`,
        body: `Het koppelverzoek voor ${koppeling.werkgeverNaam} is geweigerd.`,
        link: 'werknemers',
      })
    }

    return bijgewerkt
  },

  /**
   * De werkgever haalt iemand eruit.
   *
   * De koppeling blijft staan met de reden erbij -- dat is de geschiedenis.
   * Maar hij telt niet meer mee, dus de wasbeurten van dit bedrijf
   * verdwijnen uit het beeld van die chauffeur. Ook de beurten die hij zelf
   * heeft gebracht: die zijn van het bedrijf, niet van hem.
   */
  async beeindigen(
    koppeling: WerkgeverKoppeling,
    reden: string,
    door: Pick<User, 'id' | 'name'>,
  ) {
    const bijgewerkt = await put('employerLinks', db.employerLinks, {
      ...koppeling,
      status: 'beëindigd',
      beeindigdOp: Date.now(),
      beeindigdDoor: door.id,
      beeindigdDoorNaam: door.name,
      beeindigdReden: reden.trim().slice(0, 400) || undefined,
    })

    if (koppeling.userId) {
      const persoon = await db.users.get(koppeling.userId)
      if (persoon) {
        await notifications.send({
          to: { id: persoon.id, name: persoon.name },
          from: door,
          kind: 'waarschuwing',
          title: `Je bent losgekoppeld van ${koppeling.werkgeverNaam}`,
          body: (reden.trim().slice(0, 200) || 'Er is geen reden opgegeven.') +
                ' Je ziet de wasbeurten van dit bedrijf niet meer. Je account ' +
                'en je eigen gegevens blijven gewoon van jou.',
          mail: true,
        })
      }
    }

    return bijgewerkt
  },

  /** De kentekens die deze chauffeur mag brengen. */
  async setKentekens(koppeling: WerkgeverKoppeling, kentekens: string[]) {
    return put('employerLinks', db.employerLinks, {
      ...koppeling,
      kentekens: kentekens.map((k) => k.toUpperCase().trim()).filter(Boolean),
    })
  },
}

async function leesFout(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!context || typeof context !== 'object') return null
  try {
    const response = context as Response
    if (typeof response.json !== 'function') return null
    const body = await response.json()
    return body?.error ?? body?.reden ?? null
  } catch {
    return null
  }
}

/* ================================================================== *
 *  Afspraken
 * ================================================================== */

export const regels = {
  async toevoegen(input: {
    werkgeverId: string
    kenteken?: string
    service?: ServiceKind
    productCode?: string
    soort: WerkgeverRegel['soort']
    reden?: string
    door: Pick<User, 'id'>
  }) {
    const regel: WerkgeverRegel = {
      id: uid('wgr'),
      werkgeverId: input.werkgeverId,
      kenteken: input.kenteken?.toUpperCase().trim() || undefined,
      service: input.service,
      productCode: input.productCode?.trim() || undefined,
      soort: input.soort,
      reden: input.reden?.trim() || undefined,
      aangemaaktDoor: input.door.id,
      aangemaaktOp: Date.now(),
      updatedAt: Date.now(),
    }
    return put('employerRules', db.employerRules, regel)
  },

  async verwijderen(id: string) {
    await db.employerRules.delete(id)
    await enqueue('employerRules', 'delete', id, null)
  },
}

/* ------------------------------------------------------------------ *
 *  Wat mag er bij deze wagen?
 *
 *  Dit is de vraag die het kassasysteem straks stelt. Het antwoord komt uit
 *  dezelfde regels als in de app, zodat wat hier niet mag ook aan de balie
 *  niet in beeld komt.
 * ------------------------------------------------------------------ */

export interface Beoordeling {
  toegestaan: boolean
  akkoordNodig: boolean
  reden?: string
}

export function magAfnemen(
  alleRegels: WerkgeverRegel[],
  input: { werkgeverId: string; kenteken?: string; service?: ServiceKind; productCode?: string },
): Beoordeling {
  const kenteken = input.kenteken?.toUpperCase().trim()

  const vanToepassing = alleRegels.filter((r) => {
    if (r.werkgeverId !== input.werkgeverId) return false
    // Zonder kenteken geldt de regel voor alle wagens van dit bedrijf.
    if (r.kenteken && r.kenteken !== kenteken) return false
    if (r.service && r.service !== input.service) return false
    if (r.productCode && r.productCode !== input.productCode) return false
    // Een regel zonder behandeling én zonder product zegt niets.
    return !!(r.service || r.productCode)
  })

  // Een verbod weegt zwaarder dan een voorwaarde. Staat er allebei iets,
  // dan geldt het strengste.
  const verbod = vanToepassing.find((r) => r.soort === 'niet toegestaan')
  if (verbod) {
    return { toegestaan: false, akkoordNodig: false, reden: verbod.reden }
  }

  const voorwaarde = vanToepassing.find((r) => r.soort === 'alleen met akkoord')
  if (voorwaarde) {
    return { toegestaan: true, akkoordNodig: true, reden: voorwaarde.reden }
  }

  return { toegestaan: true, akkoordNodig: false }
}

/* ================================================================== *
 *  Wat je ervan ziet
 * ================================================================== */

/** De werkgevers waar deze persoon iets mee te maken heeft. */
export function mijnWerkgevers(
  alle: Werkgever[],
  links: WerkgeverKoppeling[],
  user: User | null,
): Werkgever[] {
  if (!user) return []

  const alsBeheerder = alle.filter((w) => w.beheerders.includes(user.id))
  const alsChauffeur = alle.filter((w) =>
    links.some((l) => l.werkgeverId === w.id && l.userId === user.id && l.status === 'actief'))

  const gezien = new Set<string>()
  return [...alsBeheerder, ...alsChauffeur].filter((w) => {
    if (gezien.has(w.id)) return false
    gezien.add(w.id)
    return true
  })
}

/** De chauffeurs van een werkgever, actieve bovenaan. */
export function chauffeursVan(
  links: WerkgeverKoppeling[],
  werkgeverId: string,
): WerkgeverKoppeling[] {
  const rang: Record<WerkgeverKoppeling['status'], number> = {
    'actief': 0,
    'wacht op akkoord': 1,
    'uitgenodigd': 2,
    'geweigerd': 3,
    'beëindigd': 4,
  }
  return links
    .filter((l) => l.werkgeverId === werkgeverId)
    .sort((a, b) => rang[a.status] - rang[b.status] || a.naam.localeCompare(b.naam))
}

/** De koppelverzoeken die op mij wachten. */
export function openKoppelverzoeken(
  links: WerkgeverKoppeling[],
  user: User | null,
): WerkgeverKoppeling[] {
  if (!user) return []
  return links.filter((l) =>
    l.status === 'wacht op akkoord' &&
    (l.userId === user.id || l.email.toLowerCase() === user.email.toLowerCase()))
}

/** De wasbeurten die bij deze werkgever horen. */
export function beurtenVan(jobs: WashJob[], werkgeverId: string): WashJob[] {
  return jobs
    .filter((j) => j.werkgeverId === werkgeverId)
    .sort((a, b) => b.scheduledAt - a.scheduledAt)
}
