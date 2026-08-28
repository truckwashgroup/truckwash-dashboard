import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, CalendarClock, ClipboardList, Gauge, Wrench } from 'lucide-react'
import { db } from '../../lib/db'
import type { Asset, Fault, Location, MaintenancePlan, WorkOrder } from '../../lib/types'
import { duration, money } from '../../lib/format'
import { Bar as MiniBar, Card, Empty, Stat } from '../../components/ui'
import { techKpis } from '../../lib/techniek'
import { filterByLocation, useLocationFilter } from '../../lib/locations'
import { useAuth } from '../../store/useAuth'
import { PALETTE, gridStroke, hoverFill, tooltipStyle } from '../../lib/charts'
import Storingen from '../technician/Storingen'
import Werkbonnen from '../technician/Werkbonnen'
import Installaties from '../technician/Installaties'
import Onderhoud from '../technician/Onderhoud'

/* ------------------------------------------------------------------ *
 *  Techniek voor het management
 *
 *  Dezelfde schermen als de technische dienst gebruikt, met er een laag
 *  cijfers overheen: waar staat de installatie het vaakst stil, welke
 *  vestiging loopt achter met onderhoud, en wat kost het.
 * ------------------------------------------------------------------ */

const TABS = [
  { key: 'cijfers', label: 'Cijfers' },
  { key: 'storingen', label: 'Storingen' },
  { key: 'werkbonnen', label: 'Werkbonnen' },
  { key: 'installaties', label: 'Installaties' },
  { key: 'onderhoud', label: 'Onderhoud' },
]

export default function Techniek({ days }: { days: number }) {
  const me = useAuth((s) => s.user)!
  const current = useLocationFilter((s) => s.current)
  const [tab, setTab] = useState('cijfers')

  const alleFaults = useLiveQuery(() => db.faults.toArray(), [], [] as Fault[])
  const alleOrders = useLiveQuery(() => db.workOrders.toArray(), [], [] as WorkOrder[])
  const allePlans = useLiveQuery(() => db.maintenancePlans.toArray(), [], [] as MaintenancePlan[])
  const alleAssets = useLiveQuery(() => db.assets.toArray(), [], [] as Asset[])
  const locations = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  const faults = useMemo(() => filterByLocation(me, alleFaults, current), [me, alleFaults, current])
  const orders = useMemo(() => filterByLocation(me, alleOrders, current), [me, alleOrders, current])
  const plans = useMemo(() => filterByLocation(me, allePlans, current), [me, allePlans, current])
  const assets = useMemo(() => filterByLocation(me, alleAssets, current), [me, alleAssets, current])

  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn sm ${tab === t.key ? 'primary' : 'ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cijfers' && (
        <Cijfers
          faults={faults} orders={orders} plans={plans} assets={assets}
          locations={locations} days={days}
        />
      )}
      {tab === 'storingen' && <Storingen faults={faults} />}
      {tab === 'werkbonnen' && <Werkbonnen orders={orders} />}
      {tab === 'installaties' && <Installaties assets={assets} />}
      {tab === 'onderhoud' && <Onderhoud plans={plans} assets={assets} />}
    </>
  )
}

/* ================================================================== */

