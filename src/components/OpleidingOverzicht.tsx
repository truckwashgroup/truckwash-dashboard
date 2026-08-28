import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Award, Bell, CalendarClock, Check, GraduationCap, TriangleAlert, X } from 'lucide-react'
import { db } from '../lib/db'
import { learning, notifications as notifyRepo } from '../lib/repo'
import { COURSE_CATEGORIES, type Course, type CourseProgress, type User } from '../lib/types'
import { initials } from '../lib/format'
import { Badge, Card, Empty, Stat } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { toast } from '../store/useToasts'

const DAY = 86_400_000

type Status = 'af' | 'bezig' | 'open' | 'verlopen' | 'binnenkort'

function statusOf(course: Course, p?: CourseProgress): Status {
  if (!p || p.startedAt === 0) return 'open'
  if (p.passed && p.expiresAt && p.expiresAt < Date.now()) return 'verlopen'
  if (p.passed && p.expiresAt && p.expiresAt - Date.now() < 30 * DAY) return 'binnenkort'
  if (p.passed) return 'af'
  return 'bezig'
}

const BADGE: Record<Status, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'default'; label: string }> = {
  af: { tone: 'ok', label: 'Afgerond' },
  bezig: { tone: 'info', label: 'Bezig' },
  open: { tone: 'default', label: 'Niet begonnen' },
  verlopen: { tone: 'danger', label: 'Verlopen' },
  binnenkort: { tone: 'warn', label: 'Verloopt bijna' },
}

/**
 * Wie heeft wat gedaan. Bedoeld voor leidinggevenden en management: één
 * matrix van medewerkers tegen cursussen, met de mogelijkheid om iemand aan
 * te sporen of een cursus toe te wijzen.
 */
