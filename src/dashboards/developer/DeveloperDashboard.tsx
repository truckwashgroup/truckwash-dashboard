import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Bug, Check, Code2, Copy, Inbox, Lock, Mail, MessageSquare,
  Radio, ScrollText, Search, Send, Server, Trash2, TriangleAlert,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import {
  tickets as ticketRepo, ticketMessages as messageRepo, logs as logRepo,
  TICKET_PRIORITY_TONE, TICKET_STATUS_TONE,
} from '../../lib/tickets'
import {
  TICKET_KINDS, type LogEvent, type Ticket, type TicketMessage,
  type TicketPriority, type TicketStatus, type TrailEntry, type User,
} from '../../lib/types'
import { dateTime, duration, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { useNavTarget, usePerms } from '../../store/useNav'
import { useSync } from '../../lib/sync'
import { useUpdates } from '../../lib/updates'
import { activeBackend } from '../../lib/api'
import { toast } from '../../store/useToasts'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import Post from './Post'
import Meekijken from './Meekijken'

const TITLES: Record<string, { title: string; subtitle: string }> = {
  tickets: { title: 'Meldingen', subtitle: 'Wat gebruikers tegenkomen' },
  logboek: { title: 'Logboek', subtitle: 'Fouten en waarschuwingen uit de app' },
  systeem: { title: 'Systeem', subtitle: 'Versies, verbinding en opslag' },
  post: { title: 'Post', subtitle: 'Wat de app via Resend heeft verstuurd' },
  meekijken: { title: 'Meekijken', subtitle: 'Alles wat er nu gebeurt, op volgorde' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken' },
}

export default function DeveloperDashboard() {
  const [page, setPage] = useState('tickets')
  const perms = usePerms()

  const alleTickets = useLiveQuery(() => db.tickets.toArray(), [], [] as Ticket[])
  const open = alleTickets.filter((t) => t.status !== 'opgelost' && t.status !== 'gesloten')

  const logs = useLiveQuery(() => db.logEvents.toArray(), [], [] as LogEvent[])
  const fouten = logs.filter((l) => l.level === 'fout')
  const ongelezen = useOverlegTeller()

  const items: NavItem[] = [
    { key: 'tickets', label: 'Meldingen', icon: Inbox, badge: open.length || undefined },
    ...(perms.can('dev.logs')
      ? [{ key: 'logboek', label: 'Logboek', icon: ScrollText, badge: fouten.length || undefined }]
      : []),
    ...(perms.can('dev.logs')
      ? [{ key: 'meekijken', label: 'Meekijken', icon: Radio }]
      : []),
    { key: 'systeem', label: 'Systeem', icon: Server },
    { key: 'post', label: 'Post', icon: Mail },
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
  ]

  useNavTarget(['tickets', 'logboek', 'meekijken', 'systeem', 'post', 'overleg'], (p) => setPage(p))

  const meta = TITLES[page] ?? TITLES.tickets

  return (
    <Shell
      roleLabel="Ontwikkeling"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={meta.subtitle}
    >
      {page === 'tickets' && <Tickets tickets={alleTickets} />}
      {page === 'logboek' && <Logboek logs={logs} />}
      {page === 'systeem' && <Systeem tickets={alleTickets} logs={logs} />}
      {page === 'meekijken' && <Meekijken />}
      {page === 'post' && <Post />}
      {page === 'overleg' && <Overleg />}
    </Shell>
  )
}

/* ================================================================== *
 *  Meldingen
 * ================================================================== */

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'nieuw', label: 'Nieuw' },
  { key: 'mij', label: 'Aan mij' },
  { key: 'alles', label: 'Alles' },
]

