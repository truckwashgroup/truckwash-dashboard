import { SHIFT_KINDS, type Shift, type User, type WashJob } from './types'
import { shiftHours, shiftsOnDay, weekDays, weekStart } from './roster'

/* ------------------------------------------------------------------ *
 *  Smartroster
 *
 *  Maakt een voorstel voor een week op basis van drie dingen:
 *
 *   1. Contracturen  -- iemand met 32 uur hoort ook 32 uur ingeroosterd te
 *                       staan, niet 40.
 *   2. Gewoontes     -- welke dagen en tijden iemand de afgelopen weken
 *                       daadwerkelijk werkte. Wie altijd de vroege dienst
 *                       draait, krijgt die weer.
 *   3. Drukte        -- hoeveel wasbeurten er die dag gepland staan. Op een
 *                       drukke dinsdag mag er iemand extra staan.
 *
 *  Het blijft een voorstel: niets wordt opgeslagen tot een leidinggevende
 *  het overneemt. Elke regel draagt de reden waarom hij er staat.
 * ------------------------------------------------------------------ */

const DAY = 86_400_000
const HOUR = 3_600_000

/** Hoeveel wasbeurten één persoon per uur ongeveer aankan. */
const JOBS_PER_HOUR = 1.15

/** Openingstijden; zondag dicht. */
const OPENING: Record<number, { from: number; to: number } | null> = {
  0: null,                     // zondag
  1: { from: 6.5, to: 19 },
  2: { from: 6.5, to: 19 },
  3: { from: 6.5, to: 19 },
  4: { from: 6.5, to: 19 },
  5: { from: 6.5, to: 19 },
  6: { from: 8, to: 14 },      // zaterdag
}

export interface Pattern {
  /** Hoe vaak deze persoon op elke weekdag werkte (0 = maandag) */
  dayFrequency: number[]
  /** Meest voorkomende begintijd in uren, bijv. 7 of 11 */
  usualStart: number
  usualEnd: number
  usualBreak: number
  /** Op hoeveel diensten dit patroon gebaseerd is */
  sampleSize: number
}

/** Leidt het werkpatroon van iemand af uit zijn recente diensten. */
export function patternOf(shifts: Shift[], userId: string, lookbackWeeks = 8): Pattern {
  const from = weekStart(Date.now()) - lookbackWeeks * 7 * DAY
  const mine = shifts.filter(
    (s) => s.userId === userId && s.kind === 'dienst' && s.startAt >= from && s.startAt < Date.now(),
  )

  const dayFrequency = [0, 0, 0, 0, 0, 0, 0]
  const starts: number[] = []
  const ends: number[] = []
  const breaks: number[] = []

  for (const s of mine) {
    const d = new Date(s.startAt)
    dayFrequency[(d.getDay() + 6) % 7] += 1
    starts.push(d.getHours() + d.getMinutes() / 60)
    const e = new Date(s.endAt)
    ends.push(e.getHours() + e.getMinutes() / 60)
    breaks.push(s.breakMinutes ?? 0)
  }

  return {
    dayFrequency,
    usualStart: mostCommon(starts, 7),
    usualEnd: mostCommon(ends, 15.5),
    usualBreak: Math.round(median(breaks, 30) / 15) * 15,
    sampleSize: mine.length,
  }
}

/** De meest voorkomende waarde, afgerond op een half uur. */
function mostCommon(values: number[], fallback: number): number {
  if (!values.length) return fallback
  const counts = new Map<number, number>()
  for (const v of values) {
    const rounded = Math.round(v * 2) / 2
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1)
  }
  let best = fallback
  let bestCount = -1
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v < best)) {
      best = v
      bestCount = c
    }
  }
  return best
}

