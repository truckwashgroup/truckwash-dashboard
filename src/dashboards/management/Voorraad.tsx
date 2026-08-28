import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Package, PackagePlus, ShoppingCart, TriangleAlert } from 'lucide-react'
import { db } from '../../lib/db'
import { inventory as invRepo } from '../../lib/repo'
import type { InventoryItem, StockMovement } from '../../lib/types'
import { dateShort, dateTime, money, number } from '../../lib/format'
import { Badge, Bar, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { inventoryHealth, startOfDay } from '../../lib/analytics'
import { filterByLocation, useLocationFilter } from '../../lib/locations'
import { BRAND, gridStroke, tooltipStyle } from '../../lib/charts'

const DAY = 86_400_000

export default function Voorraad({ days }: { days: number }) {
  const user = useAuth((s) => s.user)!
  const currentLocation = useLocationFilter((s) => s.current)
  const [newOpen, setNewOpen] = useState(false)
  const [edit, setEdit] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState({
    name: '', unit: 'liter', stock: '0', minStock: '0', pricePerUnit: '0', supplier: '',
  })

  const alleItems = useLiveQuery(() => db.inventory.orderBy('name').toArray(), [], [] as InventoryItem[])
  const alleMovements = useLiveQuery(() => db.stockMovements.toArray(), [], [] as StockMovement[])

  // Voorraad is per vestiging; laat alleen zien waar je bij mag en wat je
  // bovenin hebt gekozen.
  const items = useMemo(
    () => filterByLocation(user, alleItems, currentLocation),
    [user, alleItems, currentLocation],
  )
  const movements = useMemo(
    () => filterByLocation(user, alleMovements, currentLocation),
    [user, alleMovements, currentLocation],
  )

  const health = inventoryHealth(items)

  const verbruikSerie = useMemo(() => {
    const from = startOfDay(Date.now() - (days - 1) * DAY)
    const buckets = new Map<number, { label: string; verbruik: number; waarde: number }>()
    for (let i = 0; i < days; i++) {
      const ts = from + i * DAY
      buckets.set(ts, {
        label: new Date(ts).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }),
        verbruik: 0,
        waarde: 0,
      })
    }
    const priceOf = new Map(items.map((i) => [i.id, i.pricePerUnit]))
    for (const m of movements) {
      if (m.qty >= 0) continue
      const b = buckets.get(startOfDay(m.at))
      if (!b) continue
      b.verbruik += Math.abs(m.qty)
      b.waarde += Math.abs(m.qty) * (priceOf.get(m.itemId) ?? 0)
    }
    return [...buckets.values()].map((b) => ({
      ...b,
      verbruik: Math.round(b.verbruik * 10) / 10,
      waarde: Math.round(b.waarde * 100) / 100,
    }))
  }, [movements, items, days])

  const verbruikswaarde = verbruikSerie.reduce((a, b) => a + b.waarde, 0)

  async function createItem() {
    if (!form.name.trim()) return toast.error('Vul een naam in')
    const doel = currentLocation ?? user.locationId
    if (!doel) {
      return toast.error('Kies eerst een vestiging bovenin; voorraad hoort bij een vestiging.')
    }

    await invRepo.create({
      locationId: doel,
      name: form.name.trim(),
      unit: form.unit.trim() || 'stuk',
      stock: Number(form.stock.replace(',', '.')) || 0,
      minStock: Number(form.minStock.replace(',', '.')) || 0,
      pricePerUnit: Number(form.pricePerUnit.replace(',', '.')) || 0,
      supplier: form.supplier.trim() || 'Onbekend',
    })
    toast.ok('Artikel toegevoegd')
    setNewOpen(false)
    setForm({ name: '', unit: 'liter', stock: '0', minStock: '0', pricePerUnit: '0', supplier: '' })
  }

  async function saveEdit() {
    if (!edit) return
    await invRepo.upsert(edit)
    toast.ok('Artikel bijgewerkt')
    setEdit(null)
  }

  async function bestel(item: InventoryItem) {
    const qty = Math.max(1, Math.round(item.minStock * 2 - item.stock))
    await invRepo.adjust({
      itemId: item.id,
      qty,
      reason: `Bestelling geplaatst bij ${item.supplier}`,
      user: { id: user.id, name: user.name },
    })
    toast.ok(`${qty} ${item.unit} ${item.name} bijgeboekt`)
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Artikelen" value={items.length} icon={<Package size={17} />} />
        <Stat
          label="Onder minimum"
          value={health.low.length}
          icon={<TriangleAlert size={17} />}
          tone={health.low.length ? 'danger' : 'ok'}
        />
        <Stat label="Voorraadwaarde" value={money(health.waarde)} icon={<Package size={17} />} tone="ok" />
        <Stat
          label={`Verbruikswaarde (${days}d)`}
          value={money(verbruikswaarde)}
          icon={<ShoppingCart size={17} />}
          tone="warn"
        />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="Verbruik in euro's" hint={`Laatste ${days} dagen`}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={verbruikSerie} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" stroke="#6b7d9e" fontSize={11} tickLine={false} minTickGap={26} />
                <YAxis stroke="#6b7d9e" fontSize={11} tickLine={false} width={54} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [money(v), 'Verbruik']}
                />
                <Line type="monotone" dataKey="waarde" stroke={BRAND} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Bestellijst" hint={health.low.length ? `Geschat ${money(health.bestelwaarde)}` : 'Alles op peil'}>
          {health.low.length === 0 ? (
            <Empty text="Geen artikelen onder het minimum." icon={<ShoppingCart size={30} />} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {health.low.map((i) => {
                const nodig = Math.max(1, Math.round(i.minStock * 2 - i.stock))
                return (
                  <div
                    key={i.id}
                    className="row"
                    style={{
                      padding: 11, borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
                      flexWrap: 'nowrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: '.88rem' }}>{i.name}</strong>
                      <div style={{ fontSize: '.73rem', color: 'var(--text-3)' }}>
                        {i.supplier} · nu {number(i.stock)} {i.unit}, min. {number(i.minStock)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: '.83rem' }}>
                        {nodig} {i.unit}
                      </div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                        {money(nodig * i.pricePerUnit)}
                      </div>
                    </div>
                    <button className="btn primary sm" onClick={() => void bestel(i)}>
                      Bestellen
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Artikelen"
        flush
        action={
          <button className="btn primary sm" onClick={() => setNewOpen(true)}>
            <PackagePlus size={15} /> Artikel toevoegen
          </button>
        }
      >
        {items.length === 0 ? (
          <Empty text="Nog geen artikelen." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th>Leverancier</th>
                  <th className="num">Voorraad</th>
                  <th className="num">Minimum</th>
                  <th style={{ width: 130 }}>Niveau</th>
                  <th className="num">Prijs</th>
                  <th className="num">Waarde</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const low = i.stock < i.minStock
                  return (
                    <tr key={i.id}>
                      <td><strong>{i.name}</strong></td>
                      <td style={{ color: 'var(--text-3)' }}>{i.supplier}</td>
                      <td className="num">{number(i.stock)} {i.unit}</td>
                      <td className="num" style={{ color: 'var(--text-3)' }}>{number(i.minStock)}</td>
                      <td>
                        <Bar value={i.stock} max={i.minStock * 2} tone={low ? 'danger' : undefined} />
                        {low && <Badge tone="danger">Laag</Badge>}
                      </td>
                      <td className="num">{money(i.pricePerUnit)}</td>
                      <td className="num">{money(i.stock * i.pricePerUnit)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn sm" onClick={() => setEdit({ ...i })}>Wijzigen</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recente mutaties" flush className="mt">
        {movements.length === 0 ? (
          <Empty text="Geen mutaties." />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Wanneer</th>
                  <th>Artikel</th>
                  <th className="num">Aantal</th>
                  <th>Reden</th>
                  <th>Door</th>
                </tr>
              </thead>
              <tbody>
                {[...movements].sort((a, b) => b.at - a.at).slice(0, 60).map((m) => (
                  <tr key={m.id}>
                    <td>
                      {dateShort(m.at)}
                      <div style={{ fontSize: '.71rem', color: 'var(--text-3)' }}>{dateTime(m.at).split(' ')[1]}</div>
                    </td>
                    <td>{m.itemName}</td>
                    <td className="num" style={{ color: m.qty < 0 ? 'var(--warn)' : 'var(--ok)' }}>
                      {m.qty > 0 ? '+' : ''}{number(m.qty)}
                    </td>
                    <td style={{ color: 'var(--text-3)' }}>{m.reason}</td>
                    <td>{m.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* nieuw artikel */}
      <Modal open={newOpen} title="Artikel toevoegen" onClose={() => setNewOpen(false)}>
        <Field label="Naam">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <div className="grid cols-2">
          <Field label="Eenheid">
            <input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </Field>
          <Field label="Leverancier">
            <input className="input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </Field>
        </div>
        <div className="grid cols-3">
          <Field label="Voorraad">
            <input className="input" inputMode="decimal" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          </Field>
          <Field label="Minimum">
            <input className="input" inputMode="decimal" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
          </Field>
          <Field label="Prijs p/e">
            <input className="input" inputMode="decimal" value={form.pricePerUnit} onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })} />
          </Field>
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={() => setNewOpen(false)}>Annuleren</button>
          <button className="btn primary" onClick={() => void createItem()}>Toevoegen</button>
        </div>
      </Modal>

      {/* artikel wijzigen */}
      <Modal open={!!edit} title="Artikel wijzigen" subtitle={edit?.name} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <Field label="Naam">
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <div className="grid cols-2">
              <Field label="Leverancier">
                <input className="input" value={edit.supplier} onChange={(e) => setEdit({ ...edit, supplier: e.target.value })} />
              </Field>
              <Field label="Eenheid">
                <input className="input" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
              </Field>
            </div>
            <div className="grid cols-3">
              <Field label="Voorraad">
                <input
                  className="input" inputMode="decimal" value={String(edit.stock)}
                  onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value.replace(',', '.')) || 0 })}
                />
              </Field>
              <Field label="Minimum">
                <input
                  className="input" inputMode="decimal" value={String(edit.minStock)}
                  onChange={(e) => setEdit({ ...edit, minStock: Number(e.target.value.replace(',', '.')) || 0 })}
                />
              </Field>
              <Field label="Prijs p/e">
                <input
                  className="input" inputMode="decimal" value={String(edit.pricePerUnit)}
                  onChange={(e) => setEdit({ ...edit, pricePerUnit: Number(e.target.value.replace(',', '.')) || 0 })}
                />
              </Field>
            </div>
            <div className="row end">
              <button className="btn ghost" onClick={() => setEdit(null)}>Annuleren</button>
              <button className="btn primary" onClick={() => void saveEdit()}>Opslaan</button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
