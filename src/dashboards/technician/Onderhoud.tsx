import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarClock, CalendarPlus, CheckCircle2, ListChecks, Plus, TriangleAlert,
} from 'lucide-react'
import { db } from '../../lib/db'
import { maintenance as planRepo, dueStateOf } from '../../lib/techniek'
import {
  ASSET_CATEGORIES, MAINTENANCE_DAYS,
  type Asset, type Location, type MaintenanceInterval, type MaintenancePlan,
} from '../../lib/types'
import { dateShort, duration, relative } from '../../lib/format'
import { Badge, Bar, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { useLocationFilter, visibleLocations } from '../../lib/locations'
import { toast } from '../../store/useToasts'

const DAY = 86_400_000

export default function Onderhoud({
  plans, assets,
}: { plans: MaintenancePlan[]; assets: Asset[] }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [filter, setFilter] = useState('open')
  const [nieuw, setNieuw] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)

  const locations = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const naamVan = (id?: string) => locations.find((l) => l.id === id)?.name ?? '—'
  const assetVan = (id?: string) => assets.find((a) => a.id === id)

  const rows = useMemo(() => {
    return plans
      .filter((p) => p.active)
      .filter((p) => {
        const staat = dueStateOf(p)
        if (filter === 'open') return staat !== 'gepland'
        if (filter === 'tijd') return staat === 'over tijd'
        return true
      })
      .sort((a, b) => a.nextDueAt - b.nextDueAt)
  }, [plans, filter])

  const actief = plans.filter((p) => p.active)
  const overTijd = actief.filter((p) => p.nextDueAt < Date.now())
  const dezeWeek = actief.filter(
    (p) => p.nextDueAt >= Date.now() && p.nextDueAt < Date.now() + 7 * DAY)
  const opPeil = actief.length
    ? Math.round(((actief.length - overTijd.length) / actief.length) * 100)
    : 100

  const gekozen = plans.find((p) => p.id === detail)

  async function inplannen(plan: MaintenancePlan) {
    const bon = await planRepo.schedule(plan.id, { id: me.id, name: me.name })
    if (bon) toast.ok(`Werkbon ${bon.number} aangemaakt voor ${plan.title}`)
    else toast.error('Kon geen werkbon maken: het schema hangt aan geen vestiging')
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Op peil"
          value={`${opPeil}%`}
          icon={<CheckCircle2 size={17} />}
          tone={opPeil >= 90 ? 'ok' : opPeil >= 70 ? 'warn' : 'danger'}
        />
        <Stat label="Over tijd" value={overTijd.length} icon={<TriangleAlert size={17} />} tone={overTijd.length ? 'danger' : 'ok'} />
        <Stat label="Deze week" value={dezeWeek.length} icon={<CalendarClock size={17} />} tone="warn" />
        <Stat label="Schemas actief" value={actief.length} icon={<ListChecks size={17} />} />
      </div>

      <Card
        title="Onderhoudsschemas"
        hint={`${rows.length} in beeld`}
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            {[
              { key: 'open', label: 'Openstaand' },
              { key: 'tijd', label: 'Over tijd' },
              { key: 'alles', label: 'Alles' },
            ].map((f) => (
              <button
                key={f.key}
                className={`btn sm ${filter === f.key ? 'primary' : 'ghost'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            {perms.can('maintenance.manage') && (
              <button className="btn primary sm" onClick={() => setNieuw(true)}>
                <Plus size={15} /> Schema
              </button>
            )}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty text="Niets openstaand — alles op schema." icon={<CheckCircle2 size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '58vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Beurt</th>
                  <th>Installatie</th>
                  <th>Vestiging</th>
                  <th>Interval</th>
                  <th>Laatst gedaan</th>
                  <th>Volgende</th>
                  <th className="num">Duur</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const staat = dueStateOf(p)
                  const asset = assetVan(p.assetId)
                  return (
                    <tr key={p.id}>
                      <td style={{ cursor: 'pointer' }} onClick={() => setDetail(p.id)}>
                        <strong>{p.title}</strong>
                        <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                          {p.checklist.length} punten
                        </div>
                      </td>
                      <td>{asset ? `${asset.code} ${asset.name}` : <span style={{ color: 'var(--text-3)' }}>hele vestiging</span>}</td>
                      <td>{naamVan(p.locationId ?? asset?.locationId)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.interval}</td>
                      <td style={{ color: 'var(--text-3)' }}>
                        {p.lastDoneAt ? relative(p.lastDoneAt) : 'nooit'}
                      </td>
                      <td>
                        <Badge tone={staat === 'over tijd' ? 'danger' : staat === 'deze week' ? 'warn' : 'default'}>
                          {dateShort(p.nextDueAt)}
                        </Badge>
                      </td>
                      <td className="num">{duration(p.estimatedMinutes * 60000)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {perms.can('workorders.create') && (
                          <button className="btn sm" onClick={() => void inplannen(p)}>
                            <CalendarPlus size={14} /> Werkbon
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {overTijd.length > 0 && (
        <Card title="Achterstand per vestiging" className="mt">
          <div style={{ display: 'grid', gap: 11 }}>
            {[...new Set(overTijd.map((p) => p.locationId))].map((locId) => {
              const bij = overTijd.filter((p) => p.locationId === locId)
              const totaal = actief.filter((p) => p.locationId === locId).length
              return (
                <div key={locId}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4 }}>
                    <span>{naamVan(locId)}</span>
                    <span className="mono" style={{ color: 'var(--warn)' }}>{bij.length} van {totaal} te laat</span>
                  </div>
                  <div className="bar danger">
                    <span style={{ width: `${(bij.length / Math.max(1, totaal)) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Modal
        open={!!gekozen}
        title={gekozen?.title ?? ''}
        subtitle={gekozen ? `${gekozen.interval} · ${duration(gekozen.estimatedMinutes * 60000)}` : undefined}
        onClose={() => setDetail(null)}
      >
        {gekozen && (
          <>
            {gekozen.description && (
              <p style={{ fontSize: '.88rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
                {gekozen.description}
              </p>
            )}
            <Field label="Checklist">
              <div style={{ display: 'grid', gap: 5 }}>
                {gekozen.checklist.map((c, i) => (
                  <div key={i} className="check-row">
                    <span className="box" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </Field>
            <div className="row end">
              <button className="btn ghost" onClick={() => setDetail(null)}>Sluiten</button>
              {perms.can('workorders.create') && (
                <button
                  className="btn primary"
                  onClick={async () => { await inplannen(gekozen); setDetail(null) }}
                >
                  <CalendarPlus size={15} /> Werkbon maken
                </button>
              )}
            </div>
          </>
        )}
      </Modal>

      <NieuwSchema open={nieuw} onClose={() => setNieuw(false)} assets={assets} />
    </>
  )
}

/* ================================================================== */

function NieuwSchema({
  open, onClose, assets,
}: { open: boolean; onClose: () => void; assets: Asset[] }) {
  const me = useAuth((s) => s.user)!
  const current = useLocationFilter((s) => s.current)
  const locations = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mijne = visibleLocations(me, locations).filter((l) => l.kind === 'vestiging')

  const [locationId, setLocationId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [interval, setInterval] = useState<MaintenanceInterval>('maandelijks')
  const [minuten, setMinuten] = useState('60')
  const [checklist, setChecklist] = useState('')

  const doel = locationId || current || me.locationId || mijne[0]?.id || ''
  const lokaal = assets.filter((a) => a.locationId === doel)

  async function opslaan() {
    if (!doel) return toast.error('Kies een vestiging')
    if (title.trim().length < 3) return toast.error('Geef het schema een naam')
    const punten = checklist.split('\n').map((l) => l.trim()).filter(Boolean)
    if (punten.length === 0) return toast.error('Zet er minstens één controlepunt in')

    await planRepo.create({
      title,
      description,
      interval,
      checklist: punten,
      estimatedMinutes: Number(minuten) || 60,
      assetId: assetId || undefined,
      locationId: doel,
    })
    toast.ok(`Schema aangemaakt — eerste beurt over ${MAINTENANCE_DAYS[interval]} dagen`)
    setTitle(''); setDescription(''); setChecklist('')
    onClose()
  }

  return (
    <Modal open={open} title="Onderhoudsschema" onClose={onClose} width={560}>
      <div className="grid cols-2">
        <Field label="Vestiging">
          <select className="select" value={doel} onChange={(e) => setLocationId(e.target.value)}>
            {mijne.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Installatie" help="Leeg = geldt voor de hele vestiging.">
          <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">— hele vestiging —</option>
            {lokaal.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Naam van de beurt">
        <input
          className="input" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Bijv. Maandelijks onderhoud hogedruk" autoFocus
        />
      </Field>

      <div className="grid cols-2">
        <Field label="Hoe vaak">
          <select
            className="select"
            value={interval}
            onChange={(e) => setInterval(e.target.value as MaintenanceInterval)}
          >
            {(Object.keys(MAINTENANCE_DAYS) as MaintenanceInterval[]).map((i) => (
              <option key={i} value={i}>{i} (elke {MAINTENANCE_DAYS[i]} dagen)</option>
            ))}
          </select>
        </Field>
        <Field label="Duur (minuten)">
          <input className="input" inputMode="numeric" value={minuten} onChange={(e) => setMinuten(e.target.value)} />
        </Field>
      </div>

      <Field label="Toelichting">
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <Field label="Controlepunten" help="Eén per regel. Deze komen als checklist op de werkbon.">
        <textarea
          className="textarea"
          style={{ minHeight: 120 }}
          value={checklist}
          onChange={(e) => setChecklist(e.target.value)}
          placeholder={'Oliepeil pomp controleren\nFilters reinigen\nWerkdruk meten en noteren'}
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void opslaan()}>Aanmaken</button>
      </div>
    </Modal>
  )
}