function median(values: number[], fallback: number): number {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/* ------------------------------------------------------------------ */

export interface Proposal {
  userId: string
  userName: string
  day: number
  startAt: number
  endAt: number
  breakMinutes: number
  hours: number
  /** Waarom dit voorstel er staat, in gewone taal */
  reason: string
}

export interface WeekPlan {
  weekStart: number
  proposals: Proposal[]
  /** Per persoon: wat er al stond, wat erbij komt, en het contract */
  summary: {
    userId: string
    userName: string
    contractHours: number
    plannedHours: number
    proposedHours: number
    pattern: Pattern
    note?: string
  }[]
  /** Dagen waarop de bezetting krap is voor het aantal wasbeurten */
  warnings: string[]
}

export function planWeek(input: {
  staff: User[]
  shifts: Shift[]
  jobs: WashJob[]
  weekStart: number
}): WeekPlan {
  const { staff, shifts, jobs } = input
  const start = input.weekStart
  const days = weekDays(start)

  const proposals: Proposal[] = []
  const warnings: string[] = []

  // Wat er per persoon al staat in deze week
  const existingOf = (userId: string) =>
    shifts.filter((s) => s.userId === userId && s.startAt >= start && s.startAt < start + 7 * DAY)

  const patterns = new Map(staff.map((u) => [u.id, patternOf(shifts, u.id)]))

  // Verwachte drukte per dag
  const demand = days.map((day) => {
    const n = jobs.filter(
      (j) => j.scheduledAt >= day && j.scheduledAt < day + DAY && j.status !== 'geannuleerd',
    ).length
    return n
  })

  for (const person of staff) {
    const contract = person.contractHours ?? 0
    const pattern = patterns.get(person.id)!
    const existing = existingOf(person.id)

    let plannedHours = existing.reduce((a, s) => a + shiftHours(s), 0)
    const alreadyOnDay = new Set(
      existing.map((s) => new Date(s.startAt).setHours(0, 0, 0, 0)),
    )

    if (contract <= 0) continue

    // Dagen op volgorde van hoe vaak deze persoon er normaal staat; bij een
    // gelijke score wint de dag waarop het drukker is.
    const candidates = days
      .map((day, i) => ({ day, index: i, dow: new Date(day).getDay() }))
      .filter((d) => OPENING[d.dow] !== null)
      .filter((d) => !alreadyOnDay.has(d.day))
      .sort((a, b) => {
        const fa = pattern.dayFrequency[(new Date(a.day).getDay() + 6) % 7]
        const fb = pattern.dayFrequency[(new Date(b.day).getDay() + 6) % 7]
        if (fb !== fa) return fb - fa
        return demand[b.index] - demand[a.index]
      })

    for (const c of candidates) {
      if (plannedHours >= contract - 0.5) break

      const opening = OPENING[c.dow]!
      const zaterdag = c.dow === 6

      let from = zaterdag ? opening.from : pattern.usualStart
      let till = zaterdag ? opening.to : pattern.usualEnd
      const pause = zaterdag ? 0 : pattern.usualBreak

      // Binnen de openingstijden blijven
      from = Math.max(from, opening.from)
      till = Math.min(till, opening.to)

      let hours = till - from - pause / 60
      if (hours <= 1) continue

      // Laatste dienst inkorten zodat we niet over het contract heen gaan
      const remaining = contract - plannedHours
      if (hours > remaining) {
        till = from + remaining + pause / 60
        hours = remaining
        if (hours < 3) continue // een dienst van minder dan drie uur is onpraktisch
      }

      const freq = pattern.dayFrequency[(new Date(c.day).getDay() + 6) % 7]
      const reason =
        pattern.sampleSize === 0
          ? 'Nog geen patroon bekend; standaarddienst binnen de openingstijden'
          : freq > 0
            ? `Werkte hier ${freq}× op deze dag in de afgelopen 8 weken`
            : demand[c.index] > 0
              ? `Vult de bezetting aan op een dag met ${demand[c.index]} wasbeurten`
              : 'Aanvulling om de contracturen te halen'

      proposals.push({
        userId: person.id,
        userName: person.name,
        day: c.day,
        startAt: c.day + from * HOUR,
        endAt: c.day + till * HOUR,
        breakMinutes: pause,
        hours: Math.round(hours * 10) / 10,
        reason,
      })

      plannedHours += hours
      alreadyOnDay.add(c.day)
    }
  }

  /* ---- bezettingscontrole per dag ---- */

  for (let i = 0; i < days.length; i++) {
    const day = days[i]
    if (OPENING[new Date(day).getDay()] === null) continue

    const planned = shiftsOnDay(shifts, day).filter((s) => SHIFT_KINDS[s.kind].counts)
    const extra = proposals.filter((p) => p.day === day)
    const capacityHours =
      planned.reduce((a, s) => a + shiftHours(s), 0) + extra.reduce((a, p) => a + p.hours, 0)

    const needed = demand[i] / JOBS_PER_HOUR
    if (demand[i] > 0 && capacityHours < needed * 0.8) {
      const label = new Date(day).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' })
      warnings.push(
        `${label}: ${demand[i]} wasbeurten gepland, maar maar ${Math.round(capacityHours)} manuur beschikbaar ` +
        `(ongeveer ${Math.round(needed)} nodig).`,
      )
    }
  }

  /* ---- samenvatting per persoon ---- */

  const summary = staff
    .filter((u) => (u.contractHours ?? 0) > 0)
    .map((u) => {
      const existing = existingOf(u.id)
      const plannedHours = Math.round(existing.reduce((a, s) => a + shiftHours(s), 0) * 10) / 10
      const proposedHours =
        Math.round(proposals.filter((p) => p.userId === u.id).reduce((a, p) => a + p.hours, 0) * 10) / 10
      const pattern = patterns.get(u.id)!
      const total = plannedHours + proposedHours
      const contract = u.contractHours ?? 0

      let note: string | undefined
      if (pattern.sampleSize === 0) note = 'Nog geen werkpatroon bekend'
      else if (total < contract - 2) note = `Komt ${Math.round((contract - total) * 10) / 10} uur tekort`
      else if (total > contract + 2) note = `Staat ${Math.round((total - contract) * 10) / 10} uur boven contract`

      return {
        userId: u.id,
        userName: u.name,
        contractHours: contract,
        plannedHours,
        proposedHours,
        pattern,
        note,
      }
    })
    .sort((a, b) => a.userName.localeCompare(b.userName))

  return { weekStart: start, proposals, summary, warnings }
}
