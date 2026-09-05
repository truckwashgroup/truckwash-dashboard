import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, MailX, Monitor, RefreshCw, ShieldAlert, Trash2,
} from 'lucide-react'
import { Card, Empty, Stat } from '../../components/ui'
import { db } from '../../lib/db'
import { supabase, supabaseConfigured } from '../../lib/api/supabaseApi'
import { dateTime, relative } from '../../lib/format'
import type { EmailLog, LogEvent, PosDevice } from '../../lib/types'

/* ------------------------------------------------------------------ *
 *  Beveiliging
 *
 *  Wat hier staat is niet nieuw gemeten. Het werd al opgeschreven -- alleen
 *  kon niemand erbij.
 *
 *  Het verwijderlogboek is daarvan het duidelijkste geval: elke verwijdering
 *  in de database schrijft daar een regel, met wie het deed en waarom, en er
 *  was tot nu toe geen enkel scherm dat het liet zien. Een logboek dat niemand
 *  kan openen is geen logboek maar een geruststelling.
 *
 *  Wat hier bewust NIET staat:
 *
 *    - Fouten en waarschuwingen. Die hebben hun eigen scherm (Logboek), en dat
 *      is uitgebreider dan wat hier zou passen. Hier staat alleen het aantal,
 *      als aanleiding om daarheen te gaan.
 *    - Mislukte inlogpogingen. Die worden nergens vastgelegd. Een vakje met
 *      een nul zou hier liegen.
 *    - Automatisch ingrijpen. Dit scherm kijkt, het blokkeert niets. Dat is
 *      een uitdrukkelijke keuze uit de melding zelf.
 *
 *  De verwijderingen worden live opgehaald en niet meegesynchroniseerd. Twee
 *  redenen: het is een archief dat alleen maar groeit, en de redenen die erin
 *  staan horen niet in de cache van elk apparaat.
 * ------------------------------------------------------------------ */

interface Verwijdering {
  id: string
  soort: string
  naam: string
  tabel: string | null
  recordId: string | null
  reden: string
  doorNaam: string
  at: number
}

/** Hoe lang een apparaat mag zwijgen voordat het opvalt. */
const STIL = 3 * 86_400_000

