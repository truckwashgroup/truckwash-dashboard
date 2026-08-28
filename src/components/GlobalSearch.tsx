import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Building2, CalendarRange, GraduationCap, Loader2, Mic, MicOff,
  Package, Search, Truck, Users, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { SERVICES } from '../lib/types'
import { money, time } from '../lib/format'
import { usePerms, useNav } from '../store/useNav'
import { cleanSpokenQuery, listenOnce, voiceSupported, type VoiceSession } from '../lib/voice'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Zoeken door de hele app
 *
 *  Veiligheid: er wordt niets uitgevoerd wat een gebruiker typt. De zoekterm
 *  gaat als gewone tekst naar een vergelijking op de lokale database -- geen
 *  query-taal, geen reguliere expressie uit invoer, geen HTML. React zet
 *  tekst altijd als tekst neer, dus scripts in een zoekterm of in een
 *  klantnaam blijven letterlijk zichtbaar in plaats van uitgevoerd te worden.
 *
 *  Verder een lengtelimiet en een wachttijd, zodat niemand met een enorme
 *  invoer de app kan laten vastlopen.
 * ------------------------------------------------------------------ */

const MAX_QUERY = 64
const MAX_PER_GROUP = 5
const DEBOUNCE_MS = 180

type Hit = {
  id: string
  group: string
  icon: typeof Truck
  title: string
  subtitle: string
  right?: string
  page: string
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const [listening, setListening] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const session = useRef<VoiceSession | null>(null)

  const perms = usePerms()
  const goto = useNav((s) => s.goto)

  /* ---- openen met Ctrl+K, sluiten met Escape ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40)
    else {
      setQuery('')
      setHits([])
      stopListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* ---- wachten tot het typen even stilvalt ---- */
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  /* ---- zoeken ---- */
  useEffect(() => {
    let cancelled = false
    const needle = debounced.toLowerCase()

    if (needle.length < 2) {
      setHits([])
      setBusy(false)
      return
    }

    setBusy(true)
    ;(async () => {
      const found: Hit[] = []
      const has = (value: unknown) => String(value ?? '').toLowerCase().includes(needle)

      if (perms.can('jobs.view')) {
        const jobs = await db.washJobs.toArray()
        for (const j of jobs) {
          if (has(j.plate) || has(j.ticket) || has(j.companyName)) {
            found.push({
              id: 'job:' + j.id,
              group: 'Wasbeurten',
              icon: Truck,
              title: j.plate,
              subtitle: `${j.companyName} · ${SERVICES[j.service].label} · ${j.status}`,
              right: time(j.scheduledAt),
              page: perms.can('planning.view') ? 'planning' : 'vandaag',
            })
            if (found.filter((h) => h.group === 'Wasbeurten').length >= MAX_PER_GROUP) break
          }
        }
      }

      if (perms.can('customers.view')) {
        const companies = await db.companies.toArray()
        for (const c of companies) {
          if (has(c.name) || has(c.city) || has(c.contact)) {
            found.push({
              id: 'co:' + c.id,
              group: 'Klanten',
              icon: Building2,
              title: c.name,
              subtitle: `${c.contact} · ${c.city}`,
              right: c.contractDiscountPct ? `${c.contractDiscountPct}% korting` : undefined,
              page: 'klanten',
            })
            if (found.filter((h) => h.group === 'Klanten').length >= MAX_PER_GROUP) break
          }
        }
      }

      if (perms.can('staff.view')) {
        const users = await db.users.toArray()
        for (const u of users) {
          if (has(u.name) || has(u.email) || has(u.personnelNumber) || has(u.function)) {
            found.push({
              id: 'user:' + u.id,
              group: 'Medewerkers',
              icon: Users,
              title: u.name,
              subtitle: [u.personnelNumber, u.function].filter(Boolean).join(' · ') || u.email,
              page: 'personeel',
            })
            if (found.filter((h) => h.group === 'Medewerkers').length >= MAX_PER_GROUP) break
          }
        }
      }

      if (perms.can('inventory.view')) {
        const items = await db.inventory.toArray()
        for (const i of items) {
          if (has(i.name) || has(i.supplier)) {
            found.push({
              id: 'inv:' + i.id,
              group: 'Voorraad',
              icon: Package,
              title: i.name,
              subtitle: `${i.supplier} · ${i.stock} ${i.unit} op voorraad`,
              right: money(i.pricePerUnit),
              page: 'materiaal',
            })
            if (found.filter((h) => h.group === 'Voorraad').length >= MAX_PER_GROUP) break
          }
        }
      }

      if (perms.can('learning.take')) {
        const courses = await db.courses.toArray()
        for (const c of courses) {
          if (has(c.title) || has(c.summary) || has(c.code)) {
            found.push({
              id: 'crs:' + c.id,
              group: 'Cursussen',
              icon: GraduationCap,
              title: c.title,
              subtitle: `${c.code} · ${c.estimatedMinutes} min`,
              page: 'opleiding',
            })
            if (found.filter((h) => h.group === 'Cursussen').length >= MAX_PER_GROUP) break
          }
        }
      }

      if (!cancelled) {
        setHits(found)
        setActive(0)
        setBusy(false)
      }
    })()

    return () => { cancelled = true }
  }, [debounced, perms])

  const grouped = useMemo(() => {
    const map = new Map<string, Hit[]>()
    for (const h of hits) {
      const list = map.get(h.group) ?? []
      list.push(h)
      map.set(h.group, list)
    }
    return [...map.entries()]
  }, [hits])

  /* ---- spraak ---- */

  function stopListening() {
    session.current?.stop()
    session.current = null
    setListening(false)
  }

  function startListening() {
    if (listening) return stopListening()
    setListening(true)
    session.current = listenOnce({
      onPartial: (text) => setQuery(text.slice(0, MAX_QUERY)),
      onFinal: (text) => {
        const cleaned = cleanSpokenQuery(text).slice(0, MAX_QUERY)
        setQuery(cleaned)
        setDebounced(cleaned)
      },
      onError: (message) => { toast.warn(message); stopListening() },
      onEnd: () => setListening(false),
    })
    if (!session.current) setListening(false)
  }

  function pick(hit: Hit) {
    goto(hit.page, { query: debounced, id: hit.id.split(':')[1] })
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]) }
  }

  let index = -1

  return (
    <>
      <button className="search-trigger" onClick={() => setOpen(true)} title="Zoeken (Ctrl+K)">
        <Search size={15} />
        <span className="label">Zoeken…</span>
        <kbd>Ctrl K</kbd>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="search-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
            >
              <motion.div
                className="search-panel"
                initial={{ opacity: 0, y: -14, scale: .98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: .98 }}
                transition={{ duration: .16 }}
              >
                <div className="search-input-row">
                  <Search size={17} color="var(--text-3)" />
                  <input
                    ref={inputRef}
                    value={query}
                    maxLength={MAX_QUERY}
                    onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY))}
                    onKeyDown={onKeyDown}
                    placeholder="Kenteken, klant, medewerker, artikel of cursus"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {busy && <Loader2 size={15} className="spin" color="var(--text-3)" />}
                  {voiceSupported() && (
                    <button
                      className={`search-mic ${listening ? 'on' : ''}`}
                      onClick={startListening}
                      title={listening ? 'Stoppen met luisteren' : 'Zoeken met je stem'}
                    >
                      {listening ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => setOpen(false)}>
                    <X size={15} />
                  </button>
                </div>

                {listening && (
                  <div className="search-listening">
                    <span className="pulse" /> Luisteren… zeg bijvoorbeeld “zoek 12-BND-4”
                  </div>
                )}

                <div className="search-results">
                  {debounced.length >= 2 && hits.length === 0 && !busy && (
                    <div className="search-empty">
                      Niets gevonden voor <strong>{debounced}</strong>
                    </div>
                  )}

                  {debounced.length < 2 && !listening && (
                    <div className="search-hint">
                      <div><CalendarRange size={14} /> Typ minstens twee tekens</div>
                      <div>Doorzoekt alleen waar jij bij mag</div>
                    </div>
                  )}

                  {grouped.map(([group, items]) => (
                    <div key={group} className="search-group">
                      <div className="search-group-head">{group}</div>
                      {items.map((h) => {
                        index++
                        const isActive = index === active
                        const Icon = h.icon
                        return (
                          <button
                            key={h.id}
                            className={`search-hit ${isActive ? 'active' : ''}`}
                            onMouseEnter={() => setActive(hits.indexOf(h))}
                            onClick={() => pick(h)}
                          >
                            <Icon size={16} />
                            <div className="text">
                              <div className="t">{h.title}</div>
                              <div className="s">{h.subtitle}</div>
                            </div>
                            {h.right && <span className="r mono">{h.right}</span>}
                          </button>
                        )
                      })}
                    </div>
                  ))}
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
