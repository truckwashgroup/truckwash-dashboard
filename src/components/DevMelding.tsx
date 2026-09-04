import { useMemo, useState } from 'react'
import {
  Bug, ChevronDown, ChevronRight, LifeBuoy, Lightbulb, Send, Timer,
} from 'lucide-react'
import { tickets as ticketRepo } from '../lib/tickets'
import { deviceInfo, trail } from '../lib/trail'
import {
  TICKET_KINDS, type Ticket, type TicketKind, type TicketPriority,
  type TrailEntry,
} from '../lib/types'
import { Badge, Field, Modal } from './ui'
import MijnMeldingen from './MijnMeldingen'
import Doorvragen from './Doorvragen'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { useSync } from '../lib/sync'
import { useUpdates } from '../lib/updates'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Melding aan de ontwikkelaar
 *
 *  De kunst is om het invullen kort te houden en toch bruikbaar te maken.
 *  Daarom vragen we alleen wat een mens weet -- wat wilde je doen, wat
 *  gebeurde er -- en sturen we de rest automatisch mee: het apparaat, de
 *  versie, of er verbinding was, en wat je het afgelopen kwartier deed.
 *
 *  Dat spoor is zichtbaar voordat je verstuurt. Niemand hoort iets mee te
 *  sturen zonder te kunnen zien wát.
 * ------------------------------------------------------------------ */

const MAX_TITLE = 100
const MAX_BODY = 1500

const KIND_ICON: Record<TicketKind, typeof Bug> = {
  fout: Bug,
  vraag: LifeBuoy,
  wens: Lightbulb,
  traag: Timer,
}

const TRAIL_LABEL: Record<TrailEntry['kind'], string> = {
  pagina: 'scherm',
  actie: 'actie',
  fout: 'fout',
  sync: 'sync',
  melding: 'melding',
}

