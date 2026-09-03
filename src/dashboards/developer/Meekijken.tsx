import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Activity, AlertTriangle, ArrowDownToLine, Bug, Copy, Eraser, MousePointerClick,
  Pause, Play, RefreshCw, Radio, Search, Trash2, Wifi,
} from 'lucide-react'
import { db } from '../../lib/db'
import {
  liveClear, liveRecent, onLive, type LiveEvent, type LiveSoort,
} from '../../lib/trail'
import type { OutboxRecord } from '../../lib/types'
import { time } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'
import { useSync } from '../../lib/sync'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Meekijken
 *
 *  Het logboek verderop telt dezelfde fout bij elkaar op -- prima om te zien
 *  wat er structureel misgaat, waardeloos als iemand naast je zegt "kijk,
 *  nu doet hij het weer".
 *
 *  Dit scherm is het tegenovergestelde: alles, ongefilterd, op volgorde van
 *  gebeuren. Schermwissels, handelingen, fouten, elke ronde van de
 *  synchronisatie met hoe lang die duurde.
 *
 *  Het staat alleen in het geheugen van dit apparaat en gaat nergens heen.
 * ------------------------------------------------------------------ */

const SOORT: Record<LiveSoort, { label: string; tint: string; icon: typeof Activity }> = {
  pagina:       { label: 'scherm',  tint: 'info',    icon: MousePointerClick },
  actie:        { label: 'actie',   tint: 'brand',   icon: MousePointerClick },
  fout:         { label: 'fout',    tint: 'danger',  icon: Bug },
  waarschuwing: { label: 'let op',  tint: 'warn',    icon: AlertTriangle },
  sync:         { label: 'sync',    tint: 'ok',      icon: RefreshCw },
  netwerk:      { label: 'netwerk', tint: 'danger',  icon: Wifi },
  melding:      { label: 'melding', tint: 'default', icon: Activity },
}