function Tickets({ tickets }: { tickets: Ticket[] }) {
  const me = useAuth((s) => s.user)!
  const [filter, setFilter] = useState('open')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tickets
      .filter((t) => {
        if (filter === 'open') return t.status !== 'opgelost' && t.status !== 'gesloten'
        if (filter === 'nieuw') return t.status === 'nieuw'
        if (filter === 'mij') return t.assignedTo === me.id
        return true
      })
      .filter((t) => !needle ||
        t.title.toLowerCase().includes(needle) ||
        t.number.toLowerCase().includes(needle) ||
        t.reportedByName.toLowerCase().includes(needle))
      .sort((a, b) => {
        const prio = { blokkerend: 0, hoog: 1, normaal: 2, laag: 3 }
        return prio[a.priority] - prio[b.priority] || b.reportedAt - a.reportedAt
      })
  }, [tickets, filter, q, me.id])

  const gekozen = tickets.find((t) => t.id === selected)
  if (gekozen) return <TicketDetail ticket={gekozen} onBack={() => setSelected(null)} />

  const open = tickets.filter((t) => t.status !== 'opgelost' && t.status !== 'gesloten')

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Open" value={open.length} icon={<Inbox size={17} />} tone={open.length ? 'warn' : 'ok'} />
        <Stat
          label="Blokkerend"
          value={open.filter((t) => t.priority === 'blokkerend').length}
          icon={<TriangleAlert size={17} />}
          tone={open.some((t) => t.priority === 'blokkerend') ? 'danger' : 'ok'}
        />
        <Stat label="Nieuw" value={tickets.filter((t) => t.status === 'nieuw').length} tone="warn" />
        <Stat
          label="Opgelost (30d)"
          value={tickets.filter((t) =>
            t.status === 'opgelost' && (t.resolvedAt ?? 0) > Date.now() - 30 * 86_400_000).length}
          tone="ok"
        />
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
                placeholder="Nummer, titel of melder"
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
          <Empty text="Geen meldingen in deze selectie." icon={<Check size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th>Wat</th>
                  <th>Soort</th>
                  <th>Melder</th>
                  <th>Apparaat</th>
                  <th>Urgentie</th>
                  <th>Status</th>
                  <th>Gemeld</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(t.id)}>
                    <td className="mono">{t.number}</td>
                    <td>
                      <strong>{t.title}</strong>
                      {t.fromPage && (
                        <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                          {t.fromRole} → {t.fromPage}
                        </div>
                      )}
                    </td>
                    <td>{TICKET_KINDS[t.kind].label}</td>
                    <td>{t.reportedByName}</td>
                    <td style={{ color: 'var(--text-3)' }}>{t.platform} · {t.appVersion}</td>
                    <td><Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                    <td><Badge tone={TICKET_STATUS_TONE[t.status]}>{t.status}</Badge></td>
                    <td style={{ color: 'var(--text-3)' }}>{relative(t.reportedAt)}</td>
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

const TRAIL_LABEL: Record<TrailEntry['kind'], string> = {
  pagina: 'scherm', actie: 'actie', fout: 'fout', sync: 'sync', melding: 'melding',
}

