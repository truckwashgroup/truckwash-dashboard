import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BadgeCheck, ShieldCheck, Timer, UserCog, Users } from 'lucide-react'
import { db } from '../../lib/db'
import { users as userRepo } from '../../lib/repo'
import type { Role, TimeEntry, User, WashJob } from '../../lib/types'
import { duration, initials, money, number } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { staffPerformance } from '../../lib/analytics'

const ROLE_LABELS: Record<Role, string> = {
  employee: 'Werknemer',
  customer: 'Klant',
  management: 'Management',
}

const ALL_ROLES: Role[] = ['employee', 'customer', 'management']

export default function Personeel({ days }: { days: number }) {
  const me = useAuth((s) => s.user)!
  const [editing, setEditing] = useState<User | null>(null)
  const [draftRoles, setDraftRoles] = useState<Role[]>([])
  const [draftRate, setDraftRate] = useState('')

  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])

  const rows = useMemo(
    () => staffPerformance(users, jobs, entries, days),
    [users, jobs, entries, days],
  )

  const totaalUren = rows.reduce((a, r) => a + r.minuten, 0)
  const totaalLoon = rows.reduce((a, r) => a + r.loonkosten, 0)
  const totaalOmzet = rows.reduce((a, r) => a + r.omzet, 0)

  function openEdit(u: User) {
    setEditing(u)
    setDraftRoles([...u.roles])
    setDraftRate(String(u.hourlyRate ?? 0))
  }

  async function save() {
    if (!editing) return
    if (draftRoles.length === 0) return toast.error('Kies minimaal één rol')

    await userRepo.setRoles(editing.id, draftRoles)
    const rate = Number(draftRate.replace(',', '.'))
    if (Number.isFinite(rate)) await userRepo.setRate(editing.id, rate)

    toast.ok(`Rechten van ${editing.name} bijgewerkt`)
    setEditing(null)
  }

  async function toggleActive(u: User) {
    if (u.id === me.id) return toast.warn('Je kunt jezelf niet deactiveren')
    await userRepo.setActive(u.id, !u.active)
    toast.info(`${u.name} is nu ${u.active ? 'inactief' : 'actief'}`)
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Medewerkers" value={rows.length} icon={<Users size={17} />} />
        <Stat label={`Uren (${days}d)`} value={duration(totaalUren * 60000)} icon={<Timer size={17} />} />
        <Stat label="Loonkosten" value={money(totaalLoon)} icon={<UserCog size={17} />} tone="warn" />
        <Stat
          label="Omzet per loon-euro"
          value={totaalLoon > 0 ? (totaalOmzet / totaalLoon).toFixed(2) + '×' : '—'}
          icon={<BadgeCheck size={17} />}
          tone="ok"
        />
      </div>

      <Card title="Prestaties" hint={`Laatste ${days} dagen`} flush>
        {rows.length === 0 ? (
          <Empty text="Geen medewerkers gevonden." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Medewerker</th>
                  <th className="num">Wasbeurten</th>
                  <th className="num">Uren</th>
                  <th className="num">Gem. per was</th>
                  <th className="num">Omzet</th>
                  <th className="num">Loonkosten</th>
                  <th>Rollen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user: u, ...r }) => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                    <td>
                      <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
                        <div
                          style={{
                            width: 30, height: 30, borderRadius: 9, flex: 'none',
                            display: 'grid', placeItems: 'center',
                            background: 'var(--surface-3)', fontSize: '.7rem', fontWeight: 700,
                          }}
                        >
                          {initials(u.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <strong>{u.name}</strong>
                          <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{number(r.jobs)}</td>
                    <td className="num">{duration(r.minuten * 60000)}</td>
                    <td className="num">{r.gemMinPerWas ? `${r.gemMinPerWas}m` : '—'}</td>
                    <td className="num">{money(r.omzet)}</td>
                    <td className="num" style={{ color: 'var(--text-3)' }}>{money(r.loonkosten)}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {u.roles.map((role) => (
                          <Badge key={role} tone={role === 'management' ? 'brand' : 'default'}>
                            {role === 'management' && <ShieldCheck size={11} />}
                            {ROLE_LABELS[role]}
                          </Badge>
                        ))}
                        {!u.active && <Badge tone="danger">Inactief</Badge>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => openEdit(u)}>
                        <UserCog size={14} /> Rechten
                      </button>{' '}
                      <button
                        className={`btn sm ${u.active ? 'ghost' : 'ok'}`}
                        onClick={() => void toggleActive(u)}
                        disabled={u.id === me.id}
                      >
                        {u.active ? 'Blokkeren' : 'Activeren'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!editing}
        title="Rechten en tarief"
        subtitle={editing?.name}
        onClose={() => setEditing(null)}
      >
        <Field
          label="Dashboards waar deze gebruiker bij mag"
          help="Het managementdashboard verschijnt pas als de rol Management is toegekend."
        >
          <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
            {ALL_ROLES.map((role) => {
              const on = draftRoles.includes(role)
              return (
                <button
                  key={role}
                  className={`btn ${on ? 'primary' : ''}`}
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() =>
                    setDraftRoles(on ? draftRoles.filter((r) => r !== role) : [...draftRoles, role])
                  }
                >
                  {role === 'management' ? <ShieldCheck size={15} /> : <Users size={15} />}
                  {ROLE_LABELS[role]}
                  {on && <span style={{ marginLeft: 'auto', fontSize: '.75rem' }}>Aan</span>}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Uurtarief (€)">
          <input
            className="input"
            inputMode="decimal"
            value={draftRate}
            onChange={(e) => setDraftRate(e.target.value)}
          />
        </Field>

        <div className="row end">
          <button className="btn ghost" onClick={() => setEditing(null)}>Annuleren</button>
          <button className="btn primary" onClick={() => void save()}>Opslaan</button>
        </div>
      </Modal>
    </>
  )
}
