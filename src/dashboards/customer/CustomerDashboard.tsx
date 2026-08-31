import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarPlus, FileText, History, LayoutDashboard, LayoutGrid, Truck,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import Overzicht from './Overzicht'
import Plannen from './Plannen'
import Historie from './Historie'
import Facturen from './Facturen'
import { useCompany } from './useCompany'
import { Start, type Tegel } from '../../components/Tegels'
import { db } from '../../lib/db'
import { money } from '../../lib/format'
import { useNavTarget } from '../../store/useNav'
import type { WashJob } from '../../lib/types'

const TITLES: Record<string, string> = {
  start: 'Start',
  overzicht: 'Overzicht',
  plannen: 'Wasbeurt inplannen',
  historie: 'Historie',
  facturen: 'Facturen',
}

const ITEMS: NavItem[] = [
  { key: 'start', label: 'Start', icon: LayoutGrid },
  { key: 'overzicht', label: 'Overzicht', icon: LayoutDashboard },
  { key: 'plannen', label: 'Inplannen', icon: CalendarPlus },
  { key: 'historie', label: 'Historie', icon: History },
  { key: 'facturen', label: 'Facturen', icon: FileText },
]

export default function CustomerDashboard() {
  const [page, setPage] = useState('start')
  const { company, companies, locked, setOverride } = useCompany()

  const jobs = useLiveQuery(
    async () => company
      ? db.washJobs.where('companyId').equals(company.id).toArray()
      : [],
    [company?.id],
    [] as WashJob[],
  )

  useNavTarget(ITEMS.map((i) => i.key), (p) => setPage(p))

  const cijfers = useMemo(() => {
    const open = jobs.filter(
      (j) => j.status !== 'gereed' && j.status !== 'geannuleerd')
    const bezig = jobs.filter((j) => j.status === 'bezig').length
    const maand = Date.now() - 30 * 86_400_000
    const recent = jobs.filter((j) => j.status === 'gereed' && (j.completedAt ?? 0) >= maand)
    return {
      open: open.length,
      bezig,
      gereedMaand: recent.length,
      bedragMaand: recent.reduce((a, j) => a + j.priceExcl, 0),
    }
  }, [jobs])

  const tegels: Tegel[] = [
    {
      key: 'plannen',
      label: 'Wasbeurt inplannen',
      hint: 'Een wagen aanmelden voor de wasstraat',
      icon: CalendarPlus,
      tint: 'brand',
      onClick: () => setPage('plannen'),
    },
    {
      key: 'overzicht',
      label: 'Overzicht',
      hint: 'Waar je wagens nu staan',
      icon: Truck,
      tint: cijfers.bezig ? 'ok' : 'info',
      stat: cijfers.open,
      statLabel: cijfers.bezig ? `${cijfers.bezig} nu in behandeling` : 'wagens open',
      onClick: () => setPage('overzicht'),
    },
    {
      key: 'historie',
      label: 'Historie',
      hint: 'Alles wat er gewassen is',
      icon: History,
      tint: 'neutraal',
      stat: cijfers.gereedMaand,
      statLabel: 'gereed deze maand',
      onClick: () => setPage('historie'),
    },
    {
      key: 'facturen',
      label: 'Facturen',
      hint: 'Wat er in rekening is gebracht',
      icon: FileText,
      tint: 'neutraal',
      stat: money(cijfers.bedragMaand),
      statLabel: 'deze maand',
      onClick: () => setPage('facturen'),
    },
  ]

  return (
    <Shell
      roleLabel="Klant"
      items={ITEMS}
      active={page}
      onNavigate={setPage}
      title={TITLES[page]}
      subtitle={company?.name}
      actions={
        !locked && companies.length > 1 ? (
          <select
            className="select hide-mobile"
            style={{ width: 210 }}
            value={company?.id ?? ''}
            onChange={(e) => setOverride(e.target.value)}
            title="Meekijken als klant"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      {page === 'start' && (
        <Start
          tegels={tegels}
          onderschrift={company ? `Je kijkt naar ${company.name}` : undefined}
          snel={
            <button className="btn primary sm" onClick={() => setPage('plannen')}>
              <CalendarPlus size={14} /> Wasbeurt inplannen
            </button>
          }
        />
      )}
      {page === 'overzicht' && <Overzicht />}
      {page === 'plannen' && <Plannen />}
      {page === 'historie' && <Historie />}
      {page === 'facturen' && <Facturen />}
    </Shell>
  )
}
