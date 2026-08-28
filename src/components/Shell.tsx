import { type ReactNode, useState } from 'react'
import { motion } from 'framer-motion'
import {
  LayoutGrid, LogOut, RefreshCw, WifiOff, Wifi, Download,
} from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useSync } from '../lib/sync'
import { useUpdates } from '../lib/updates'
import { isForcedOffline, setForcedOffline } from '../lib/api'
import { initials, relative } from '../lib/format'
import SyncPill from './SyncPill'
import Logo from './Logo'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  badge?: number
}

interface Props {
  roleLabel: string
  items: NavItem[]
  active: string
  onNavigate: (key: string) => void
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

export default function Shell({
  roleLabel, items, active, onNavigate, title, subtitle, actions, children,
}: Props) {
  const { user, clearRole, logout } = useAuth()
  const { lastSyncAt, sync, syncing } = useSync()
  const { state: updateState, check: checkUpdates, version } = useUpdates()
  const [flightMode, setFlightMode] = useState(isForcedOffline())

  function toggleFlight() {
    const next = !flightMode
    setFlightMode(next)
    setForcedOffline(next)
  }

  return (
    <div className="app-shell">
      {/* ------------------------- Sidebar ------------------------- */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo width={150} />
          <div className="sub">{roleLabel}</div>
        </div>

        <nav className="nav">
          {items.map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.key}
                className={`nav-item ${active === it.key ? 'active' : ''}`}
                onClick={() => onNavigate(it.key)}
              >
                <Icon size={17} />
                <span>{it.label}</span>
                {!!it.badge && <span className="badge brand">{it.badge}</span>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <button className="nav-item" onClick={clearRole}>
            <LayoutGrid size={17} />
            <span>Ander dashboard</span>
          </button>
          <button className="nav-item" onClick={() => void logout()}>
            <LogOut size={17} />
            <span>Uitloggen</span>
          </button>

          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '11px 12px 4px', borderTop: '1px solid var(--line-soft)',
              marginTop: 8,
            }}
          >
            <div
              style={{
                width: 30, height: 30, borderRadius: 9, flex: 'none',
                display: 'grid', placeItems: 'center',
                background: 'var(--surface-3)', fontSize: '.72rem', fontWeight: 700,
              }}
            >
              {initials(user?.name ?? '?')}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name}
              </div>
              <div style={{ fontSize: '.7rem', color: 'var(--text-3)' }}>
                v{version}
                {lastSyncAt ? ` · ${relative(lastSyncAt)}` : ''}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* --------------------------- Main -------------------------- */}
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && (
              <div style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>{subtitle}</div>
            )}
          </div>
          <span className="spacer" />

          {actions}

          <button
            className="btn ghost sm hide-mobile"
            onClick={toggleFlight}
            title={flightMode
              ? 'Simulatie: offline. Klik om weer verbinding te maken.'
              : 'Simuleer geen internet, om de offline-modus te testen.'}
          >
            {flightMode ? <WifiOff size={15} color="var(--warn)" /> : <Wifi size={15} />}
            {flightMode ? 'Offline-test aan' : 'Offline testen'}
          </button>

          <button
            className="btn ghost sm hide-mobile"
            onClick={() => void checkUpdates()}
            title="Controleer op updates"
          >
            {updateState === 'checking'
              ? <RefreshCw size={15} className="spin" />
              : <Download size={15} />}
            Updates
          </button>

          <button
            className="btn ghost sm"
            onClick={() => void sync()}
            disabled={syncing}
            title="Nu synchroniseren"
          >
            <RefreshCw size={15} className={syncing ? 'spin' : ''} />
          </button>

          <SyncPill />
        </header>

        <motion.main
          className="content"
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .2 }}
        >
          {children}
        </motion.main>

        {/* --------------------- Mobiele navigatie ------------------ */}
        <nav className="mobile-nav">
          {items.slice(0, 4).map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.key}
                className={active === it.key ? 'active' : ''}
                onClick={() => onNavigate(it.key)}
              >
                <Icon size={19} />
                <span>{it.label}</span>
              </button>
            )
          })}
          <button onClick={clearRole}>
            <LayoutGrid size={19} />
            <span>Wissel</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
