import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, CalendarClock, ClipboardList, Gauge, GraduationCap, LayoutGrid,
  MessageSquare, QrCode, Wrench,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import type { Asset, Fault, MaintenancePlan, WorkOrder } from '../../lib/types'
import { dateFull, duration, money } from '../../lib/format'
import { Card, Stat } from '../../components/ui'
import { techKpis } from '../../lib/techniek'
import { filterByLocation, useLocationFilter } from '../../lib/locations'
import { useAuth } from '../../store/useAuth'
import { useNavTarget, usePerms } from '../../store/useNav'
import { assets as assetRepo } from '../../lib/techniek'
import QrScanner from '../../components/QrScanner'
import StoringMelden from '../../components/StoringMelden'
import { toast } from '../../store/useToasts'
import Storingen from './Storingen'
import Werkbonnen from './Werkbonnen'
import Installaties from './Installaties'
import Onderhoud from './Onderhoud'
import Opleiding from '../../components/Opleiding'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import { Start, type Tegel, type TegelTint } from '../../components/Tegels'

const TITLES: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Technische dienst', subtitle: 'Waar wil je heen?' },
  overzicht: { title: 'Technische dienst', subtitle: 'Wat er nu speelt' },
  storingen: { title: 'Storingen', subtitle: 'Meldingen beoordelen en afhandelen' },
  werkbonnen: { title: 'Werkbonnen', subtitle: 'Het werk zelf' },
  installaties: { title: 'Installaties', subtitle: 'Machinepark en QR-labels' },
  onderhoud: { title: 'Onderhoud', subtitle: 'Schemas en wat er openstaat' },
  opleiding: { title: 'Mijn cursussen', subtitle: 'Veiligheid en techniek' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken' },
}

