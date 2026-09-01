import { db, uid, alleMensen } from './db'
import { enqueue } from './sync'
import { notifications } from './repo'
import { withinScope } from './locations'
import type {
  AgendaItem, AgendaSoort, MaintenancePlan, PersonnelDocument, PersonnelPrivate,
  Shift, User, WashJob,
} from './types'
import { SHIFT_KINDS } from './types'

/* ------------------------------------------------------------------ *
 *  Agenda
 *
 *  Twee soorten dingen staan erin, en het verschil is belangrijk.
 *
 *  Afspraken zet iemand er zelf in: een overleg, een keuring, een bezoek.
 *  Die worden opgeslagen.
 *
 *  De rest staat er al. Een verjaardag volgt uit een geboortedatum, een
 *  jubileum uit een datum in dienst, een aflopend contract uit het contract
 *  zelf. Die worden hier afgeleid, niet bewaard -- anders heb je twee
 *  waarheden die uit elkaar gaan lopen zodra er iets verandert.
 * ------------------------------------------------------------------ */

const DAG = 86_400_000

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
 *  Afspraken
 * ================================================================== */

export const agenda = {
  async create(input: {
    title: string
    description?: string
    soort: AgendaSoort
    startAt: number
    endAt: number
    heleDag?: boolean
    locationId?: string
    deelnemers?: string[]
    door: Pick<User, 'id' | 'name'>
  }) {
    const item: AgendaItem = {
      id: uid('ag'),
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      soort: input.soort,
      startAt: input.startAt,
      endAt: input.endAt,
      heleDag: input.heleDag ?? false,
      locationId: input.locationId,
      deelnemers: input.deelnemers ?? [],
      createdBy: input.door.id,
      createdByName: input.door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await put('agendaItems', db.agendaItems, item)

    // Wie erbij moet zijn hoort het te weten, en niet pas als hij toevallig
    // in de agenda kijkt.
    for (const id of item.deelnemers) {
      if (id === input.door.id) continue
      const persoon = await db.users.get(id)
      if (!persoon) continue
      await notifications.send({
        to: { id: persoon.id, name: persoon.name },
        from: input.door,
        kind: 'taak',
        title: `In je agenda: ${item.title}`,
        body: beschrijfMoment(item),
        link: 'agenda',
        mail: true,
      })
    }

    return item
  },

  async update(id: string, patch: Partial<AgendaItem>) {
    const item = await db.agendaItems.get(id)
    if (!item) return
    return put('agendaItems', db.agendaItems, { ...item, ...patch, id })
  },

  async remove(id: string) {
    await db.agendaItems.delete(id)
    await enqueue('agendaItems', 'delete', id, null)
  },
}

function beschrijfMoment(item: AgendaItem): string {
  const dag = new Date(item.startAt).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  if (item.heleDag) return `${dag}, hele dag`
  const tijd = (ts: number) =>
    new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return `${dag} van ${tijd(item.startAt)} tot ${tijd(item.endAt)}`
}

/* ================================================================== *
 *  Wat er op een dag staat
 * ================================================================== */

export type GebeurtenisSoort =
  | AgendaSoort
  | 'verjaardag' | 'jubileum' | 'indienst' | 'uitdienst'
  | 'dienst' | 'contract' | 'document' | 'onderhoudsbeurt'

export interface Gebeurtenis {
  id: string
  soort: GebeurtenisSoort
  titel: string
  toelichting?: string
  /** Het begin van de dag waarop dit valt */
  dag: number
  startAt?: number
  endAt?: number
  heleDag: boolean
  locationId?: string
  /** Om wie het gaat, als het over een persoon gaat */
  userId?: string
  /** Het opgeslagen item, als het er een is */
  item?: AgendaItem
}

export const SOORT_LABELS: Record<GebeurtenisSoort, { label: string; tint: string }> = {
  afspraak:        { label: 'Afspraak',        tint: 'brand' },
  verlof:          { label: 'Verlof',          tint: 'info' },
  opleiding:       { label: 'Opleiding',       tint: 'paars' },
  onderhoud:       { label: 'Onderhoud',       tint: 'oranje' },
  overig:          { label: 'Overig',          tint: 'neutraal' },
  verjaardag:      { label: 'Verjaardag',      tint: 'brand' },
  jubileum:        { label: 'Jubileum',        tint: 'brand' },
  indienst:        { label: 'In dienst',       tint: 'ok' },
  uitdienst:       { label: 'Uit dienst',      tint: 'danger' },
  dienst:          { label: 'Dienst',          tint: 'neutraal' },
  contract:        { label: 'Contract',        tint: 'warn' },
  document:        { label: 'Document',        tint: 'warn' },
  onderhoudsbeurt: { label: 'Onderhoudsbeurt', tint: 'oranje' },
}

export function beginVanDag(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** De datum in een bepaald jaar, met dezelfde dag en maand. */
function inJaar(ts: number, jaar: number): number {
  const d = new Date(ts)
  return new Date(jaar, d.getMonth(), d.getDate()).getTime()
}

/**
 * Alles wat er in een periode gebeurt.
 *
 * De opgeslagen afspraken, plus wat uit de rest van de gegevens volgt. Dat
 * laatste wordt hier berekend en niet bewaard: een geboortedatum die wordt
 * gecorrigeerd hoort meteen de juiste verjaardag te geven, niet pas nadat
 * iemand een oude regel heeft opgeruimd.
 */
export function gebeurtenissen(input: {
  van: number
  tot: number
  ik: User | null
  items: AgendaItem[]
  mensen: User[]
  prive: PersonnelPrivate[]
  shifts: Shift[]
  documenten: PersonnelDocument[]
  onderhoud: MaintenancePlan[]
  /** Alleen mijn eigen diensten tonen, of die van iedereen */
  alleDiensten?: boolean
}): Gebeurtenis[] {
  const uit: Gebeurtenis[] = []
  const { van, tot } = input

  const inBereik = (ts: number) => ts >= van && ts < tot

  /* ------------------------- afspraken ------------------------- */

  for (const item of withinScope(input.ik, input.items)) {
    if (item.endAt < van || item.startAt >= tot) continue
    uit.push({
      id: item.id,
      soort: item.soort,
      titel: item.title,
      toelichting: item.description,
      dag: beginVanDag(item.startAt),
      startAt: item.startAt,
      endAt: item.endAt,
      heleDag: item.heleDag,
      locationId: item.locationId,
      item,
    })
  }

  /* ------------------- verjaardagen en jubilea ------------------ */

  const prive = new Map(input.prive.map((p) => [p.userId, p]))
  const jaren = new Set([
    new Date(van).getFullYear(),
    new Date(tot).getFullYear(),
  ])

  for (const persoon of input.mensen) {
    if (!persoon.active) continue

    const geboorte = prive.get(persoon.id)?.birthDate
    if (geboorte) {
      for (const jaar of jaren) {
        const dag = inJaar(geboorte, jaar)
        if (!inBereik(dag)) continue
        const leeftijd = jaar - new Date(geboorte).getFullYear()
        uit.push({
          id: `vj_${persoon.id}_${jaar}`,
          soort: 'verjaardag',
          titel: `${persoon.name} is jarig`,
          toelichting: leeftijd > 0 ? `Wordt ${leeftijd}` : undefined,
          dag,
          heleDag: true,
          locationId: persoon.locationId,
          userId: persoon.id,
        })
      }
    }

    if (persoon.startDate) {
      const start = persoon.startDate
      for (const jaar of jaren) {
        const dag = inJaar(start, jaar)
        if (!inBereik(dag)) continue
        const jarenInDienst = jaar - new Date(start).getFullYear()

        if (jarenInDienst === 0) {
          uit.push({
            id: `id_${persoon.id}`,
            soort: 'indienst',
            titel: `${persoon.name} begint`,
            toelichting: persoon.function,
            dag,
            heleDag: true,
            locationId: persoon.locationId,
            userId: persoon.id,
          })
        } else if (MIJLPALEN.includes(jarenInDienst)) {
          // Niet elk jaar een jubileum: dan is het geen jubileum meer.
          uit.push({
            id: `jub_${persoon.id}_${jaar}`,
            soort: 'jubileum',
            titel: `${persoon.name} is ${jarenInDienst} jaar in dienst`,
            dag,
            heleDag: true,
            locationId: persoon.locationId,
            userId: persoon.id,
          })
        }
      }
    }

    if (persoon.endDate && inBereik(beginVanDag(persoon.endDate))) {
      uit.push({
        id: `ud_${persoon.id}`,
        soort: 'uitdienst',
        titel: `Laatste dag van ${persoon.name}`,
        dag: beginVanDag(persoon.endDate),
        heleDag: true,
        locationId: persoon.locationId,
        userId: persoon.id,
      })
    }
  }

  /* ---------------------------- diensten ------------------------ */

  for (const shift of input.shifts) {
    if (!input.alleDiensten && shift.userId !== input.ik?.id) continue
    if (!inBereik(shift.startAt)) continue
    uit.push({
      id: shift.id,
      soort: 'dienst',
      titel: input.alleDiensten
        ? `${shift.userName} — ${SHIFT_KINDS[shift.kind].label.toLowerCase()}`
        : SHIFT_KINDS[shift.kind].label,
      dag: beginVanDag(shift.startAt),
      startAt: shift.startAt,
      endAt: shift.endAt,
      heleDag: shift.kind !== 'dienst',
      locationId: shift.locationId,
      userId: shift.userId,
    })
  }

  /* ------------------- documenten die verlopen ------------------ */

  for (const doc of input.documenten) {
    if (!doc.expiresAt || !inBereik(beginVanDag(doc.expiresAt))) continue
    uit.push({
      id: `doc_${doc.id}`,
      soort: doc.kind === 'contract' ? 'contract' : 'document',
      titel: `${doc.title} van ${doc.userName} verloopt`,
      toelichting: 'Regel op tijd een nieuwe.',
      dag: beginVanDag(doc.expiresAt),
      heleDag: true,
      userId: doc.userId,
    })
  }

  /* ----------------------- onderhoudsbeurten -------------------- */

  for (const plan of withinScope(input.ik, input.onderhoud)) {
    if (!plan.active || !inBereik(beginVanDag(plan.nextDueAt))) continue
    uit.push({
      id: `mp_${plan.id}`,
      soort: 'onderhoudsbeurt',
      titel: plan.title,
      toelichting: `${plan.estimatedMinutes} minuten`,
      dag: beginVanDag(plan.nextDueAt),
      heleDag: true,
      locationId: plan.locationId,
    })
  }

  return uit.sort((a, b) => {
    if (a.dag !== b.dag) return a.dag - b.dag
    // Hele dagen bovenaan, daarna op tijd.
    if (a.heleDag !== b.heleDag) return a.heleDag ? -1 : 1
    return (a.startAt ?? 0) - (b.startAt ?? 0)
  })
}

/** Waar we een jubileum van maken. Elk jaar zou het niets meer betekenen. */
export const MIJLPALEN = [1, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50]

/** Per dag gegroepeerd, voor een maandweergave. */
export function perDag(lijst: Gebeurtenis[]): Map<number, Gebeurtenis[]> {
  const kaart = new Map<number, Gebeurtenis[]>()
  for (const g of lijst) {
    const rij = kaart.get(g.dag) ?? []
    rij.push(g)
    kaart.set(g.dag, rij)
  }
  return kaart
}

/* ================================================================== *
 *  Feliciteren
 *
 *  Een verjaardag die niemand opmerkt is erger dan geen verjaardag in het
 *  systeem. Dit kijkt bij het openen van de app of er vandaag iets te
 *  vieren valt, en stuurt dan bericht.
 *
 *  Het id ligt vast op persoon en jaar. Doen twee mensen dit tegelijk, dan
 *  levert dat één bericht op in plaats van twee -- de tweede schrijft
 *  dezelfde regel over.
 * ================================================================== */

export interface Felicitatie {
  id: string
  userId: string
  naam: string
  soort: 'verjaardag' | 'jubileum' | 'indienst'
  titel: string
  tekst: string
}

/** Wat er vandaag te vieren valt. */
export function teVieren(
  mensen: User[],
  prive: PersonnelPrivate[],
  vandaag = Date.now(),
): Felicitatie[] {
  const dag = beginVanDag(vandaag)
  const jaar = new Date(dag).getFullYear()
  const priveKaart = new Map(prive.map((p) => [p.userId, p]))
  const uit: Felicitatie[] = []

  for (const persoon of mensen) {
    if (!persoon.active) continue

    const geboorte = priveKaart.get(persoon.id)?.birthDate
    if (geboorte && inJaar(geboorte, jaar) === dag) {
      const leeftijd = jaar - new Date(geboorte).getFullYear()
      uit.push({
        id: `nt_vj_${persoon.id}_${jaar}`,
        userId: persoon.id,
        naam: persoon.name,
        soort: 'verjaardag',
        titel: `Gefeliciteerd, ${persoon.name.split(' ')[0]}!`,
        tekst: leeftijd > 0
          ? `Namens iedereen bij Truckwash1: een fijne verjaardag. Alweer ${leeftijd}.`
          : 'Namens iedereen bij Truckwash1: een fijne verjaardag.',
      })
    }

    if (persoon.startDate) {
      const jarenInDienst = jaar - new Date(persoon.startDate).getFullYear()
      if (inJaar(persoon.startDate, jaar) === dag) {
        if (jarenInDienst === 0) {
          uit.push({
            id: `nt_id_${persoon.id}`,
            userId: persoon.id,
            naam: persoon.name,
            soort: 'indienst',
            titel: `Welkom bij Truckwash1, ${persoon.name.split(' ')[0]}`,
            tekst: 'Fijn dat je er bent. Loop gerust binnen als er iets is.',
          })
        } else if (MIJLPALEN.includes(jarenInDienst)) {
          uit.push({
            id: `nt_jub_${persoon.id}_${jaar}`,
            userId: persoon.id,
            naam: persoon.name,
            soort: 'jubileum',
            titel: `${jarenInDienst} jaar bij Truckwash1`,
            tekst: `Vandaag precies ${jarenInDienst} jaar in dienst. Bedankt voor al die jaren.`,
          })
        }
      }
    }
  }

  return uit
}

/**
 * Stuurt de felicitaties van vandaag, en meldt het bij het management.
 *
 * Geeft terug hoeveel er verstuurd zijn. Twee keer aanroepen op dezelfde dag
 * levert geen tweede bericht op: het id ligt vast.
 */
export async function feliciteer(
  namens: Pick<User, 'id' | 'name'>,
  vandaag = Date.now(),
): Promise<number> {
  const mensen = await alleMensen()
  const prive = await db.personnelPrivate.toArray()
  const lijst = teVieren(mensen, prive, vandaag)
  if (lijst.length === 0) return 0

  const bestaande = new Set((await db.notifications.toArray()).map((n) => n.id))
  let verstuurd = 0

  for (const f of lijst) {
    if (bestaande.has(f.id)) continue
    if (f.userId === namens.id) continue

    await notifications.send({
      id: f.id,
      to: { id: f.userId, name: f.naam },
      from: namens,
      kind: 'info',
      title: f.titel,
      body: f.tekst,
      // Een felicitatie per mail is aardig; een felicitatie die pas
      // aankomt als iemand toevallig de app opent, niet.
      mail: true,
    })
    verstuurd++
  }

  return verstuurd
}
