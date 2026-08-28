import { SHIFT_KINDS, type Shift } from './types'

const DAY = 86_400_000

/** Maandag 00:00 van de week waarin `ts` valt. */
export function weekStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // maandag = 0
  return d.getTime() - dow * DAY
}

export function weekNumber(ts: number): number {
  // ISO-8601: week 1 bevat de eerste donderdag van het jaar
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY))
}

export function weekDays(start: number): number[] {
  return Array.from({ length: 7 }, (_, i) => start + i * DAY)
}

export const DAY_LABELS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

/** Netto gewerkte uren van één dienst, pauze eraf. */
export function shiftHours(shift: Shift): number {
  if (!SHIFT_KINDS[shift.kind].counts) return 0
  const gross = (shift.endAt - shift.startAt) / 3_600_000
  return Math.max(0, gross - (shift.breakMinutes ?? 0) / 60)
}

export function totalHours(shifts: Shift[]): number {
  return Math.round(shifts.reduce((a, s) => a + shiftHours(s), 0) * 10) / 10
}

/** Diensten van een dag, op begintijd gesorteerd. */
export function shiftsOnDay(shifts: Shift[], day: number): Shift[] {
  const end = day + DAY
  return shifts
    .filter((s) => s.startAt >= day && s.startAt < end)
    .sort((a, b) => a.startAt - b.startAt)
}

/** "07:00 - 15:30" */
export function shiftRange(shift: Shift): string {
  const f = (ts: number) =>
    new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return `${f(shift.startAt)} - ${f(shift.endAt)}`
}

/**
 * Uren en tijden van een dienst omzetten naar de waarden die een
 * <input type="time"> verwacht, en weer terug.
 */
export function toTimeInput(ts: number): string {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export function fromTimeInput(day: number, value: string): number {
  const [h, m] = value.split(':').map(Number)
  return day + (h || 0) * 3_600_000 + (m || 0) * 60_000
}

export function dateInputValue(ts: number): string {
  const d = new Date(ts)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

export function dayFromDateInput(value: string): number {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime()
}