function TicketDetail({ ticket, onBack }: { ticket: Ticket; onBack: () => void }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [antwoord, setAntwoord] = useState('')
  const [intern, setIntern] = useState(false)
  const [afronden, setAfronden] = useState(false)
  const [oplossing, setOplossing] = useState('')
  const [versie, setVersie] = useState('')

  const berichten = useLiveQuery(
    async () => (await db.ticketMessages.where('ticketId').equals(ticket.id).toArray())
      .sort((a, b) => a.createdAt - b.createdAt),
    [ticket.id],
    [] as TicketMessage[],
  )
  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const devs = users.filter((u) => u.active && u.roles.includes('developer'))

  const mag = perms.can('dev.respond')

  async function stuur() {
    if (antwoord.trim().length < 2) return
    await messageRepo.send({
      ticketId: ticket.id,
      body: antwoord,
      internal: intern,
      by: { id: me.id, name: me.name },
    })
    setAntwoord('')
    toast.ok(intern ? 'Interne notitie opgeslagen' : 'Antwoord verstuurd — de melder krijgt bericht')
  }

  async function rondAf() {
    if (oplossing.trim().length < 5) return toast.error('Noteer kort wat de oplossing was')
    await ticketRepo.setStatus(ticket.id, 'opgelost', { id: me.id, name: me.name }, {
      resolution: oplossing.trim(),
      fixedIn: versie.trim() || undefined,
    })
    toast.ok('Melding afgehandeld — de melder is bericht')
    setAfronden(false)
    onBack()
  }

  function kopieerContext() {
    const tekst = [
      `${ticket.number} — ${ticket.title}`,
      `Soort: ${TICKET_KINDS[ticket.kind].label} · urgentie: ${ticket.priority}`,
      `Melder: ${ticket.reportedByName} (${ticket.fromRole ?? '—'} → ${ticket.fromPage ?? '—'})`,
      `Apparaat: ${ticket.platform} · versie ${ticket.appVersion} · ${ticket.screen}`,
      `Verbinding: ${ticket.online ? 'online' : 'offline'} · ${ticket.pendingChanges} wijzigingen open`,
      `User-agent: ${ticket.userAgent}`,
      '',
      ticket.description,
      '',
      'Spoor van het laatste kwartier:',
      ...ticket.trail.map((e) =>
        `  ${new Date(e.at).toLocaleTimeString('nl-NL')}  [${TRAIL_LABEL[e.kind]}]  ${e.text}`),
    ].join('\n')

    navigator.clipboard?.writeText(tekst)
      .then(() => toast.ok('Context gekopieerd'))
      .catch(() => toast.error('Kopiëren lukte niet'))
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={onBack}>
          <ArrowLeft size={15} /> Terug naar de meldingen
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={kopieerContext}>
          <Copy size={14} /> Context kopiëren
        </button>
      </div>

      <div className="grid sidebar-right">
        <div>
          <Card>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span className="mono" style={{ color: 'var(--text-3)' }}>{ticket.number}</span>
              <Badge tone={TICKET_PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge>
              <Badge tone={TICKET_STATUS_TONE[ticket.status]}>{ticket.status}</Badge>
              <Badge>{TICKET_KINDS[ticket.kind].label}</Badge>
            </div>

            <h2>{ticket.title}</h2>
            <div style={{ fontSize: '.83rem', color: 'var(--text-3)', marginTop: 4 }}>
              {ticket.reportedByName} · {dateTime(ticket.reportedAt)}
              {ticket.fromPage ? ` · vanaf ${ticket.fromRole} → ${ticket.fromPage}` : ''}
            </div>

            <p style={{ fontSize: '.92rem', lineHeight: 1.65, color: 'var(--text-2)', marginTop: 14, whiteSpace: 'pre-wrap' }}>
              {ticket.description}
            </p>

            {ticket.status === 'opgelost' && ticket.resolution && (
              <div
                style={{
                  marginTop: 14, padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                  background: 'rgba(53,208,127,.08)', border: '1px solid rgba(53,208,127,.3)',
                }}
              >
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <Check size={16} color="var(--ok)" />
                  <strong style={{ fontSize: '.88rem' }}>Opgelost</strong>
                  {ticket.fixedIn && <Badge tone="ok">in {ticket.fixedIn}</Badge>}
                </div>
                <div style={{ fontSize: '.85rem', color: 'var(--text-2)' }}>{ticket.resolution}</div>
              </div>
            )}
          </Card>

          {/* --- gesprek --- */}
          <Card title="Gesprek" hint={`${berichten.length} berichten`} className="mt">
            {berichten.length === 0 ? (
              <Empty text="Nog geen reactie." />
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {berichten.map((m) => (
                  <div key={m.id} className={`msg ${m.internal ? 'internal' : ''} ${m.authorId === ticket.reportedBy ? 'from-user' : 'from-dev'}`}>
                    <div className="msg-head">
                      <strong>{m.authorName}</strong>
                      {m.internal && <Badge tone="warn"><Lock size={10} /> intern</Badge>}
                      <span style={{ flex: 1 }} />
                      <span>{relative(m.createdAt)}</span>
                    </div>
                    <div className="msg-body">{m.body}</div>
                  </div>
                ))}
              </div>
            )}

            {mag && ticket.status !== 'gesloten' && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
                <textarea
                  className="textarea"
                  value={antwoord}
                  maxLength={2000}
                  onChange={(e) => setAntwoord(e.target.value)}
                  placeholder={intern
                    ? 'Notitie voor jezelf en je collega-ontwikkelaars'
                    : 'Antwoord aan de melder — die krijgt hier een melding van'}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className={`btn sm ${intern ? 'primary' : 'ghost'}`}
                    onClick={() => setIntern(!intern)}
                    title="Interne notities ziet de melder niet"
                  >
                    <Lock size={13} /> Interne notitie
                  </button>
                  <span style={{ flex: 1 }} />
                  <button className="btn primary" onClick={() => void stuur()}>
                    <Send size={15} /> Versturen
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* --- context --- */}
        <div>
          {mag && (
            <Card title="Afhandelen" className="mb">
              <Field label="Toegewezen aan">
                <select
                  className="select"
                  value={ticket.assignedTo ?? ''}
                  onChange={(e) => {
                    const u = devs.find((d) => d.id === e.target.value)
                    void ticketRepo.assign(ticket.id, u ? { id: u.id, name: u.name } : null, { id: me.id, name: me.name })
                  }}
                >
                  <option value="">— niemand —</option>
                  {devs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>

              <Field label="Urgentie">
                <select
                  className="select"
                  value={ticket.priority}
                  onChange={(e) => void ticketRepo.setPriority(ticket.id, e.target.value as TicketPriority)}
                >
                  {['laag', 'normaal', 'hoog', 'blokkerend'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>

              <Field label="Status">
                <select
                  className="select"
                  value={ticket.status}
                  onChange={(e) => {
                    const next = e.target.value as TicketStatus
                    if (next === 'opgelost') setAfronden(true)
                    else void ticketRepo.setStatus(ticket.id, next, { id: me.id, name: me.name })
                  }}
                >
                  <option value="nieuw">Nieuw</option>
                  <option value="in behandeling">In behandeling</option>
                  <option value="wacht op melder">Wacht op melder</option>
                  <option value="opgelost">Opgelost</option>
                  <option value="gesloten">Gesloten</option>
                </select>
              </Field>

              {ticket.status !== 'opgelost' && (
                <button className="btn ok block" onClick={() => setAfronden(true)}>
                  <Check size={15} /> Afhandelen
                </button>
              )}
            </Card>
          )}

          <Card title="Apparaat en omgeving">
            <div className="trail-meta" style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <div><span>Platform</span><span>{ticket.platform}</span></div>
              <div><span>Versie</span><span>{ticket.appVersion}</span></div>
              <div><span>Scherm</span><span>{ticket.screen}</span></div>
              <div><span>Verbinding</span><span>{ticket.online ? 'online' : 'offline'}</span></div>
              <div><span>Wachtrij</span><span>{ticket.pendingChanges}</span></div>
              <div><span>Rol</span><span>{ticket.fromRole ?? '—'}</span></div>
            </div>
            <div style={{ fontSize: '.7rem', color: 'var(--text-3)', marginTop: 10, wordBreak: 'break-all' }}>
              {ticket.userAgent}
            </div>
          </Card>

          <Card
            title="Wat de melder deed"
            hint={`${ticket.trail.length} handelingen`}
            className="mt"
            flush
          >
            {ticket.trail.length === 0 ? (
              <Empty text="Geen spoor vastgelegd." />
            ) : (
              <div className="trail-list" style={{ maxHeight: 380 }}>
                {ticket.trail.map((e, i) => (
                  <div key={i} className={`trail-item k-${e.kind}`}>
                    <span className="t">
                      {new Date(e.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="k">{TRAIL_LABEL[e.kind]}</span>
                    <span className="x">{e.text}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="trail-note">
              Het laatste kwartier vóór de melding, oud naar nieuw. Handig om te
              zien wat er vlak voor de fout gebeurde.
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={afronden}
        title="Melding afhandelen"
        subtitle={`${ticket.number} — ${ticket.title}`}
        onClose={() => setAfronden(false)}
      >
        <Field label="Wat was het, en wat is eraan gedaan?" help="Dit ziet de melder.">
          <textarea
            className="textarea"
            value={oplossing}
            maxLength={800}
            onChange={(e) => setOplossing(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Opgelost in versie" help="Leeg laten als er geen nieuwe versie voor nodig was.">
          <input
            className="input" value={versie} onChange={(e) => setVersie(e.target.value)}
            placeholder="1.1.2"
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setAfronden(false)}>Annuleren</button>
          <button className="btn ok" onClick={() => void rondAf()}>
            <Check size={15} /> Afhandelen
          </button>
        </div>
      </Modal>
    </>
  )
}

/* ================================================================== *
 *  Logboek
 * ================================================================== */

function Logboek({ logs }: { logs: LogEvent[] }) {
  const [level, setLevel] = useState('alles')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return logs
      .filter((l) => level === 'alles' || l.level === level)
      .filter((l) => !needle ||
        l.message.toLowerCase().includes(needle) ||
        (l.page ?? '').toLowerCase().includes(needle))
      .sort((a, b) => b.at - a.at)
  }, [logs, level, q])

  const gekozen = logs.find((l) => l.id === open)
  const fouten = logs.filter((l) => l.level === 'fout')
  const totaal = logs.reduce((a, l) => a + l.count, 0)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Soorten fouten" value={fouten.length} icon={<Bug size={17} />} tone={fouten.length ? 'danger' : 'ok'} />
        <Stat label="Waarschuwingen" value={logs.filter((l) => l.level === 'waarschuwing').length} tone="warn" />
        <Stat label="Voorvallen totaal" value={totaal} icon={<ScrollText size={17} />} />
        <Stat
          label="Laatste 24 uur"
          value={logs.filter((l) => l.at > Date.now() - 86_400_000).length}
          tone="warn"
        />
      </div>

      <Card
        title="Logboek"
        hint="Dezelfde fout wordt opgeteld, niet herhaald"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, width: 200 }}
                placeholder="Zoek in de meldingen"
                value={q}
                maxLength={60}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {['alles', 'fout', 'waarschuwing'].map((l) => (
              <button
                key={l}
                className={`btn sm ${level === l ? 'primary' : 'ghost'}`}
                onClick={() => setLevel(l)}
              >
                {l}
              </button>
            ))}
            <button
              className="btn danger sm"
              onClick={async () => {
                if (rows.length === 0) return
                await logRepo.clear()
                toast.info('Logboek geleegd')
              }}
            >
              <Trash2 size={14} /> Legen
            </button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty text="Niets in het logboek. Dat is goed nieuws." icon={<Check size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Soort</th>
                  <th>Melding</th>
                  <th>Scherm</th>
                  <th>Gebruiker</th>
                  <th>Waar</th>
                  <th className="num">Aantal</th>
                  <th>Laatst</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(l.id)}>
                    <td>
                      <Badge tone={l.level === 'fout' ? 'danger' : l.level === 'waarschuwing' ? 'warn' : 'info'}>
                        {l.level}
                      </Badge>
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.message}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-3)' }}>{l.page ?? '—'}</td>
                    <td style={{ color: 'var(--text-3)' }}>{l.userName ?? '—'}</td>
                    <td style={{ color: 'var(--text-3)' }}>{l.platform} · {l.appVersion}</td>
                    <td className="num">{l.count}</td>
                    <td style={{ color: 'var(--text-3)' }}>{relative(l.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!gekozen}
        title={gekozen?.level === 'fout' ? 'Foutmelding' : 'Waarschuwing'}
        subtitle={gekozen ? `${gekozen.count}× · laatst ${relative(gekozen.at)}` : undefined}
        onClose={() => setOpen(null)}
        width={720}
      >
        {gekozen && (
          <>
            <div className="trail-meta" style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 14 }}>
              <div><span>Scherm</span><span>{gekozen.page ?? '—'}</span></div>
              <div><span>Gebruiker</span><span>{gekozen.userName ?? '—'}</span></div>
              <div><span>Platform</span><span>{gekozen.platform}</span></div>
              <div><span>Versie</span><span>{gekozen.appVersion}</span></div>
            </div>

            <Field label="Melding">
              <div className="code-block">{gekozen.message}</div>
            </Field>

            {gekozen.stack && (
              <Field label="Stacktrace">
                <div className="code-block" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {gekozen.stack}
                </div>
              </Field>
            )}

            <div className="row end">
              <button
                className="btn ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `${gekozen.message}\n\n${gekozen.stack ?? ''}`.trim())
                    .then(() => toast.ok('Gekopieerd'))
                    .catch(() => toast.error('Kopiëren lukte niet'))
                }}
              >
                <Copy size={15} /> Kopiëren
              </button>
              <button className="btn primary" onClick={() => setOpen(null)}>Sluiten</button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}

/* ================================================================== *
 *  Systeem
 * ================================================================== */

function Systeem({ tickets, logs }: { tickets: Ticket[]; logs: LogEvent[] }) {
  const sync = useSync()
  const { version, channel, state } = useUpdates()

  const counts = useLiveQuery(async () => ({
    locaties: await db.locations.count(),
    gebruikers: await db.users.count(),
    wasopdrachten: await db.washJobs.count(),
    diensten: await db.shifts.count(),
    installaties: await db.assets.count(),
    storingen: await db.faults.count(),
    werkbonnen: await db.workOrders.count(),
    onderhoud: await db.maintenancePlans.count(),
    cursussen: await db.courses.count(),
    meldingen: await db.tickets.count(),
    logregels: await db.logEvents.count(),
    wachtrij: await db.outbox.count(),
  }), [], null)

  /** Op welke versies draaien de mensen? */
  const versies = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tickets) map.set(t.appVersion, (map.get(t.appVersion) ?? 0) + 1)
    for (const l of logs) map.set(l.appVersion, (map.get(l.appVersion) ?? 0) + l.count)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [tickets, logs])

  const platforms = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tickets) map.set(t.platform, (map.get(t.platform) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [tickets])

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Backend"
          value={activeBackend === 'supabase' ? 'Supabase' : activeBackend === 'mock' ? 'Testmodus' : 'Niet ingesteld'}
          icon={<Server size={17} />}
          tone={activeBackend === 'supabase' ? 'ok' : 'warn'}
        />
        <Stat
          label="Deze app"
          value={version}
          delta={{ text: channel, dir: 'flat' }}
          icon={<Code2 size={17} />}
        />
        <Stat
          label="Synchronisatie"
          value={sync.pending > 0 ? `${sync.pending} open` : 'bij'}
          delta={sync.lastSyncAt ? { text: relative(sync.lastSyncAt), dir: 'flat' } : undefined}
          tone={sync.pending ? 'warn' : 'ok'}
        />
        <Stat label="Updatestatus" value={state === 'idle' ? 'niet gecontroleerd' : state} />
      </div>

      <div className="grid cols-2">
        <Card title="Wat er lokaal staat">
          {counts ? (
            <div style={{ display: 'grid', gap: 5 }}>
              {Object.entries(counts).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.84rem' }}>
                  <span style={{ color: k === 'wachtrij' && v > 0 ? 'var(--warn)' : 'var(--text-2)', textTransform: 'capitalize' }}>
                    {k}
                  </span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="Bezig met tellen…" />}
        </Card>

        <Card title="Waar draaien de mensen op?" hint="Uit meldingen en logregels">
          {versies.length === 0 ? (
            <Empty text="Nog geen meldingen binnengekomen." />
          ) : (
            <>
              <div style={{ fontSize: '.75rem', color: 'var(--text-3)', marginBottom: 8 }}>VERSIES</div>
              <div style={{ display: 'grid', gap: 9, marginBottom: 16 }}>
                {versies.map(([v, n]) => {
                  const max = versies[0][1] || 1
                  const oud = v !== version
                  return (
                    <div key={v}>
                      <div className="row" style={{ justifyContent: 'space-between', fontSize: '.83rem', marginBottom: 3 }}>
                        <span>
                          {v} {oud && <Badge tone="warn">verouderd</Badge>}
                        </span>
                        <span className="mono">{n}</span>
                      </div>
                      <div className={`bar ${oud ? 'warn' : ''}`}>
                        <span style={{ width: `${(n / max) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ fontSize: '.75rem', color: 'var(--text-3)', marginBottom: 8 }}>PLATFORMEN</div>
              <div style={{ display: 'grid', gap: 5 }}>
                {platforms.map(([p, n]) => (
                  <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.83rem' }}>
                    <span style={{ color: 'var(--text-2)' }}>{p}</span>
                    <span className="mono">{n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
