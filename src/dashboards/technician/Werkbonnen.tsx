import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Check, ClipboardList, Package, Play, Plus, Printer, Search, Trash2,
} from 'lucide-react'
import { db } from '../../lib/db'
import { workOrders as orderRepo } from '../../lib/techniek'
import type { InventoryItem, User, WorkOrder, WorkOrderStatus } from '../../lib/types'
import { dateTime, duration, money } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

const STATUS_TONE: Record<WorkOrderStatus, 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'> = {
  open: 'warn',
  ingepland: 'info',
  bezig: 'brand',
  gereed: 'ok',
  geannuleerd: 'default',
}

const PRIO_TONE = { laag: 'default', normaal: 'info', hoog: 'warn', spoed: 'danger' } as const

export default function Werkbonnen({ orders }: { orders: WorkOrder[] }) {
  const me = useAuth((s) => s.user)!
  const [filter, setFilter] = useState('mij')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return orders
      .filter((o) => {
        if (filter === 'mij') return o.assignedTo === me.id && o.status !== 'gereed'
        if (filter === 'open') return o.status !== 'gereed' && o.status !== 'geannuleerd'
        if (filter === 'gereed') return o.status === 'gereed'
        return true
      })
      .filter((o) => !needle ||
        o.title.toLowerCase().includes(needle) ||
        o.number.toLowerCase().includes(needle) ||
        (o.assetName ?? '').toLowerCase().includes(needle))
      .sort((a, b) => {
        const prio = { spoed: 0, hoog: 1, normaal: 2, laag: 3 }
        return prio[a.priority] - prio[b.priority] ||
          (a.plannedAt ?? a.createdAt) - (b.plannedAt ?? b.createdAt)
      })
  }, [orders, filter, q, me.id])

  const gekozen = orders.find((o) => o.id === selected)
  if (gekozen) return <WerkbonDetail order={gekozen} onBack={() => setSelected(null)} />

  const open = orders.filter((o) => o.status !== 'gereed' && o.status !== 'geannuleerd')
  const mijn = open.filter((o) => o.assignedTo === me.id)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Voor mij" value={mijn.length} icon={<ClipboardList size={17} />} tone={mijn.length ? 'warn' : 'ok'} />
        <Stat label="Open" value={open.length} />
        <Stat label="Spoed" value={open.filter((o) => o.priority === 'spoed').length} tone="danger" />
        <Stat
          label="Gereed deze maand"
          value={orders.filter((o) =>
            o.status === 'gereed' && (o.completedAt ?? 0) > Date.now() - 30 * 86_400_000).length}
          tone="ok"
        />
      </div>

      <Card
        title="Werkbonnen"
        hint={`${rows.length} in beeld`}
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, width: 180 }}
                placeholder="Nummer of titel"
                value={q}
                maxLength={50}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {[
              { key: 'mij', label: 'Voor mij' },
              { key: 'open', label: 'Open' },
              { key: 'gereed', label: 'Gereed' },
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
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty text="Geen werkbonnen in deze selectie." icon={<ClipboardList size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th>Wat</th>
                  <th>Installatie</th>
                  <th>Soort</th>
                  <th>Prioriteit</th>
                  <th>Monteur</th>
                  <th>Gepland</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(o.id)}>
                    <td className="mono">{o.number}</td>
                    <td><strong>{o.title}</strong></td>
                    <td>{o.assetName ?? '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{o.type}</td>
                    <td><Badge tone={PRIO_TONE[o.priority]}>{o.priority}</Badge></td>
                    <td>{o.assignedName ?? <span style={{ color: 'var(--text-3)' }}>niemand</span>}</td>
                    <td>{o.plannedAt ? new Date(o.plannedAt).toLocaleDateString('nl-NL') : '—'}</td>
                    <td><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
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

/* ================================================================== */

function WerkbonDetail({ order, onBack }: { order: WorkOrder; onBack: () => void }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [afronden, setAfronden] = useState(false)
  const [onderdeel, setOnderdeel] = useState(false)

  const [minuten, setMinuten] = useState(String(order.minutesSpent ?? 60))
  const [gedaan, setGedaan] = useState(order.workDone ?? '')
  const [getekend, setGetekend] = useState(order.signedOffBy ?? '')
  const [extern, setExtern] = useState(String(order.externalCost ?? ''))

  const [partNaam, setPartNaam] = useState('')
  const [partAantal, setPartAantal] = useState('1')
  const [partPrijs, setPartPrijs] = useState('')
  const [partItem, setPartItem] = useState('')

  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const voorraad = useLiveQuery(
    () => db.inventory.where('locationId').equals(order.locationId).toArray(),
    [order.locationId],
    [] as InventoryItem[],
  )
  const monteurs = users.filter(
    (u) => u.active && (u.roles.includes('technician') || u.roles.includes('supervisor')))

  const klaar = order.status === 'gereed'
  const magAfronden = perms.can('workorders.complete')
  const onderdelenTotaal = order.parts.reduce((a, p) => a + p.qty * p.unitPrice, 0)
  const afgevinkt = order.checklist.filter((c) => c.done).length

  async function toewijzen(userId: string) {
    const u = monteurs.find((m) => m.id === userId)
    await orderRepo.assign(order.id, u ? { id: u.id, name: u.name } : null, { id: me.id, name: me.name })
    toast.ok(u ? `Toegewezen aan ${u.name}` : 'Toewijzing verwijderd')
  }

  async function voegOnderdeelToe() {
    const gekozen = voorraad.find((v) => v.id === partItem)
    const naam = gekozen?.name ?? partNaam.trim()
    const aantal = Number(partAantal.replace(',', '.'))
    const prijs = gekozen?.pricePerUnit ?? Number(partPrijs.replace(',', '.'))

    if (!naam) return toast.error('Kies een artikel of vul een naam in')
    if (!Number.isFinite(aantal) || aantal <= 0) return toast.error('Vul een geldig aantal in')

    await orderRepo.addPart(order.id, {
      itemId: gekozen?.id,
      name: naam,
      qty: aantal,
      unitPrice: Number.isFinite(prijs) ? prijs : 0,
    })
    toast.ok(`${aantal}× ${naam} toegevoegd`)
    setOnderdeel(false)
    setPartNaam(''); setPartAantal('1'); setPartPrijs(''); setPartItem('')
  }

  async function rondAf() {
    const min = Number(minuten.replace(',', '.'))
    if (!Number.isFinite(min) || min <= 0) return toast.error('Vul de bestede tijd in')
    if (gedaan.trim().length < 5) return toast.error('Noteer kort wat er gedaan is')

    await orderRepo.complete({
      id: order.id,
      minutesSpent: Math.round(min),
      workDone: gedaan,
      signedOffBy: getekend,
      externalCost: extern ? Number(extern.replace(',', '.')) : undefined,
      by: { id: me.id, name: me.name },
    })
    toast.ok(`Werkbon ${order.number} afgerond`)
    setAfronden(false)
    onBack()
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={onBack}>
          <ArrowLeft size={15} /> Terug
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => window.print()}>
          <Printer size={14} /> Afdrukken
        </button>
      </div>

      <Card>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="mono" style={{ color: 'var(--text-3)' }}>{order.number}</span>
          <Badge tone={PRIO_TONE[order.priority]}>{order.priority}</Badge>
          <Badge tone={STATUS_TONE[order.status]}>{order.status}</Badge>
          <Badge>{order.type}</Badge>
        </div>

        <h2>{order.title}</h2>
        {order.description && (
          <p style={{ fontSize: '.9rem', lineHeight: 1.6, color: 'var(--text-2)', marginTop: 8 }}>
            {order.description}
          </p>
        )}

        <div className="person-fields" style={{ marginTop: 16 }}>
          <div className="person-field">
            <div className="label">Installatie</div>
            <div className="value">{order.assetName ?? '—'}</div>
          </div>
          <div className="person-field">
            <div className="label">Aangemaakt</div>
            <div className="value">{dateTime(order.createdAt)} · {order.createdByName}</div>
          </div>
          <div className="person-field">
            <div className="label">Gepland</div>
            <div className="value">
              {order.plannedAt ? new Date(order.plannedAt).toLocaleDateString('nl-NL') : 'niet ingepland'}
            </div>
          </div>
          {klaar && (
            <div className="person-field">
              <div className="label">Bestede tijd</div>
              <div className="value">{duration((order.minutesSpent ?? 0) * 60000)}</div>
            </div>
          )}
        </div>

        {!klaar && perms.can('workorders.assign') && (
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <Field label="Monteur">
              <select
                className="select"
                value={order.assignedTo ?? ''}
                onChange={(e) => void toewijzen(e.target.value)}
              >
                <option value="">— niet toegewezen —</option>
                {monteurs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Inplannen op">
              <input
                className="input"
                type="date"
                value={order.plannedAt ? new Date(order.plannedAt).toISOString().slice(0, 10) : ''}
                onChange={(e) => {
                  const d = e.target.value ? new Date(e.target.value + 'T08:00:00').getTime() : undefined
                  void orderRepo.update(order.id, { plannedAt: d })
                }}
              />
            </Field>
          </div>
        )}

        {!klaar && (
          <div className="row" style={{ marginTop: 8 }}>
            {order.status !== 'bezig' && (
              <button className="btn" onClick={() => void orderRepo.start(order.id)}>
                <Play size={15} /> Beginnen
              </button>
            )}
            <span style={{ flex: 1 }} />
            {magAfronden && (
              <button className="btn ok" onClick={() => setAfronden(true)}>
                <Check size={15} /> Afronden
              </button>
            )}
          </div>
        )}
      </Card>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="Checklist" hint={`${afgevinkt} van ${order.checklist.length}`}>
          {order.checklist.length === 0 ? (
            <Empty text="Geen checklist bij deze bon." />
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {order.checklist.map((c, i) => (
                <button
                  key={i}
                  className={`check-row ${c.done ? 'done' : ''}`}
                  disabled={klaar}
                  onClick={() => void orderRepo.toggleCheck(order.id, i)}
                >
                  <span className="box">{c.done && <Check size={13} />}</span>
                  <span>{c.text}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Onderdelen"
          hint={onderdelenTotaal ? money(onderdelenTotaal) : undefined}
          action={
            !klaar ? (
              <button className="btn sm" onClick={() => setOnderdeel(true)}>
                <Plus size={14} /> Toevoegen
              </button>
            ) : undefined
          }
        >
          {order.parts.length === 0 ? (
            <Empty text="Geen onderdelen gebruikt." icon={<Package size={28} />} />
          ) : (
            <div className="table-wrap">
              <table className="data" style={{ minWidth: 0 }}>
                <tbody>
                  {order.parts.map((p, i) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td className="num">{p.qty}×</td>
                      <td className="num">{money(p.unitPrice)}</td>
                      <td className="num">{money(p.qty * p.unitPrice)}</td>
                      {!klaar && (
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn ghost sm"
                            onClick={() => void orderRepo.removePart(order.id, i)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {order.externalCost ? (
            <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', fontSize: '.85rem' }}>
              <span style={{ color: 'var(--text-3)' }}>Externe partij</span>
              <span className="mono">{money(order.externalCost)}</span>
            </div>
          ) : null}
        </Card>
      </div>

      {klaar && order.workDone && (
        <Card title="Uitgevoerd werk" className="mt">
          <p style={{ fontSize: '.9rem', lineHeight: 1.6, color: 'var(--text-2)' }}>{order.workDone}</p>
          <div className="row" style={{ marginTop: 12, fontSize: '.82rem', color: 'var(--text-3)' }}>
            <span>Afgerond {order.completedAt ? dateTime(order.completedAt) : ''}</span>
            {order.signedOffBy && <span>· Akkoord van {order.signedOffBy}</span>}
          </div>
        </Card>
      )}

      {/* --- onderdeel toevoegen --- */}
      <Modal open={onderdeel} title="Onderdeel toevoegen" onClose={() => setOnderdeel(false)}>
        <Field label="Uit de voorraad" help="Of laat leeg en vul hieronder zelf iets in.">
          <select className="select" value={partItem} onChange={(e) => setPartItem(e.target.value)}>
            <option value="">— niet uit de voorraad —</option>
            {voorraad.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.stock} {v.unit} op voorraad)
              </option>
            ))}
          </select>
        </Field>

        {!partItem && (
          <div className="grid cols-2">
            <Field label="Omschrijving">
              <input className="input" value={partNaam} onChange={(e) => setPartNaam(e.target.value)} />
            </Field>
            <Field label="Prijs per stuk">
              <input className="input" inputMode="decimal" value={partPrijs} onChange={(e) => setPartPrijs(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Aantal">
          <input className="input" inputMode="decimal" value={partAantal} onChange={(e) => setPartAantal(e.target.value)} />
        </Field>

        <div className="row end">
          <button className="btn ghost" onClick={() => setOnderdeel(false)}>Annuleren</button>
          <button className="btn primary" onClick={() => void voegOnderdeelToe()}>Toevoegen</button>
        </div>
      </Modal>

      {/* --- afronden --- */}
      <Modal
        open={afronden}
        title="Werkbon afronden"
        subtitle={order.number + ' — ' + order.title}
        onClose={() => setAfronden(false)}
        width={560}
      >
        <div className="grid cols-2">
          <Field label="Bestede tijd (minuten)">
            <input className="input" inputMode="numeric" value={minuten} onChange={(e) => setMinuten(e.target.value)} autoFocus />
          </Field>
          <Field label="Kosten externe partij (€)" help="Leeg laten als er niets extern is gedaan.">
            <input className="input" inputMode="decimal" value={extern} onChange={(e) => setExtern(e.target.value)} />
          </Field>
        </div>

        <Field label="Wat is er gedaan?">
          <textarea
            className="textarea"
            value={gedaan}
            maxLength={800}
            onChange={(e) => setGedaan(e.target.value)}
            placeholder="Bevindingen, uitgevoerd werk, eventueel advies voor de volgende keer"
          />
        </Field>

        <Field label="Akkoord van (naam op de vestiging)" help="Wie op de locatie heeft gezien dat het werkt.">
          <input className="input" value={getekend} onChange={(e) => setGetekend(e.target.value)} />
        </Field>

        {order.faultId && (
          <div style={{ fontSize: '.82rem', color: 'var(--text-3)', marginBottom: 12 }}>
            De gekoppelde storing wordt hiermee ook afgemeld, en de melder krijgt bericht.
          </div>
        )}

        <div className="row end">
          <button className="btn ghost" onClick={() => setAfronden(false)}>Annuleren</button>
          <button className="btn ok" onClick={() => void rondAf()}>
            <Check size={15} /> Afronden
          </button>
        </div>
      </Modal>
    </>
  )
}
