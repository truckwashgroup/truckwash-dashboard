import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarRange, GraduationCap, LayoutDashboard, Package, Receipt, Settings, Users, Wrench } from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import Overzicht from './Overzicht'
import Financieel from './Financieel'
import Personeel from './Personeel'
import Voorraad from './Voorraad'
import Planning from './Planning'
import Beheer from './Beheer'
import Techniek from './Techniek'
import OpleidingOverzicht from '../../components/OpleidingOverzicht'
import BerichtVersturen from '../../components/BerichtVersturen'
import { useNavTarget, usePerms } from '../../store/useNav'
import { Send } from 'lucide-react'

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
  techniek: { title: 'Techniek', subtitle: 'Storingen, onderhoud en werkbonnen' },
  opleiding: { title: 'Opleiding', subtitle: 'Voortgang van iedereen' },
  beheer: { title: 'Beheer', subtitle: 'Instellingen, rechten en gegevens' },
}

export default function ManagementDashboard() {
  const [page, setPage] = useState('overzicht')
  const [days, setDays] = useState(30)
  const [messaging, setMessaging] = useState(false)
  const perms = usePerms()

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
    { key: 'techniek', label: 'Techniek', icon: Wrench },
    { key: 'opleiding', label: 'Opleiding', icon: GraduationCap },
    { key: 'beheer', label: 'Beheer', icon: Settings },
  ]

  useNavTarget(
    ['overzicht', 'financieel', 'planning', 'personeel', 'voorraad', 'opleiding',
     'beheer', 'klanten', 'materiaal', 'techniek', 'storingen', 'werkbonnen', 'installaties', 'onderhoud'],
    (p) => setPage(
      p === 'klanten' ? 'personeel' :
      p === 'materiaal' ? 'voorraad' :
      ['storingen', 'werkbonnen', 'installaties', 'onderhoud'].includes(p) ? 'techniek' : p),
  )

  const meta = TITLES[page]
  const showPeriod = page !== 'planning' && page !== 'beheer' && page !== 'opleiding'

  return (
    <Shell
      roleLabel="Management"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={meta.subtitle}
      actions={
        <>
          {perms.can('notify.send') && (
            <button className="btn sm hide-mobile" onClick={() => setMessaging(true)}>
              <Send size={14} /> Bericht
            </button>
          )}
          {showPeriod ? (
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
          ) : null}
        </>
      }
    >
      {page === 'overzicht' && <Overzicht days={days} />}
      {page === 'financieel' && <Financieel days={days} />}
      {page === 'personeel' && <Personeel days={days} />}
      {page === 'voorraad' && <Voorraad days={days} />}
      {page === 'planning' && <Planning />}
      {page === 'techniek' && <Techniek days={days} />}
      {page === 'opleiding' && <OpleidingOverzicht />}
      {page === 'beheer' && <Beheer />}

      <BerichtVersturen open={messaging} onClose={() => setMessaging(false)} />
    </Shell>
  )
}
