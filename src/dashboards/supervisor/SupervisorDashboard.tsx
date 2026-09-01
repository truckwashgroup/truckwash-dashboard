import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarDays, CheckCircle2, ClipboardList, Clock, GraduationCap, LayoutGrid,
  MessageSquare, Send, Sparkles, Square, Timer, TriangleAlert, Truck, Users,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import { SERVICES, SHIFT_KINDS, type Shift, type TimeEntry, type User, type WashJob } from '../../lib/types'
import { dateFull, duration, initials, money, time } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'
import WeekRooster from '../../components/WeekRooster'
import SmartRosterPanel from '../../components/SmartRosterPanel'
import BerichtVersturen from '../../components/BerichtVersturen'
import OpleidingOverzicht from '../../components/OpleidingOverzicht'
import Opleiding from '../../components/Opleiding'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import Personeel from '../management/Personeel'
import Agenda from '../../components/Agenda'
import { Start, type Tegel, type TegelTint } from '../../components/Tegels'
import { useAuth } from '../../store/useAuth'
import { usePerms, useNavTarget } from '../../store/useNav'
import { timeEntries as timeRepo } from '../../lib/repo'
import Urenverzoeken from '../../components/Urenverzoeken'
import { toast } from '../../store/useToasts'
import { shiftsOnDay, shiftHours, shiftRange, weekStart } from '../../lib/roster'
import { startOfDay } from '../../lib/analytics'

const DAY = 86_400_000

const TITLES: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Start', subtitle: 'Waar wil je heen?' },
  team: { title: 'Mijn team', subtitle: 'Wie staat er vandaag en hoe loopt het' },
  rooster: { title: 'Rooster', subtitle: 'Plannen en publiceren' },
  smart: { title: 'Smartroster', subtitle: 'Voorstel op basis van contract en gewoontes' },
  uren: { title: 'Uren', subtitle: 'Registraties van het team' },
  opleiding: { title: 'Opleiding', subtitle: 'Voortgang van je team' },
  mijn: { title: 'Mijn opleiding', subtitle: 'Cursussen die jij moet doen' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken' },
  personeel: { title: 'Dossiers', subtitle: 'Gegevens inzien en wijzigingen aanvragen' },
  agenda: { title: 'Agenda', subtitle: 'Afspraken, verjaardagen en wat er aankomt' },
}

