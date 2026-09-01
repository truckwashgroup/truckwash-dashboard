import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Clock, Euro, Receipt } from 'lucide-react'
import { db } from '../../lib/db'
import type { Expense, WashJob } from '../../lib/types'
import { money, moneyShort } from '../../lib/format'
import { Card, Stat } from '../../components/ui'
import { expensesByCategory, managementKpis, startOfDay } from '../../lib/analytics'
import { PALETTE, gridStroke, hoverFill, tooltipStyle } from '../../lib/charts'

/* ------------------------------------------------------------------ *
 *  Financieel
 *
 *  Alleen de cijfers. Het beoordelen van kostenposten stond hier tussen de
 *  grafieken en is verhuisd naar het administratiedashboard: cijfers bekijk
 *  je, bonnen beoordeel je, en dat is ander werk met een ander ritme.
 *
 *  Wat hier bleef staan is het beeld dat je nodig hebt om te weten of het
 *  klopt -- omzet, kosten, marge en de btw-stand.
 * ------------------------------------------------------------------ */

const DAY = 86_400_000

export default function Financieel({ days }: { days: number }) {

  const expenses = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])

  const from = startOfDay(Date.now() - (days - 1) * DAY)

  const kpis = useMemo(() => managementKpis(jobs, expenses, days), [jobs, expenses, days])
  const byCategory = useMemo(() => expensesByCategory(expenses, days), [expenses, days])

  const open = expenses.filter((e) => e.status === 'open')
  const openBedrag = open.reduce((a, e) => a + e.amountExcl, 0)

  const periodeKosten = expenses.filter((e) => e.status === 'goedgekeurd' && e.date >= from)
  const btw = periodeKosten.reduce((a, e) => a + (e.amountExcl * e.vatPct) / 100, 0)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Te valideren"
          value={open.length}
          delta={{ text: money(openBedrag), dir: 'flat' }}
          icon={<Clock size={17} />}
          tone={open.length ? 'warn' : 'ok'}
        />
        <Stat label={`Omzet (${days}d)`} value={money(kpis.omzet.value)} icon={<Euro size={17} />} />
        <Stat label={`Goedgekeurde kosten (${days}d)`} value={money(kpis.kosten.value)} icon={<Receipt size={17} />} tone="warn" />
        <Stat
          label="Resultaat"
          value={money(kpis.marge.value)}
          delta={{
            text: kpis.omzet.value ? `${Math.round((kpis.marge.value / kpis.omzet.value) * 100)}% marge` : '—',
            dir: kpis.marge.value >= 0 ? 'up' : 'down',
          }}
          icon={<Euro size={17} />}
          tone={kpis.marge.value >= 0 ? 'ok' : 'danger'}
        />
      </div>

      {open.length > 0 && (
        <p className="hint" style={{ marginBottom: 14 }}>
          <Receipt size={13} /> {open.length} {open.length === 1 ? 'kostenpost wacht' : 'kostenposten wachten'} op
          een beslissing. Beoordelen doe je bij Administratie; hier staan de cijfers.
        </p>
      )}

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
          <Card title="Kosten per categorie" hint={`${days} dagen`}>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" stroke="#6b7d9e" fontSize={11} tickFormatter={(v) => moneyShort(v)} />
                  <YAxis
                    type="category" dataKey="name" stroke="#6b7d9e" fontSize={11}
                    width={78} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number) => [money(v), 'Kosten']}
                    cursor={hoverFill}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Resultaat" hint={`Laatste ${days} dagen`}>
            <PnlLine label="Omzet (excl. btw)" value={kpis.omzet.value} />
            <PnlLine label="Goedgekeurde kosten" value={-kpis.kosten.value} />
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
              <PnlLine label="Brutoresultaat" value={kpis.marge.value} strong />
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)', fontSize: '.8rem', color: 'var(--text-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Voorbelasting (btw op kosten)</span>
                <span className="mono">{money(btw)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>Btw over omzet (21%)</span>
                <span className="mono">{money(kpis.omzet.value * 0.21)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: 'var(--text-2)' }}>
                <span>Saldo aangifte</span>
                <span className="mono">{money(kpis.omzet.value * 0.21 - btw)}</span>
              </div>
            </div>
          </Card>
      </div>
    </>
  )
}

function PnlLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '5px 0', fontSize: strong ? '.95rem' : '.87rem',
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span style={{ color: strong ? 'var(--text)' : 'var(--text-2)' }}>{label}</span>
      <span
        className="mono"
        style={{ color: value < 0 ? 'var(--warn)' : strong ? 'var(--ok)' : 'var(--text)' }}
      >
        {money(value)}
      </span>
    </div>
  )
}
