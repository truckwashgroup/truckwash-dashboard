import { type ReactNode, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  LayoutGrid, LogOut, Mic, RefreshCw, Search,
} from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useSync } from '../lib/sync'
import { useNav } from '../store/useNav'
import { voiceSupported, voiceUnavailableReason } from '../lib/voice'
import { toast } from '../store/useToasts'
import { useUpdates } from '../lib/updates'
import { initials, relative } from '../lib/format'
import SyncPill from './SyncPill'
import Logo from './Logo'
import GlobalSearch from './GlobalSearch'
import LocationSwitcher from './LocationSwitcher'
import { StoringMeldenKnop } from './StoringMelden'
import { DevMeldingKnop } from './DevMelding'
import { trail } from '../lib/trail'
import { usePerms } from '../store/useNav'
import NotificationCenter from './NotificationCenter'
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
  const version = useUpdates((s) => s.version)
  const openSearch = useNav((s) => s.openSearch)
  const perms = usePerms()

  // Elk schermwissel in het spoor, zodat een melding laat zien waar iemand
  // liep vlak voordat er iets misging.
  useEffect(() => { trail.page(roleLabel, active) }, [roleLabel, active])

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

          <LocationSwitcher />

          <div className="topbar-search">
            <button className="search-trigger" onClick={() => openSearch(false)} title="Zoeken (Ctrl+K)">
              <Search size={15} />
              <span className="label">Zoeken…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="topbar-mic"
              onClick={() =>
                voiceSupported() ? openSearch(true) : toast.info(voiceUnavailableReason())
              }
              title={voiceSupported() ? 'Zoeken met je stem' : voiceUnavailableReason()}
              aria-label="Zoeken met je stem"
            >
              <Mic size={16} />
            </button>
          </div>

          <GlobalSearch />

          {perms.can('faults.report') && <StoringMeldenKnop />}
          <DevMeldingKnop role={roleLabel} page={active} />

          {actions}

          <button
            className="btn ghost sm"
            onClick={() => void sync()}
            disabled={syncing}
            title="Nu synchroniseren"
          >
            <RefreshCw size={15} className={syncing ? 'spin' : ''} />
          </button>

          <NotificationCenter />
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