export default function SupervisorDashboard() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [page, setPage] = useState('start')
  const [messaging, setMessaging] = useState(false)

  const allUsers = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  /** Het team: wie deze leidinggevende onder zich heeft, plus hijzelf. */
  const team = useMemo(() => {
    const direct = allUsers.filter((u) => u.supervisorId === me.id && u.active)
    // Is er niemand expliciet gekoppeld, dan val je terug op alle werknemers.
    const fallback = allUsers.filter((u) => u.active && u.roles.includes('employee'))
    return direct.length > 0 ? direct : fallback
  }, [allUsers, me.id])

  const ongelezen = useOverlegTeller()
  const alleShifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[])
  const alleUren = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])

  /** Twee cijfers voor op de tegels: hoe vol staat de week, en wie werkt er nu. */
  const { dezeWeek, nuIngeklokt } = useMemo(() => {
    const ids = new Set(team.map((u) => u.id))
    const start = weekStart(Date.now())
    return {
      dezeWeek: alleShifts.filter(
        (s) => ids.has(s.userId) && s.kind === 'dienst' &&
               s.startAt >= start && s.startAt < start + 7 * DAY).length,
      nuIngeklokt: alleUren.filter((e) => ids.has(e.userId) && !e.end).length,
    }
  }, [team, alleShifts, alleUren])

  const items: NavItem[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid },
    { key: 'team', label: 'Mijn team', icon: Users },
    ...(perms.can('roster.viewTeam') ? [{ key: 'rooster', label: 'Rooster', icon: CalendarDays }] : []),
    ...(perms.can('roster.edit') ? [{ key: 'smart', label: 'Smartroster', icon: Sparkles }] : []),
    ...(perms.can('hours.viewTeam') ? [{ key: 'uren', label: 'Uren', icon: Timer }] : []),
    ...(perms.can('learning.assign') ? [{ key: 'opleiding', label: 'Opleiding', icon: GraduationCap }] : []),
    ...(perms.can('staff.view')
      ? [{ key: 'personeel', label: 'Dossiers', icon: Users }]
      : []),
    ...(perms.can('agenda.view')
      ? [{ key: 'agenda', label: 'Agenda', icon: CalendarDays }]
      : []),
    { key: 'mijn', label: 'Mijn cursussen', icon: ClipboardList },
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
  ]

  useNavTarget(items.map((i) => i.key), (p) => setPage(p))

  const meta = TITLES[page] ?? TITLES.start

  const tegels: Tegel[] = [
    {
      key: 'team',
      label: 'Mijn team',
      hint: 'Wie er staat, wie is ingeklokt en hoe het loopt',
      icon: Users,
      tint: 'brand',
      stat: team.length,
      statLabel: 'teamleden',
      onClick: () => setPage('team'),
    },
    ...(perms.can('roster.viewTeam') ? [{
      key: 'rooster',
      label: 'Rooster',
      hint: 'Diensten plannen en publiceren',
      icon: CalendarDays,
      tint: 'info' as TegelTint,
      stat: dezeWeek,
      statLabel: 'diensten deze week',
      onClick: () => setPage('rooster'),
    }] : []),
    ...(perms.can('roster.edit') ? [{
      key: 'smart',
      label: 'Smartroster',
      hint: 'Voorstel op basis van contract en gewoontes',
      icon: Sparkles,
      tint: 'oranje' as TegelTint,
      onClick: () => setPage('smart'),
    }] : []),
    ...(perms.can('hours.viewTeam') ? [{
      key: 'uren',
      label: 'Uren',
      hint: 'Registraties van je team',
      icon: Timer,
      tint: 'neutraal' as TegelTint,
      stat: nuIngeklokt,
      statLabel: 'nu ingeklokt',
      onClick: () => setPage('uren'),
    }] : []),
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Je team bereiken zonder groepsapp',
      icon: MessageSquare,
      tint: 'paars' as TegelTint,
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
    ...(perms.can('agenda.view') ? [{
      key: 'agenda',
      label: 'Agenda',
      hint: 'Afspraken, verjaardagen en jubilea van je team',
      icon: CalendarDays,
      tint: 'info' as TegelTint,
      onClick: () => setPage('agenda'),
    }] : []),
    ...(perms.can('staff.view') ? [{
      key: 'personeel',
      label: 'Dossiers',
      hint: 'Gegevens inzien en een wijziging aanvragen',
      icon: Users,
      tint: 'neutraal' as TegelTint,
      onClick: () => setPage('personeel'),
    }] : []),
    ...(perms.can('learning.assign') ? [{
      key: 'opleiding',
      label: 'Opleiding',
      hint: 'Wie welke cursus nog moet doen',
      icon: GraduationCap,
      tint: 'neutraal' as TegelTint,
      onClick: () => setPage('opleiding'),
    }] : []),
    {
      key: 'mijn',
      label: 'Mijn cursussen',
      hint: 'Wat jij zelf nog openstaan hebt',
      icon: ClipboardList,
      tint: 'neutraal',
      onClick: () => setPage('mijn'),
    },
  ]

  return (
    <Shell
      roleLabel="Leidinggevende"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={page === 'team' || page === 'start' ? dateFull(Date.now()) : meta.subtitle}
      menu={
        perms.can('notify.send')
          ? [{
              title: 'Versturen',
              items: [{
                key: 'bericht',
                label: 'Bericht sturen',
                hint: 'Je team bereiken, ook wie nu niet in de app zit',
                icon: <Send size={16} />,
                onClick: () => setMessaging(true),
              }],
            }]
          : undefined
      }
    >
      {page === 'start' && <Start tegels={tegels} />}
      {page === 'team' && <TeamVandaag team={team} onMessage={() => setMessaging(true)} />}
      {page === 'rooster' && <TeamRooster team={team} />}
      {page === 'smart' && <SmartRosterPanel team={team} />}
      {page === 'uren' && <TeamUren team={team} />}
      {page === 'opleiding' && <OpleidingOverzicht team={team} />}
      {page === 'mijn' && <Opleiding />}
      {page === 'overleg' && <Overleg />}
      {page === 'personeel' && <Personeel days={30} />}
      {page === 'agenda' && <Agenda />}

      <BerichtVersturen open={messaging} onClose={() => setMessaging(false)} team={team} />
    </Shell>
  )
}