function Cijfers({
  faults, orders, plans, assets, locations, days,
}: {
  faults: Fault[]
  orders: WorkOrder[]
  plans: MaintenancePlan[]
  assets: Asset[]
  locations: Location[]
  days: number
}) {
  const kpi = useMemo(
    () => techKpis({ faults, orders, plans, days }),
    [faults, orders, plans, days],
  )

  const naamVan = (id?: string) => locations.find((l) => l.id === id)?.name ?? 'Onbekend'

  /** Welke apparaten geven het vaakst problemen? */
  const probleemgevallen = useMemo(() => {
    const map = new Map<string, { naam: string; aantal: number; stilstand: number }>()
    const from = Date.now() - days * 86_400_000
    for (const f of faults) {
      if (f.reportedAt < from || !f.assetId) continue
      const asset = assets.find((a) => a.id === f.assetId)
      const key = f.assetId
      const huidig = map.get(key) ?? {
        naam: asset ? `${asset.code} ${asset.name}` : (f.assetName ?? 'Onbekend'),
        aantal: 0,
        stilstand: 0,
      }
      huidig.aantal += 1
      huidig.stilstand += f.downtimeMinutes ?? 0
      map.set(key, huidig)
    }
    return [...map.values()].sort((a, b) => b.aantal - a.aantal).slice(0, 8)
  }, [faults, assets, days])

  /** Storingen per vestiging, zodat je ziet waar het schuurt. */
  const perVestiging = useMemo(() => {
    const from = Date.now() - days * 86_400_000
    const map = new Map<string, number>()
    for (const f of faults) {
      if (f.reportedAt < from) continue
      map.set(f.locationId, (map.get(f.locationId) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([id, n]) => ({ naam: naamVan(id), aantal: n }))
      .sort((a, b) => b.aantal - a.aantal)
      .slice(0, 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faults, locations, days])

  const achterstandPerVestiging = useMemo(() => {
    const actief = plans.filter((p) => p.active)
    const map = new Map<string, { totaal: number; laat: number }>()
    for (const p of actief) {
      const id = p.locationId ?? 'onbekend'
      const huidig = map.get(id) ?? { totaal: 0, laat: 0 }
      huidig.totaal += 1
      if (p.nextDueAt < Date.now()) huidig.laat += 1
      map.set(id, huidig)
    }
    return [...map.entries()]
      .map(([id, v]) => ({ naam: naamVan(id), ...v, pct: Math.round((v.laat / v.totaal) * 100) }))
      .filter((v) => v.laat > 0)
      .sort((a, b) => b.pct - a.pct)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, locations])

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Open storingen"
          value={kpi.openStoringen}
          delta={kpi.kritiek ? { text: `${kpi.kritiek} kritiek`, dir: 'down' } : undefined}
          icon={<AlertTriangle size={17} />}
          tone={kpi.kritiek ? 'danger' : kpi.openStoringen ? 'warn' : 'ok'}
        />
        <Stat
          label={`Stilstand (${days}d)`}
          value={duration(kpi.stilstandMinuten * 60000)}
          delta={{ text: `gem. ${duration(kpi.gemDoorlooptijdMinuten * 60000)}`, dir: 'flat' }}
          icon={<Gauge size={17} />}
          tone="warn"
        />
        <Stat
          label="Onderhoud op peil"
          value={`${kpi.onderhoudOpPeil}%`}
          delta={kpi.achterstallig ? { text: `${kpi.achterstallig} over tijd`, dir: 'down' } : undefined}
          icon={<CalendarClock size={17} />}
          tone={kpi.onderhoudOpPeil >= 90 ? 'ok' : 'warn'}
        />
        <Stat
          label={`Onderhoudskosten (${days}d)`}
          value={money(kpi.onderdelenKosten)}
          delta={{ text: `${kpi.monteursuren} monteursuren`, dir: 'flat' }}
          icon={<Wrench size={17} />}
        />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="Storingen per vestiging" hint={`Laatste ${days} dagen`}>
          {perVestiging.length === 0 ? (
            <Empty text="Geen storingen in deze periode." />
          ) : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perVestiging} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" stroke="#6b7d9e" fontSize={11} allowDecimals={false} />
                  <YAxis
                    type="category" dataKey="naam" stroke="#6b7d9e" fontSize={11}
                    width={92} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={hoverFill}
                    formatter={(v: number) => [v, 'storingen']}
                  />
                  <Bar dataKey="aantal" radius={[0, 4, 4, 0]}>
                    {perVestiging.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Installaties die het vaakst uitvallen" hint={`Laatste ${days} dagen`}>
          {probleemgevallen.length === 0 ? (
            <Empty text="Geen storingen op installaties." icon={<Wrench size={28} />} />
          ) : (
            <div style={{ display: 'grid', gap: 11 }}>
              {probleemgevallen.map((p, i) => {
                const max = probleemgevallen[0].aantal || 1
                return (
                  <div key={p.naam}>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: '.83rem', marginBottom: 4 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.naam}
                      </span>
                      <span className="mono" style={{ color: 'var(--text-2)' }}>
                        {p.aantal}× · {duration(p.stilstand * 60000)}
                      </span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${(p.aantal / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Achterstand onderhoud" hint="Vestigingen met openstaande beurten">
          {achterstandPerVestiging.length === 0 ? (
            <Empty text="Alle vestigingen lopen op schema." icon={<CalendarClock size={28} />} />
          ) : (
            <div style={{ display: 'grid', gap: 11 }}>
              {achterstandPerVestiging.map((v) => (
                <div key={v.naam}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '.83rem', marginBottom: 4 }}>
                    <span>{v.naam}</span>
                    <span className="mono" style={{ color: v.pct > 40 ? 'var(--danger)' : 'var(--warn)' }}>
                      {v.laat} van {v.totaal} te laat
                    </span>
                  </div>
                  <MiniBar value={v.laat} max={v.totaal} tone={v.pct > 40 ? 'danger' : 'warn'} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Machinepark">
          <div className="grid cols-2" style={{ gap: 10 }}>
            <Stat label="Installaties" value={assets.length} />
            <Stat label="In storing" value={assets.filter((a) => a.status === 'storing').length} tone="danger" />
            <Stat label="Open werkbonnen" value={kpi.openWerkbonnen} icon={<ClipboardList size={16} />} />
            <Stat label="Opgelost" value={`${kpi.opgelost} / ${kpi.gemeld}`} tone="ok" />
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)', fontSize: '.8rem', color: 'var(--text-3)' }}>
            Stilstand telt vanaf de melding tot het moment dat de storing wordt
            afgemeld. Dat is dus inclusief wachten op onderdelen — precies wat
            je wilt zien als je wilt weten hoeveel omzet je misloopt.
          </div>
        </Card>
      </div>
    </>
  )
}
