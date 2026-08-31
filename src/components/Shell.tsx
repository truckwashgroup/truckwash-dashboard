import { type ReactNode, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Bug, LayoutGrid, LogOut, MessageSquarePlus, Mic, MoreHorizontal,
  RefreshCw, Search, Settings, SlidersHorizontal,
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
import StoringMelden from './StoringMelden'
import DevMelding from './DevMelding'
import Instellingen from './Instellingen'
import Overleg, { OverlegKnop } from './Overleg'
import { Dropdown, type MenuGroup } from './ui'
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
  /** Knoppen die zichtbaar moeten blijven, bijv. de periodekiezer */
  actions?: ReactNode
  /** Regels die het dashboard aan het actiemenu toevoegt */
  menu?: MenuGroup[]
  children: ReactNode
}

export default function Shell({
  roleLabel, items, active, onNavigate, title, subtitle, actions, menu, children,
}: Props) {
  const { user, clearRole, logout } = useAuth()
  const { lastSyncAt, sync, syncing } = useSync()
  const version = useUpdates((s) => s.version)
  const openSearch = useNav((s) => s.openSearch)
  const goto = useNav((s) => s.goto)
  const perms = usePerms()

  const [storing, setStoring] = useState(false)
  const [devmelding, setDevmelding] = useState(false)
  const [instellingen, setInstellingen] = useState(false)

  // Elk schermwissel in het spoor, zodat een melding laat zien waar iemand
  // liep vlak voordat er iets misging.
  useEffect(() => { trail.page(roleLabel, active) }, [roleLabel, active])

  /* ---------------------------------------------------------------- *
   *  Het actiemenu
   *
   *  Hier zat vroeger een rij losse icoontjes waarvan je moest raden wat
   *  ze deden. Onder één knop, met een regel uitleg per keuze, is het
   *  compacter én duidelijker.
   * ---------------------------------------------------------------- */

  const acties: MenuGroup[] = [
    ...(menu ?? []),
    {
      title: 'Melden',
      items: [
        ...(perms.can('faults.report') ? [{
          key: 'storing',
          label: 'Storing melden',
          hint: 'Er is iets stuk op de vestiging',
          icon: <AlertTriangle size={16} />,
          onClick: () => setStoring(true),
        }] : []),
        ...(perms.can('dev.report') ? [{
          key: 'devmelding',
          label: 'Melding aan de ontwikkelaar',
          hint: 'De app doet iets raars, of je mist iets',
          icon: <Bug size={16} />,
          onClick: () => setDevmelding(true),
        }] : []),
        ...(perms.can('dev.report') ? [{
          key: 'mijnmeldingen',
          label: 'Mijn meldingen',
          hint: 'Wat je eerder hebt doorgegeven',
          icon: <MessageSquarePlus size={16} />,
          onClick: () => { setDevmelding(true) },
        }] : []),
      ],
    },
    {
      title: 'Gegevens',
      items: [
        {
          key: 'sync',
          label: syncing ? 'Bezig met synchroniseren…' : 'Nu synchroniseren',
          hint: lastSyncAt ? `Laatst bijgewerkt ${relative(lastSyncAt)}` : 'Nog niet bijgewerkt',
          icon: <RefreshCw size={16} />,
          disabled: syncing,
          onClick: () => void sync(),
        },
      ],
    },
  ]

  const persoonlijk: MenuGroup[] = [
    {
      items: [
        {
          key: 'instellingen',
          label: 'Instellingen',
          hint: 'Licht of donker, beweging, meldingen',
          icon: <SlidersHorizontal size={16} />,
          onClick: () => setInstellingen(true),
        },
        {
          key: 'wissel',
          label: 'Ander dashboard',
          hint: 'Terug naar de keuze',
          icon: <LayoutGrid size={16} />,
          onClick: clearRole,
        },
      ],
    },
    {
      items: [
        {
          key: 'uit',
          label: 'Uitloggen',
          icon: <LogOut size={16} />,
          tone: 'danger' as const,
          onClick: () => void logout(),
        },
      ],
    },
  ]

  return (
    <div className="app-shell">
      {/* ------------------------- Zijbalk -------------------------- */}
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
          <button className="nav-item" onClick={() => setInstellingen(true)}>
            <Settings size={17} />
            <span>Instellingen</span>
          </button>

          <div className="sidebar-persoon">
            <div className="av">{initials(user?.name ?? '?')}</div>
            <div style={{ minWidth: 0 }}>
              <div className="n">{user?.name}</div>
              <div className="s">
                v{version}
                {lastSyncAt ? ` · ${relative(lastSyncAt)}` : ''}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* --------------------------- Werkvlak ----------------------- */}
      <div className="main">
        <header className="topbar">
          <div className="topbar-titel">
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
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

          {actions}

          <OverlegKnop onOpen={() => goto('overleg')} />
          <NotificationCenter />

          <Dropdown
            icon={<MoreHorizontal size={17} />}
            items={acties}
            title="Acties"
            className="hide-mobile"
          />

          <Dropdown
            icon={<span className="menu-av">{initials(user?.name ?? '?')}</span>}
            items={persoonlijk}
            title={user?.name}
            className="menu-persoon"
          />

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
                {!!it.badge && <span className="stip" />}
              </button>
            )
          })}
          <Dropdown
            icon={<MoreHorizontal size={19} />}
            items={[...acties, ...persoonlijk]}
            align="right"
            className="mobile-meer"
            label="Meer"
          />
        </nav>
      </div>

      <StoringMelden open={storing} onClose={() => setStoring(false)} />
      <DevMelding
        open={devmelding}
        onClose={() => setDevmelding(false)}
        fromRole={roleLabel}
        fromPage={active}
      />
      <Instellingen open={instellingen} onClose={() => setInstellingen(false)} />
    </div>
  )
}

/** Het overlegscherm, zodat dashboards het als pagina kunnen tonen. */
export { Overleg }
