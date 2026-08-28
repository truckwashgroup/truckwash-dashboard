import { useEffect } from 'react'
import { create } from 'zustand'
import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { effectivePermissions } from '../lib/permissions'
import type { Permission } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Navigatie tussen schermen
 *
 *  De zoekbalk en de meldingen moeten naar een pagina kunnen springen die
 *  ergens anders in de app staat. Dat loopt via dit kleine winkeltje: wie
 *  wil navigeren zet een doel, en het dashboard dat die pagina kent pakt hem op.
 * ------------------------------------------------------------------ */

interface NavStore {
  target: { page: string; query?: string; id?: string } | null
  goto: (page: string, extra?: { query?: string; id?: string }) => void
  consume: () => void

  /** Vraagt het zoekpaneel te openen, eventueel meteen luisterend. */
  searchRequest: { voice: boolean; nonce: number } | null
  openSearch: (voice?: boolean) => void
  clearSearchRequest: () => void
}

let nonce = 0

export const useNav = create<NavStore>((set) => ({
  target: null,
  goto: (page, extra) => set({ target: { page, ...extra } }),
  consume: () => set({ target: null }),

  searchRequest: null,
  openSearch: (voice = false) => set({ searchRequest: { voice, nonce: ++nonce } }),
  clearSearchRequest: () => set({ searchRequest: null }),
}))

/**
 * Laat een dashboard reageren op een navigatieverzoek voor zijn eigen pagina's.
 */
export function useNavTarget(pages: string[], onGo: (page: string, id?: string) => void) {
  const target = useNav((s) => s.target)
  const consume = useNav((s) => s.consume)

  useEffect(() => {
    if (!target) return
    if (!pages.includes(target.page)) return
    onGo(target.page, target.id)
    consume()
    // onGo verandert elke render; alleen op het doel reageren is hier juist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
}

/* ------------------------------------------------------------------ *
 *  Rechten in de UI
 * ------------------------------------------------------------------ */

export function usePerms() {
  const user = useAuth((s) => s.user)
  return useMemo(() => {
    const set = effectivePermissions(user)
    return {
      set,
      can: (p: Permission) => set.has(p),
      canAny: (...ps: Permission[]) => ps.some((p) => set.has(p)),
      canAll: (...ps: Permission[]) => ps.every((p) => set.has(p)),
    }
  }, [user])
}
