import type { Expense, InventoryItem, TimeEntry, User, WashJob } from './types'

const DAY = 86_400_000

export function startOfDay(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayRange(days: number) {
  const to = startOfDay(Date.now()) + DAY - 1
  const from = startOfDay(Date.now() - (days - 1) * DAY)
  return { from, to }
}

export function inRange<T>(rows: T[], get: (r: T) => number, from: number, to: number) {
  return rows.filter((r) => {
    const v = get(r)
    return v >= from && v <= to
  })
}

/* ------------------------------------------------------------------ *
 *  Omzet & volume
 * ------------------------------------------------------------------ */

export interface DayPoint {
  ts: number
  label: string
  omzet: number
  wasbeurten: number
  kosten: number
}

export function seriesByDay(
  jobs: WashJob[],
  expenses: Expense[],
  days: number,
): DayPoint[] {
  const { from } = dayRange(days)
  const buckets = new Map<number, DayPoint>()

  for (let i = 0; i < days; i++) {
    const ts = from + i * DAY
    buckets.set(ts, {
      ts,
      label: new Date(ts).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }),
      omzet: 0,
      wasbeurten: 0,
      kosten: 0,
    })
  }

  for (const j of jobs) {
    if (j.status !== 'gereed' || !j.completedAt) continue
    const key = startOfDay(j.completedAt)
    const b = buckets.get(key)
    if (!b) continue
    b.omzet += j.priceExcl
    b.wasbeurten += 1
  }

  for (const e of expenses) {
    if (e.status === 'afgekeurd') continue
    const b = buckets.get(startOfDay(e.date))
    if (b) b.kosten += e.amountExcl
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    omzet: Math.round(b.omzet * 100) / 100,
    kosten: Math.round(b.kosten * 100) / 100,
  }))
}

/* ------------------------------------------------------------------ *
 *  KPI's, inclusief vergelijking met de vorige periode
 * ------------------------------------------------------------------ */

export interface Kpi {
  value: number
  prev: number
  deltaPct: number
}

function kpi(value: number, prev: number): Kpi {
  const deltaPct = prev === 0 ? (value === 0 ? 0 : 100) : ((value - prev) / prev) * 100
  return { value, prev, deltaPct }
}

export interface ManagementKpis {
  omzet: Kpi
  wasbeurten: Kpi
  kosten: Kpi
  marge: Kpi
  gemDoorlooptijdMin: Kpi
  openKosten: number
  openKostenBedrag: number
}

export function managementKpis(
  jobs: WashJob[],
  expenses: Expense[],
  days: number,
): ManagementKpis {
  const now = Date.now()
  const curFrom = startOfDay(now - (days - 1) * DAY)
  const prevFrom = curFrom - days * DAY
  const prevTo = curFrom - 1

  const done = jobs.filter((j) => j.status === 'gereed' && j.completedAt)
  const cur = done.filter((j) => j.completedAt! >= curFrom)
  const prev = done.filter((j) => j.completedAt! >= prevFrom && j.completedAt! <= prevTo)

  const valid = expenses.filter((e) => e.status !== 'afgekeurd')
  const curExp = valid.filter((e) => e.date >= curFrom)
  const prevExp = valid.filter((e) => e.date >= prevFrom && e.date <= prevTo)

  const sum = (a: number, b: number) => a + b
  const omzetCur = cur.map((j) => j.priceExcl).reduce(sum, 0)
  const omzetPrev = prev.map((j) => j.priceExcl).reduce(sum, 0)
  const kostenCur = curExp.map((e) => e.amountExcl).reduce(sum, 0)
  const kostenPrev = prevExp.map((e) => e.amountExcl).reduce(sum, 0)

  const durMin = (list: WashJob[]) => {
    const withDur = list.filter((j) => j.startedAt && j.completedAt)
    if (!withDur.length) return 0
    return (
      withDur
        .map((j) => (j.completedAt! - j.startedAt!) / 60000)
        .reduce(sum, 0) / withDur.length
    )
  }

  const open = expenses.filter((e) => e.status === 'open')

  return {
    omzet: kpi(omzetCur, omzetPrev),
    wasbeurten: kpi(cur.length, prev.length),
    kosten: kpi(kostenCur, kostenPrev),
    marge: kpi(omzetCur - kostenCur, omzetPrev - kostenPrev),
    gemDoorlooptijdMin: kpi(durMin(cur), durMin(prev)),
    openKosten: open.length,
    openKostenBedrag: open.map((e) => e.amountExcl).reduce(sum, 0),
  }
}

/* ------------------------------------------------------------------ *
 *  Personeel
 * ------------------------------------------------------------------ */

export interface StaffRow {
  user: User
  jobs: number
  omzet: number
  minuten: number
  gemMinPerWas: number
  loonkosten: number
}

/**
 * Prestaties per medewerker.
 *
 * De uurtarieven komen los mee. Ze staan namelijk niet meer in het profiel
 * -- dat leest iedereen die hier werkt -- maar in het afgeschermde deel van
 * het dossier. Wie daar niet bij mag krijgt hier dus loonkosten van nul, en
 * dat is precies goed: hij hoort ze niet te zien.
 */
export function staffPerformance(
  users: User[],
  jobs: WashJob[],
  entries: TimeEntry[],
  days: number,
  tarieven?: Map<string, number>,
): StaffRow[] {
  const from = startOfDay(Date.now() - (days - 1) * DAY)

  return users
    .filter((u) => u.roles.includes('employee'))
    .map((u) => {
      const mine = jobs.filter(
        (j) => j.assignedTo === u.id && j.status === 'gereed' && (j.completedAt ?? 0) >= from,
      )
      const myTime = entries.filter((e) => e.userId === u.id && e.start >= from && e.end)
      const minuten = myTime
        .map((e) => (e.end! - e.start) / 60000)
        .reduce((a, b) => a + b, 0)
      const omzet = mine.map((j) => j.priceExcl).reduce((a, b) => a + b, 0)

      return {
        user: u,
        jobs: mine.length,
        omzet: Math.round(omzet * 100) / 100,
        minuten: Math.round(minuten),
        gemMinPerWas: mine.length ? Math.round(minuten / mine.length) : 0,
        loonkosten: Math.round(((minuten / 60) * (tarieven?.get(u.id) ?? u.hourlyRate ?? 0)) * 100) / 100,
      }
    })
    .sort((a, b) => b.omzet - a.omzet)
}

/* ------------------------------------------------------------------ *
 *  Voorraad
 * ------------------------------------------------------------------ */

export function inventoryHealth(items: InventoryItem[]) {
  const low = items.filter((i) => i.stock < i.minStock)
  const waarde = items
    .map((i) => i.stock * i.pricePerUnit)
    .reduce((a, b) => a + b, 0)
  const bestelwaarde = low
    .map((i) => (i.minStock * 2 - i.stock) * i.pricePerUnit)
    .reduce((a, b) => a + b, 0)

  return {
    low,
    waarde: Math.round(waarde * 100) / 100,
    bestelwaarde: Math.round(bestelwaarde * 100) / 100,
  }
}

/* ------------------------------------------------------------------ *
 *  Kosten per categorie
 * ------------------------------------------------------------------ */

export function expensesByCategory(expenses: Expense[], days: number) {
  const from = startOfDay(Date.now() - (days - 1) * DAY)
  const map = new Map<string, number>()
  for (const e of expenses) {
    if (e.status === 'afgekeurd' || e.date < from) continue
    map.set(e.category, (map.get(e.category) ?? 0) + e.amountExcl)
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
}
