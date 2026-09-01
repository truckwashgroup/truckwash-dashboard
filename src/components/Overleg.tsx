import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AtSign, Check, CornerUpLeft, Hash, Loader2, MapPin, MessageSquare,
  MoreHorizontal, Plus, Search, Send, Trash2, Users, X,
} from 'lucide-react'
import { db, alleMensen } from '../lib/db'
import {
  channelStates, channels as channelRepo, chat, channelTitle, ensureDefaultChannels,
  MAX_MESSAGE, mayRead, type ChannelState,
} from '../lib/chat'
import type { Channel, ChannelRead, ChatMessage, Location, User } from '../lib/types'
import { initials, time } from '../lib/format'
import { Badge, Empty, Field, Modal } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { setFastSync, useSync } from '../lib/sync'
import { toast } from '../store/useToasts'
import { trail } from '../lib/trail'

/* ------------------------------------------------------------------ *
 *  Overleg
 *
 *  Links de kanalen, rechts het gesprek. Dat is de vorm die iedereen al
 *  kent, dus daar hoeft niets aan uitgelegd te worden.
 *
 *  Wat er wél anders is dan in een gewone chat: dit werkt zonder bereik.
 *  Een bericht dat je in de machinekamer typt staat er meteen, met een
 *  klokje ernaast, en vertrekt zodra je weer buiten staat.
 * ------------------------------------------------------------------ */

const DAG = 86_400_000

