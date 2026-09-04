import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Minus, Package, Plus, Send, TriangleAlert } from 'lucide-react'
import { db } from '../../lib/db'
import { inventory as invRepo } from '../../lib/repo'
import { isConceptNummer, nieuweBestelling, voorstelAantal } from '../../lib/trucksupply'
import type { Bestelling, Bestelregel, InventoryItem, StockMovement } from '../../lib/types'
import { dateTime, money, number } from '../../lib/format'
import { Badge, Bar, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { inventoryHealth } from '../../lib/analytics'

export default function Materiaal() {
  const user = useAuth((s) => s.user)!
  const [target, setTarget] = useState<{ item: InventoryItem; dir: 1 | -1 } | null>(null)
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')

  const items = useLiveQuery(
    () => db.inventory.orderBy('name').toArray(),
    [],
    [] as InventoryItem[],
  )

  const movements = useLiveQuery(
    async () => (await db.stockMovements.orderBy('at').reverse().limit(25).toArray()),
    [],
    [] as StockMovement[],
  )

  const health = inventoryHealth(items)

  /*
   * Aanvragen bij Trucksshop.
   *
   * Vroeger ging "we zijn door de shampoo heen" per telefoon of appje, of
   * helemaal niet. Nu maakt de knop een bestelling met bron 'aanvraag' aan:
   * die verschijnt bij Trucksshop als concept, met de standaard
   * bestelhoeveelheid erin. Staat het artikel al in een lopende bestelling,
   * dan zeggen we dat in plaats van een tweede aan te maken.
   */
  const bestellingen = useLiveQuery(() => db.bestellingen.toArray(), [], [] as Bestelling[])
  const bestelregels = useLiveQuery(() => db.bestelregels.toArray(), [], [] as Bestelregel[])

  function onderweg(item: InventoryItem): Bestelling | undefined {
    return bestellingen.find((b) =>
      b.locationId === item.locationId
      && b.status !== 'ontvangen' && b.status !== 'geannuleerd'
      && bestelregels.some((r) => r.bestellingId === b.id && r.itemId === item.id))
  }

  async function aanvragen(item: InventoryItem) {
    // Dezelfde regel als bij de leverancier, anders vraagt de vloer 12 en
    // stelt het voorraadscherm 10 voor.
    const aantal = voorstelAantal(item)
    try {
      await nieuweBestelling({
        locationId: item.locationId,
        bron: 'aanvraag',
        door: { id: user.id, name: user.name },
        regels: [{ itemId: item.id, itemNaam: item.name, aantal, eenheid: item.unit, prijs: item.inkoopprijs }],
        opmerking: `Aangevraagd vanaf de vloer door ${user.name}`,
      })
      toast.ok(`${aantal} ${item.unit} ${item.name} aangevraagd bij Trucksshop`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function submit() {
    if (!target) return
    const amount = Number(qty.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Vul een geldig aantal in')
      return
    }
    await invRepo.adjust({
      itemId: target.item.id,
      qty: amount * target.dir,
      reason: reason || (target.dir < 0 ? 'Verbruik wasstraat' : 'Levering ontvangen'),
      user: { id: user.id, name: user.name },
    })
    toast.ok(
      `${target.dir < 0 ? 'Verbruik' : 'Ontvangst'} van ${amount} ${target.item.unit} ${target.item.name} geboekt`,
    )
    setTarget(null)
    setQty('1')
    setReason('')
  }

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Artikelen" value={items.length} icon={<Package size={17} />} />
        <Stat
          label="Onder minimum"
          value={health.low.length}
          icon={<TriangleAlert size={17} />}
          tone={health.low.length ? 'danger' : 'ok'}
        />
        <Stat label="Voorraadwaarde" value={money(health.waarde)} icon={<Package size={17} />} tone="ok" />
      </div>

      {health.low.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderColor: 'rgba(245,181,68,.35)',
            background: 'rgba(245,181,68,.07)',
          }}
        >
          <div className="row">
            <TriangleAlert size={18} color="var(--warn)" />
            <strong>Bijbestellen</strong>
            <span style={{ color: 'var(--text-2)' }}>
              {health.low.map((i) => i.name).join(', ')}
            </span>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            {health.low.map((i) => {
              const b = onderweg(i)
              return b ? (
                <Badge key={i.id} tone="info">
                  {i.name}: {b.status === 'verzonden' ? 'onderweg' : 'aangevraagd'} ({isConceptNummer(b.nummer) ? 'concept' : b.nummer})
                </Badge>
              ) : (
                <button
                  key={i.id}
                  className="btn sm"
                  onClick={() => void aanvragen(i)}
                  title="Maakt een aanvraag aan die Trucksshop als concept ziet"
                >
                  <Send size={13} /> {i.name} aanvragen bij Trucksshop
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid sidebar-right">
        <Card title="Voorraad" hint="Boek verbruik direct af" flush>
          {items.length === 0 ? (
            <Empty text="Geen artikelen." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Artikel</th>
                    <th className="num">Voorraad</th>
                    <th style={{ width: 150 }}>Niveau</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const low = i.stock < i.minStock
                    return (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.name}</strong>
                          <div style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>
                            {i.supplier} · {money(i.pricePerUnit)}/{i.unit}
                          </div>
                        </td>
                        <td className="num">
                          {number(i.stock)} {i.unit}
                          <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                            min. {number(i.minStock)}
                          </div>
                        </td>
                        <td>
                          <Bar
                            value={i.stock}
                            max={i.minStock * 2}
                            tone={low ? 'danger' : i.stock < i.minStock * 1.3 ? 'warn' : undefined}
                          />
                          {low && <Badge tone="danger">Onder minimum</Badge>}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn sm"
                            onClick={() => { setTarget({ item: i, dir: -1 }); setReason('') }}
                            title="Verbruik boeken"
                          >
                            <Minus size={14} />
                          </button>{' '}
                          <button
                            className="btn sm"
                            onClick={() => { setTarget({ item: i, dir: 1 }); setReason('') }}
                            title="Ontvangst boeken"
                          >
                            <Plus size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Laatste mutaties" flush>
          {movements.length === 0 ? (
            <Empty text="Nog geen mutaties." />
          ) : (
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {movements.map((m) => (
                <div
                  key={m.id}
                  style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <strong
                      className="mono"
                      style={{ color: m.qty < 0 ? 'var(--warn)' : 'var(--ok)' }}
                    >
                      {m.qty > 0 ? '+' : ''}{number(m.qty)}
                    </strong>
                    <span style={{ fontSize: '.85rem' }}>{m.itemName}</span>
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                    {m.reason} · {m.userName} · {dateTime(m.at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={!!target}
        title={target?.dir === -1 ? 'Verbruik boeken' : 'Ontvangst boeken'}
        subtitle={target?.item.name}
        onClose={() => setTarget(null)}
      >
        <Field label={`Aantal (${target?.item.unit ?? ''})`}>
          <input
            className="input"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Reden" help="Bijvoorbeeld: verbruik combi-was, of levering CleanChem">
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={target?.dir === -1 ? 'Verbruik wasstraat' : 'Levering ontvangen'}
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setTarget(null)}>Annuleren</button>
          <button className="btn primary" onClick={() => void submit()}>Boeken</button>
        </div>
      </Modal>
    </>
  )
}
