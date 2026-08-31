import { create } from 'zustand'

/* ------------------------------------------------------------------ *
 *  Licht en donker
 *
 *  Drie standen, en de derde is de belangrijkste: "volg het systeem". Wie
 *  zijn telefoon 's avonds op donker zet wil dat hier ook, zonder eraan te
 *  denken. Kiest iemand bewust licht of donker, dan blijft dat staan.
 *
 *  De keuze staat op dit apparaat, niet in het dossier. Iemand die overdag
 *  op een lichte werkplek zit en 's avonds in de cabine wil niet dat zijn
 *  keuze meereist naar het andere scherm.
 * ------------------------------------------------------------------ */

export type ThemeKeuze = 'systeem' | 'licht' | 'donker'

export const THEMA_LABELS: Record<ThemeKeuze, { label: string; hint: string }> = {
  systeem: { label: 'Volg het systeem', hint: 'Donker als je telefoon of computer donker staat' },
  licht:   { label: 'Licht',            hint: 'Prettig bij daglicht en op kantoor' },
  donker:  { label: 'Donker',           hint: 'Rustiger in de wasstraat en ’s avonds' },
}

const SLEUTEL = 'tw.thema'
const BEWEGING = 'tw.beweging'

function lees<T extends string>(sleutel: string, geldig: readonly T[], standaard: T): T {
  try {
    const raw = localStorage.getItem(sleutel)
    return geldig.includes(raw as T) ? (raw as T) : standaard
  } catch {
    return standaard
  }
}

function systeemIsDonker(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  } catch {
    return true
  }
}

/** Wat er uiteindelijk op het scherm staat, na het volgen van het systeem. */
export function effectiefThema(keuze: ThemeKeuze): 'licht' | 'donker' {
  if (keuze === 'systeem') return systeemIsDonker() ? 'donker' : 'licht'
  return keuze
}

/* ------------------------------------------------------------------ *
 *  Beweging
 *
 *  Niet iedereen wordt vrolijk van dingen die bewegen, en op een oud
 *  Android-toestel kost het merkbaar. Wie in zijn systeem heeft gezegd dat
 *  hij minder beweging wil, krijgt hier standaard hetzelfde -- maar hij mag
 *  het ook los zetten.
 * ------------------------------------------------------------------ */

export type BewegingKeuze = 'systeem' | 'vol' | 'rustig'

export const BEWEGING_LABELS: Record<BewegingKeuze, { label: string; hint: string }> = {
  systeem: { label: 'Volg het systeem', hint: 'Zoals je het op je apparaat hebt ingesteld' },
  vol:     { label: 'Volledig',         hint: 'Alle overgangen en de wasstraat-animatie' },
  rustig:  { label: 'Rustig',           hint: 'Alleen het hoognodige; scheelt ook accu' },
}

function systeemWilRust(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export function effectieveBeweging(keuze: BewegingKeuze): 'vol' | 'rustig' {
  if (keuze === 'systeem') return systeemWilRust() ? 'rustig' : 'vol'
  return keuze
}

/* ------------------------------------------------------------------ */

interface ThemeStore {
  thema: ThemeKeuze
  beweging: BewegingKeuze
  /** Wat er nu daadwerkelijk staat */
  actief: 'licht' | 'donker'
  rustig: boolean
  setThema: (v: ThemeKeuze) => void
  setBeweging: (v: BewegingKeuze) => void
}

const THEMAS = ['systeem', 'licht', 'donker'] as const
const BEWEGINGEN = ['systeem', 'vol', 'rustig'] as const

const startThema = lees<ThemeKeuze>(SLEUTEL, THEMAS, 'systeem')
const startBeweging = lees<BewegingKeuze>(BEWEGING, BEWEGINGEN, 'systeem')

export const useTheme = create<ThemeStore>((set) => ({
  thema: startThema,
  beweging: startBeweging,
  actief: effectiefThema(startThema),
  rustig: effectieveBeweging(startBeweging) === 'rustig',

  setThema: (v) => {
    try { localStorage.setItem(SLEUTEL, v) } catch { /* privémodus */ }
    const actief = effectiefThema(v)
    pasToe(actief, null)
    set({ thema: v, actief })
  },

  setBeweging: (v) => {
    try { localStorage.setItem(BEWEGING, v) } catch { /* privémodus */ }
    const rustig = effectieveBeweging(v) === 'rustig'
    pasToe(null, rustig)
    set({ beweging: v, rustig })
  },
}))

/**
 * Zet de keuze op het document.
 *
 * Twee kenmerken op <html>, zodat de CSS het kan zien en er in JavaScript
 * niets herberekend hoeft te worden bij elke render.
 */
function pasToe(thema: 'licht' | 'donker' | null, rustig: boolean | null) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (thema) {
    el.setAttribute('data-thema', thema)
    el.style.colorScheme = thema === 'donker' ? 'dark' : 'light'
  }
  if (rustig !== null) {
    el.setAttribute('data-beweging', rustig ? 'rustig' : 'vol')
  }
}

/**
 * Eén keer bij het opstarten aanroepen. Zet de opgeslagen keuze door en
 * luistert daarna of het systeem van stand wisselt.
 */
export function startThemaMotor() {
  if (typeof window === 'undefined') return

  const s = useTheme.getState()
  pasToe(effectiefThema(s.thema), effectieveBeweging(s.beweging) === 'rustig')

  const volgen = (query: string, bij: () => void) => {
    try {
      const mq = window.matchMedia(query)
      // Safari kende addEventListener op media-queries lang niet.
      if (mq.addEventListener) mq.addEventListener('change', bij)
      else mq.addListener?.(bij)
    } catch { /* geen matchMedia: dan blijft de keuze gewoon staan */ }
  }

  volgen('(prefers-color-scheme: dark)', () => {
    const { thema } = useTheme.getState()
    if (thema !== 'systeem') return
    const actief = effectiefThema(thema)
    pasToe(actief, null)
    useTheme.setState({ actief })
  })

  volgen('(prefers-reduced-motion: reduce)', () => {
    const { beweging } = useTheme.getState()
    if (beweging !== 'systeem') return
    const rustig = effectieveBeweging(beweging) === 'rustig'
    pasToe(null, rustig)
    useTheme.setState({ rustig })
  })
}

/** Handig in componenten: mag dit bewegen? */
export function useBeweegt(): boolean {
  return !useTheme((s) => s.rustig)
}
