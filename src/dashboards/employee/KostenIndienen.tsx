import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Clock, Plus, Receipt, X } from 'lucide-react'
import { db } from '../../lib/db'
import { expenses as expRepo } from '../../lib/repo'
import type { Expense } from '../../lib/types'
import { dateShort, money } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'

const CATEGORIES: Expense['category'][] = [
  'materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig',
]

export function statusBadge(status: Expense['status']) {
  if (status === 'goedgekeurd') return <Badge tone="ok"><Check size={11} /> Goedgekeurd</Badge>
  if (status === 'afgekeurd') return <Badge tone="danger"><X size={11} /> Afgekeurd</Badge>
  return <Badge tone="warn"><Clock size={11} /> Wacht op akkoord</Badge>
}

export default function KostenIndienen() {
  const user = useAuth((s) => s.user)!
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    supplier: '',
    description: '',
    amount: '',
    category: 'materiaal' as Expense['category'],
    vatPct: '21',
    date: new Date().toISOString().slice(0, 10),
  })

  const mine = useLiveQuery(
    async () => {
      const rows = await db.expenses.where('status').anyOf('open', 'goedgekeurd', 'afgekeurd').toArray()
      return rows
        .filter((e) => e.submittedBy === user.id)
        .sort((a, b) => b.date - a.date)
    },
    [user.id],
    [] as Expense[],
  )

  const open_ = mine.filter((e) => e.status === 'open')
  const goedgekeurd = mine.filter((e) => e.status === 'goedgekeurd')

  async function submit() {
    const amount = Number(form.amount.replace(',', '.'))
    if (!form.supplier.trim()) return toast.error('Vul een leverancier in')
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Vul een geldig bedrag in')

    if (!user.locationId) {
      return toast.error('Je bent nog niet aan een vestiging gekoppeld. Vraag je leidinggevende dat te doen.')
    }

    await expRepo.create({
      locationId: user.locationId,
      date: new Date(form.date).getTime(),
      category: form.category,
      supplier: form.supplier.trim(),
      description: form.description.trim() || 'Geen omschrijving',
      amountExcl: Math.round(amount * 100) / 100,
      vatPct: Number(form.vatPct) || 0,
      submittedBy: user.id,
      submittedByName: user.name,
    })

    toast.ok('Kostenpost ingediend — het management krijgt hem ter goedkeuring')
    setOpen(false)
    setForm({ ...form, supplier: '', description: '', amount: '' })
  }

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Ingediend (open)" value={open_.length} icon={<Clock size={17} />} tone="warn" />
        <Stat
          label="Openstaand bedrag"
          value={money(open_.reduce((a, e) => a + e.amountExcl, 0))}
          icon={<Receipt size={17} />}
        />
        <Stat
          label="Goedgekeurd"
          value={money(goedgekeurd.reduce((a, e) => a + e.amountExcl, 0))}
          icon={<Check size={17} />}
          tone="ok"
        />
      </div>

      <Card
        title="Mijn kostenposten"
        hint="Alles wordt lokaal bewaard en automatisch verstuurd"
        action={
          <button className="btn primary sm" onClick={() => setOpen(true)}>
            <Plus size={15} /> Kosten indienen
          </button>
        }
        flush
      >
        {mine.length === 0 ? (
          <Empty text="Je hebt nog geen kosten ingediend." icon={<Receipt size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Leverancier</th>
                  <th>Omschrijving</th>
                  <th>Categorie</th>
                  <th className="num">Bedrag excl.</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((e) => (
                  <tr key={e.id}>
                    <td>{dateShort(e.date)}</td>
                    <td><strong>{e.supplier}</strong></td>
                    <td>
                      {e.description}
                      {e.rejectReason && (
                        <div style={{ fontSize: '.74rem', color: 'var(--danger)' }}>
                          Afgekeurd: {e.rejectReason}
                        </div>
                      )}
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{e.category}</td>
                    <td className="num">{money(e.amountExcl)}</td>
                    <td>{statusBadge(e.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title="Kostenpost indienen"
        subtitle="Het management beoordeelt en valideert de bon."
        onClose={() => setOpen(false)}
      >
        <div className="grid cols-2">
          <Field label="Datum">
            <input
              className="input" type="date" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label="Categorie">
            <select
              className="select" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Expense['category'] })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Leverancier">
          <input
            className="input" value={form.supplier}
            onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            placeholder="CleanChem BV"
          />
        </Field>

        <Field label="Omschrijving">
          <textarea
            className="textarea" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Waar was dit voor?"
          />
        </Field>

        <div className="grid cols-2">
          <Field label="Bedrag excl. btw">
            <input
              className="input" inputMode="decimal" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0,00"
            />
          </Field>
          <Field label="Btw %">
            <select
              className="select" value={form.vatPct}
              onChange={(e) => setForm({ ...form, vatPct: e.target.value })}
            >
              <option value="21">21%</option>
              <option value="9">9%</option>
              <option value="0">0%</option>
            </select>
          </Field>
        </div>

        <div className="row end">
          <button className="btn ghost" onClick={() => setOpen(false)}>Annuleren</button>
          <button className="btn primary" onClick={() => void submit()}>Indienen</button>
        </div>
      </Modal>
    </>
  )
}