export default function DevMelding({
  open, onClose, fromRole, fromPage, startTab = 'nieuw',
}: {
  open: boolean
  onClose: () => void
  fromRole?: string
  fromPage?: string
  startTab?: 'nieuw' | 'mijne'
}) {
  const me = useAuth((s) => s.user)!
  const sync = useSync()
  const version = useUpdates((s) => s.version)

  const [tab, setTab] = useState<'nieuw' | 'mijne'>(startTab)
  const [kind, setKind] = useState<TicketKind>('fout')
  const [priority, setPriority] = useState<TicketPriority>('normaal')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [toonSpoor, setToonSpoor] = useState(false)
  const [busy, setBusy] = useState(false)
  /*
   * De melding is verstuurd, maar het gesprek begint pas. Versturen en dan
   * meteen dichtklappen was het makkelijkst -- en precies waarom er zo vaak
   * een melding lag waar niemand iets mee kon.
   */
  const [gesprek, setGesprek] = useState<Ticket | null>(null)

  const spoor = useMemo(() => (open ? trail.recent() : []), [open])
  const device = useMemo(() => deviceInfo(), [])

  /** Dichtdoen zet het gesprek ook weg; anders staat het er morgen nog. */
  function sluit() {
    setGesprek(null)
    setTab(startTab)
    onClose()
  }

  async function versturen() {
    if (title.trim().length < 5) return toast.error('Geef kort aan wat er aan de hand is')
    if (description.trim().length < 10) return toast.error('Beschrijf wat je deed en wat er gebeurde')

    setBusy(true)
    try {
      const melding = await ticketRepo.create({
        title: title.slice(0, MAX_TITLE),
        description: description.slice(0, MAX_BODY),
        kind,
        priority,
        by: { id: me.id, name: me.name, locationId: me.locationId },
        fromRole: fromRole as never,
        fromPage,
        appVersion: version,
        online: sync.online,
        pendingChanges: sync.pending,
      })

      toast.ok(`Melding ${melding.number} verstuurd`)
      setTitle('')
      setDescription('')
      setKind('fout')
      setPriority('normaal')
      setGesprek(melding)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Melding aan de ontwikkelaar"
      subtitle="Werkt iets niet, of mist er iets? Laat het weten."
      onClose={sluit}
      width={620}
      /*
       * Hier typt iemand een melding. Ernaast klikken hoort dat niet weg te
       * gooien -- dat is precies wat er gebeurde bij M-2609-0010.
       */
      alleenBewustSluiten
    >
      {gesprek && (
        <>
          <Doorvragen
            ticket={gesprek}
            door={{ id: me.id, name: me.name }}
            onKlaar={() => { /* het scherm blijft staan tot iemand sluit */ }}
          />
          <div className="row end" style={{ marginTop: 16 }}>
            <button className="btn" onClick={sluit}>Sluiten</button>
          </div>
        </>
      )}

      {!gesprek && (<>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button
          className={`btn sm ${tab === 'nieuw' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('nieuw')}
        >
          Nieuwe melding
        </button>
        <button
          className={`btn sm ${tab === 'mijne' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('mijne')}
        >
          Mijn meldingen
        </button>
      </div>

      {tab === 'mijne' ? <MijnMeldingen /> : <>

      <Field label="Wat voor melding is dit?">
        <div className="kind-row">
          {(Object.keys(TICKET_KINDS) as TicketKind[]).map((k) => {
            const Icon = KIND_ICON[k]
            return (
              <button
                key={k}
                type="button"
                className={`kind ${kind === k ? 'on' : ''}`}
                onClick={() => setKind(k)}
              >
                <Icon size={18} />
                <strong>{TICKET_KINDS[k].label}</strong>
                <span>{TICKET_KINDS[k].hint}</span>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="In één zin" help={`${title.length}/${MAX_TITLE}`}>
        <input
          className="input"
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Bijv. Kan geen wasbeurt afmelden op de telefoon"
        />
      </Field>

      <Field
        label="Wat wilde je doen, en wat gebeurde er?"
        help={`${description.length}/${MAX_BODY} — hoe concreter, hoe sneller het opgelost is`}
      >
        <textarea
          className="textarea"
          style={{ minHeight: 110 }}
          value={description}
          maxLength={MAX_BODY}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={'Ik wilde ...\nIk verwachtte ...\nIn plaats daarvan ...'}
        />
      </Field>

      <Field label="Hoe erg zit het je in de weg?">
        <div className="row" style={{ gap: 6 }}>
          {([
            ['laag', 'Kan wachten'],
            ['normaal', 'Hinderlijk'],
            ['hoog', 'Kost me tijd'],
            ['blokkerend', 'Ik kan niet werken'],
          ] as [TicketPriority, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`btn sm ${priority === k ? 'primary' : ''}`}
              onClick={() => setPriority(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {/* Wat er automatisch meegaat, zichtbaar vóór het versturen */}
      <button className="trail-toggle" onClick={() => setToonSpoor(!toonSpoor)} type="button">
        {toonSpoor ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span>
          <strong>Wat er automatisch meegaat</strong>
          <span>
            {device.platform} · versie {version} · {sync.online ? 'online' : 'offline'}
            {spoor.length ? ` · ${spoor.length} handelingen uit het laatste kwartier` : ''}
          </span>
        </span>
      </button>

      {toonSpoor && (
        <div className="trail-box">
          <div className="trail-meta">
            <div><span>Apparaat</span><span>{device.platform}</span></div>
            <div><span>Schermformaat</span><span>{device.screen}</span></div>
            <div><span>Versie</span><span>{version}</span></div>
            <div><span>Verbinding</span><span>{sync.online ? 'online' : 'offline'}</span></div>
            <div><span>Nog te versturen</span><span>{sync.pending} wijzigingen</span></div>
            {fromPage && <div><span>Scherm</span><span>{fromRole} → {fromPage}</span></div>}
          </div>

          {spoor.length === 0 ? (
            <div className="trail-empty">Nog geen handelingen vastgelegd in dit kwartier.</div>
          ) : (
            <div className="trail-list">
              {spoor.map((e, i) => (
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
            Alleen wat je deed, niet wat je typte. Wachtwoorden, klantgegevens
            en invoervelden zitten er niet in.
          </div>
        </div>
      )}

      <div className="row end" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void versturen()} disabled={busy}>
          <Send size={15} /> Versturen
        </button>
      </div>

      </>}
      </>)}
    </Modal>
  )
}

/** Knop voor in de balk van elk dashboard. */
export function DevMeldingKnop({ role, page }: { role?: string; page?: string }) {
  const perms = usePerms()
  const [open, setOpen] = useState(false)

  if (!perms.can('dev.report')) return null

  return (
    <>
      <button
        className="btn ghost sm"
        onClick={() => setOpen(true)}
        title="Werkt er iets niet? Geef het door aan de ontwikkelaar"
        data-rondleiding="dev-melding"
      >
        <Bug size={14} /> <span className="hide-mobile">Devmelding</span>
      </button>
      <DevMelding open={open} onClose={() => setOpen(false)} fromRole={role} fromPage={page} />
    </>
  )
}
