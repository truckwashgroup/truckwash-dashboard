import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Clock, Euro, Receipt, TrendingUp, Truck,
} from 'lucide-react'
import { db } from '../../lib/db'
import { SERVICES, type Expense, type WashJob } from '../../lib/types'
import { duration, money, moneyShort, number, pct } from '../../lib/format'
import { Card, Stat } from '../../components/ui'
import { managementKpis, seriesByDay, startOfDay } from '../../lib/analytics'
import { PALETTE, axis, gridStroke, hoverFill, tooltipStyle } from '../../lib/charts'

const DAY = 86_400_000

export default function Overzicht({ days }: { days: number }) {
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])

  const kpis = useMemo(() => managementKpis(jobs, expenses, days), [jobs, expenses, days])
  const series = useMemo(() => seriesByDay(jobs, expenses, days), [jobs, expenses, days])

  const serviceMix = useMemo(() => {
    const from = startOfDay(Date.now() - (days - 1) * DAY)
    const map = new Map<string, number>()
    for (const j of jobs) {
      if (j.status !== 'gereed' || (j.completedAt ?? 0) < from) continue
      const label = SERVICES[j.service].label
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    return [...map.entries()].map(([name, value]) => ({ name, value }))
  }, [jobs, days])

  const topKlanten = useMemo(() => {
    const from = startOfDay(Date.now() - (days - 1) * DAY)
    const map = new Map<string, { omzet: number; aantal: number }>()
    for (const j of jobs) {
      if (j.status !== 'gereed' || (j.completedAt ?? 0) < from) continue
      const cur = map.get(j.companyName) ?? { omzet: 0, aantal: 0 }
      cur.omzet += j.priceExcl
      cur.aantal += 1
      map.set(j.companyName, cur)
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v, omzet: Math.round(v.omzet * 100) / 100 }))
      .sort((a, b) => b.omzet - a.omzet)
      .slice(0, 6)
  }, [jobs, days])

  const dir = (v: number): 'up' | 'down' | 'flat' => (v > 1 ? 'up' : v < -1 ? 'down' : 'flat')
  const arrow = (v: number) =>
    v > 1 ? <ArrowUpRight size={13} /> : v < -1 ? <ArrowDownRight size={13} /> : <ArrowRight size={13} />

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label={`Omzet (${days}d)`}
          value={money(kpis.omzet.value)}
          delta={{ text: `${pct(kpis.omzet.deltaPct)} t.o.v. vorige periode`, dir: dir(kpis.omzet.deltaPct) }}
          icon={<Euro size={17} />}
        />
        <Stat
          label="Wasbeurten"
          value={number(kpis.wasbeurten.value)}
          delta={{ text: `${pct(kpis.wasbeurten.deltaPct)}`, dir: dir(kpis.wasbeurten.deltaPct) }}
          icon={<Truck size={17} />}
        />
        <Stat
          label="Kosten"
          value={money(kpis.kosten.value)}
          delta={{ text: `${pct(kpis.kosten.deltaPct)}`, dir: dir(-kpis.kosten.deltaPct) }}
          icon={<Receipt size={17} />}
          tone="warn"
        />
        <Stat
          label="Brutomarge"
          value={money(kpis.marge.value)}
          delta={{
            text: kpis.omzet.value > 0
              ? `${Math.round((kpis.marge.value / kpis.omzet.value) * 100)}% marge`
              : '—',
            dir: dir(kpis.marge.deltaPct),
          }}
          icon={<TrendingUp size={17} />}
          tone={kpis.marge.value >= 0 ? 'ok' : 'danger'}
        />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="Omzet en kosten" hint={`Laatste ${days} dagen`}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gOmzet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f8c010" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#f8c010" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="gKosten" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#58b6f5" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#58b6f5" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" {...axis} tickLine={false} minTickGap={26} />
                <YAxis {...axis} tickLine={false} tickFormatter={(v) => moneyShort(v)} width={62} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, n) => [money(Number(v ?? 0)), n === 'omzet' ? 'Omzet' : 'Kosten']}
                />
                <Area type="monotone" dataKey="omzet" stroke="#f8c010" strokeWidth={2} fill="url(#gOmzet)" />
                <Area type="monotone" dataKey="kosten" stroke="#58b6f5" strokeWidth={2} fill="url(#gKosten)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Wasbeurten per dag" hint={`Gemiddeld ${(kpis.wasbeurten.value / days).toFixed(1)} per dag`}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 6, right: 6, left: -24, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" {...axis} tickLine={false} minTickGap={26} />
                <YAxis {...axis} tickLine={false} allowDecimals={false} width={38} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [Number(v ?? 0), 'Wasbeurten']} cursor={hoverFill} />
                <Bar dataKey="wasbeurten" fill="#f8c010" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid cols-3">
        <Card title="Gemiddelde doorlooptijd">
          <div style={{ fontSize: '2.2rem', fontWeight: 700, letterSpacing: '-.03em' }}>
            {duration(kpis.gemDoorlooptijdMin.value * 60000)}
          </div>
          <div className={`delta ${dir(-kpis.gemDoorlooptijdMin.deltaPct)}`} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.82rem' }}>
            {arrow(-kpis.gemDoorlooptijdMin.deltaPct)}
            {pct(kpis.gemDoorlooptijdMin.deltaPct)} t.o.v. vorige periode
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ gap: 7, fontSize: '.83rem', color: 'var(--text-2)' }}>
              <Clock size={15} color="var(--brand)" />
              {kpis.openKosten} kostenposten wachten op validatie
              {kpis.openKosten > 0 && (
                <strong style={{ marginLeft: 'auto' }}>{money(kpis.openKostenBedrag)}</strong>
              )}
            </div>
          </div>
        </Card>

        <Card title="Mix behandelingen">
          <div style={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={serviceMix}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={46}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {serviceMix.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend
                  verticalAlign="bottom"
                  height={38}
                  wrapperStyle={{ fontSize: 11, color: '#a3b2ce' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Grootste klanten" hint={`Laatste ${days} dagen`}>
          {topKlanten.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>Geen data.</div>
          ) : (
            <div style={{ display: 'grid', gap: 11 }}>
              {topKlanten.map((k, i) => {
                const max = topKlanten[0].omzet || 1
                return (
                  <div key={k.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.83rem', marginBottom: 4 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {k.name}
                      </span>
                      <span className="mono" style={{ color: 'var(--text-2)' }}>{money(k.omzet)}</span>
                    </div>
                    <div className="bar">
                      <span
                        style={{
                          width: `${(k.omzet / max) * 100}%`,
                          background: PALETTE[i % PALETTE.length],
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
