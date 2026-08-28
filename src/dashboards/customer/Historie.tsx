import { useMemo, useState } from 'react'
import { History, Search } from 'lucide-react'
import { SERVICES } from '../../lib/types'
import { dateShort, duration, money, time } from '../../lib/format'
import { Card, Empty } from '../../components/ui'
import { useCompany } from './useCompany'
import { statusBadge } from './Overzicht'

export default function Historie() {
  const { jobs } = useCompany()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('alle')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return jobs.filter((j) => {
      if (status !== 'alle' && j.status !== status) return false
      if (!needle) return true
      return (
        j.plate.toLowerCase().includes(needle) ||
        j.ticket.toLowerCase().includes(needle) ||
        SERVICES[j.service].label.toLowerCase().includes(needle)
      )
    })
  }, [jobs, q, status])

  const totaal = rows
    .filter((j) => j.status === 'gereed')
    .reduce((a, j) => a + j.priceExcl, 0)

  return (
    <Card
      title="Historie"
      hint={`${rows.length} regels · ${money(totaal)} afgerond`}
      flush
      action={
        <div className="row" style={{ gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 30, width: 200 }}
              placeholder="Kenteken of ticket"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="alle">Alle statussen</option>
            <option value="gereed">Gereed</option>
            <option value="gepland">Ingepland</option>
            <option value="bezig">Bezig</option>
            <option value="geannuleerd">Geannuleerd</option>
          </select>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty text="Geen resultaten." icon={<History size={30} />} />
      ) : (
        <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Datum</th>
                <th>Kenteken</th>
                <th>Behandeling</th>
                <th>Uitgevoerd door</th>
                <th className="num">Duur</th>
                <th className="num">Bedrag excl.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{j.ticket}</td>
                  <td>
                    {dateShort(j.scheduledAt)}
                    <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{time(j.scheduledAt)}</div>
                  </td>
                  <td><strong>{j.plate}</strong></td>
                  <td>{SERVICES[j.service].label}</td>
                  <td>{j.assignedName ?? '—'}</td>
                  <td className="num">
                    {j.startedAt && j.completedAt ? duration(j.completedAt - j.startedAt) : '—'}
                  </td>
                  <td className="num">{money(j.priceExcl)}</td>
                  <td>{statusBadge(j)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