export default function OpleidingOverzicht({ team }: { team?: User[] }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [busy, setBusy] = useState(false)

  const allUsers = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const courses = useLiveQuery(() => db.courses.toArray(), [], [] as Course[])
  const progress = useLiveQuery(() => db.courseProgress.toArray(), [], [] as CourseProgress[])

  const staff = useMemo(
    () => (team ?? allUsers)
      .filter((u) => u.active && (u.roles.includes('employee') || u.roles.includes('supervisor')))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [team, allUsers],
  )

  const byKey = useMemo(
    () => new Map(progress.map((p) => [`${p.userId}__${p.courseId}`, p])),
    [progress],
  )

  const cells = useMemo(() => {
    const rows = staff.map((u) => ({
      user: u,
      items: courses.map((c) => {
        const p = byKey.get(`${u.id}__${c.id}`)
        return {
          course: c,
          progress: p,
          status: statusOf(c, p),
          required: c.requiredFor.some((r) => u.roles.includes(r)),
        }
      }),
    }))
    return rows
  }, [staff, courses, byKey])

  const stats = useMemo(() => {
    let verplicht = 0
    let af = 0
    let verlopen = 0
    let achterstand = 0
    for (const row of cells) {
      let rowOpen = 0
      for (const cell of row.items) {
        if (!cell.required) continue
        verplicht++
        if (cell.status === 'af' || cell.status === 'binnenkort') af++
        else rowOpen++
        if (cell.status === 'verlopen') verlopen++
      }
      if (rowOpen > 0) achterstand++
    }
    return { verplicht, af, verlopen, achterstand }
  }, [cells])

  async function herinner(user: User, course: Course) {
    if (!perms.can('notify.send')) return toast.error('Je mag geen berichten sturen')
    setBusy(true)
    try {
      await notifyRepo.send({
        to: { id: user.id, name: user.name },
        from: { id: me.id, name: me.name },
        kind: 'opleiding',
        title: `Cursus openstaand: ${course.title}`,
        body: `${course.code} staat nog open. Hij duurt ongeveer ${course.estimatedMinutes} minuten.`,
        link: 'opleiding',
      })
      toast.ok(`${user.name.split(' ')[0]} is herinnerd`)
    } finally {
      setBusy(false)
    }
  }

  async function wijsToe(user: User, course: Course) {
    if (!perms.can('learning.assign')) return toast.error('Je mag geen cursussen toewijzen')
    await learning.assign({
      user: { id: user.id, name: user.name },
      courseId: course.id,
      assignedBy: me.id,
      dueAt: Date.now() + 14 * DAY,
    })
    await notifyRepo.send({
      to: { id: user.id, name: user.name },
      from: { id: me.id, name: me.name },
      kind: 'opleiding',
      title: `Nieuwe cursus toegewezen: ${course.title}`,
      body: 'Je hebt twee weken om deze cursus af te ronden.',
      link: 'opleiding',
    })
    toast.ok('Toegewezen, met een termijn van twee weken')
  }

  if (courses.length === 0) {
    return (
      <Card>
        <Empty text="Er staat nog geen lesmateriaal klaar." icon={<GraduationCap size={30} />} />
      </Card>
    )
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Verplicht afgerond"
          value={`${stats.af} / ${stats.verplicht}`}
          icon={<Award size={17} />}
          tone={stats.af === stats.verplicht ? 'ok' : 'warn'}
        />
        <Stat label="Medewerkers" value={staff.length} icon={<GraduationCap size={17} />} />
        <Stat
          label="Met achterstand"
          value={stats.achterstand}
          icon={<CalendarClock size={17} />}
          tone={stats.achterstand ? 'warn' : 'ok'}
        />
        <Stat
          label="Verlopen certificaten"
          value={stats.verlopen}
          icon={<TriangleAlert size={17} />}
          tone={stats.verlopen ? 'danger' : 'ok'}
        />
      </div>

      <Card title="Wie heeft wat gedaan" hint="Klik op een vakje voor een actie" flush>
        <div className="table-wrap">
          <table className="data matrix">
            <thead>
              <tr>
                <th style={{ minWidth: 190 }}>Medewerker</th>
                {courses.map((c) => (
                  <th key={c.id} title={c.title}>
                    <div className="matrix-head">
                      <span className={`course-cat cat-${c.category}`}>{c.code}</span>
                      <span className="matrix-title">{c.title}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map(({ user, items }) => (
                <tr key={user.id}>
                  <td>
                    <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
                      <div
                        style={{
                          width: 28, height: 28, borderRadius: 8, flex: 'none',
                          display: 'grid', placeItems: 'center',
                          background: 'var(--surface-3)', fontSize: '.68rem', fontWeight: 700,
                        }}
                      >
                        {initials(user.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <strong>{user.name}</strong>
                        <div style={{ fontSize: '.71rem', color: 'var(--text-3)' }}>
                          {user.function ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>

                  {items.map((cell) => {
                    const meta = BADGE[cell.status]
                    const actionable =
                      cell.status !== 'af' && (perms.can('notify.send') || perms.can('learning.assign'))
                    return (
                      <td key={cell.course.id} style={{ textAlign: 'center' }}>
                        <div className="matrix-cell">
                          <Badge tone={meta.tone}>
                            {cell.status === 'af' && <Check size={11} />}
                            {cell.status === 'verlopen' && <X size={11} />}
                            {meta.label}
                          </Badge>
                          {cell.required && cell.status !== 'af' && (
                            <span className="matrix-req">verplicht</span>
                          )}
                          {actionable && (
                            <div className="matrix-actions">
                              {perms.can('notify.send') && (
                                <button
                                  className="btn ghost sm"
                                  disabled={busy}
                                  title="Herinnering sturen"
                                  onClick={() => void herinner(user, cell.course)}
                                >
                                  <Bell size={12} />
                                </button>
                              )}
                              {perms.can('learning.assign') && cell.status === 'open' && (
                                <button
                                  className="btn ghost sm"
                                  title="Toewijzen met termijn"
                                  onClick={() => void wijsToe(user, cell.course)}
                                >
                                  <CalendarClock size={12} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Cursussen" hint={`${courses.length} beschikbaar`} className="mt" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Cursus</th>
                <th>Onderwerp</th>
                <th className="num">Duur</th>
                <th className="num">Slaagnorm</th>
                <th>Geldigheid</th>
                <th>Verplicht voor</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td><strong>{c.title}</strong></td>
                  <td>
                    <span className={`course-cat cat-${c.category}`}>
                      {COURSE_CATEGORIES[c.category]}
                    </span>
                  </td>
                  <td className="num">{c.estimatedMinutes} min</td>
                  <td className="num">{c.passScore}%</td>
                  <td>{c.validMonths ? `${c.validMonths} maanden` : 'Verloopt niet'}</td>
                  <td style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
                    {c.requiredFor.length ? c.requiredFor.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