export default function TechnicianDashboard() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const currentLocation = useLocationFilter((s) => s.current)
  const [page, setPage] = useState('start')
  const [scanning, setScanning] = useState(false)
  const [melden, setMelden] = useState(false)
  const [gescandAsset, setGescandAsset] = useState<string | undefined>()

  const alleFaults = useLiveQuery(() => db.faults.toArray(), [], [] as Fault[])
  const alleOrders = useLiveQuery(() => db.workOrders.toArray(), [], [] as WorkOrder[])
  const allePlans = useLiveQuery(() => db.maintenancePlans.toArray(), [], [] as MaintenancePlan[])
  const alleAssets = useLiveQuery(() => db.assets.toArray(), [], [] as Asset[])
  const ongelezen = useOverlegTeller()

  const faults = useMemo(() => filterByLocation(me, alleFaults, currentLocation), [me, alleFaults, currentLocation])
  const orders = useMemo(() => filterByLocation(me, alleOrders, currentLocation), [me, alleOrders, currentLocation])
  const plans = useMemo(() => filterByLocation(me, allePlans, currentLocation), [me, allePlans, currentLocation])
  const assets = useMemo(() => filterByLocation(me, alleAssets, currentLocation), [me, alleAssets, currentLocation])

  const openStoringen = faults.filter((f) => f.status !== 'opgelost' && f.status !== 'afgewezen')
  const mijnBonnen = orders.filter(
    (o) => o.assignedTo === me.id && o.status !== 'gereed' && o.status !== 'geannuleerd')
  const achterstallig = plans.filter((p) => p.active && p.nextDueAt < Date.now())

  const items: NavItem[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid },
    { key: 'overzicht', label: 'Overzicht', icon: Gauge },
    ...(perms.can('faults.view')
      ? [{ key: 'storingen', label: 'Storingen', icon: AlertTriangle, badge: openStoringen.length || undefined }]
      : []),
    ...(perms.can('workorders.view')
      ? [{ key: 'werkbonnen', label: 'Werkbonnen', icon: ClipboardList, badge: mijnBonnen.length || undefined }]
      : []),
    ...(perms.can('assets.view') ? [{ key: 'installaties', label: 'Installaties', icon: Wrench }] : []),
    ...(perms.can('maintenance.view')
      ? [{ key: 'onderhoud', label: 'Onderhoud', icon: CalendarClock, badge: achterstallig.length || undefined }]
      : []),
    { key: 'opleiding', label: 'Cursussen', icon: GraduationCap },
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
  ]

  const kritiek = openStoringen.filter((f) => f.severity === 'kritiek' || f.stopsProduction).length
  const stil = assets.filter((a) => a.status === 'storing').length

  const tegels: Tegel[] = [
    {
      key: 'overzicht',
      label: 'Overzicht',
      hint: 'Wat er nu speelt op je vestigingen',
      icon: Gauge,
      tint: 'brand',
      stat: openStoringen.length,
      statLabel: 'storingen open',
      onClick: () => setPage('overzicht'),
    },
    ...(perms.can('faults.view') ? [{
      key: 'storingen',
      label: 'Storingen',
      hint: 'Beoordelen, toewijzen en afhandelen',
      icon: AlertTriangle,
      tint: (kritiek ? 'danger' : 'warn') as TegelTint,
      stat: kritiek || openStoringen.length,
      statLabel: kritiek ? 'kritiek of stilstand' : 'open meldingen',
      urgent: kritiek > 0,
      onClick: () => setPage('storingen'),
    }] : []),
    ...(perms.can('workorders.view') ? [{
      key: 'werkbonnen',
      label: 'Werkbonnen',
      hint: 'Het werk dat aan jou is toegewezen',
      icon: ClipboardList,
      tint: 'info' as const,
      stat: mijnBonnen.length,
      statLabel: 'op jouw naam',
      urgent: mijnBonnen.length > 4,
      onClick: () => setPage('werkbonnen'),
    }] : []),
    ...(perms.can('maintenance.view') ? [{
      key: 'onderhoud',
      label: 'Onderhoud',
      hint: "Schema's en beurten die klaarstaan",
      icon: CalendarClock,
      tint: (achterstallig.length ? 'oranje' : 'ok') as TegelTint,
      stat: achterstallig.length,
      statLabel: achterstallig.length ? 'over de datum' : 'alles op schema',
      urgent: achterstallig.length > 0,
      onClick: () => setPage('onderhoud'),
    }] : []),
    ...(perms.can('assets.view') ? [{
      key: 'installaties',
      label: 'Installaties',
      hint: 'Machinepark, historie en QR-labels',
      icon: Wrench,
      tint: (stil ? 'danger' : 'neutraal') as TegelTint,
      stat: stil || assets.length,
      statLabel: stil ? 'buiten bedrijf' : 'apparaten',
      onClick: () => setPage('installaties'),
    }] : []),
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Overleggen met de vestiging',
      icon: MessageSquare,
      tint: 'paars' as const,
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
    {
      key: 'opleiding',
      label: 'Mijn cursussen',
      hint: 'Veiligheid, chemie en techniek',
      icon: GraduationCap,
      tint: 'neutraal',
      onClick: () => setPage('opleiding'),
    },
  ]

  useNavTarget(items.map((i) => i.key), (p) => setPage(p))

  async function handleScan(code: string) {
    setScanning(false)
    const asset = await assetRepo.find(code)
    if (!asset) return toast.error(`Geen apparaat gevonden met code ${code}`)
    setGescandAsset(asset.id)
    setPage('installaties')
    toast.ok(`${asset.name} — ${asset.code}`)
  }

  const meta = TITLES[page] ?? TITLES.overzicht

  return (
    <Shell
      roleLabel="Technische dienst"
      items={items}
      active={page}
      onNavigate={(p) => { setPage(p); setGescandAsset(undefined) }}
      title={meta.title}
      subtitle={page === 'overzicht' || page === 'start' ? dateFull(Date.now()) : meta.subtitle}
      actions={
        <button className="btn primary sm" onClick={() => setScanning(true)} title="Scan een QR-label">
          <QrCode size={14} />
          <span className="hide-mobile">Scannen</span>
        </button>
      }
      menu={[{
        title: 'Techniek',
        items: [
          {
            key: 'scan',
            label: 'QR-label scannen',
            hint: 'Meteen bij de juiste installatie uitkomen',
            icon: <QrCode size={16} />,
            onClick: () => setScanning(true),
          },
          {
            key: 'storing',
            label: 'Storing melden',
            hint: 'Met foto en urgentie',
            icon: <AlertTriangle size={16} />,
            onClick: () => setMelden(true),
          },
        ],
      }]}
    >
      {page === 'start' && (
        <Start
          tegels={tegels}
          snel={
            <>
              <button className="btn sm" onClick={() => setScanning(true)}>
                <QrCode size={14} /> QR-label scannen
              </button>
              <button className="btn sm" onClick={() => setMelden(true)}>
                <AlertTriangle size={14} /> Storing melden
              </button>
            </>
          }
        />
      )}
      {page === 'overzicht' && (
        <TechOverzicht
          faults={faults} orders={orders} plans={plans} assets={assets}
          onOpen={setPage}
        />
      )}
      {page === 'storingen' && <Storingen faults={faults} />}
      {page === 'werkbonnen' && <Werkbonnen orders={orders} />}
      {page === 'installaties' && <Installaties assets={assets} focusId={gescandAsset} />}
      {page === 'onderhoud' && <Onderhoud plans={plans} assets={assets} />}
      {page === 'opleiding' && <Opleiding />}
      {page === 'overleg' && <Overleg />}

      <QrScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onScan={(c) => void handleScan(c)}
        title="Scan een installatie"
      />
      <StoringMelden open={melden} onClose={() => setMelden(false)} />
    </Shell>
  )
}

/* ================================================================== *
 *  Overzicht
 * ================================================================== */

