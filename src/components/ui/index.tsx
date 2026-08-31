import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Inbox, X } from 'lucide-react'

/* ---------------------------- Card ------------------------------- */

export function Card({
  title, hint, action, children, className = '', flush = false,
}: {
  title?: string
  hint?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <div className={`card ${flush ? 'pad-0' : ''} ${className}`}>
      {(title || action) && (
        <div className="card-head" style={flush ? { padding: '16px 16px 0' } : undefined}>
          {title && <h3>{title}</h3>}
          {hint && <span className="hint">{hint}</span>}
          <span className="spacer" />
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

/* ---------------------------- Stat ------------------------------- */

export function Stat({
  label, value, delta, icon, tone,
}: {
  label: string
  value: ReactNode
  delta?: { text: string; dir: 'up' | 'down' | 'flat' }
  icon?: ReactNode
  tone?: 'brand' | 'ok' | 'warn' | 'danger'
}) {
  const color =
    tone === 'ok' ? 'var(--ok)' :
    tone === 'warn' ? 'var(--warn)' :
    tone === 'danger' ? 'var(--danger)' : 'var(--brand)'

  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${delta.dir}`}>{delta.text}</div>}
      {icon && <div className="glyph" style={{ color }}>{icon}</div>}
    </div>
  )
}

/* ---------------------------- Badge ------------------------------ */

export function Badge({
  children, tone = 'default', dot = false,
}: {
  children: ReactNode
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'
  dot?: boolean
}) {
  return (
    <span className={`badge ${tone === 'default' ? '' : tone} ${dot ? 'dot' : ''}`}>
      {children}
    </span>
  )
}

/* ---------------------------- Modal ------------------------------ */

export function Modal({
  open, title, subtitle, onClose, children, width,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="modal"
            style={width ? { width: `min(${width}px, 100%)` } : undefined}
            initial={{ opacity: 0, y: 22, scale: .97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: .98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, mass: .8 }}
          >
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2>{title}</h2>
                {subtitle && <p className="sub">{subtitle}</p>}
              </div>
              <button className="btn ghost sm" onClick={onClose} aria-label="Sluiten">
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* --------------------------- Leegstand --------------------------- */

export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div>{icon ?? <Inbox size={30} />}</div>
      {text}
    </div>
  )
}

/* ---------------------------- Bar -------------------------------- */

export function Bar({ value, max, tone }: { value: number; max: number; tone?: 'warn' | 'danger' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={`bar ${tone ?? ''}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/* ---------------------------- Field ------------------------------ */

export function Field({
  label, help, children,
}: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  )
}

/* --------------------------- Dropdown ---------------------------- */

export interface MenuItem {
  key: string
  label: string
  hint?: string
  icon?: ReactNode
  onClick: () => void
  tone?: 'danger'
  badge?: number
  disabled?: boolean
}

export interface MenuGroup {
  /** Kopje boven de groep; leeg laten mag */
  title?: string
  items: MenuItem[]
}

/**
 * Een menu onder een knop.
 *
 * Waarom dit er is: de balk bovenin liep vol met losse knopjes die alleen
 * met een icoontje uitlegden wat ze deden. Onder één knop met leesbare regels
 * eronder is het compacter én duidelijker.
 *
 * Sluit bij een klik ernaast, bij Escape, en na het kiezen van een regel.
 */
export function Dropdown({
  label, icon, items, align = 'right', title, className = '',
}: {
  label?: ReactNode
  icon: ReactNode
  items: MenuGroup[]
  align?: 'left' | 'right'
  title?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const zichtbaar = items
    .map((g) => ({ ...g, items: g.items.filter(Boolean) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className={`menu-wrap ${className}`}>
      <button
        className={`menu-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
        {label && <span className="label">{label}</span>}
        <ChevronDown size={14} className="pijl" />
      </button>

      {open && (
        <>
          <div className="menu-layer" onClick={() => setOpen(false)} />
          <motion.div
            className={`menu-panel ${align}`}
            initial={{ opacity: 0, y: -6, scale: .97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: .14, ease: [.22, .61, .36, 1] }}
            role="menu"
          >
            {zichtbaar.map((g, gi) => (
              <div key={g.title ?? gi} className="menu-group">
                {g.title && <div className="menu-group-head">{g.title}</div>}
                {g.items.map((it) => (
                  <button
                    key={it.key}
                    className={`menu-item ${it.tone === 'danger' ? 'danger' : ''}`}
                    disabled={it.disabled}
                    onClick={() => { setOpen(false); it.onClick() }}
                    role="menuitem"
                  >
                    {it.icon && <span className="ico">{it.icon}</span>}
                    <span className="tekst">
                      <strong>{it.label}</strong>
                      {it.hint && <span>{it.hint}</span>}
                    </span>
                    {!!it.badge && <span className="badge brand">{it.badge}</span>}
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        </>
      )}
    </div>
  )
}
