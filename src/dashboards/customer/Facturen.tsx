import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Printer } from 'lucide-react'
import { SERVICES, type WashJob } from '../../lib/types'
import { dateShort, money } from '../../lib/format'
import { Badge, Card, Empty } from '../../components/ui'
import { useCompany } from './useCompany'

const VAT = 0.21

interface Period {
  key: string
  label: string
  jobs: WashJob[]
  excl: number
  btw: number
  incl: number
}

export default function Facturen() {
  const { company, jobs } = useCompany()
  const [openKey, setOpenKey] = useState<string | null>(null)

  const periods = useMemo<Period[]>(() => {
    const map = new Map<string, WashJob[]>()
    for (const j of jobs) {
      if (j.status !== 'gereed' || !j.completedAt) continue
      const d = new Date(j.completedAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const list = map.get(key) ?? []
      list.push(j)
      map.set(key, list)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => {
        const excl = list.reduce((a, j) => a + j.priceExcl, 0)
        const btw = Math.round(excl * VAT * 100) / 100
        return {
          key,
          label: new Date(key + '-01T00:00:00').toLocaleDateString('nl-NL', {
            month: 'long', year: 'numeric',
          }),
          jobs: list.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0)),
          excl: Math.round(excl * 100) / 100,
          btw,
          incl: Math.round((excl + btw) * 100) / 100,
        }
      })
  }, [jobs])

  if (periods.length === 0) {
    return (
      <Card title="Facturen">
        <Empty text="Er zijn nog geen afgeronde wasbeurten om te factureren." icon={<FileText size={30} />} />
      </Card>
    )
  }

  return (
    <Card
      title="Facturen per periode"
      hint={company?.name}
      flush
      action={
        <button className="btn ghost sm" onClick={() => window.print()}>
          <Printer size={14} /> Afdrukken
        </button>
      }
    >
      {periods.map((p, idx) => {
        const open = openKey === p.key
        return (
          <div key={p.key} style={{ borderBottom: '1px solid var(--line-soft)' }}>
            <button
              onClick={() => setOpenKey(open ? null : p.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '14px 16px', background: 'transparent', border: 0,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {open ? <ChevronDown size={16} color="var(--text-3)" /> : <ChevronRight size={16} color="var(--text-3)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{p.label}</div>
                <div style={{ fontSize: '.76rem', color: 'var(--text-3)' }}>
                  {p.jobs.length} wasbeurten
                </div>
              </div>
              {idx === 0 && <Badge tone="warn">Lopende periode</Badge>}
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontWeight: 650 }}>{money(p.incl)}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>incl. btw</div>
              </div>
            </button>

            {open && (
              <div style={{ padding: '0 16px 16px' }}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Datum</th>
                        <th>Kenteken</th>
                        <th>Behandeling</th>
                        <th className="num">Bedrag excl.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.jobs.map((j) => (
                        <tr key={j.id}>
                          <td className="mono">{j.ticket}</td>
                          <td>{dateShort(j.completedAt!)}</td>
                          <td><strong>{j.plate}</strong></td>
                          <td>{SERVICES[j.service].label}</td>
                          <td className="num">{money(j.priceExcl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    marginTop: 14, marginLeft: 'auto', width: 'min(300px, 100%)',
                    display: 'grid', gap: 6, fontSize: '.87rem',
                  }}
                >
                  <Line label="Subtotaal excl. btw" value={money(p.excl)} />
                  <Line label="Btw 21%" value={money(p.btw)} />
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                    <Line label="Totaal incl. btw" value={money(p.incl)} strong />
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: strong ? 'var(--text)' : 'var(--text-3)', fontWeight: strong ? 650 : 400 }}>
        {label}
      </span>
      <span className="mono" style={{ fontWeight: strong ? 700 : 500 }}>{value}</span>
    </div>
  )
}
