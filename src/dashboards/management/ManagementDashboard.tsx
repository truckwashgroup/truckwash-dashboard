import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarRange, LayoutDashboard, Package, Receipt, Users } from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import Overzicht from './Overzicht'
import Financieel from './Financieel'
import Personeel from './Personeel'
import Voorraad from './Voorraad'
import Planning from './Planning'

const PERIODS = [
  { days: 7, label: '7 dagen' },
  { days: 30, label: '30 dagen' },
  { days: 90, label: '90 dagen' },
]

const TITLES: Record<string, { title: string; subtitle: string }> = {
  overzicht: { title: 'Managementoverzicht', subtitle: 'Omzet, volume en marge' },
  financieel: { title: 'Financieel', subtitle: 'Kosten valideren en resultaat' },
  personeel: { title: 'Personeel', subtitle: 'Prestaties, uren en rechten' },
  voorraad: { title: 'Voorraad', subtitle: 'Materiaal, verbruik en bestellingen' },
  planning: { title: 'Planning', subtitle: 'Alle wasopdrachten' },
}

export default function ManagementDashboard() {
  const [page, setPage] = useState('overzicht')
  const [days, setDays] = useState(30)

  const openKosten = useLiveQuery(
    () => db.expenses.where('status').equals('open').count(),
    [],
    0,
  )

  const items: NavItem[] = [
    { key: 'overzicht', label: 'Overzicht', icon: LayoutDashboard },
    { key: 'financieel', label: 'Financieel', icon: Receipt, badge: openKosten || undefined },
    { key: 'planning', label: 'Planning', icon: CalendarRange },
    { key: 'personeel', label: 'Personeel', icon: Users },
    { key: 'voorraad', label: 'Voorraad', icon: Package },
  ]

  const meta = TITLES[page]
  const showPeriod = page !== 'planning'

  return (
    <Shell
      roleLabel="Management"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={meta.subtitle}
      actions={
        showPeriod ? (
          <div className="row hide-mobile" style={{ gap: 5 }}>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                className={`btn sm ${days === p.days ? 'primary' : 'ghost'}`}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {page === 'overzicht' && <Overzicht days={days} />}
      {page === 'financieel' && <Financieel days={days} />}
      {page === 'personeel' && <Personeel days={days} />}
      {page === 'voorraad' && <Voorraad days={days} />}
      {page === 'planning' && <Planning />}
    </Shell>
  )
}