function TechOverzicht({
  faults, orders, plans, assets, onOpen,
}: {
  faults: Fault[]
  orders: WorkOrder[]
  plans: MaintenancePlan[]
  assets: Asset[]
  onOpen: (page: string) => void
}) {
  const me = useAuth((s) => s.user)!
  const kpi = useMemo(
    () => techKpis({ faults, orders, plans, days: 30 }),
    [faults, orders, plans],
  )

  const kritiek = faults
    .filter((f) => f.status !== 'opgelost' && f.status !== 'afgewezen')
    .sort((a, b) => {
      const rang = { kritiek: 0, hoog: 1, middel: 2, laag: 3 }
      return rang[a.severity] - rang[b.severity] || a.reportedAt - b.reportedAt
    })
    .slice(0, 6)

  const mijnBonnen = orders
    .filter((o) => o.assignedTo === me.id && o.status !== 'gereed' && o.status !== 'geannuleerd')
    .sort((a, b) => (a.plannedAt ?? 0) - (b.plannedAt ?? 0))
    .slice(0, 6)

  const binnenkort = plans
    .filter((p) => p.active)
    .sort((a, b) => a.nextDueAt - b.nextDueAt)
    .slice(0, 6)

  const stuk = assets.filter((a) => a.status === 'storing')

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
          label="Open werkbonnen"
          value={kpi.openWerkbonnen}
          icon={<ClipboardList size={17} />}
        />
        <Stat
          label="Onderhoud op peil"
          value={`${kpi.onderhoudOpPeil}%`}
          delta={kpi.achterstallig ? { text: `${kpi.achterstallig} over tijd`, dir: 'down' } : undefined}
          icon={<CalendarClock size={17} />}
          tone={kpi.achterstallig ? 'warn' : 'ok'}
        />
        <Stat
          label="Stilstand (30 dagen)"
          value={duration(kpi.stilstandMinuten * 60000)}
          delta={{ text: `gem. ${duration(kpi.gemDoorlooptijdMinuten * 60000)} per storing`, dir: 'flat' }}
          icon={<Gauge size={17} />}
          tone={kpi.stilstandMinuten > 3000 ? 'danger' : 'warn'}
        />
      </div>

      {stuk.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderColor: 'rgba(244,104,95,.35)',
            background: 'rgba(244,104,95,.07)',
          }}
        >
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} color="var(--danger)" style={{ flex: 'none', marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: '.9rem' }}>
                {stuk.length} {stuk.length === 1 ? 'installatie staat' : 'installaties staan'} in storing
              </strong>
              <div style={{ fontSize: '.82rem', color: 'var(--text-2)', marginTop: 3 }}>
                {stuk.slice(0, 4).map((a) => `${a.code} ${a.name}`).join(' · ')}
                {stuk.length > 4 ? ` en ${stuk.length - 4} meer` : ''}
              </div>
            </div>
            <button className="btn sm" onClick={() => onOpen('storingen')}>Bekijken</button>
          </div>
        </div>
      )}

      <div className="grid cols-3">
        <Card
          title="Meest urgent"
          hint={`${kritiek.length} open`}
          action={<button className="btn ghost sm" onClick={() => onOpen('storingen')}>Alles</button>}
        >
          {kritiek.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>Geen open storingen.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {kritiek.map((f) => (
                <div key={f.id} className="mini-row">
                  <span className={`dot sev-${f.severity}`} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="t">{f.title}</div>
                    <div className="s">{f.number} · {f.assetName ?? 'geen installatie'}</div>
                  </div>
                  {f.stopsProduction && <span className="badge danger">stil</span>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Voor mij ingepland"
          hint={`${mijnBonnen.length} werkbonnen`}
          action={<button className="btn ghost sm" onClick={() => onOpen('werkbonnen')}>Alles</button>}
        >
          {mijnBonnen.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>Niets voor jou ingepland.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {mijnBonnen.map((o) => (
                <div key={o.id} className="mini-row">
                  <span className={`dot prio-${o.priority}`} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="t">{o.title}</div>
                    <div className="s">
                      {o.number} · {o.plannedAt
                        ? new Date(o.plannedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
                        : 'niet ingepland'}
                    </div>
                  </div>
                  <span className="badge">{o.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Onderhoud dat aankomt"
          action={<button className="btn ghost sm" onClick={() => onOpen('onderhoud')}>Alles</button>}
        >
          {binnenkort.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>Geen schemas ingesteld.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {binnenkort.map((p) => {
                const over = p.nextDueAt < Date.now()
                return (
                  <div key={p.id} className="mini-row">
                    <span className={`dot ${over ? 'sev-hoog' : ''}`} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="t">{p.title}</div>
                      <div className="s">
                        {over ? 'over tijd sinds ' : 'gepland '}
                        {new Date(p.nextDueAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    <span className="badge">{p.interval}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <Stat label="Monteursuren (30d)" value={`${kpi.monteursuren} u`} />
        <Stat label="Onderdelen en derden (30d)" value={money(kpi.onderdelenKosten)} tone="warn" />
        <Stat label="Opgelost (30d)" value={`${kpi.opgelost} van ${kpi.gemeld}`} tone="ok" />
      </div>
    </>
  )
}