/* ================================================================== *
 *  Vandaag
 * ================================================================== */

function TeamVandaag({ team, onMessage }: { team: User[]; onMessage: () => void }) {
  const perms = usePerms()
  const today = startOfDay(Date.now())

  const shifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[])
  const jobs = useLiveQuery(
    async () =>
      (await db.washJobs.where('scheduledAt').between(today, today + DAY, true, false).toArray())
        .sort((a, b) => a.scheduledAt - b.scheduledAt),
    [today],
    [] as WashJob[],
  )
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])

  const vandaag = useMemo(() => {
    return team.map((u) => {
      const mine = shiftsOnDay(shifts.filter((s) => s.userId === u.id), today)
      const shift = mine[0]
      const running = entries.find((e) => e.userId === u.id && !e.end)
      const done = jobs.filter((j) => j.assignedTo === u.id && j.status === 'gereed').length
      const busy = jobs.find((j) => j.assignedTo === u.id && j.status === 'bezig')
      return { user: u, shift, running, done, busy }
    })
  }, [team, shifts, entries, jobs, today])

  const ingeroosterd = vandaag.filter((v) => v.shift?.kind === 'dienst')
  const afwezig = vandaag.filter((v) => v.shift && v.shift.kind !== 'dienst')
  const aanwezig = vandaag.filter((v) => v.running)

  const wachtrij = jobs.filter((j) => j.status === 'wachtrij' || j.status === 'gepland')
  const gereed = jobs.filter((j) => j.status === 'gereed')
  const capaciteit = ingeroosterd.reduce((a, v) => a + (v.shift ? shiftHours(v.shift) : 0), 0)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Ingeroosterd" value={ingeroosterd.length} icon={<Users size={17} />} />
        <Stat
          label="Ingeklokt"
          value={aanwezig.length}
          icon={<Clock size={17} />}
          tone={aanwezig.length < ingeroosterd.length ? 'warn' : 'ok'}
        />
        <Stat label="Nog te doen" value={wachtrij.length} icon={<Truck size={17} />} tone="warn" />
        <Stat label="Gereed vandaag" value={gereed.length} icon={<CheckCircle2 size={17} />} tone="ok" />
      </div>

      {wachtrij.length > capaciteit * 1.2 && capaciteit > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderColor: 'rgba(245,181,68,.35)',
            background: 'rgba(245,181,68,.07)',
          }}
        >
          <div className="row" style={{ gap: 10 }}>
            <TriangleAlert size={17} color="var(--warn)" />
            <span style={{ fontSize: '.87rem' }}>
              <strong>Het loopt vol.</strong> {wachtrij.length} wagens open met {ingeroosterd.length} man
              op de vloer.
            </span>
            {perms.can('notify.send') && (
              <>
                <span style={{ flex: 1 }} />
                <button className="btn sm" onClick={onMessage}>
                  <MessageSquare size={14} /> Team oproepen
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid sidebar-right">
        <Card title="Het team vandaag" flush>
          {vandaag.length === 0 ? (
            <Empty text="Geen teamleden gevonden." icon={<Users size={30} />} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Medewerker</th>
                    <th>Dienst</th>
                    <th>Status</th>
                    <th className="num">Gereed</th>
                    <th>Nu bezig met</th>
                  </tr>
                </thead>
                <tbody>
                  {vandaag.map(({ user, shift, running, done, busy }) => (
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
                      <td>
                        {shift ? (
                          shift.kind === 'dienst'
                            ? <span className="mono">{shiftRange(shift)}</span>
                            : <Badge tone={shift.kind === 'ziek' ? 'danger' : 'info'}>
                                {SHIFT_KINDS[shift.kind].label}
                              </Badge>
                        ) : (
                          <span style={{ color: 'var(--text-3)' }}>niet ingeroosterd</span>
                        )}
                      </td>
                      <td>
                        {running ? (
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <Badge tone="ok" dot>Ingeklokt {duration(Date.now() - running.start)}</Badge>
                            {/*
                              * Klokken gebeurt aan de kassa. Het enige wat
                              * hier hoort is de regel van iemand die aan het
                              * eind van de dag vergat uit te klokken -- anders
                              * blijft die eeuwig doorlopen.
                              */}
                            {perms.can('hours.approve') && Date.now() - running.start > 12 * 3_600_000 && (
                              <button
                                className="btn ghost sm"
                                title="Deze registratie loopt al meer dan twaalf uur — afsluiten"
                                onClick={() => void timeRepo.afsluiten(running.id).then(
                                  () => toast.info(`Registratie van ${user.name} afgesloten`))}
                              >
                                <Square size={13} />
                              </button>
                            )}
                          </div>
                        ) : shift?.kind === 'dienst' ? (
                          <Badge tone="warn">Nog niet ingeklokt</Badge>
                        ) : (
                          <Badge>—</Badge>
                        )}
                      </td>
                      <td className="num">{done}</td>
                      <td style={{ color: 'var(--text-3)' }}>
                        {busy ? `${busy.plate} · ${SERVICES[busy.service].label}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Wachtrij" hint={`${wachtrij.length} wagens`} flush>
          {wachtrij.length === 0 ? (
            <Empty text="Alles opgepakt." icon={<CheckCircle2 size={30} />} />
          ) : (
            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              {wachtrij.map((j) => (
                <div
                  key={j.id}
                  style={{ padding: '11px 16px', borderBottom: '1px solid var(--line-soft)' }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: '.88rem' }}>{j.plate}</strong>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: '.8rem', color: 'var(--text-3)' }}>
                      {time(j.scheduledAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>
                    {j.companyName} · {SERVICES[j.service].label}
                    {j.assignedName ? ` · ${j.assignedName}` : ' · niet toegewezen'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {afwezig.length > 0 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-soft)' }}>
              <div style={{ fontSize: '.72rem', color: 'var(--text-3)', marginBottom: 6 }}>
                AFWEZIG VANDAAG
              </div>
              {afwezig.map((v) => (
                <div key={v.user.id} style={{ fontSize: '.82rem', color: 'var(--text-2)' }}>
                  {v.user.name} — {SHIFT_KINDS[v.shift!.kind].label}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/* ================================================================== *
 *  Rooster van het team
 * ================================================================== */

function TeamRooster({ team }: { team: User[] }) {
  const perms = usePerms()
  const [selected, setSelected] = useState<string | null>(team[0]?.id ?? null)
  const person = team.find((u) => u.id === selected) ?? team[0]

  const shifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[])
  const start = weekStart(Date.now())

  const perPerson = useMemo(
    () => team.map((u) => {
      const week = shifts.filter(
        (s) => s.userId === u.id && s.startAt >= start && s.startAt < start + 7 * DAY,
      )
      return {
        user: u,
        hours: Math.round(week.reduce((a, s) => a + shiftHours(s), 0) * 10) / 10,
        diensten: week.filter((s) => s.kind === 'dienst').length,
      }
    }),
    [team, shifts, start],
  )

  if (!person) return <Card><Empty text="Geen teamleden." /></Card>

  return (
    <>
      <Card title="Deze week" hint="Klik op iemand om zijn rooster te openen" className="mb">
        <div className="team-strip">
          {perPerson.map(({ user, hours, diensten }) => {
            const contract = user.contractHours ?? 0
            const tekort = contract > 0 && hours < contract - 2
            return (
              <button
                key={user.id}
                className={`team-chip ${person.id === user.id ? 'active' : ''}`}
                onClick={() => setSelected(user.id)}
              >
                <span className="av">{initials(user.name)}</span>
                <span className="who">
                  <span className="n">{user.name.split(' ')[0]}</span>
                  <span className={`h ${tekort ? 'low' : ''}`}>
                    {hours} u{contract ? ` / ${contract}` : ''} · {diensten} dg
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card title={`Rooster van ${person.name}`} hint={perms.can('roster.edit') ? 'Klik op een dag om te plannen' : 'Alleen lezen'}>
        <WeekRooster person={person} editable={perms.can('roster.edit')} />
      </Card>
    </>
  )
}

/* ================================================================== *
 *  Uren van het team
 * ================================================================== */

function TeamUren({ team }: { team: User[] }) {
  const [days, setDays] = useState(7)
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])
  const teamIds = useMemo(() => new Set(team.map((u) => u.id)), [team])

  const from = startOfDay(Date.now() - (days - 1) * DAY)

  const rows = useMemo(
    () => team.map((u) => {
      const mine = entries.filter((e) => e.userId === u.id && e.start >= from)
      const minuten = mine.filter((e) => e.end).reduce((a, e) => a + (e.end! - e.start) / 60000, 0)
      const loopt = mine.find((e) => !e.end)
      return { user: u, minuten: Math.round(minuten), registraties: mine.length, loopt }
    }).sort((a, b) => b.minuten - a.minuten),
    [team, entries, from],
  )

  const recent = useMemo(
    () => entries
      .filter((e) => teamIds.has(e.userId) && e.start >= from)
      .sort((a, b) => b.start - a.start)
      .slice(0, 40),
    [entries, from, teamIds],
  )

  const totaal = rows.reduce((a, r) => a + r.minuten, 0)

  return (
    <>
      {/*
        * Bovenaan, want dit is wat er op jou wacht. De urenstaat zelf kun je
        * altijd nog bekijken; een verzoek dat blijft liggen kost iemand geld.
        */}
      <div className="mb"><Urenverzoeken teamIds={teamIds} /></div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label={`Totaal (${days} dagen)`} value={duration(totaal * 60000)} icon={<Timer size={17} />} />
        <Stat label="Nu ingeklokt" value={rows.filter((r) => r.loopt).length} icon={<Clock size={17} />} tone="ok" />
        <Stat label="Teamleden" value={team.length} icon={<Users size={17} />} />
      </div>

      <Card
        title="Per medewerker"
        flush
        action={
          <div className="row" style={{ gap: 5 }}>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                className={`btn sm ${days === d ? 'primary' : 'ghost'}`}
                onClick={() => setDays(d)}
              >
                {d} dagen
              </button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Medewerker</th>
                <th className="num">Uren</th>
                <th className="num">Registraties</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ user, minuten, registraties, loopt }) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong></td>
                  <td className="num">{duration(minuten * 60000)}</td>
                  <td className="num">{registraties}</td>
                  <td>
                    {loopt
                      ? <Badge tone="ok" dot>Loopt sinds {time(loopt.start)}</Badge>
                      : <Badge>Uitgeklokt</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Laatste registraties" flush className="mt">
        {recent.length === 0 ? (
          <Empty text="Geen registraties in deze periode." />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Medewerker</th>
                  <th>Datum</th>
                  <th>Van</th>
                  <th>Tot</th>
                  <th>Omschrijving</th>
                  <th className="num">Duur</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id}>
                    <td>{e.userName}</td>
                    <td>{new Date(e.start).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })}</td>
                    <td className="mono">{time(e.start)}</td>
                    <td className="mono">{e.end ? time(e.end) : '—'}</td>
                    <td style={{ color: 'var(--text-3)' }}>{e.note ?? '—'}</td>
                    <td className="num">{e.end ? duration(e.end - e.start) : 'loopt'}</td>
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
