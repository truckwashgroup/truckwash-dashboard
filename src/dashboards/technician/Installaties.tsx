import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Plus, Printer, QrCode, RefreshCw, Search, Wrench,
} from 'lucide-react'
import { db } from '../../lib/db'
import { assets as assetRepo } from '../../lib/techniek'
import {
  ASSET_CATEGORIES, type Asset, type AssetCategory, type AssetStatus,
  type Fault, type Location, type WorkOrder,
} from '../../lib/types'
import { dateShort, duration, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { QrLabel } from '../../components/QrScanner'
import { SeverityBadge } from '../../components/StoringMelden'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { useLocationFilter, visibleLocations } from '../../lib/locations'
import { toast } from '../../store/useToasts'

const STATUS_TONE: Record<AssetStatus, 'ok' | 'danger' | 'warn' | 'default'> = {
  'in bedrijf': 'ok',
  storing: 'danger',
  onderhoud: 'warn',
  'buiten gebruik': 'default',
}

export default function Installaties({
  assets, focusId,
}: {
  assets: Asset[]
  focusId?: string
}) {
  const perms = usePerms()
  const [q, setQ] = useState('')
  const [categorie, setCategorie] = useState('alle')
  const [selected, setSelected] = useState<string | null>(focusId ?? null)
  const [nieuw, setNieuw] = useState(false)
  const [labels, setLabels] = useState(false)

  useEffect(() => { if (focusId) setSelected(focusId) }, [focusId])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return assets
      .filter((a) => categorie === 'alle' || a.category === categorie)
      .filter((a) => !needle ||
        a.name.toLowerCase().includes(needle) ||
        a.code.toLowerCase().includes(needle) ||
        a.qrToken.toLowerCase().includes(needle) ||
        (a.brand ?? '').toLowerCase().includes(needle))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [assets, q, categorie])

  const gekozen = assets.find((a) => a.id === selected)
  if (gekozen) return <AssetDetail asset={gekozen} onBack={() => setSelected(null)} />

  const stuk = assets.filter((a) => a.status === 'storing')
  const gebruikteCategorieen = [...new Set(assets.map((a) => a.category))]

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Installaties" value={assets.length} icon={<Wrench size={17} />} />
        <Stat label="In storing" value={stuk.length} tone={stuk.length ? 'danger' : 'ok'} />
        <Stat
          label="Onderhoud te laat"
          value={assets.filter((a) => a.nextServiceAt && a.nextServiceAt < Date.now()).length}
          tone="warn"
        />
        <Stat
          label="Garantie verloopt binnen 3 maanden"
          value={assets.filter((a) =>
            a.warrantyUntil && a.warrantyUntil > Date.now() &&
            a.warrantyUntil < Date.now() + 90 * 86_400_000).length}
        />
      </div>

      <Card
        title="Machinepark"
        hint={`${rows.length} van ${assets.length}`}
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, width: 190 }}
                placeholder="Naam, code of QR"
                value={q}
                maxLength={40}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select className="select" style={{ width: 170 }} value={categorie} onChange={(e) => setCategorie(e.target.value)}>
              <option value="alle">Alle soorten</option>
              {gebruikteCategorieen.map((c) => (
                <option key={c} value={c}>{ASSET_CATEGORIES[c]}</option>
              ))}
            </select>
            <button className="btn sm" onClick={() => setLabels(true)}>
              <QrCode size={14} /> Labels
            </button>
            {perms.can('assets.manage') && (
              <button className="btn primary sm" onClick={() => setNieuw(true)}>
                <Plus size={15} /> Installatie
              </button>
            )}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty text="Geen installaties gevonden." icon={<Wrench size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Installatie</th>
                  <th>Soort</th>
                  <th>Merk en type</th>
                  <th>Plek</th>
                  <th>QR</th>
                  <th>Volgende beurt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const teLaat = a.nextServiceAt && a.nextServiceAt < Date.now()
                  return (
                    <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(a.id)}>
                      <td className="mono">{a.code}</td>
                      <td><strong>{a.name}</strong></td>
                      <td>{ASSET_CATEGORIES[a.category]}</td>
                      <td style={{ color: 'var(--text-3)' }}>
                        {[a.brand, a.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td style={{ color: 'var(--text-3)' }}>{a.location ?? '—'}</td>
                      <td className="mono" style={{ fontSize: '.76rem' }}>{a.qrToken}</td>
                      <td style={{ color: teLaat ? 'var(--warn)' : undefined }}>
                        {a.nextServiceAt ? dateShort(a.nextServiceAt) : '—'}
                      </td>
                      <td><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <LabelVel open={labels} onClose={() => setLabels(false)} assets={rows} />
      <NieuweInstallatie open={nieuw} onClose={() => setNieuw(false)} onCreated={setSelected} />
    </>
  )
}

/* ================================================================== */

function AssetDetail({ asset, onBack }: { asset: Asset; onBack: () => void }) {
  const perms = usePerms()
  const [labelOpen, setLabelOpen] = useState(false)

  const faults = useLiveQuery(
    async () => (await db.faults.where('assetId').equals(asset.id).toArray())
      .sort((a, b) => b.reportedAt - a.reportedAt),
    [asset.id],
    [] as Fault[],
  )
  const orders = useLiveQuery(
    async () => (await db.workOrders.where('assetId').equals(asset.id).toArray())
      .sort((a, b) => b.createdAt - a.createdAt),
    [asset.id],
    [] as WorkOrder[],
  )
  const locatie = useLiveQuery(() => db.locations.get(asset.locationId), [asset.locationId], undefined)

  const open = faults.filter((f) => f.status !== 'opgelost' && f.status !== 'afgewezen')
  const uren = orders.reduce((a, o) => a + (o.minutesSpent ?? 0), 0)

  return (
    <>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar het machinepark
      </button>

      <Card>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span className="mono" style={{ color: 'var(--text-3)' }}>{asset.code}</span>
              <Badge tone={STATUS_TONE[asset.status]}>{asset.status}</Badge>
              <Badge>{ASSET_CATEGORIES[asset.category]}</Badge>
            </div>
            <h2>{asset.name}</h2>
            <div style={{ fontSize: '.84rem', color: 'var(--text-3)', marginTop: 4 }}>
              {[asset.brand, asset.model].filter(Boolean).join(' ')}
              {asset.serialNumber ? ` · serienr. ${asset.serialNumber}` : ''}
              {locatie ? ` · ${locatie.name}` : ''}
              {asset.location ? ` · ${asset.location}` : ''}
            </div>
          </div>

          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setLabelOpen(true)}>
              <QrCode size={14} /> Label
            </button>
            {perms.can('assets.manage') && (
              <select
                className="select"
                style={{ width: 150 }}
                value={asset.status}
                onChange={(e) => void assetRepo.setStatus(asset.id, e.target.value as AssetStatus)}
              >
                <option value="in bedrijf">In bedrijf</option>
                <option value="storing">Storing</option>
                <option value="onderhoud">In onderhoud</option>
                <option value="buiten gebruik">Buiten gebruik</option>
              </select>
            )}
          </div>
        </div>

        <div className="person-fields" style={{ marginTop: 18 }}>
          <div className="person-field">
            <div className="label">QR-sleutel</div>
            <div className="value mono">{asset.qrToken}</div>
          </div>
          <div className="person-field">
            <div className="label">Geïnstalleerd</div>
            <div className="value">{asset.installedAt ? dateShort(asset.installedAt) : '—'}</div>
          </div>
          <div className="person-field">
            <div className="label">Garantie tot</div>
            <div className="value">
              {asset.warrantyUntil ? dateShort(asset.warrantyUntil) : '—'}
              {asset.warrantyUntil && asset.warrantyUntil < Date.now() && (
                <span style={{ color: 'var(--text-3)' }}> (verlopen)</span>
              )}
            </div>
          </div>
          <div className="person-field">
            <div className="label">Draaiuren</div>
            <div className="value">{asset.runningHours ? `${asset.runningHours} u` : '—'}</div>
          </div>
          <div className="person-field">
            <div className="label">Laatste beurt</div>
            <div className="value">{asset.lastServiceAt ? relative(asset.lastServiceAt) : '—'}</div>
          </div>
          <div className="person-field">
            <div className="label">Volgende beurt</div>
            <div className="value">{asset.nextServiceAt ? dateShort(asset.nextServiceAt) : '—'}</div>
          </div>
        </div>

        {asset.notes && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)', fontSize: '.86rem', color: 'var(--text-2)' }}>
            {asset.notes}
          </div>
        )}
      </Card>

      <div className="grid cols-3" style={{ margin: '16px 0' }}>
        <Stat label="Open storingen" value={open.length} tone={open.length ? 'warn' : 'ok'} />
        <Stat label="Storingen totaal" value={faults.length} />
        <Stat label="Besteed aan onderhoud" value={duration(uren * 60000)} />
      </div>

      <div className="grid cols-2">
        <Card title="Storingshistorie" flush>
          {faults.length === 0 ? (
            <Empty text="Nooit een storing gehad." />
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {faults.map((f) => (
                <div key={f.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontSize: '.76rem', color: 'var(--text-3)' }}>{f.number}</span>
                    <SeverityBadge severity={f.severity} />
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>{relative(f.reportedAt)}</span>
                  </div>
                  <div style={{ fontSize: '.86rem', marginTop: 3 }}>{f.title}</div>
                  {f.resolution && (
                    <div style={{ fontSize: '.76rem', color: 'var(--text-3)' }}>{f.resolution}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Werkbonnen" flush>
          {orders.length === 0 ? (
            <Empty text="Nog geen werkbonnen." />
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {orders.map((o) => (
                <div key={o.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="mono" style={{ fontSize: '.76rem', color: 'var(--text-3)' }}>{o.number}</span>
                    <Badge>{o.type}</Badge>
                    <span style={{ flex: 1 }} />
                    <Badge tone={o.status === 'gereed' ? 'ok' : 'warn'}>{o.status}</Badge>
                  </div>
                  <div style={{ fontSize: '.86rem', marginTop: 3 }}>{o.title}</div>
                  <div style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>
                    {o.assignedName ?? 'niet toegewezen'}
                    {o.minutesSpent ? ` · ${duration(o.minutesSpent * 60000)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={labelOpen} title="QR-label" subtitle={asset.name} onClose={() => setLabelOpen(false)}>
        <div className="qr-sheet">
          <QrLabel
            token={asset.qrToken}
            code={asset.code}
            name={asset.name}
            locationName={locatie?.name}
            size={170}
          />
        </div>
        <div className="row end" style={{ marginTop: 16 }}>
          {perms.can('assets.manage') && (
            <button
              className="btn ghost sm"
              title="Nieuwe sleutel maken, bijvoorbeeld als het label beschadigd is"
              onClick={async () => {
                await assetRepo.regenerateQr(asset.id)
                toast.ok('Nieuwe QR-sleutel aangemaakt — druk het label opnieuw af')
              }}
            >
              <RefreshCw size={14} /> Nieuw label
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => window.print()}>
            <Printer size={15} /> Afdrukken
          </button>
        </div>
      </Modal>
    </>
  )
}

/* ================================================================== */

function LabelVel({
  open, onClose, assets,
}: { open: boolean; onClose: () => void; assets: Asset[] }) {
  const locations = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const naam = (id: string) => locations.find((l) => l.id === id)?.name

  return (
    <Modal
      open={open}
      title="QR-labels afdrukken"
      subtitle={`${assets.length} labels — plak ze op de apparaten`}
      onClose={onClose}
      width={780}
    >
      <div style={{ fontSize: '.83rem', color: 'var(--text-3)', marginBottom: 14 }}>
        Print op sticker- of laminaatpapier. Onder elke QR staat de code ook
        leesbaar, zodat iemand met een vieze camera hem kan intypen.
      </div>
      <div className="qr-sheet" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {assets.slice(0, 60).map((a) => (
          <QrLabel
            key={a.id}
            token={a.qrToken}
            code={a.code}
            name={a.name}
            locationName={naam(a.locationId)}
            size={120}
          />
        ))}
      </div>
      <div className="row end" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Sluiten</button>
        <button className="btn primary" onClick={() => window.print()}>
          <Printer size={15} /> Afdrukken
        </button>
      </div>
    </Modal>
  )
}

function NieuweInstallatie({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const me = useAuth((s) => s.user)!
  const current = useLocationFilter((s) => s.current)
  const locations = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mijne = visibleLocations(me, locations).filter((l) => l.kind === 'vestiging')

  const [form, setForm] = useState({
    locationId: '', name: '', category: 'wasstraat' as AssetCategory,
    brand: '', model: '', serialNumber: '', location: '', notes: '',
  })

  const doel = form.locationId || current || me.locationId || mijne[0]?.id || ''

  async function opslaan() {
    if (!doel) return toast.error('Kies een vestiging')
    if (form.name.trim().length < 2) return toast.error('Vul een naam in')

    const asset = await assetRepo.create({
      locationId: doel,
      name: form.name,
      category: form.category,
      brand: form.brand,
      model: form.model,
      serialNumber: form.serialNumber,
      location: form.location,
      notes: form.notes,
    })
    toast.ok(`${asset.name} toegevoegd met code ${asset.code}`)
    setForm({ ...form, name: '', brand: '', model: '', serialNumber: '', notes: '' })
    onClose()
    onCreated(asset.id)
  }

  return (
    <Modal open={open} title="Installatie toevoegen" onClose={onClose} width={560}>
      <div className="grid cols-2">
        <Field label="Vestiging">
          <select className="select" value={doel} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
            {mijne.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Soort">
          <select
            className="select"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as AssetCategory })}
          >
            {(Object.keys(ASSET_CATEGORIES) as AssetCategory[]).map((c) => (
              <option key={c} value={c}>{ASSET_CATEGORIES[c]}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Naam" help="De code en de QR-sleutel worden automatisch gemaakt.">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </Field>

      <div className="grid cols-3">
        <Field label="Merk">
          <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </Field>
        <Field label="Type">
          <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </Field>
        <Field label="Serienummer">
          <input className="input" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
        </Field>
      </div>

      <Field label="Waar staat het?" help="Bijv. Machinekamer of Wasstraat 2">
        <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      </Field>

      <Field label="Notitie">
        <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void opslaan()}>Toevoegen</button>
      </div>
    </Modal>
  )
}
