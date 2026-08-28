import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Clock, PlayCircle, RotateCcw, Truck, User2 } from 'lucide-react'
import { db } from '../../lib/db'
import { jobs as jobRepo } from '../../lib/repo'
import { SERVICES, type WashJob } from '../../lib/types'
import { duration, money, time } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'
import { ShiftToday } from '../../components/WeekRooster'
import { toast } from '../../store/useToasts'
import { useAuth } from '../../store/useAuth'
import { startOfDay } from '../../lib/analytics'

const DAY = 86_400_000

export default function Vandaag() {
  const user = useAuth((s) => s.user)!
  const [tick, setTick] = useState(0)

  // laat de lopende tijd meelopen
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const today = useLiveQuery(async () => {
    const from = startOfDay(Date.now())
    const to = from + DAY
    const all = await db.washJobs
      .where('scheduledAt').between(from, to, true, false)
      .toArray()
    return all.sort((a, b) => a.scheduledAt - b.scheduledAt)
  }, [], [] as WashJob[])

  const bezig = today.filter((j) => j.status === 'bezig')
  const wachtrij = today.filter((j) => j.status === 'wachtrij' || j.status === 'gepland')
  const gereed = today.filter((j) => j.status === 'gereed')

  const mijnBezig = bezig.filter((j) => j.assignedTo === user.id)
  const omzetVandaag = gereed.reduce((a, j) => a + j.priceExcl, 0)

  async function oppakken(job: WashJob) {
    await jobRepo.assign(job.id, { id: user.id, name: user.name })
    await jobRepo.setStatus(job.id, 'bezig')
    toast.ok(`${job.plate} opgepakt`)
  }

  async function afmelden(job: WashJob) {
    await jobRepo.setStatus(job.id, 'gereed')
    toast.ok(`${job.plate} gereed gemeld`)
  }

  async function terug(job: WashJob) {
    await jobRepo.setStatus(job.id, 'wachtrij')
    toast.info(`${job.plate} terug in de wachtrij`)
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14, gap: 8 }}>
        <span style={{ fontSize: '.82rem', color: 'var(--text-3)' }}>Jouw dienst vandaag:</span>
        <ShiftToday userId={user.id} />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="In de wachtrij" value={wachtrij.length} icon={<Clock size={17} />} tone="warn" />
        <Stat label="Nu bezig" value={bezig.length} icon={<PlayCircle size={17} />} />
        <Stat label="Vandaag gereed" value={gereed.length} icon={<CheckCircle2 size={17} />} tone="ok" />
        <Stat label="Omzet vandaag" value={money(omzetVandaag)} icon={<Truck size={17} />} />
      </div>

      {mijnBezig.length > 0 && (
        <Card title="Waar jij mee bezig bent" className="mb">
          <div className="grid cols-2">
            {mijnBezig.map((j) => (
              <ActiveJob key={j.id} job={j} onDone={() => afmelden(j)} onBack={() => terug(j)} tick={tick} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid sidebar-right" style={{ marginTop: 16 }}>
        <Card title="Wachtrij" hint="Op tijd van afspraak" flush>
          {wachtrij.length === 0 ? (
            <Empty text="Alle wagens van vandaag zijn opgepakt." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tijd</th>
                    <th>Kenteken</th>
                    <th>Klant</th>
                    <th>Behandeling</th>
                    <th className="num">Prijs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {wachtrij.map((j) => (
                    <tr key={j.id}>
                      <td className="mono">{time(j.scheduledAt)}</td>
                      <td><strong>{j.plate}</strong></td>
                      <td>{j.companyName}</td>
                      <td>
                        {SERVICES[j.service].label}
                        <div style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>
                          ± {SERVICES[j.service].minutes} min
                        </div>
                      </td>
                      <td className="num">{money(j.priceExcl)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn primary sm" onClick={() => void oppakken(j)}>
                          <PlayCircle size={14} /> Oppakken
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Afgerond vandaag" flush>
          {gereed.length === 0 ? (
            <Empty text="Nog niets afgerond." />
          ) : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {gereed.map((j) => (
                <div
                  key={j.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 16px', borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  <CheckCircle2 size={16} color="var(--ok)" style={{ flex: 'none' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '.87rem' }}>{j.plate}</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--text-3)' }}>
                      {SERVICES[j.service].label} · {j.assignedName ?? '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: '.82rem' }}>{money(j.priceExcl)}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                      {j.startedAt && j.completedAt ? duration(j.completedAt - j.startedAt) : '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function ActiveJob({
  job, onDone, onBack, tick,
}: { job: WashJob; onDone: () => void; onBack: () => void; tick: number }) {
  const meta = SERVICES[job.service]
  const elapsed = job.startedAt ? Date.now() - job.startedAt : 0
  const pct = Math.min(100, (elapsed / (meta.minutes * 60000)) * 100)
  const over = elapsed > meta.minutes * 60000

  return (
    <div
      style={{
        border: '1px solid var(--line)', borderRadius: 'var(--radius)',
        padding: 16, background: 'var(--bg-2)',
      }}
      data-tick={tick}
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <Truck size={18} color="var(--brand)" />
        <strong style={{ fontSize: '1.05rem' }}>{job.plate}</strong>
        <Badge tone="brand" dot>Bezig</Badge>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="mono" style={{ color: over ? 'var(--warn)' : 'var(--text-2)' }}>
          {duration(elapsed)} / {meta.minutes}m
        </span>
      </div>

      <div style={{ fontSize: '.84rem', color: 'var(--text-3)', marginBottom: 10 }}>
        {job.companyName} · {meta.label}
      </div>

      <div className={`bar ${over ? 'warn' : ''}`} style={{ marginBottom: 14 }}>
        <span style={{ width: `${pct}%` }} />
      </div>

      <div className="row">
        <button className="btn ok" onClick={onDone}>
          <CheckCircle2 size={15} /> Gereed melden
        </button>
        <button className="btn ghost sm" onClick={onBack}>
          <RotateCcw size={14} /> Terug in wachtrij
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '.76rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <User2 size={13} /> {job.assignedName}
        </span>
      </div>
    </div>
  )
}