export default function Overleg() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const pending = useSync((s) => s.pending)

  const [openId, setOpenId] = useState<string | null>(null)
  const [zoek, setZoek] = useState('')
  const [nieuwKanaal, setNieuwKanaal] = useState(false)
  const [nieuwGesprek, setNieuwGesprek] = useState(false)
  const [leden, setLeden] = useState<Channel | null>(null)

  const alleKanalen = useLiveQuery(() => db.channels.toArray(), [], [] as Channel[])
  const berichten = useLiveQuery(() => db.chatMessages.toArray(), [], [] as ChatMessage[])
  const gelezen = useLiveQuery(() => db.channelReads.toArray(), [], [] as ChannelRead[])
  const iedereen = useLiveQuery(() => alleMensen(), [], [] as User[])
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  /* Sneller kijken zolang dit scherm openstaat; drie kwartier wachten op
     een antwoord is geen overleg. */
  useEffect(() => {
    setFastSync(true)
    return () => setFastSync(false)
  }, [])

  /* Bij het eerste bezoek de vaste kanalen klaarzetten, zodat er niet in
     een leeg scherm gestaard wordt. */
  const gezet = useRef(false)
  useEffect(() => {
    if (gezet.current) return
    if (!alleKanalen.length && locaties.length && perms.can('chat.manage')) {
      gezet.current = true
      void ensureDefaultChannels(me, locaties)
    }
  }, [alleKanalen.length, locaties, me, perms])

  const states = useMemo(
    () => channelStates(me, alleKanalen, berichten, gelezen),
    [me, alleKanalen, berichten, gelezen],
  )

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase().slice(0, 60)
    if (!q) return states
    return states.filter((s) =>
      channelTitle(s.channel, me, iedereen).toLowerCase().includes(q) ||
      (s.channel.topic ?? '').toLowerCase().includes(q))
  }, [states, zoek, me, iedereen])

  // Openen: wat gekozen is, anders het eerste kanaal met iets nieuws.
  const actief = useMemo(() => {
    const gekozen = states.find((s) => s.channel.id === openId)
    if (gekozen) return gekozen
    return states.find((s) => s.ongelezen > 0) ?? states[0]
  }, [states, openId])

  if (!perms.can('chat.use')) {
    return <Empty text="Je hebt geen toegang tot het overleg." icon={<MessageSquare size={30} />} />
  }

  const groepen: { titel: string; items: ChannelState[] }[] = [
    { titel: 'Kanalen', items: zichtbaar.filter((s) => s.channel.kind === 'kanaal') },
    { titel: 'Vestigingen', items: zichtbaar.filter((s) => s.channel.kind === 'vestiging') },
    { titel: 'Rechtstreeks', items: zichtbaar.filter((s) => s.channel.kind === 'gesprek') },
  ]

  return (
    <div className="chat">
      {/* -------------------------- Kanalen -------------------------- */}
      <aside className={`chat-list ${actief ? 'has-open' : ''}`}>
        <div className="chat-search">
          <Search size={14} />
          <input
            value={zoek}
            maxLength={60}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Kanaal zoeken…"
          />
          {zoek && (
            <button className="btn ghost sm" onClick={() => setZoek('')} aria-label="Wissen">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="chat-channels">
          {groepen.map(({ titel, items }) => items.length === 0 ? null : (
            <div key={titel} className="chat-group">
              <div className="chat-group-head">
                <span>{titel}</span>
                {titel === 'Rechtstreeks' && (
                  <button
                    className="chat-add"
                    onClick={() => setNieuwGesprek(true)}
                    title="Iemand aanspreken"
                  >
                    <Plus size={13} />
                  </button>
                )}
                {titel === 'Kanalen' && perms.can('chat.manage') && (
                  <button
                    className="chat-add"
                    onClick={() => setNieuwKanaal(true)}
                    title="Kanaal beginnen"
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>

              {items.map((s) => (
                <button
                  key={s.channel.id}
                  className={`chat-channel ${actief?.channel.id === s.channel.id ? 'active' : ''} ${s.ongelezen ? 'unread' : ''}`}
                  onClick={() => {
                    setOpenId(s.channel.id)
                    trail.action(`Overleg geopend: ${s.channel.name}`)
                  }}
                >
                  {s.channel.kind === 'vestiging'
                    ? <MapPin size={14} />
                    : s.channel.kind === 'gesprek'
                      ? <span className="av">{initials(channelTitle(s.channel, me, iedereen))}</span>
                      : <Hash size={14} />}
                  <span className="n">{channelTitle(s.channel, me, iedereen)}</span>
                  {s.genoemd && <AtSign size={13} className="mention" />}
                  {!!s.ongelezen && <span className="badge brand">{s.ongelezen}</span>}
                </button>
              ))}
            </div>
          ))}

          {zichtbaar.length === 0 && (
            <div className="chat-none">
              {zoek ? 'Geen kanaal met die naam.' : 'Er is nog geen kanaal.'}
              {!zoek && perms.can('chat.manage') && (
                <button className="btn sm mt" onClick={() => setNieuwKanaal(true)}>
                  <Plus size={14} /> Kanaal beginnen
                </button>
              )}
            </div>
          )}
        </div>

        {pending > 0 && (
          <div className="chat-pending">
            <Loader2 size={13} className="spin" />
            {pending} {pending === 1 ? 'bericht wacht' : 'wijzigingen wachten'} op verbinding
          </div>
        )}
      </aside>

      {/* -------------------------- Gesprek -------------------------- */}
      {actief ? (
        <Gesprek
          key={actief.channel.id}
          state={actief}
          me={me}
          iedereen={iedereen}
          berichten={berichten}
          onLeden={() => setLeden(actief.channel)}
          onTerug={() => setOpenId(null)}
        />
      ) : (
        <div className="chat-thread">
          <Empty text="Kies een kanaal om mee te lezen." icon={<MessageSquare size={30} />} />
        </div>
      )}

      <NieuwKanaal
        open={nieuwKanaal}
        onClose={() => setNieuwKanaal(false)}
        onCreated={setOpenId}
        me={me}
        iedereen={iedereen}
      />

      <NieuwGesprek
        open={nieuwGesprek}
        onClose={() => setNieuwGesprek(false)}
        onCreated={setOpenId}
        me={me}
        iedereen={iedereen}
      />

      <LedenPaneel
        channel={leden}
        onClose={() => setLeden(null)}
        iedereen={iedereen}
      />
    </div>
  )
}

/* ================================================================== *
 *  Eén gesprek
 * ================================================================== */

function Gesprek({
  state, me, iedereen, berichten, onLeden, onTerug,
}: {
  state: ChannelState
  me: User
  iedereen: User[]
  berichten: ChatMessage[]
  onLeden: () => void
  onTerug: () => void
}) {
  const perms = usePerms()
  const { channel } = state

  const [tekst, setTekst] = useState('')
  const [antwoordOp, setAntwoordOp] = useState<ChatMessage | null>(null)
  const [busy, setBusy] = useState(false)

  const bodemRef = useRef<HTMLDivElement>(null)
  const invoerRef = useRef<HTMLTextAreaElement>(null)

  const regels = useMemo(
    () => berichten
      .filter((m) => m.channelId === channel.id)
      .sort((a, b) => a.at - b.at)
      .slice(-300),
    [berichten, channel.id],
  )

  /** Wie dit kanaal leest; nodig om @-namen te herkennen. */
  const leden = useMemo(
    () => iedereen.filter((u) => u.active && mayRead(u, channel)),
    [iedereen, channel],
  )

  // Naar beneden bij nieuwe berichten, en het kanaal als gelezen markeren.
  useEffect(() => {
    bodemRef.current?.scrollIntoView({ block: 'end' })
    void chat.markRead(channel.id, me.id)
  }, [regels.length, channel.id, me.id])

  async function versturen() {
    const body = tekst.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await chat.send({
        channelId: channel.id,
        body,
        by: me,
        replyTo: antwoordOp ?? undefined,
        members: leden,
      })
      setTekst('')
      setAntwoordOp(null)
      invoerRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  async function verwijderen(m: ChatMessage) {
    if (m.authorId !== me.id && !perms.can('chat.moderate')) {
      return toast.warn('Je kunt alleen je eigen berichten weghalen')
    }
    await chat.remove(m.id, me)
    toast.info('Bericht verwijderd')
  }

  const titel = channelTitle(channel, me, iedereen)

  return (
    <section className="chat-thread">
      <header className="chat-head">
        <button className="btn ghost sm chat-back" onClick={onTerug} aria-label="Terug">
          <CornerUpLeft size={15} />
        </button>

        {channel.kind === 'vestiging'
          ? <MapPin size={17} />
          : channel.kind === 'gesprek'
            ? <span className="av">{initials(titel)}</span>
            : <Hash size={17} />}

        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{titel}</h2>
          {channel.topic && <div className="topic">{channel.topic}</div>}
        </div>

        {channel.private && <Badge tone="info">Besloten</Badge>}

        <button className="btn ghost sm" onClick={onLeden} title="Wie zit hierin">
          <Users size={15} />
          <span className="hide-mobile">{leden.length}</span>
        </button>
      </header>

      <div className="chat-messages">
        {regels.length === 0 ? (
          <Empty
            text={`Nog niets gezegd in ${titel}. Begin gerust.`}
            icon={<MessageSquare size={30} />}
          />
        ) : (
          regels.map((m, i) => {
            const vorige = regels[i - 1]
            const nieuweDag = !vorige || nieuweDagTussen(vorige.at, m.at)
            // Berichten van dezelfde persoon vlak achter elkaar krijgen geen
            // nieuwe kop; dat leest als één gedachte in plaats van vijf.
            const aaneen = !nieuweDag && vorige
              && vorige.authorId === m.authorId
              && m.at - vorige.at < 5 * 60_000
              && !m.replyToId

            return (
              <div key={m.id}>
                {nieuweDag && (
                  <div className="chat-day"><span>{dagLabel(m.at)}</span></div>
                )}
                <Bericht
                  m={m}
                  aaneen={!!aaneen}
                  mij={m.authorId === me.id}
                  genoemd={m.mentions.includes(me.id)}
                  onAntwoord={() => { setAntwoordOp(m); invoerRef.current?.focus() }}
                  onVerwijder={() => void verwijderen(m)}
                  magVerwijderen={m.authorId === me.id || perms.can('chat.moderate')}
                />
              </div>
            )
          })
        )}
        <div ref={bodemRef} />
      </div>

      <div className="chat-composer">
        {antwoordOp && (
          <div className="chat-reply">
            <CornerUpLeft size={13} />
            <span>
              Antwoord aan <strong>{antwoordOp.authorName}</strong>:{' '}
              {antwoordOp.body.slice(0, 90)}
            </span>
            <button className="btn ghost sm" onClick={() => setAntwoordOp(null)} aria-label="Annuleren">
              <X size={13} />
            </button>
          </div>
        )}

        <div className="chat-input">
          <textarea
            ref={invoerRef}
            className="textarea"
            value={tekst}
            maxLength={MAX_MESSAGE}
            placeholder={`Bericht aan ${titel}…  (@naam om iemand te wijzen)`}
            onChange={(e) => setTekst(e.target.value)}
            onKeyDown={(e) => {
              // Enter verstuurt, shift+enter maakt een nieuwe regel. Op een
              // telefoon niet: daar is enter gewoon enter.
              if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
                e.preventDefault()
                void versturen()
              }
            }}
          />
          <button
            className="btn primary"
            onClick={() => void versturen()}
            disabled={!tekst.trim() || busy}
            aria-label="Versturen"
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ================================================================== *
 *  Eén bericht
 * ================================================================== */

function Bericht({
  m, aaneen, mij, genoemd, onAntwoord, onVerwijder, magVerwijderen,
}: {
  m: ChatMessage
  aaneen: boolean
  mij: boolean
  genoemd: boolean
  onAntwoord: () => void
  onVerwijder: () => void
  magVerwijderen: boolean
}) {
  const [menu, setMenu] = useState(false)

  if (m.deletedAt) {
    return (
      <div className="chat-msg deleted">
        <span className="gutter" />
        <div className="body"><em>Bericht verwijderd</em></div>
      </div>
    )
  }

  return (
    <div
      className={`chat-msg ${aaneen ? 'aaneen' : ''} ${genoemd ? 'genoemd' : ''}`}
      onMouseLeave={() => setMenu(false)}
    >
      <span className="gutter">
        {aaneen
          ? <span className="tijd-klein">{time(m.at)}</span>
          : <span className="av">{initials(m.authorName)}</span>}
      </span>

      <div className="body">
        {!aaneen && (
          <div className="kop">
            <strong>{m.authorName}</strong>
            <span className="tijd">{time(m.at)}</span>
            {m.editedAt && <span className="tijd">bewerkt</span>}
            {mij && <span className="tijd">jij</span>}
          </div>
        )}

        {m.replyToId && (
          <div className="chat-quote">
            <CornerUpLeft size={12} />
            <span><strong>{m.replyToName}</strong>: {m.replyToBody}</span>
          </div>
        )}

        <div className="tekst">{m.body}</div>
      </div>

      <div className="acties">
        <button className="btn ghost sm" onClick={onAntwoord} title="Antwoorden">
          <CornerUpLeft size={13} />
        </button>
        {magVerwijderen && (
          menu ? (
            <button className="btn danger sm" onClick={onVerwijder} title="Definitief weghalen">
              <Trash2 size={13} />
            </button>
          ) : (
            <button className="btn ghost sm" onClick={() => setMenu(true)} title="Meer">
              <MoreHorizontal size={13} />
            </button>
          )
        )}
      </div>
    </div>
  )
}

/* ================================================================== *
 *  Kanaal beginnen
 * ================================================================== */

function NieuwKanaal({
  open, onClose, onCreated, me, iedereen,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
  me: User
  iedereen: User[]
}) {
  const [naam, setNaam] = useState('')
  const [topic, setTopic] = useState('')
  const [besloten, setBesloten] = useState(false)
  const [leden, setLeden] = useState<string[]>([me.id])

  const kandidaten = useMemo(
    () => iedereen
      .filter((u) => u.active && !u.roles.includes('customer'))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [iedereen],
  )

  async function maak() {
    if (naam.trim().length < 2) return toast.error('Geef het kanaal een naam')
    const kanaal = await channelRepo.create({
      name: naam,
      topic,
      private: besloten,
      memberIds: besloten ? [...new Set([me.id, ...leden])] : [me.id],
      by: me,
    })
    toast.ok(`Kanaal ${kanaal.name} staat er`)
    onCreated(kanaal.id)
    setNaam(''); setTopic(''); setBesloten(false); setLeden([me.id])
    onClose()
  }

  return (
    <Modal
      open={open}
      title="Kanaal beginnen"
      subtitle="Eén onderwerp per kanaal leest het prettigst"
      onClose={onClose}
      width={520}
    >
      <Field label="Naam">
        <input
          className="input" value={naam} maxLength={40}
          onChange={(e) => setNaam(e.target.value)}
          placeholder="Bijv. Chemie en dosering"
        />
      </Field>

      <Field label="Waar gaat het over? (optioneel)">
        <input
          className="input" value={topic} maxLength={120}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Staat boven het gesprek, zodat iedereen het weet"
        />
      </Field>

      <button
        type="button"
        className={`stop-toggle ${besloten ? 'on' : ''}`}
        onClick={() => setBesloten((v) => !v)}
      >
        <Users size={17} />
        <span>
          <strong>Besloten kanaal</strong>
          <span>Alleen wie je toevoegt kan het zien en meelezen.</span>
        </span>
        {besloten && <Check size={16} />}
      </button>

      {besloten && (
        <div className="recipient-list" style={{ marginTop: 12, maxHeight: 240, overflowY: 'auto' }}>
          {kandidaten.map((u) => {
            const on = leden.includes(u.id)
            return (
              <button
                key={u.id}
                type="button"
                className={`recipient ${on ? 'on' : ''}`}
                disabled={u.id === me.id}
                onClick={() => setLeden(on
                  ? leden.filter((id) => id !== u.id)
                  : [...leden, u.id])}
              >
                <span className="av">{initials(u.name)}</span>
                <span className="who">
                  <span className="n">{u.name}</span>
                  <span className="f">{u.function ?? u.roles.join(', ')}</span>
                </span>
                {on && <Check size={15} />}
              </button>
            )
          })}
        </div>
      )}

      <div className="row end mt">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void maak()}>
          <Hash size={15} /> Kanaal maken
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Iemand rechtstreeks aanspreken
 * ================================================================== */

function NieuwGesprek({
  open, onClose, onCreated, me, iedereen,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
  me: User
  iedereen: User[]
}) {
  const [zoek, setZoek] = useState('')

  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase().slice(0, 60)
    return iedereen
      .filter((u) => u.active && u.id !== me.id && !u.roles.includes('customer'))
      .filter((u) => !q || u.name.toLowerCase().includes(q) ||
        (u.function ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 60)
  }, [iedereen, zoek, me.id])

  async function open2(u: User) {
    const kanaal = await channelRepo.openDirect(me, u)
    if (kanaal) onCreated(kanaal.id)
    setZoek('')
    onClose()
  }

  return (
    <Modal open={open} title="Iemand aanspreken" onClose={onClose} width={460}>
      <Field label="Zoek een collega">
        <input
          className="input" value={zoek} maxLength={60} autoFocus
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Naam of functie"
        />
      </Field>

      <div className="recipient-list" style={{ maxHeight: 340, overflowY: 'auto' }}>
        {lijst.length === 0 && <div className="chat-none">Niemand gevonden.</div>}
        {lijst.map((u) => (
          <button key={u.id} type="button" className="recipient" onClick={() => void open2(u)}>
            <span className="av">{initials(u.name)}</span>
            <span className="who">
              <span className="n">{u.name}</span>
              <span className="f">{u.function ?? u.roles.join(', ')}</span>
            </span>
            <Send size={14} />
          </button>
        ))}
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Wie zit hierin
 * ================================================================== */

function LedenPaneel({
  channel, onClose, iedereen,
}: {
  channel: Channel | null
  onClose: () => void
  iedereen: User[]
}) {
  const perms = usePerms()
  const leden = useMemo(
    () => channel ? iedereen.filter((u) => u.active && mayRead(u, channel)) : [],
    [channel, iedereen],
  )

  return (
    <Modal
      open={!!channel}
      title={channel ? `Wie leest ${channel.name} mee` : ''}
      subtitle={channel?.private
        ? 'Besloten kanaal: alleen deze mensen zien het.'
        : 'Open kanaal: iedereen die eraan toe mag komen.'}
      onClose={onClose}
      width={420}
    >
      <div className="recipient-list" style={{ maxHeight: 380, overflowY: 'auto' }}>
        {leden.map((u) => (
          <div key={u.id} className="recipient" style={{ cursor: 'default' }}>
            <span className="av">{initials(u.name)}</span>
            <span className="who">
              <span className="n">{u.name}</span>
              <span className="f">{u.function ?? u.roles.join(', ')}</span>
            </span>
            {channel?.private && perms.can('chat.manage') && u.id !== channel.createdBy && (
              <button
                className="btn ghost sm"
                onClick={() => void channelRepo.removeMember(channel.id, u.id)}
                title="Uit het kanaal halen"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {leden.length === 0 && <div className="chat-none">Nog niemand.</div>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

function isTouch() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches === true
}

function nieuweDagTussen(a: number, b: number) {
  return new Date(a).toDateString() !== new Date(b).toDateString()
}

function dagLabel(ts: number) {
  const vandaag = new Date().toDateString()
  const gisteren = new Date(Date.now() - DAG).toDateString()
  const d = new Date(ts).toDateString()
  if (d === vandaag) return 'Vandaag'
  if (d === gisteren) return 'Gisteren'
  return new Date(ts).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

/* ------------------------------------------------------------------ *
 *  Het knopje in de balk
 * ------------------------------------------------------------------ */

export function OverlegKnop({ onOpen }: { onOpen: () => void }) {
  const me = useAuth((s) => s.user)
  const perms = usePerms()

  const kanalen = useLiveQuery(() => db.channels.toArray(), [], [] as Channel[])
  const berichten = useLiveQuery(() => db.chatMessages.toArray(), [], [] as ChatMessage[])
  const gelezen = useLiveQuery(() => db.channelReads.toArray(), [], [] as ChannelRead[])

  const states = useMemo(
    () => channelStates(me, kanalen, berichten, gelezen),
    [me, kanalen, berichten, gelezen],
  )

  if (!perms.can('chat.use')) return null

  const totaal = states.reduce((a, s) => a + s.ongelezen, 0)
  const genoemd = states.some((s) => s.genoemd)

  return (
    <button
      className={`notif-bell ${totaal ? 'has-unread' : ''}`}
      onClick={onOpen}
      title={totaal ? `${totaal} ongelezen berichten` : 'Overleg'}
      aria-label="Overleg"
    >
      <MessageSquare size={17} />
      {totaal > 0 && <span className="dot">{genoemd ? '@' : totaal > 9 ? '9+' : totaal}</span>}
    </button>
  )
}

/** Het laatste nieuws uit het overleg, voor op een starttegel. */
export function useOverlegTeller(): number {
  const me = useAuth((s) => s.user)
  const kanalen = useLiveQuery(() => db.channels.toArray(), [], [] as Channel[])
  const berichten = useLiveQuery(() => db.chatMessages.toArray(), [], [] as ChatMessage[])
  const gelezen = useLiveQuery(() => db.channelReads.toArray(), [], [] as ChannelRead[])

  return useMemo(
    () => channelStates(me, kanalen, berichten, gelezen).reduce((a, s) => a + s.ongelezen, 0),
    [me, kanalen, berichten, gelezen],
  )
}
