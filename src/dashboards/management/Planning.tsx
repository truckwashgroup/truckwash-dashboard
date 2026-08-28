import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarRange, Search } from 'lucide-react'
import { db } from '../../lib/db'
import { jobs as jobRepo } from '../../lib/repo'
import { SERVICES, type User, type WashJob, type WashStatus } from '../../lib/types'
import { dateShort, duration, money, time } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'
import { toast } from '../../store/useToasts'
import { startOfDay } from '../../lib/analytics'

const DAY = 86_400_000

const STATUS_TONE: Record<WashStatus, 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'> = {
  gepland: 'info',
  wachtrij: 'warn',
  bezig: 'brand',
  gereed: 'ok',
  geannuleerd: 'danger',
}

const RANGES = [
  { key: 'vandaag', label: 'Vandaag' },
  { key: 'week', label: 'Deze week' },
  { key: 'komend', label: 'Komend' },
  { key: 'alles', label: 'Alles' },
]

export default function Planning() {
  const [range, setRange] = useState('week')
  const [status, setStatus] = useState('alle')
  const [q, setQ] = useState('')

  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const staff = users.filter((u) => u.roles.includes('employee') && u.active)

  const rows = useMemo(() => {
    const today = startOfDay(Date.now())
    const needle = q.trim().toLowerCase()

    return jobs
      .filter((j) => {
        if (range === 'vandaag' && (j.scheduledAt < today || j.scheduledAt >= today + DAY)) return false
        if (range === 'week' && (j.scheduledAt < today - 3 * DAY || j.scheduledAt >= today + 4 * DAY)) return false
        if (range === 'komend' && j.scheduledAt < today) return false
        if (status !== 'alle' && j.status !== status) return false
        if (!needle) return true
        return (
          j.plate.toLowerCase().includes(needle) ||
          j.companyName.toLowerCase().includes(needle) ||
          j.ticket.toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => a.scheduledAt - b.scheduledAt)
  }, [jobs, range, status, q])

  const omzet = rows.filter((j) => j.status === 'gereed').reduce((a, j) => a + j.priceExcl, 0)
  const gepland = rows.filter((j) => j.status === 'gepland' || j.status === 'wachtrij')
  const zonderWasser = gepland.filter((j) => !j.assignedTo)

  async function assign(job: WashJob, userId: string) {
    const u = staff.find((s) => s.id === userId)
    await jobRepo.assign(job.id, u ? { id: u.id, name: u.name } : null)
    toast.ok(u ? `${job.plate} toegewezen aan ${u.name}` : `Toewijzing verwijderd`)
  }

  async function setStatusOf(job: WashJob, next: WashStatus) {
    await jobRepo.setStatus(job.id, next)
    toast.info(`${job.plate} → ${next}`)
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="In selectie" value={rows.length} icon={<CalendarRange size={17} />} />
        <Stat label="Nog te doen" value={gepland.length} tone="warn" />
        <Stat
          label="Zonder wasser"
          value={zonderWasser.length}
          tone={zonderWasser.length ? 'danger' : 'ok'}
        />
        <Stat label="Omzet in selectie" value={money(omzet)} tone="ok" />
      </div>

      <Card
        title="Planning"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, width: 190 }}
                placeholder="Kenteken of klant"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select className="select" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="alle">Alle statussen</option>
              <option value="gepland">Ingepland</option>
              <option value="wachtrij">Wachtrij</option>
              <option value="bezig">Bezig</option>
              <option value="gereed">Gereed</option>
              <option value="geannuleerd">Geannuleerd</option>
            </select>
            {RANGES.map((r) => (
              <button
                key={r.key}
                className={`btn sm ${range === r.key ? 'primary' : 'ghost'}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty text="Geen wasopdrachten in deze selectie." icon={<CalendarRange size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '64vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Wanneer</th>
                  <th>Kenteken</th>
                  <th>Klant</th>
                  <th>Behandeling</th>
                  <th>Wasser</th>
                  <th className="num">Duur</th>
                  <th className="num">Bedrag</th>
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
                    <td>{j.companyName}</td>
                    <td>{SERVICES[j.service].label}</td>
                    <td>
                      <select
                        className="select"
                        style={{ minWidth: 140, padding: '5px 8px', fontSize: '.8rem' }}
                        value={j.assignedTo ?? ''}
                        onChange={(e) => void assign(j, e.target.value)}
                      >
                        <option value="">— niet toegewezen —</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {j.startedAt && j.completedAt ? duration(j.completedAt - j.startedAt) : '—'}
                    </td>
                    <td className="num">{money(j.priceExcl)}</td>
                    <td>
                      <select
                        className="select"
                        style={{ minWidth: 118, padding: '5px 8px', fontSize: '.8rem' }}
                        value={j.status}
                        onChange={(e) => void setStatusOf(j, e.target.value as WashStatus)}
                      >
                        <option value="gepland">Ingepland</option>
                        <option value="wachtrij">Wachtrij</option>
                        <option value="bezig">Bezig</option>
                        <option value="gereed">Gereed</option>
                        <option value="geannuleerd">Geannuleerd</option>
                      </select>
                      <div style={{ marginTop: 3 }}>
                        <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
