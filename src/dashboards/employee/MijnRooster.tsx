import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Clock, Sun, Umbrella } from 'lucide-react'
import { db } from '../../lib/db'
import { SHIFT_KINDS, type Shift } from '../../lib/types'
import { Card, Empty, Stat } from '../../components/ui'
import WeekRooster from '../../components/WeekRooster'
import { useAuth } from '../../store/useAuth'
import { shiftHours, shiftRange, weekStart } from '../../lib/roster'

const DAY = 86_400_000

export default function MijnRooster() {
  const me = useAuth((s) => s.user)!

  const shifts = useLiveQuery(
    () => db.shifts.where('userId').equals(me.id).toArray(),
    [me.id],
    [] as Shift[],
  )

  const now = Date.now()
  const thisWeek = weekStart(now)

  const wekelijks = shifts.filter((s) => s.startAt >= thisWeek && s.startAt < thisWeek + 7 * DAY)
  const urenDezeWeek = Math.round(wekelijks.reduce((a, s) => a + shiftHours(s), 0) * 10) / 10

  const komend = shifts
    .filter((s) => s.endAt >= now && s.kind === 'dienst')
    .sort((a, b) => a.startAt - b.startAt)

  const volgende = komend[0]

  const verlofDagen = shifts.filter(
    (s) => s.kind === 'verlof' && s.startAt >= thisWeek - 180 * DAY,
  ).length

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat
          label="Deze week ingeroosterd"
          value={`${urenDezeWeek} u`}
          delta={me.contractHours ? { text: `contract ${me.contractHours} u`, dir: 'flat' } : undefined}
          icon={<Clock size={17} />}
        />
        <Stat
          label="Volgende dienst"
          value={
            volgende
              ? new Date(volgende.startAt).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
              : '—'
          }
          delta={volgende ? { text: shiftRange(volgende), dir: 'flat' } : undefined}
          icon={<Sun size={17} />}
          tone="ok"
        />
        <Stat
          label="Verlofdagen (half jaar)"
          value={verlofDagen}
          icon={<Umbrella size={17} />}
          tone="warn"
        />
      </div>

      <Card title="Mijn rooster" hint="Ingepland door het management">
        <WeekRooster person={me} editable={false} />
      </Card>

      <Card title="Komende diensten" flush className="mt">
        {komend.length === 0 ? (
          <Empty text="Er staan nog geen diensten ingepland." icon={<CalendarDays size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Dag</th>
                  <th>Datum</th>
                  <th>Tijd</th>
                  <th className="num">Uren</th>
                  <th>Notitie</th>
                </tr>
              </thead>
              <tbody>
                {komend.slice(0, 20).map((s) => (
                  <tr key={s.id}>
                    <td style={{ textTransform: 'capitalize' }}>
                      {new Date(s.startAt).toLocaleDateString('nl-NL', { weekday: 'long' })}
                    </td>
                    <td>
                      {new Date(s.startAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}
                    </td>
                    <td className="mono">{shiftRange(s)}</td>
                    <td className="num">{shiftHours(s)}</td>
                    <td style={{ color: 'var(--text-3)' }}>
                      {s.note ?? SHIFT_KINDS[s.kind].label}
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
