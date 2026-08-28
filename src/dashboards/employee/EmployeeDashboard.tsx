import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarCheck, CalendarDays, GraduationCap, Package, Receipt, Timer } from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import { dateFull } from '../../lib/format'
import { startOfDay } from '../../lib/analytics'
import Vandaag from './Vandaag'
import Uren from './Uren'
import Materiaal from './Materiaal'
import KostenIndienen from './KostenIndienen'
import MijnRooster from './MijnRooster'
import Opleiding from '../../components/Opleiding'
import { useNavTarget } from '../../store/useNav'

const DAY = 86_400_000

const TITLES: Record<string, { title: string; subtitle: string }> = {
  vandaag: { title: 'Vandaag', subtitle: 'Wasopdrachten en wachtrij' },
  rooster: { title: 'Mijn rooster', subtitle: 'Wanneer je bent ingeroosterd' },
  uren: { title: 'Mijn uren', subtitle: 'Tijdregistratie' },
  materiaal: { title: 'Materiaal', subtitle: 'Voorraad en verbruik' },
  kosten: { title: 'Kosten', subtitle: 'Bonnen indienen ter goedkeuring' },
  opleiding: { title: 'Opleiding', subtitle: 'Cursussen en certificaten' },
}

export default function EmployeeDashboard() {
  const [page, setPage] = useState('vandaag')

  const openCount = useLiveQuery(
    async () => {
      const from = startOfDay(Date.now())
      const rows = await db.washJobs.where('scheduledAt').between(from, from + DAY, true, false).toArray()
      return rows.filter((j) => j.status === 'wachtrij' || j.status === 'gepland').length
    },
    [],
    0,
  )

  const items: NavItem[] = [
    { key: 'vandaag', label: 'Vandaag', icon: CalendarCheck, badge: openCount || undefined },
    { key: 'rooster', label: 'Rooster', icon: CalendarDays },
    { key: 'uren', label: 'Mijn uren', icon: Timer },
    { key: 'materiaal', label: 'Materiaal', icon: Package },
    { key: 'kosten', label: 'Kosten', icon: Receipt },
    { key: 'opleiding', label: 'Opleiding', icon: GraduationCap },
  ]

  useNavTarget(['vandaag', 'rooster', 'uren', 'materiaal', 'kosten', 'opleiding'], (p) => setPage(p))

  const meta = TITLES[page]

  return (
    <Shell
      roleLabel="Werknemer"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={page === 'vandaag' ? dateFull(Date.now()) : meta.subtitle}
    >
      {page === 'vandaag' && <Vandaag />}
      {page === 'rooster' && <MijnRooster />}
      {page === 'uren' && <Uren />}
      {page === 'materiaal' && <Materiaal />}
      {page === 'kosten' && <KostenIndienen />}
      {page === 'opleiding' && <Opleiding />}
    </Shell>
  )
}
