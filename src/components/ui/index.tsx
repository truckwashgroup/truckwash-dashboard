import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Inbox, X } from 'lucide-react'

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
            initial={{ opacity: 0, y: 18, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: .98 }}
            transition={{ duration: .18 }}
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