export default function Meekijken() {
  const [regels, setRegels] = useState<LiveEvent[]>(() => liveRecent())
  const [volgen, setVolgen] = useState(true)
  const [pauze, setPauze] = useState(false)
  const [zoek, setZoek] = useState('')
  const [uit, setUit] = useState<Set<LiveSoort>>(new Set())
  const [open, setOpen] = useState<number | null>(null)

  const bodem = useRef<HTMLDivElement>(null)
  const sync = useSync()

  /* Meekijken staat los van pauze: we blijven verzamelen, we tonen alleen
     niets meer. Anders mis je juist het moment dat je wilde bekijken. */
  useEffect(() => {
    return onLive((e) => {
      if (pauze) return
      setRegels((r) => [...r.slice(-599), e])
    })
  }, [pauze])

  useEffect(() => {
    if (volgen && !pauze) bodem.current?.scrollIntoView({ block: 'end' })
  }, [regels.length, volgen, pauze])

  /**
   * Een wijziging uit de wachtrij halen.
   *
   * Vraagt eerst na, want dit is onomkeerbaar: wat hier weggaat is werk dat de
   * server nooit heeft gezien. Daarom staat er in de vraag ook bij wát het is
   * en waarom het vastloopt.
   */
  async function weggooien(r: OutboxRecord) {
    const zeker = window.confirm(
      `${r.entity} / ${r.recordId} uit de wachtrij halen?

` +
      `Deze wijziging is ${r.tries}x geweigerd:
${r.lastError ?? 'onbekende reden'}

` +
      'Weggooien kan niet ongedaan worden gemaakt. Wat hier weggaat heeft de ' +
      'server nooit gezien.',
    )
    if (!zeker) return
    await db.outbox.delete(r.id!)
    await useSync.getState().refreshPending()
    toast.ok('Uit de wachtrij gehaald.')
  }

  const outbox = useLiveQuery(
    async () => (await db.outbox.orderBy('createdAt').toArray()).slice(0, 100),
    [],
    [] as OutboxRecord[],
  )

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase().slice(0, 64)
    return regels
      .filter((e) => !uit.has(e.soort))
      .filter((e) => !q || e.tekst.toLowerCase().includes(q) ||
        (e.detail ?? '').toLowerCase().includes(q))
  }, [regels, uit, zoek])

  const fouten = regels.filter((e) => e.soort === 'fout' || e.soort === 'netwerk').length

  function wissel(s: LiveSoort) {
    const volgende = new Set(uit)
    if (volgende.has(s)) volgende.delete(s)
    else volgende.add(s)
    setUit(volgende)
  }

  function kopieer() {
    const tekst = zichtbaar.map((e) =>
      `${new Date(e.at).toISOString()}  ${SOORT[e.soort].label.padEnd(8)} ${e.tekst}` +
      (e.duur !== undefined ? `  (${e.duur} ms)` : '') +
      (e.detail ? `\n    ${e.detail.replace(/\n/g, '\n    ')}` : '')
    ).join('\n')

    navigator.clipboard?.writeText(tekst)
      .then(() => toast.ok(`${zichtbaar.length} regels gekopieerd`))
      .catch(() => toast.error('Kopiëren lukte niet'))
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Gebeurtenissen"
          value={regels.length}
          icon={<Radio size={17} />}
          tone={pauze ? 'warn' : 'ok'}
        />
        <Stat label="Fouten in beeld" value={fouten} icon={<Bug size={17} />} tone={fouten ? 'danger' : 'ok'} />
        <Stat
          label="Wachtrij"
          value={sync.pending}
          icon={<ArrowDownToLine size={17} />}
          tone={sync.pending ? 'warn' : 'ok'}
        />
        <Stat
          label="Verbinding"
          value={sync.online ? (sync.syncing ? 'bezig' : 'online') : 'offline'}
          icon={<Wifi size={17} />}
          tone={sync.online ? 'ok' : 'warn'}
        />
      </div>

      {sync.lastError && (
        <div className="waarschuwing mb">
          <AlertTriangle size={17} />
          <span>
            <strong>Laatste synchronisatiefout:</strong> {sync.lastError}
          </span>
        </div>
      )}

      <Card
        title="Live"
        hint="Alles wat er op dit apparaat gebeurt, op volgorde"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div className="chat-search" style={{ margin: 0, width: 190 }}>
              <Search size={14} />
              <input
                value={zoek}
                maxLength={64}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Filteren"
              />
            </div>
            <button
              className={`btn sm ${pauze ? 'primary' : 'ghost'}`}
              onClick={() => setPauze((v) => !v)}
              title={pauze ? 'Weer meekijken' : 'Beeld vasthouden'}
            >
              {pauze ? <Play size={14} /> : <Pause size={14} />}
              {pauze ? 'Verder' : 'Pauze'}
            </button>
            <button
              className={`btn sm ${volgen ? 'primary' : 'ghost'}`}
              onClick={() => setVolgen((v) => !v)}
              title="Meescrollen met nieuwe regels"
            >
              <ArrowDownToLine size={14} />
            </button>
            <button className="btn ghost sm" onClick={kopieer} title="Kopiëren">
              <Copy size={14} />
            </button>
            <button
              className="btn ghost sm"
              onClick={() => { liveClear(); setRegels([]) }}
              title="Beeld leegmaken"
            >
              <Eraser size={14} />
            </button>
          </div>
        }
      >
        <div className="live-filters">
          {(Object.keys(SOORT) as LiveSoort[]).map((s) => {
            const aantal = regels.filter((e) => e.soort === s).length
            return (
              <button
                key={s}
                className={`live-filter ${uit.has(s) ? 'uit' : ''} t-${SOORT[s].tint}`}
                onClick={() => wissel(s)}
                title={uit.has(s) ? 'Weer tonen' : 'Verbergen'}
              >
                {SOORT[s].label}
                <span>{aantal}</span>
              </button>
            )
          })}
        </div>

        <div className="live-lijst">
          {zichtbaar.length === 0 ? (
            <Empty
              text={regels.length === 0
                ? 'Nog niets gebeurd. Klik ergens in de app en het verschijnt hier meteen.'
                : 'Alles is weggefilterd.'}
              icon={<Radio size={30} />}
            />
          ) : (
            zichtbaar.map((e) => {
              const meta = SOORT[e.soort]
              const Icon = meta.icon
              const uitgeklapt = open === e.id
              return (
                <div key={e.id} className={`live-regel t-${meta.tint}`}>
                  <button
                    className="kop"
                    onClick={() => setOpen(uitgeklapt ? null : e.id)}
                    disabled={!e.detail}
                  >
                    <span className="tijd">{time(e.at)}</span>
                    <span className="soort"><Icon size={12} /> {meta.label}</span>
                    <span className="tekst">{e.tekst}</span>
                    {e.duur !== undefined && (
                      <span className={`duur ${e.duur > 2500 ? 'traag' : ''}`}>
                        {e.duur} ms
                      </span>
                    )}
                  </button>
                  {uitgeklapt && e.detail && <pre className="detail">{e.detail}</pre>}
                </div>
              )
            })
          )}
          <div ref={bodem} />
        </div>
      </Card>

      {/* ------------------------- De wachtrij ------------------------ */}

      <Card
        title="Wachtrij"
        hint="Wijzigingen die nog naar de server moeten"
        flush
        className="mt"
        action={
          <button
            className="btn sm"
            onClick={() => void useSync.getState().sync()}
            disabled={sync.syncing}
          >
            <RefreshCw size={14} className={sync.syncing ? 'spin' : ''} /> Nu versturen
          </button>
        }
      >
        {outbox.length === 0 ? (
          <Empty text="De wachtrij is leeg — alles staat op de server." icon={<Trash2 size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tabel</th>
                  <th>Record</th>
                  <th>Wat</th>
                  <th className="num">Pogingen</th>
                  <th>Laatste fout</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {outbox.map((r) => (
                  <tr key={r.id}>
                    <td><Badge>{r.entity}</Badge></td>
                    <td className="mono" style={{ fontSize: '.76rem' }}>{r.recordId}</td>
                    <td>{r.op === 'put' ? 'opslaan' : 'verwijderen'}</td>
                    <td className="num">
                      {r.tries > 0
                        ? <Badge tone={r.tries > 4 ? 'danger' : 'warn'}>{r.tries}</Badge>
                        : '—'}
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: '.78rem' }}>
                      {r.lastError ?? '—'}
                    </td>
                    <td>
                      {/*
                        * Met de hand weggooien, en alleen met de hand.
                        *
                        * De wachtrij gooit sinds 1.27.1 niets meer vanzelf weg --
                        * dat kostte een compleet personeelsdossier. Maar dan moet
                        * er wél een uitweg zijn voor het geval dat een regel de
                        * server werkelijk nooit gaat halen: iets dat is aangemaakt
                        * door iemand die het niet mocht, bijvoorbeeld.
                        *
                        * Zonder deze knop blijft zo'n regel eeuwig staan en blijft
                        * de app erover klagen. Mét de knop is het een besluit van
                        * een mens die de reden ernaast ziet staan.
                        */}
                      <button
                        className="btn ghost sm danger"
                        title="Deze wijziging weggooien"
                        onClick={() => void weggooien(r)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
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
