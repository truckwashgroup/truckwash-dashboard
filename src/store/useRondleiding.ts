import { create } from 'zustand'
import type { Role } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  De rondleiding opnieuw opvragen
 *
 *  Een klein winkeltje, want de knop staat in het menu rechtsboven en het
 *  scherm hangt aan de wortel van de app. Die twee kennen elkaar niet, en
 *  dat hoeven ze ook niet.
 * ------------------------------------------------------------------ */

interface RondleidingStore {
  /** Welke rondleiding er nu is opgevraagd; null is geen. */
  rol: Role | null
  start: (rol: Role) => void
  stop: () => void
}

export const useRondleiding = create<RondleidingStore>((set) => ({
  rol: null,
  start: (rol) => set({ rol }),
  stop: () => set({ rol: null }),
}))
