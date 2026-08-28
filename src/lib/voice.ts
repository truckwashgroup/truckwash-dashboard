/* ------------------------------------------------------------------ *
 *  Spraakherkenning
 *
 *  Gebruikt de Web Speech API, die in Chrome, Edge en de Electron-app
 *  beschikbaar is, en op Android in de systeem-webview. Ontbreekt hij, dan
 *  verdwijnt de microfoonknop gewoon -- de zoekbalk werkt zonder net zo goed.
 *
 *  Spraak wordt uitsluitend als zoektekst gebruikt. Er wordt niets uitgevoerd
 *  op basis van wat er gezegd is zonder dat je het resultaat ziet.
 * ------------------------------------------------------------------ */

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

function ctor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type VoiceAvailability = 'beschikbaar' | 'desktop-app' | 'niet-ondersteund'

/**
 * Waarom dit meer is dan ja of nee:
 *
 * De Electron-app heeft wel het object voor spraakherkenning, maar niet de
 * dienst erachter -- die zit in Chrome zelf en mag niet worden meegeleverd.
 * De knop zou het daar dus altijd begeven met een netwerkfout. Beter om dat
 * eerlijk te zeggen dan een knop te tonen die niets doet.
 */
export function voiceAvailability(): VoiceAvailability {
  if (typeof window !== 'undefined' && (window as any).desktop?.isElectron) {
    return 'desktop-app'
  }
  return ctor() ? 'beschikbaar' : 'niet-ondersteund'
}

export const voiceSupported = () => voiceAvailability() === 'beschikbaar'

export const voiceUnavailableReason = (): string => {
  const state = voiceAvailability()
  if (state === 'desktop-app') {
    return 'Spraakherkenning zit in de browser, niet in de Windows-app. ' +
           'Open het dashboard in Chrome of Edge, of gebruik de app op je telefoon.'
  }
  return 'Deze browser ondersteunt spraakherkenning niet. Chrome of Edge werkt wel.'
}

export interface VoiceSession {
  stop: () => void
}

/**
 * Luistert één zin lang mee.
 *
 * onPartial krijgt de tekst terwijl er gesproken wordt, onFinal de definitieve
 * zin. onError krijgt een korte, uitlegbare melding.
 */
export function listenOnce(opts: {
  onPartial?: (text: string) => void
  onFinal: (text: string) => void
  onError?: (message: string) => void
  onEnd?: () => void
  lang?: string
}): VoiceSession | null {
  const Ctor = ctor()
  if (!Ctor) {
    opts.onError?.('Spraakherkenning wordt hier niet ondersteund.')
    return null
  }

  const rec = new Ctor()
  rec.lang = opts.lang ?? 'nl-NL'
  rec.continuous = false
  rec.interimResults = true
  rec.maxAlternatives = 1

  rec.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      const text = String(result[0]?.transcript ?? '').trim()
      if (result.isFinal) {
        if (text) opts.onFinal(text)
        return
      }
      interim += text
    }
    if (interim) opts.onPartial?.(interim)
  }

  rec.onerror = (e: any) => {
    const code = String(e?.error ?? '')
    const message =
      code === 'not-allowed' || code === 'service-not-allowed'
        ? 'Geen toegang tot de microfoon. Sta dat toe in de instellingen.'
        : code === 'no-speech'
          ? 'Niets verstaan. Probeer het nog eens.'
          : code === 'network'
            ? 'Spraakherkenning heeft internet nodig.'
            : 'Spraakherkenning werkte even niet.'
    opts.onError?.(message)
  }

  rec.onend = () => opts.onEnd?.()

  try {
    rec.start()
  } catch {
    opts.onError?.('De microfoon is al in gebruik.')
    return null
  }

  return { stop: () => { try { rec.stop() } catch { /* al gestopt */ } } }
}

/* ------------------------------------------------------------------ *
 *  Gesproken zoekopdrachten opschonen
 * ------------------------------------------------------------------ */

const FILLERS = [
  'zoek naar', 'zoek op', 'zoek', 'laat me', 'laat zien', 'toon me', 'toon',
  'open', 'ga naar', 'ik wil', 'geef me', 'geef',
]

/**
 * Haalt aanloopwoorden weg en maakt van uitgesproken kentekens weer een
 * kenteken: "twaalf b n d vier" blijft lastig, maar "12 b n d 4" wordt
 * "12-BND-4".
 */
export function cleanSpokenQuery(raw: string): string {
  let text = raw.trim().toLowerCase()

  for (const f of FILLERS) {
    if (text.startsWith(f + ' ')) {
      text = text.slice(f.length + 1)
      break
    }
  }

  text = text.replace(/[.?!,]+$/g, '').trim()

  // Losse letters en cijfers aan elkaar: "1 2 b n d 4" -> "12bnd4"
  const compact = text.replace(/\s+/g, '')
  const looksLikePlate = /^[a-z0-9]{6,8}$/.test(compact)
  if (looksLikePlate) {
    const groups = compact.match(/\d+|[a-z]+/g) ?? []
    if (groups.length >= 2) return groups.join('-').toUpperCase()
  }

  return text
}
