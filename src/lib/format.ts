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

/**
 * Draagt dit tijdstip een tijd, of is het alleen een datum?
 *
 * Twee soorten momenten komen door elkaar in dezelfde velden terecht. Een
 * factuurdatum komt van een stuk papier en heeft geen tijd: de lezer maakt
 * hem met Date.UTC(jaar, maand, dag), dus precies middernacht UTC. Een
 * moment waarop iets gebeurde -- post die binnenkomt, een bon die wordt
 * afgetekend -- is Date.now() en valt daar vrijwel nooit op.
 *
 * Dat verschil is precies wat je wil laten zien. "21 mrt 01:00" bij een
 * factuurdatum is geen extra informatie maar een verzinsel (en in de zomer
 * een uur ernaast); "4 sep 09:12" bij binnengekomen post is juist het enige
 * wat je wil weten.
 */
export const heeftTijd = (ts: number) => Number.isFinite(ts) && ts % 86_400_000 !== 0

/**
 * Datum, met de tijd erbij als die er is.
 *
 * Voor kolommen waar allebei de soorten in staan: een bon die net per mail
 * binnenkwam toont het moment, en zodra de factuurdatum eruit gelezen is
 * alleen de datum.
 */
export const datumMisschienTijd = (ts: number) => heeftTijd(ts) ? dateTime(ts) : dateShort(ts)

export function duration(ms: number) {
  const min = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? h + 'u ' + String(m).padStart(2, '0') + 'm' : m + 'm'
}

/**
 * Hoe lang geleden iets was.
 *
 * Het tweede argument bestaat alleen voor de controles. Zonder dat kan een
 * test die "30 min geleden" verwacht omvallen omdat de klok tijdens het
 * draaien net over een afrondingsgrens tikt -- en een controle die af en toe
 * omvalt zonder dat er iets mis is, is erger dan geen controle: die leer je
 * negeren.
 */
export function relative(ts: number, nu = Date.now()) {
  const diff = nu - ts
  // Een tijdstip dat nog moet komen hoort hier niet; die zou anders stil
  // "zojuist" opleveren. Zie nogGeldig() hieronder.
  if (diff < 0) return binnenkort(-diff)
  if (diff < 60_000) return 'zojuist'
  if (diff < 3_600_000) return Math.round(diff / 60_000) + ' min geleden'
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' uur geleden'
  return dagen(diff / 86_400_000) + ' geleden'
}

/** "1 dag" of "6 dagen" -- er stond overal "1 dagen". */
function dagen(n: number) {
  const afgerond = Math.round(n)
  return afgerond + (afgerond === 1 ? ' dag' : ' dagen')
}

/** "over 12 min", "over 3 uur", "over 6 dagen" */
function binnenkort(ms: number) {
  if (ms < 60_000) return 'zo meteen'
  if (ms < 3_600_000) return 'over ' + Math.round(ms / 60_000) + ' min'
  if (ms < 86_400_000) return 'over ' + Math.round(ms / 3_600_000) + ' uur'
  return 'over ' + dagen(ms / 86_400_000)
}

/**
 * Hoe lang iets nog geldig is.
 *
 * Bestaat apart omdat relative() achteruit kijkt: die rekent uit hoe lang
 * geleden iets was. Een koppelcode die nog een week meegaat kwam daar als
 * "zojuist" uit -- niet fout gerekend, wel het tegenovergestelde van wat er
 * aan de hand was. Wie dat leest maakt een nieuwe code, en dan staan er twee.
 */
export function nogGeldig(tot: number, nu = Date.now()) {
  return tot <= nu ? 'verlopen' : binnenkort(tot - nu)
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
