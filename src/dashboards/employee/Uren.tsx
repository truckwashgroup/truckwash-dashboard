import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CreditCard, Timer } from 'lucide-react'
import { db } from '../../lib/db'
import type { TimeEntry } from '../../lib/types'
import { dateShort, duration, money, time } from '../../lib/format'
import { Card, Empty, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { startOfDay } from '../../lib/analytics'

/* ------------------------------------------------------------------ *
 *  Je uren
 *
 *  Kijken, niet klokken. In- en uitklokken gebeurt op het apparaat op de
 *  vestiging: je toetst je persoonlijke code in of scant je badge, en
 *  daarmee ontstaat de regel -- op de plek waar je ook werkelijk staat.
 *
 *  Een knop op ieders telefoon maakte van inklokken iets wat je vanaf de
 *  bank kon doen. Dan is een urenstaat geen urenstaat meer maar een
 *  voorstel, en dat is niet waar hij voor is.
 * ------------------------------------------------------------------ */

const DAY = 86_400_000

export default function Uren() {
  const user = useAuth((s) => s.user)!
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

      <Card title="Klok" hint={running ? 'Je staat ingeklokt' : 'Je staat niet ingeklokt'}>
        {running ? (
          <div className="klok-nu">
            <div className="teller">{duration(Date.now() - running.start)}</div>
            <div className="sinds">
              Ingeklokt om {time(running.start)}
              {running.note ? ` · ${running.note}` : ''}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: '.87rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
            Er loopt op dit moment geen registratie op jouw naam.
          </p>
        )}

        <div className="signup-note" style={{ marginTop: 14, marginBottom: 0 }}>
          <CreditCard size={16} />
          <span>
            In- en uitklokken doe je aan de kassa op de vestiging, met je
            persoonlijke code of je badge. Dat kan hier bewust niet: waar je
            werkt hoort te blijken uit waar je inklokt. Klopt er iets niet,
            zeg het dan tegen je leidinggevende — die kan het rechtzetten.
          </span>
        </div>
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
