import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, ArrowLeft, Check, ClipboardPlus, Search, UserCheck, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import { faults as faultRepo, workOrders as orderRepo } from '../../lib/techniek'
import {
  type Fault, type FaultStatus, type User, type WorkOrder,
} from '../../lib/types'
import { dateTime, duration, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { SeverityBadge } from '../../components/StoringMelden'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

const STATUS_TONE: Record<FaultStatus, 'default' | 'ok' | 'warn' | 'danger' | 'info'> = {
  gemeld: 'warn',
  'in behandeling': 'info',
  'wacht op onderdelen': 'warn',
  opgelost: 'ok',
  afgewezen: 'default',
}

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'mij', label: 'Aan mij' },
  { key: 'kritiek', label: 'Kritiek' },
  { key: 'alles', label: 'Alles' },
]

export default function Storingen({ faults }: { faults: Fault[] }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [filter, setFilter] = useState('open')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return faults
      .filter((f) => {
        if (filter === 'open') return f.status !== 'opgelost' && f.status !== 'afgewezen'
        if (filter === 'mij') return f.assignedTo === me.id
        if (filter === 'kritiek') return f.severity === 'kritiek' || f.stopsProduction
        return true
      })
      .filter((f) => !needle ||
        f.title.toLowerCase().includes(needle) ||
        f.number.toLowerCase().includes(needle) ||
        (f.assetName ?? '').toLowerCase().includes(needle))
      .sort((a, b) => {
        const rang = { kritiek: 0, hoog: 1, middel: 2, laag: 3 }
        if (a.status !== b.status) {
          const open = (f: Fault) => (f.status === 'opgelost' || f.status === 'afgewezen' ? 1 : 0)
          if (open(a) !== open(b)) return open(a) - open(b)
        }
        return rang[a.severity] - rang[b.severity] || b.reportedAt - a.reportedAt
      })
  }, [faults, filter, q, me.id])

  const gekozen = faults.find((f) => f.id === selected)
  if (gekozen) {
    return <StoringDetail fault={gekozen} onBack={() => setSelected(null)} />
  }

  const open = faults.filter((f) => f.status !== 'opgelost' && f.status !== 'afgewezen')

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Open" value={open.length} icon={<AlertTriangle size={17} />} tone={open.length ? 'warn' : 'ok'} />
        <Stat
          label="Kritiek"
          value={open.filter((f) => f.severity === 'kritiek').length}
          tone={open.some((f) => f.severity === 'kritiek') ? 'danger' : 'ok'}
        />
        <Stat label="Installatie ligt stil" value={open.filter((f) => f.stopsProduction).length} tone="danger" />
        <Stat label="Aan mij toegewezen" value={faults.filter((f) => f.assignedTo === me.id && f.status !== 'opgelost').length} />
      </div>

      <Card
        title="Meldingen"
        hint={`${rows.length} in beeld`}
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, width: 190 }}
                placeholder="Nummer, titel of apparaat"
                value={q}
                maxLength={50}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {FILTERS.map((f) => (
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
          <Empty text="Geen storingen in deze selectie." icon={<Check size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th>Wat</th>
                  <th>Installatie</th>
                  <th>Ernst</th>
                  <th>Status</th>
                  <th>Monteur</th>
                  <th>Gemeld</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(f.id)}>
                    <td className="mono">{f.number}</td>
                    <td>
                      <strong>{f.title}</strong>
                      {f.stopsProduction && f.status !== 'opgelost' && (
                        <div style={{ fontSize: '.72rem', color: 'var(--danger)' }}>
                          installatie ligt stil
                        </div>
                      )}
                    </td>
                    <td>{f.assetName ?? '—'}</td>
                    <td><SeverityBadge severity={f.severity} /></td>
                    <td><Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge></td>
                    <td>{f.assignedName ?? <span style={{ color: 'var(--text-3)' }}>niemand</span>}</td>
                    <td style={{ color: 'var(--text-3)' }}>{relative(f.reportedAt)}</td>
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

function StoringDetail({ fault, onBack }: { fault: Fault; onBack: () => void }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [afronden, setAfronden] = useState(false)
  const [resolution, setResolution] = useState('')

  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const monteurs = users.filter(
    (u) => u.active && (u.roles.includes('technician') || u.roles.includes('supervisor')))
  const order = useLiveQuery(
    async () => (fault.workOrderId ? db.workOrders.get(fault.workOrderId) : undefined),
    [fault.workOrderId],
    undefined as WorkOrder | undefined,
  )

  const mag = perms.can('faults.triage')

  async function toewijzen(userId: string) {
    const u = monteurs.find((m) => m.id === userId)
    await faultRepo.assign(fault.id, u ? { id: u.id, name: u.name } : null, { id: me.id, name: me.name })
    toast.ok(u ? `Toegewezen aan ${u.name}` : 'Toewijzing verwijderd')
  }

  async function status(next: FaultStatus) {
    if (next === 'opgelost' || next === 'afgewezen') return setAfronden(true)
    await faultRepo.setStatus(fault.id, next, { id: me.id, name: me.name })
    toast.info(`Status: ${next}`)
  }

  async function werkbonMaken() {
    const nieuw = await orderRepo.create({
      locationId: fault.locationId,
      type: 'storing',
      title: fault.title,
      description: fault.description,
      priority: fault.severity === 'kritiek' ? 'spoed' : fault.severity === 'hoog' ? 'hoog' : 'normaal',
      assetId: fault.assetId,
      assetName: fault.assetName,
      faultId: fault.id,
      checklist: [
        'Installatie spanningsloos gemaakt',
        'Storing verholpen',
        'Proefdraaien en vrijgeven',
      ],
      by: { id: me.id, name: me.name },
    })
    toast.ok(`Werkbon ${nieuw.number} aangemaakt`)
  }

  async function afrondenMet(nieuweStatus: 'opgelost' | 'afgewezen') {
    if (resolution.trim().length < 5) return toast.error('Noteer kort wat er gedaan is')
    await faultRepo.setStatus(fault.id, nieuweStatus, { id: me.id, name: me.name }, resolution.trim())
    toast.ok(nieuweStatus === 'opgelost' ? 'Storing afgemeld' : 'Melding afgewezen')
    setAfronden(false)
    onBack()
  }

  return (
    <>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar de meldingen
      </button>

      <Card>
        <div className="row" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span className="mono" style={{ color: 'var(--text-3)' }}>{fault.number}</span>
              <SeverityBadge severity={fault.severity} />
              <Badge tone={STATUS_TONE[fault.status]}>{fault.status}</Badge>
              {fault.stopsProduction && <Badge tone="danger">installatie ligt stil</Badge>}
            </div>
            <h2>{fault.title}</h2>
            <div style={{ fontSize: '.83rem', color: 'var(--text-3)', marginTop: 4 }}>
              {fault.assetName ?? 'Geen installatie gekoppeld'} · gemeld door {fault.reportedByName} · {dateTime(fault.reportedAt)}
            </div>
          </div>
        </div>

        <p style={{ fontSize: '.92rem', lineHeight: 1.6, color: 'var(--text-2)' }}>
          {fault.description}
        </p>

        {fault.status === 'opgelost' && fault.resolvedAt && (
          <div
            style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(53,208,127,.08)', border: '1px solid rgba(53,208,127,.3)',
            }}
          >
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <Check size={16} color="var(--ok)" />
              <strong style={{ fontSize: '.88rem' }}>Opgelost</strong>
              <span style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>
                na {duration(fault.resolvedAt - fault.reportedAt)}
              </span>
            </div>
            <div style={{ fontSize: '.85rem', color: 'var(--text-2)' }}>{fault.resolution}</div>
          </div>
        )}

        {mag && fault.status !== 'opgelost' && fault.status !== 'afgewezen' && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line-soft)' }}>
            <div className="grid cols-2">
              <Field label="Monteur">
                <select
                  className="select"
                  value={fault.assignedTo ?? ''}
                  onChange={(e) => void toewijzen(e.target.value)}
                >
                  <option value="">— niet toegewezen —</option>
                  {monteurs.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  className="select"
                  value={fault.status}
                  onChange={(e) => void status(e.target.value as FaultStatus)}
                >
                  <option value="gemeld">Gemeld</option>
                  <option value="in behandeling">In behandeling</option>
                  <option value="wacht op onderdelen">Wacht op onderdelen</option>
                  <option value="opgelost">Opgelost</option>
                  <option value="afgewezen">Afwijzen</option>
                </select>
              </Field>
            </div>

            <div className="row">
              {!fault.workOrderId && perms.can('workorders.create') && (
                <button className="btn" onClick={() => void werkbonMaken()}>
                  <ClipboardPlus size={15} /> Werkbon aanmaken
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn ok" onClick={() => setAfronden(true)}>
                <Check size={15} /> Afmelden
              </button>
            </div>
          </div>
        )}
      </Card>

      {order && (
        <Card title="Gekoppelde werkbon" className="mt">
          <div className="row">
            <span className="mono">{order.number}</span>
            <Badge>{order.status}</Badge>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-3)', fontSize: '.83rem' }}>
              {order.assignedName ?? 'niet toegewezen'}
              {order.plannedAt ? ` · ${new Date(order.plannedAt).toLocaleDateString('nl-NL')}` : ''}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            {order.checklist.map((c, i) => (
              <div key={i} className="row" style={{ gap: 8, fontSize: '.85rem', padding: '3px 0' }}>
                {c.done
                  ? <Check size={14} color="var(--ok)" />
                  : <span style={{ width: 14, display: 'inline-block' }} />}
                <span style={{ color: c.done ? 'var(--text-3)' : 'var(--text-2)' }}>{c.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={afronden}
        title="Storing afmelden"
        subtitle={fault.number + ' — ' + fault.title}
        onClose={() => setAfronden(false)}
      >
        <Field label="Wat is er gedaan?" help="Dit ziet de melder ook.">
          <textarea
            className="textarea"
            value={resolution}
            maxLength={500}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Bijv. borstelsegment vervangen en installatie proefgedraaid"
            autoFocus
          />
        </Field>
        <div className="row">
          <button className="btn danger sm" onClick={() => void afrondenMet('afgewezen')}>
            <X size={14} /> Afwijzen
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={() => setAfronden(false)}>Annuleren</button>
          <button className="btn ok" onClick={() => void afrondenMet('opgelost')}>
            <UserCheck size={15} /> Opgelost
          </button>
        </div>
      </Modal>
    </>
  )
}
