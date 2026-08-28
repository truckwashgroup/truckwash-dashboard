import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { Building2, Check, ChevronDown, Globe, Search } from 'lucide-react'
import { db } from '../lib/db'
import type { Location } from '../lib/types'
import { useAuth } from '../store/useAuth'
import { scopeLabel, seesAllLocations, useLocationFilter, visibleLocations } from '../lib/locations'

/* ------------------------------------------------------------------ *
 *  Welke vestiging bekijk je?
 *
 *  Met negentien vestigingen plus het hoofdkantoor is een uitklaplijst met
 *  een zoekveld prettiger dan een rij knoppen. Wie maar bij één vestiging
 *  hoort, ziet alleen de naam -- geen keuze die er niet is.
 * ------------------------------------------------------------------ */

export default function LocationSwitcher() {
  const user = useAuth((s) => s.user)
  const { current, setCurrent } = useLocationFilter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const btnRef = useRef<HTMLButtonElement>(null)
  const all = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mine = visibleLocations(user, all.filter((l) => l.active))

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - 320)) })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  // Hoort iemand bij precies één vestiging, dan valt er niets te kiezen.
  if (mine.length <= 1) {
    return mine.length === 1 ? (
      <span className="loc-static" title={mine[0].address + ', ' + mine[0].city}>
        <Building2 size={14} />
        {mine[0].name}
      </span>
    ) : null
  }

  const needle = query.trim().toLowerCase()
  const gefilterd = needle
    ? mine.filter((l) =>
        l.name.toLowerCase().includes(needle) ||
        l.city.toLowerCase().includes(needle) ||
        l.code.toLowerCase().includes(needle))
    : mine

  return (
    <>
      <button
        ref={btnRef}
        className={`loc-trigger ${current ? 'picked' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Kies een vestiging"
      >
        {current ? <Building2 size={14} /> : <Globe size={14} />}
        <span className="label">{scopeLabel(user, all, current)}</span>
        <ChevronDown size={14} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="loc-layer"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: .12 }}
              onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
            >
              <motion.div
                className="loc-panel"
                style={{ top: pos.top, left: pos.left }}
                initial={{ opacity: 0, y: -8, scale: .98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: .98 }}
                transition={{ duration: .14 }}
              >
                <div className="loc-search">
                  <Search size={14} color="var(--text-3)" />
                  <input
                    autoFocus
                    value={query}
                    maxLength={40}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Zoek een vestiging"
                  />
                </div>

                <div className="loc-list">
                  {seesAllLocations(user) && (
                    <button
                      className={`loc-item ${!current ? 'active' : ''}`}
                      onClick={() => { setCurrent(null); setOpen(false) }}
                    >
                      <Globe size={15} />
                      <span className="who">
                        <span className="n">Alle vestigingen</span>
                        <span className="s">{mine.length} locaties samengeteld</span>
                      </span>
                      {!current && <Check size={15} />}
                    </button>
                  )}

                  {gefilterd.map((l) => (
                    <button
                      key={l.id}
                      className={`loc-item ${current === l.id ? 'active' : ''}`}
                      onClick={() => { setCurrent(l.id); setOpen(false) }}
                    >
                      <Building2 size={15} />
                      <span className="who">
                        <span className="n">
                          {l.name}
                          {l.kind === 'hoofdkantoor' && <span className="hk">hoofdkantoor</span>}
                        </span>
                        <span className="s">{l.code} · {l.city}</span>
                      </span>
                      {current === l.id && <Check size={15} />}
                    </button>
                  ))}

                  {gefilterd.length === 0 && (
                    <div className="loc-empty">Geen vestiging gevonden voor “{query}”</div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
