import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Check, Inbox, Send } from 'lucide-react'
import { db } from '../lib/db'
import {
  ticketMessages as messageRepo, tickets as ticketRepo,
  TICKET_PRIORITY_TONE, TICKET_STATUS_TONE,
} from '../lib/tickets'
import { TICKET_KINDS, type Ticket, type TicketMessage } from '../lib/types'
import { dateTime, relative } from '../lib/format'
import { Badge, Empty } from './ui'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Mijn meldingen
 *
 *  De kant van de melder: wat heb ik doorgegeven, wat is ermee gebeurd, en
 *  waar kan ik antwoorden. Interne notities van de ontwikkelaar blijven hier
 *  buiten beeld.
 * ------------------------------------------------------------------ */

export default function MijnMeldingen() {
  const me = useAuth((s) => s.user)!
  const [open, setOpen] = useState<string | null>(null)

  const mijne = useLiveQuery(
    async () => (await db.tickets.where('reportedBy').equals(me.id).toArray())
      .sort((a, b) => b.reportedAt - a.reportedAt),
    [me.id],
    [] as Ticket[],
  )

  const gekozen = mijne.find((t) => t.id === open)
  if (gekozen) return <MeldingDetail ticket={gekozen} onBack={() => setOpen(null)} />

  if (mijne.length === 0) {
    return <Empty text="Je hebt nog geen meldingen gedaan." icon={<Inbox size={30} />} />
  }

  return (
    <div className="ticket-list">
      {mijne.map((t) => {
        const afgehandeld = t.status === 'opgelost' || t.status === 'gesloten'
        return (
          <button key={t.id} className="ticket-row" onClick={() => setOpen(t.id)}>
            <div className="row" style={{ gap: 7, marginBottom: 3 }}>
              <span className="mono" style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                {t.number}
              </span>
              <Badge tone={TICKET_STATUS_TONE[t.status]}>{t.status}</Badge>
              {!afgehandeld && (
                <Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                {relative(t.reportedAt)}
              </span>
            </div>
            <div className="t">{t.title}</div>
            <div className="s">
              {TICKET_KINDS[t.kind].label}
              {t.assignedName ? ` · ${t.assignedName} kijkt ernaar` : ''}
              {t.fixedIn ? ` · opgelost in ${t.fixedIn}` : ''}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ================================================================== */

function MeldingDetail({ ticket, onBack }: { ticket: Ticket; onBack: () => void }) {
  const me = useAuth((s) => s.user)!
  const [antwoord, setAntwoord] = useState('')

  const berichten = useLiveQuery(
    async () => (await db.ticketMessages.where('ticketId').equals(ticket.id).toArray())
      // Interne notities zijn niet voor de melder bedoeld.
      .filter((m) => !m.internal)
      .sort((a, b) => a.createdAt - b.createdAt),
    [ticket.id],
    [] as TicketMessage[],
  )

  const afgehandeld = ticket.status === 'opgelost' || ticket.status === 'gesloten'

  async function stuur() {
    if (antwoord.trim().length < 2) return
    await messageRepo.send({
      ticketId: ticket.id,
      body: antwoord,
      internal: false,
      by: { id: me.id, name: me.name },
    })
    setAntwoord('')
    toast.ok('Verstuurd')
  }

  async function heropen() {
    await ticketRepo.setStatus(ticket.id, 'in behandeling', { id: me.id, name: me.name })
    toast.info('Melding heropend')
  }

  return (
    <>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 12 }}>
        <ArrowLeft size={15} /> Terug
      </button>

      <div className="row" style={{ gap: 7, marginBottom: 6 }}>
        <span className="mono" style={{ color: 'var(--text-3)' }}>{ticket.number}</span>
        <Badge tone={TICKET_STATUS_TONE[ticket.status]}>{ticket.status}</Badge>
        <Badge>{TICKET_KINDS[ticket.kind].label}</Badge>
      </div>

      <h3 style={{ fontSize: '1.05rem' }}>{ticket.title}</h3>
      <div style={{ fontSize: '.78rem', color: 'var(--text-3)', marginTop: 3 }}>
        Gemeld op {dateTime(ticket.reportedAt)}
      </div>

      <p style={{ fontSize: '.88rem', lineHeight: 1.6, color: 'var(--text-2)', marginTop: 12, whiteSpace: 'pre-wrap' }}>
        {ticket.description}
      </p>

      {afgehandeld && ticket.resolution && (
        <div
          style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(53,208,127,.08)', border: '1px solid rgba(53,208,127,.3)',
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <Check size={16} color="var(--ok)" />
            <strong style={{ fontSize: '.87rem' }}>Afgehandeld</strong>
            {ticket.fixedIn && <Badge tone="ok">in versie {ticket.fixedIn}</Badge>}
          </div>
          <div style={{ fontSize: '.85rem', color: 'var(--text-2)' }}>{ticket.resolution}</div>
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
        <div style={{ fontSize: '.75rem', color: 'var(--text-3)', marginBottom: 10 }}>
          GESPREK
        </div>

        {berichten.length === 0 ? (
          <div style={{ fontSize: '.85rem', color: 'var(--text-3)' }}>
            Nog geen reactie. Je krijgt een melding zodra er iets is.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            {berichten.map((m) => (
              <div key={m.id} className={`msg ${m.authorId === me.id ? 'from-user' : 'from-dev'}`}>
                <div className="msg-head">
                  <strong>{m.authorId === me.id ? 'Jij' : m.authorName}</strong>
                  <span style={{ flex: 1 }} />
                  <span>{relative(m.createdAt)}</span>
                </div>
                <div className="msg-body">{m.body}</div>
              </div>
            ))}
          </div>
        )}

        {ticket.status !== 'gesloten' && (
          <div style={{ marginTop: 12 }}>
            <textarea
              className="textarea"
              value={antwoord}
              maxLength={1500}
              onChange={(e) => setAntwoord(e.target.value)}
              placeholder={afgehandeld
                ? 'Werkt het toch nog niet? Laat het hier weten.'
                : 'Aanvulling of antwoord op de vraag van de ontwikkelaar'}
            />
            <div className="row end" style={{ marginTop: 8 }}>
              {afgehandeld && (
                <button className="btn sm" onClick={() => void heropen()}>
                  Toch niet opgelost
                </button>
              )}
              <button className="btn primary" onClick={() => void stuur()}>
                <Send size={15} /> Versturen
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
