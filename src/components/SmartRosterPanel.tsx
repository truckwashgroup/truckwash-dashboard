import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Check, ChevronLeft, ChevronRight, Send, Sparkles, TriangleAlert, X,
} from 'lucide-react'
import { db, alleMensen } from '../lib/db'
import { shifts as shiftRepo, notifications as notifyRepo } from '../lib/repo'
import type { Shift, User, WashJob } from '../lib/types'
import { planWeek, type Proposal } from '../lib/smartRoster'
import { DAY_LABELS, weekNumber, weekStart } from '../lib/roster'
import { Badge, Card, Empty } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { toast } from '../store/useToasts'

const DAY = 86_400_000

/* ------------------------------------------------------------------ *
 *  Smartroster
 *
 *  Stelt een week voor op basis van contracturen, de tijden die iemand
 *  gewoonlijk werkt en de drukte van die dag. Elk voorstel is los te
 *  accepteren of te verwerpen; er wordt niets opgeslagen tot je dat doet.
 * ------------------------------------------------------------------ */

export default function SmartRosterPanel({ team }: { team?: User[] }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [offset, setOffset] = useState(1) // standaard volgende week
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)

  const allUsers = useLiveQuery(() => alleMensen(), [], [] as User[])
  const shifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])

  const start = weekStart(Date.now()) + offset * 7 * DAY

  const staff = useMemo(
    () => (team ?? allUsers).filter((u) => u.active && u.roles.includes('employee')),
    [team, allUsers],
  )

  const plan = useMemo(
    () => planWeek({ staff, shifts, jobs, weekStart: start }),
    [staff, shifts, jobs, start],
  )

  const key = (p: Proposal) => `${p.userId}:${p.day}`
  const accepted = plan.proposals.filter((p) => !rejected.has(key(p)))

  const canEdit = perms.can('roster.edit')

  async function applyAll() {
    if (!accepted.length) return
    setApplying(true)
    try {
      for (const p of accepted) {
        await shiftRepo.create({
          user: { id: p.userId, name: p.userName },
          kind: 'dienst',
          startAt: p.startAt,
          endAt: p.endAt,
          breakMinutes: p.breakMinutes,
          note: 'Smartroster',
          createdBy: me.id,
        })
      }
      toast.ok(`${accepted.length} diensten ingepland`)
      setRejected(new Set())
    } finally {
      setApplying(false)
    }
  }

  async function publish() {
    const namen = [...new Set(accepted.map((p) => p.userId))]
    for (const userId of namen) {
      const person = staff.find((u) => u.id === userId)
      if (!person) continue
      await notifyRepo.send({
        to: { id: person.id, name: person.name },
        from: { id: me.id, name: me.name },
        kind: 'rooster',
        title: `Rooster week ${weekNumber(start)} staat klaar`,
        body: 'Je diensten voor volgende week zijn ingepland. Bekijk ze in je rooster.',
        link: 'rooster',
      })
    }
    toast.ok(`${namen.length} medewerkers geïnformeerd`)
  }

  const totaalUren = Math.round(accepted.reduce((a, p) => a + p.hours, 0) * 10) / 10

  return (
    <>
      <div className="row" style={{ marginBottom: 14, flexWrap: 'nowrap' }}>
        <button className="btn ghost sm" onClick={() => setOffset(offset - 1)}>
          <ChevronLeft size={15} />
        </button>
        <button className="btn ghost sm" onClick={() => setOffset(1)} disabled={offset === 1}>
          Volgende week
        </button>
        <button className="btn ghost sm" onClick={() => setOffset(offset + 1)}>
          <ChevronRight size={15} />
        </button>
        <div style={{ marginLeft: 6 }}>
          <strong style={{ fontSize: '.9rem' }}>Week {weekNumber(start)}</strong>
          <div style={{ fontSize: '.73rem', color: 'var(--text-3)' }}>
            {new Date(start).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
            {' t/m '}
            {new Date(start + 6 * DAY).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {canEdit && accepted.length > 0 && (
          <>
            <button className="btn primary" onClick={() => void applyAll()} disabled={applying}>
              <Check size={15} /> {accepted.length} inplannen ({totaalUren} u)
            </button>
            {perms.can('roster.publish') && (
              <button className="btn sm" onClick={() => void publish()}>
                <Send size={14} /> Team informeren
              </button>
            )}
          </>
        )}
      </div>

      {plan.warnings.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            borderColor: 'rgba(245,181,68,.35)',
            background: 'rgba(245,181,68,.07)',
          }}
        >
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <TriangleAlert size={17} color="var(--warn)" style={{ marginTop: 1, flex: 'none' }} />
            <div>
              <strong style={{ fontSize: '.88rem' }}>Krappe bezetting</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '.82rem', color: 'var(--text-2)' }}>
                {plan.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid sidebar-right">
        <Card
          title="Voorstel"
          hint={
            plan.proposals.length
              ? `${plan.proposals.length} diensten, ${accepted.length} geselecteerd`
              : undefined
          }
          flush
        >
          {plan.proposals.length === 0 ? (
            <Empty
              text="Niets voor te stellen: iedereen zit al aan zijn contracturen voor deze week."
              icon={<Sparkles size={30} />}
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Dag</th>
                    <th>Medewerker</th>
                    <th>Tijd</th>
                    <th className="num">Uren</th>
                    <th>Waarom</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.proposals.map((p) => {
                    const isRejected = rejected.has(key(p))
                    return (
                      <tr key={key(p)} style={{ opacity: isRejected ? 0.4 : 1 }}>
                        <td>
                          <strong>{DAY_LABELS[(new Date(p.day).getDay() + 6) % 7]}</strong>{' '}
                          <span style={{ color: 'var(--text-3)' }}>
                            {new Date(p.day).getDate()}
                          </span>
                        </td>
                        <td>{p.userName}</td>
                        <td className="mono">
                          {new Date(p.startAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                          {' - '}
                          {new Date(p.endAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="num">{p.hours}</td>
                        <td style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>{p.reason}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn ghost sm"
                            title={isRejected ? 'Toch inplannen' : 'Dit voorstel overslaan'}
                            onClick={() => {
                              const next = new Set(rejected)
                              if (isRejected) next.delete(key(p))
                              else next.add(key(p))
                              setRejected(next)
                            }}
                          >
                            {isRejected ? <Check size={14} /> : <X size={14} />}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Per medewerker" hint="Contract versus ingepland">
          {plan.summary.length === 0 ? (
            <Empty text="Geen medewerkers met contracturen." />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {plan.summary.map((s) => {
                const total = s.plannedHours + s.proposedHours
                const pct = s.contractHours ? Math.min(140, (total / s.contractHours) * 100) : 0
                const tone = total < s.contractHours - 2
                  ? 'warn'
                  : total > s.contractHours + 2 ? 'danger' : undefined
                return (
                  <div key={s.userId}>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: '.84rem', marginBottom: 4 }}>
                      <span>{s.userName}</span>
                      <span className="mono" style={{ color: 'var(--text-2)' }}>
                        {total} / {s.contractHours} u
                      </span>
                    </div>
                    <div className={`bar ${tone ?? ''}`}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <div style={{ fontSize: '.72rem', color: 'var(--text-3)', marginTop: 3 }}>
                      {s.plannedHours > 0 && `${s.plannedHours} u stond al · `}
                      {s.proposedHours > 0 && `${s.proposedHours} u voorgesteld`}
                      {s.note && (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--warn)' }}>{s.note}</span>
                        </>
                      )}
                    </div>
                    {s.pattern.sampleSize > 0 && (
                      <div style={{ fontSize: '.71rem', color: 'var(--text-3)', marginTop: 2 }}>
                        Werkt meestal {String(Math.floor(s.pattern.usualStart)).padStart(2, '0')}
                        :{s.pattern.usualStart % 1 ? '30' : '00'}
                        {' - '}
                        {String(Math.floor(s.pattern.usualEnd)).padStart(2, '0')}
                        :{s.pattern.usualEnd % 1 ? '30' : '00'}
                        {' · '}{s.pattern.sampleSize} diensten bekeken
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!canEdit && (
            <div style={{ marginTop: 14, fontSize: '.8rem', color: 'var(--text-3)' }}>
              <Badge tone="warn">Alleen lezen</Badge> Je hebt geen recht om het rooster te wijzigen.
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
