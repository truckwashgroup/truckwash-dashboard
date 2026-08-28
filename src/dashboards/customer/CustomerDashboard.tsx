import { useState } from 'react'
import { CalendarPlus, FileText, History, LayoutDashboard } from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import Overzicht from './Overzicht'
import Plannen from './Plannen'
import Historie from './Historie'
import Facturen from './Facturen'
import { useCompany } from './useCompany'

const TITLES: Record<string, string> = {
  overzicht: 'Overzicht',
  plannen: 'Wasbeurt inplannen',
  historie: 'Historie',
  facturen: 'Facturen',
}

const ITEMS: NavItem[] = [
  { key: 'overzicht', label: 'Overzicht', icon: LayoutDashboard },
  { key: 'plannen', label: 'Inplannen', icon: CalendarPlus },
  { key: 'historie', label: 'Historie', icon: History },
  { key: 'facturen', label: 'Facturen', icon: FileText },
]

export default function CustomerDashboard() {
  const [page, setPage] = useState('overzicht')
  const { company, companies, locked, setOverride } = useCompany()

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
      {page === 'overzicht' && <Overzicht />}
      {page === 'plannen' && <Plannen />}
      {page === 'historie' && <Historie />}
      {page === 'facturen' && <Facturen />}
    </Shell>
  )
}
