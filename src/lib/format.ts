const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const eur0 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('nl-NL')

export const money = (n: number) => eur.format(n || 0)
export const moneyShort = (n: number) => eur0.format(n || 0)
export const number = (n: number) => num.format(n || 0)
export const pct = (n: number) => (n >= 0 ? '+' : '') + (Math.round(n * 10) / 10).toFixed(1) + '%'

export const dateShort = (ts: number) =>
  new Date(ts).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })

export const dateFull = (ts: number) =>
  new Date(ts).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

export const time = (ts: number) =>
  new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

export const dateTime = (ts: number) => dateShort(ts) + ' ' + time(ts)

export function duration(ms: number) {
  const min = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? h + 'u ' + String(m).padStart(2, '0') + 'm' : m + 'm'
}

export function relative(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'zojuist'
  if (diff < 3_600_000) return Math.round(diff / 60_000) + ' min geleden'
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' uur geleden'
  return Math.round(diff / 86_400_000) + ' dagen geleden'
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
