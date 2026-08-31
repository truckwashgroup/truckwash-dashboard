import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Check, CheckCheck, Clock, Euro, Loader2, Mail, Paperclip, Receipt, RotateCcw, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import { expenses as expRepo } from '../../lib/repo'
import type { Expense, MailBericht, WashJob } from '../../lib/types'
import { dateShort, money, moneyShort } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { expensesByCategory, managementKpis, startOfDay } from '../../lib/analytics'
import { PALETTE, gridStroke, hoverFill, tooltipStyle } from '../../lib/charts'
import { magOpenen, postbus } from '../../lib/postbus'
import Bekijker from '../../components/Bekijker'
import type { Bekijkbaar } from '../../lib/bekijken'

const DAY = 86_400_000

type Tab = 'open' | 'goedgekeurd' | 'afgekeurd' | 'alles'

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Te valideren' },
  { key: 'goedgekeurd', label: 'Goedgekeurd' },
  { key: 'afgekeurd', label: 'Afgekeurd' },
  { key: 'alles', label: 'Alles' },
]

export default function Financieel({ days }: { days: number }) {
  const user = useAuth((s) => s.user)!
  const [tab, setTab] = useState<Tab>('open')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<Expense | null>(null)
  const [reason, setReason] = useState('')

  const expenses = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])

  const from = startOfDay(Date.now() - (days - 1) * DAY)

  const kpis = useMemo(() => managementKpis(jobs, expenses, days), [jobs, expenses, days])
  const byCategory = useMemo(() => expensesByCategory(expenses, days), [expenses, days])

  const rows = useMemo(() => {
    const list = expenses
      .filter((e) => (tab === 'alles' ? true : e.status === tab))
      .sort((a, b) => b.date - a.date)
    return list
  }, [expenses, tab])

  const open = expenses.filter((e) => e.status === 'open')
  const openBedrag = open.reduce((a, e) => a + e.amountExcl, 0)

  const periodeKosten = expenses.filter((e) => e.status === 'goedgekeurd' && e.date >= from)
  const btw = periodeKosten.reduce((a, e) => a + (e.amountExcl * e.vatPct) / 100, 0)

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function approve(ids: string[]) {
    for (const id of ids) {
      await expRepo.decide(id, 'goedgekeurd', { id: user.id, name: user.name })
    }
    setSelected(new Set())
    toast.ok(ids.length === 1 ? 'Kostenpost goedgekeurd' : `${ids.length} kostenposten goedgekeurd`)
  }

  async function reject() {
    if (!rejecting) return
    await expRepo.decide(rejecting.id, 'afgekeurd', { id: user.id, name: user.name }, reason.trim() || 'Geen reden opgegeven')
    toast.warn('Kostenpost afgekeurd')
    setRejecting(null)
    setReason('')
  }

  async function reopen(e: Expense) {
    await expRepo.reopen(e.id)
    toast.info('Terug naar te valideren')
  }

  const selectedRows = rows.filter((r) => selected.has(r.id))

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

      <div className="grid sidebar-right" style={{ marginBottom: 16 }}>
        <Card
          title="Kostenposten"
          flush
          action={
            <div className="row" style={{ gap: 6 }}>
              {selectedRows.length > 0 && (
                <button
                  className="btn ok sm"
                  onClick={() => void approve(selectedRows.map((r) => r.id))}
                >
                  <CheckCheck size={14} /> {selectedRows.length} goedkeuren
                </button>
              )}
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`btn sm ${tab === t.key ? 'primary' : 'ghost'}`}
                  onClick={() => { setTab(t.key); setSelected(new Set()) }}
                >
                  {t.label}
                  {t.key === 'open' && open.length > 0 && ` (${open.length})`}
                </button>
              ))}
            </div>
          }
        >
          {rows.length === 0 ? (
            <Empty text="Niets in deze lijst." icon={<Receipt size={30} />} />
          ) : (
            <div className="table-wrap" style={{ maxHeight: '54vh', overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    {tab === 'open' && (
                      <th style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          checked={selected.size > 0 && selected.size === rows.length}
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                          }
                        />
                      </th>
                    )}
                    <th>Datum</th>
                    <th>Leverancier</th>
                    <th>Omschrijving</th>
                    <th>Ingediend door</th>
                    <th className="num">Excl.</th>
                    <th className="num">Btw</th>
                    <th className="num">Incl.</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const vat = (e.amountExcl * e.vatPct) / 100
                    return (
                      <tr key={e.id}>
                        {tab === 'open' && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(e.id)}
                              onChange={() => toggle(e.id)}
                            />
                          </td>
                        )}
                        <td>{dateShort(e.date)}</td>
                        <td><strong>{e.supplier}</strong></td>
                        <td>
                          {e.description}
                          <div style={{ fontSize: '.72rem', color: 'var(--text-3)', textTransform: 'capitalize' }}>
                            {e.category}
                          </div>
                          {e.source === 'mail' && (
                            <div className="bon-uit-mail">
                              <Mail size={12} /> Per mail binnengekomen
                              {e.amountExcl === 0 && ' — bedrag nog invullen'}
                            </div>
                          )}
                          <Bijlage bon={e} />
                          {e.rejectReason && (
                            <div style={{ fontSize: '.73rem', color: 'var(--danger)' }}>
                              Reden: {e.rejectReason}
                            </div>
                          )}
                        </td>
                        <td>{e.submittedByName}</td>
                        <td className="num">{money(e.amountExcl)}</td>
                        <td className="num" style={{ color: 'var(--text-3)' }}>{money(vat)}</td>
                        <td className="num">{money(e.amountExcl + vat)}</td>
                        <td>
                          {e.status === 'open' && <Badge tone="warn">Open</Badge>}
                          {e.status === 'goedgekeurd' && (
                            <Badge tone="ok" >
                              <Check size={11} /> {e.approvedByName ?? 'Akkoord'}
                            </Badge>
                          )}
                          {e.status === 'afgekeurd' && <Badge tone="danger"><X size={11} /> Afgekeurd</Badge>}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {e.status === 'open' ? (
                            <>
                              <button className="btn ok sm" onClick={() => void approve([e.id])} title="Goedkeuren">
                                <Check size={14} />
                              </button>{' '}
                              <button
                                className="btn danger sm"
                                onClick={() => { setRejecting(e); setReason('') }}
                                title="Afkeuren"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <button className="btn ghost sm" onClick={() => void reopen(e)} title="Heropenen">
                              <RotateCcw size={14} />
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

        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
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
      </div>

      <Modal
        open={!!rejecting}
        title="Kostenpost afkeuren"
        subtitle={rejecting ? `${rejecting.supplier} — ${money(rejecting.amountExcl)}` : undefined}
        onClose={() => setRejecting(null)}
      >
        <Field label="Reden" help="De indiener ziet deze reden bij zijn kostenpost.">
          <textarea
            className="textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Bijv. bon ontbreekt, of privé-uitgave"
            autoFocus
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setRejecting(null)}>Annuleren</button>
          <button className="btn danger" onClick={() => void reject()}>Afkeuren</button>
        </div>
      </Modal>
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

/* ------------------------------------------------------------------ *
 *  De bijlage bij een bon die per mail binnenkwam
 *
 *  De link vervalt na een minuut. Een bon die je nu bekijkt en morgen weer
 *  wilt zien vraag je opnieuw op; een adres dat blijft werken is een adres
 *  dat kan uitlekken.
 * ------------------------------------------------------------------ */

function Bijlage({ bon }: { bon: Expense }) {
  const post = useLiveQuery<MailBericht | undefined>(
    async () => (bon.mailboxId ? db.mailbox.get(bon.mailboxId) : undefined),
    [bon.mailboxId],
  )
  const [kijkt, setKijkt] = useState<number | null>(null)

  /*
   * Een mail met drie bonnen eraan leverde hier één knop op, en de andere
   * twee waren nergens meer te vinden. Kwam deze bon uit de post, dan hangt
   * alles wat er bij die mail zat er nu onder.
   */
  const bijlagen = useMemo<Bekijkbaar[]>(() => {
    const uitPost: Bekijkbaar[] = (post?.attachments ?? []).map((b) => ({
      naam: b.naam,
      mime: b.mime,
      size: b.size,
      geblokkeerd: magOpenen(b)
        ? undefined
        : (b.controleReden || 'Deze bijlage kwam niet door de controle.'),
      haal: () => postbus.openBijlage(b),
    }))

    // De bon wijst naar één bestand. Zit dat al bij de post, dan niet twee keer.
    if (!bon.attachmentPath) return uitPost
    if (uitPost.some((b) => b.naam === bon.attachmentName)) return uitPost
    return [
      {
        naam: bon.attachmentName ?? 'Bijlage',
        haal: () => postbus.openBijlage({ path: bon.attachmentPath! }),
      },
      ...uitPost,
    ]
  }, [post, bon.attachmentPath, bon.attachmentName])

  if (bijlagen.length === 0) return null

  return (
    <>
      {bijlagen.map((b, i) => (
        <button key={b.naam + i} className="bon-bijlage" onClick={() => setKijkt(i)}>
          <Paperclip size={12} /> {b.naam}
        </button>
      ))}
      <Bekijker
        bestanden={bijlagen}
        index={kijkt}
        onSluiten={() => setKijkt(null)}
        onWissel={setKijkt}
      />
    </>
  )
}