export default function Beveiliging() {
  const [rijen, setRijen] = useState<Verwijdering[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)

  const apparaten = useLiveQuery(() => db.posDevices.toArray(), [], [] as PosDevice[])
  const mail = useLiveQuery(() => db.emailLog.toArray(), [], [] as EmailLog[])
  const logs = useLiveQuery(() => db.logEvents.toArray(), [], [] as LogEvent[])

  async function haal() {
    if (!supabaseConfigured) {
      setFout('Er is geen verbinding met de database ingesteld.')
      setRijen([])
      return
    }
    setBezig(true)
    setFout(null)
    try {
      const { data, error } = await supabase()
        .from('deletion_log')
        .select('id, soort, naam, tabel, record_id, reden, door_naam, at')
        .order('at', { ascending: false })
        .limit(200)
      if (error) {
        setFout(error.message)
        return
      }
      const lijst = (data ?? []) as Record<string, unknown>[]
      setRijen(lijst.map((r) => ({
        id: String(r.id),
        soort: String(r.soort ?? ''),
        naam: String(r.naam ?? ''),
        tabel: (r.tabel as string | null) ?? null,
        recordId: (r.record_id as string | null) ?? null,
        reden: String(r.reden ?? ''),
        doorNaam: String(r.door_naam ?? ''),
        at: Number(r.at ?? 0),
      })))
    } catch (e) {
      setFout(e instanceof Error ? e.message : String(e))
    } finally {
      setBezig(false)
    }
  }

  useEffect(() => { void haal() }, [])

  const dag = Date.now() - 86_400_000
  const week = Date.now() - 7 * 86_400_000

  const mislukteMail = mail.filter((m) => m.status === 'mislukt')
  const foutenDag = logs.filter((l) => l.level === 'fout' && l.at > dag).length
  const verwijderdWeek = (rijen ?? []).filter((r) => r.at > week).length

  /*
   * Apparaten die aandacht vragen, met erbij waarom precies. "Er is iets met
   * dit apparaat" is geen melding waar iemand iets mee kan.
   */
  const opvallend = useMemo(() => {
    const uit: Array<{ apparaat: PosDevice; waarom: string; ernst: 'warn' | 'danger' }> = []
    for (const a of apparaten) {
      if (a.status === 'ingetrokken' && !a.wipedAt) {
        uit.push({
          apparaat: a,
          ernst: 'danger',
          waarom: 'Ingetrokken, maar heeft zich nooit afgemeld — er kan omzet op staan',
        })
        continue
      }
      if (a.status === 'geblokkeerd') {
        uit.push({ apparaat: a, ernst: 'warn', waarom: 'Geblokkeerd' })
        continue
      }
      if (a.lastSeenAt && Date.now() - a.lastSeenAt > STIL) {
        uit.push({
          apparaat: a,
          ernst: 'warn',
          waarom: 'Al dagen niets van gehoord',
        })
      }
    }
    return uit
  }, [apparaten])

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Fouten (24 uur)"
          value={foutenDag}
          icon={<AlertTriangle size={17} />}
          tone={foutenDag ? 'danger' : 'ok'}
        />
        <Stat
          label="Mail niet aangekomen"
          value={mislukteMail.length}
          icon={<MailX size={17} />}
          tone={mislukteMail.length ? 'warn' : 'ok'}
        />
        <Stat
          label="Verwijderd (7 dagen)"
          value={rijen === null ? '—' : verwijderdWeek}
          icon={<Trash2 size={17} />}
        />
        <Stat
          label="Apparaten met een vlag"
          value={opvallend.length}
          icon={<Monitor size={17} />}
          tone={opvallend.some((o) => o.ernst === 'danger')
            ? 'danger'
            : opvallend.length ? 'warn' : 'ok'}
        />
      </div>

      <Card
        title="Wat er is weggehaald"
        hint="Elke verwijdering schrijft hier een regel, ook die van een serverfunctie"
        flush
        action={
          <button className="btn ghost sm" disabled={bezig} onClick={() => void haal()}>
            <RefreshCw size={14} className={bezig ? 'spin' : undefined} /> Opnieuw ophalen
          </button>
        }
      >
        {fout && (
          <div className="waarschuwing" style={{ margin: 14 }}>
            <ShieldAlert size={16} />
            <span>Het verwijderlogboek kon niet opgehaald worden: {fout}</span>
          </div>
        )}
        {!fout && rijen === null && (
          <div style={{ padding: 18, color: 'var(--text-3)' }}>Bezig met ophalen…</div>
        )}
        {!fout && rijen !== null && rijen.length === 0 && (
          <Empty text="Er is nog niets verwijderd." icon={<Trash2 size={30} />} />
        )}
        {!fout && rijen !== null && rijen.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Wat</th>
                  <th>Door</th>
                  <th>Reden</th>
                  <th>Wanneer</th>
                </tr>
              </thead>
              <tbody>
                {rijen.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.naam || r.recordId || '—'}</strong>
                      <div style={{ fontSize: '.76rem', color: 'var(--text-3)' }}>
                        {r.soort}{r.tabel ? ' · ' + r.tabel : ''}
                      </div>
                    </td>
                    <td>
                      {r.doorNaam || (
                        <span style={{ color: 'var(--text-3)' }}>automatisch</span>
                      )}
                    </td>
                    <td style={{ maxWidth: 380 }}>{r.reden || '—'}</td>
                    <td title={dateTime(r.at)} style={{ whiteSpace: 'nowrap' }}>
                      {relative(r.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Apparaten die aandacht vragen"
        hint="Ingetrokken maar niet afgemeld, geblokkeerd, of al dagen stil"
        flush
        className="mt"
      >
        {opvallend.length === 0 ? (
          <Empty text="Alle apparaten melden zich netjes." icon={<Monitor size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Apparaat</th>
                  <th>Versie</th>
                  <th>Wat er aan de hand is</th>
                  <th>Laatst gezien</th>
                </tr>
              </thead>
              <tbody>
                {opvallend.map(({ apparaat, waarom, ernst }) => (
                  <tr key={apparaat.id}>
                    <td><strong>{apparaat.name || apparaat.id}</strong></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {apparaat.appVersion
                        ? 'v' + apparaat.appVersion
                        : <span style={{ color: 'var(--text-3)' }}>onbekend</span>}
                    </td>
                    <td style={{ color: ernst === 'danger' ? 'var(--danger)' : 'var(--warn)' }}>
                      {waarom}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {apparaat.lastSeenAt ? relative(apparaat.lastSeenAt) : 'nooit'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Wat hier nog niet in staat" className="mt">
        <div className="signup-note">
          <ShieldAlert size={16} />
          <span>
            Mislukte inlogpogingen worden nergens vastgelegd, dus ze kunnen hier ook
            niet staan. Een vakje met een nul zou suggereren dat er niets gebeurt,
            terwijl er simpelweg niet gekeken wordt. Wil je dat zien, dan moet het
            eerst opgeschreven gaan worden.
          </span>
        </div>
        <div className="signup-note">
          <MailX size={16} />
          <span>
            Mail die uit iemands naam lijkt te komen, komt niet uit deze app: die
            verstuurt altijd vanaf één vast adres en legt elke verzending vast. Dat
            is een kwestie van het DMARC-beleid op het domein, en dat staat op
            p=none — meekijken zonder ingrijpen.
          </span>
        </div>
      </Card>
    </>
  )
}
