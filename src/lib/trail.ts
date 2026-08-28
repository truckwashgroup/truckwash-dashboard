import type { TrailEntry } from './types'

/* ------------------------------------------------------------------ *
 *  Wat deed iemand het afgelopen kwartier?
 *
 *  Een melding als "hij doet het niet" is voor een ontwikkelaar bijna
 *  onbruikbaar. Wat wél helpt: welke schermen iemand langsging, welke acties
 *  hij deed, en welke fouten er ondertussen langskwamen.
 *
 *  Dat houden we bij in een ring in het geheugen -- niets gaat naar de server
 *  tenzij er daadwerkelijk een melding wordt gemaakt. Het spoor verdwijnt bij
 *  het sluiten van de app.
 *
 *  Wat er níét in komt: wachtwoorden, invoervelden en gegevens van klanten.
 *  Alleen wat er gebeurde, niet wat er stond.
 * ------------------------------------------------------------------ */

const WINDOW_MS = 15 * 60 * 1000
const MAX_ENTRIES = 200

const ring: TrailEntry[] = []

function push(kind: TrailEntry['kind'], text: string) {
  const at = Date.now()
  const laatste = ring[ring.length - 1]

  // Dezelfde regel twee keer achter elkaar voegt niets toe
  if (laatste && laatste.kind === kind && laatste.text === text && at - laatste.at < 2000) {
    return
  }

  ring.push({ at, kind, text: text.slice(0, 200) })
  if (ring.length > MAX_ENTRIES) ring.shift()
}

export const trail = {
  /** Een schermwissel. */
  page(dashboard: string, page: string) {
    push('pagina', `${dashboard} → ${page}`)
  },

  /** Een handeling: opslaan, afmelden, toewijzen. */
  action(text: string) {
    push('actie', text)
  },

  /** Iets ging mis. */
  error(text: string) {
    push('fout', text)
  },

  /** Synchronisatie: verbinding weg, wachtrij, mislukte poging. */
  sync(text: string) {
    push('sync', text)
  },

  /** Het spoor van de laatste vijftien minuten, oud naar nieuw. */
  recent(): TrailEntry[] {
    const grens = Date.now() - WINDOW_MS
    return ring.filter((e) => e.at >= grens)
  },

  clear() {
    ring.length = 0
  },
}

/* ------------------------------------------------------------------ *
 *  Fouten opvangen
 *
 *  Alles wat de app aan fouten produceert komt hier langs: onafgevangen
 *  uitzonderingen, mislukte beloftes en wat er naar de console wordt
 *  geschreven. De ontwikkelaar ziet ze terug in het logboek.
 * ------------------------------------------------------------------ */

export interface CapturedError {
  level: 'fout' | 'waarschuwing'
  message: string
  stack?: string
}

type Sink = (e: CapturedError) => void

let sink: Sink | null = null
let installed = false

export function onCapturedError(fn: Sink) {
  sink = fn
}

function report(level: CapturedError['level'], message: string, stack?: string) {
  const schoon = message.trim().slice(0, 500)
  if (!schoon) return
  trail.error(schoon.slice(0, 120))
  sink?.({ level, message: schoon, stack: stack?.slice(0, 2000) })
}

/**
 * Zet het opvangen aan. Eén keer, bij het opstarten.
 *
 * De originele console blijft gewoon werken: we kijken alleen mee. Anders
 * zou je tijdens het ontwikkelen je eigen meldingen kwijtraken.
 */
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (e) => {
    report('fout', e.message || 'Onbekende fout', e.error?.stack)
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reden = e.reason
    report(
      'fout',
      reden instanceof Error ? reden.message : String(reden ?? 'Belofte afgewezen'),
      reden instanceof Error ? reden.stack : undefined,
    )
  })

  const origError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    origError(...args)
    report('fout', args.map(tekst).join(' '))
  }

  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    report('waarschuwing', args.map(tekst).join(' '))
  }
}

function tekst(v: unknown): string {
  if (v instanceof Error) return v.message
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)?.slice(0, 200) ?? String(v)
  } catch {
    return String(v)
  }
}

/* ------------------------------------------------------------------ *
 *  Gegevens van het apparaat
 * ------------------------------------------------------------------ */

export function deviceInfo() {
  // Dit draait ook in een webview, in Electron en in de tests. Nergens van
  // uitgaan dat een eigenschap bestaat: een melding mag nooit stuklopen op
  // het verzamelen van de gegevens die eromheen zitten.
  const w = typeof window !== 'undefined' ? window : undefined
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : ''

  const platform =
    w?.desktop?.isElectron ? 'Windows (app)' :
    /android/i.test(ua) ? 'Android' :
    /iphone|ipad/i.test(ua) ? 'iOS' :
    ua ? 'Web' : 'Onbekend'

  const scherm = w?.screen
  return {
    platform,
    userAgent: ua.slice(0, 300),
    screen: scherm
      ? `${scherm.width ?? 0}x${scherm.height ?? 0} @${w?.devicePixelRatio ?? 1}x`
      : '-',
  }
}
