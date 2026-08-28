import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play, Square, Timer } from 'lucide-react'
import { db } from '../../lib/db'
import { timeEntries as timeRepo } from '../../lib/repo'
import type { TimeEntry } from '../../lib/types'
import { dateShort, duration, money, time } from '../../lib/format'
import { Card, Empty, Field, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { startOfDay } from '../../lib/analytics'

const DAY = 86_400_000

export default function Uren() {
  const user = useAuth((s) => s.user)!
  const [note, setNote] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const entries = useLiveQuery(
    async () => {
      const from = startOfDay(Date.now() - 27 * DAY)
      const rows = await db.timeEntries.where('userId').equals(user.id).toArray()
      return rows.filter((e) => e.start >= from).sort((a, b) => b.start - a.start)
    },
    [user.id],
    [] as TimeEntry[],
  )

  const running = entries.find((e) => !e.end)

  const weekFrom = startOfDay(Date.now() - 6 * DAY)
  const weekMin = entries
    .filter((e) => e.start >= weekFrom && e.end)
    .reduce((a, e) => a + (e.end! - e.start) / 60000, 0)

  const monthMin = entries
    .filter((e) => e.end)
    .reduce((a, e) => a + (e.end! - e.start) / 60000, 0)

  const rate = user.hourlyRate ?? 0

  async function start() {
    await timeRepo.clockIn({ id: user.id, name: user.name }, undefined, note || undefined)
    setNote('')
    toast.ok('Tijdregistratie gestart')
  }

  async function stop() {
    if (!running) return
    await timeRepo.clockOut(running.id)
    toast.ok('Tijdregistratie gestopt')
  }

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat
          label="Deze week"
          value={duration(weekMin * 60000)}
          icon={<Timer size={17} />}
        />
        <Stat
          label="Laatste 28 dagen"
          value={duration(monthMin * 60000)}
          icon={<Timer size={17} />}
        />
        <Stat
          label="Indicatie loon (28d)"
          value={money((monthMin / 60) * rate)}
          delta={rate ? { text: `${money(rate)} per uur`, dir: 'flat' } : undefined}
          icon={<Timer size={17} />}
          tone="ok"
        />
      </div>

      <Card title="Klok" hint={running ? 'Loopt nu' : 'Niet gestart'}>
        {running ? (
          <div className="row">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-.03em' }}>
                {duration(Date.now() - running.start)}
              </div>
              <div style={{ fontSize: '.82rem', color: 'var(--text-3)' }}>
                Gestart om {time(running.start)}
                {running.note ? ` · ${running.note}` : ''}
              </div>
            </div>
            <button className="btn danger lg" onClick={() => void stop()}>
              <Square size={16} /> Stoppen
            </button>
          </div>
        ) : (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Field label="Omschrijving (optioneel)">
                <input
                  className="input"
                  placeholder="Bijv. wasstraat ochtenddienst"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
            <button className="btn primary lg" onClick={() => void start()} style={{ marginBottom: 13 }}>
              <Play size={16} /> Starten
            </button>
          </div>
        )}
      </Card>

      <Card title="Registraties" hint="Laatste 28 dagen" flush className="mt">
        {entries.length === 0 ? (
          <Empty text="Nog geen uren geregistreerd." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Van</th>
                  <th>Tot</th>
                  <th>Omschrijving</th>
                  <th className="num">Duur</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{dateShort(e.start)}</td>
                    <td className="mono">{time(e.start)}</td>
                    <td className="mono">{e.end ? time(e.end) : '—'}</td>
                    <td>{e.note ?? '—'}</td>
                    <td className="num">
                      {e.end ? duration(e.end - e.start) : (
                        <span style={{ color: 'var(--brand)' }}>loopt</span>
                      )}
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
