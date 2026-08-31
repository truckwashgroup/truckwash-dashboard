import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, CheckCircle2, Mail, MailX, Search, ShieldCheck, XCircle,
} from 'lucide-react'
import { db } from '../../lib/db'
import type { EmailLog } from '../../lib/types'
import { dateTime, relative } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'

/* ------------------------------------------------------------------ *
 *  Post
 *
 *  Waarom dit scherm bestaat: "ik heb niets ontvangen" is anders niet te
 *  beantwoorden. Hier zie je of de mail eruit is gegaan, wanneer, en zo
 *  niet: waarom niet.
 *
 *  De app verstuurt zelf niets. Dat doet een serverfunctie met de sleutel
 *  van Resend; deze regels zet diezelfde functie neer. Wat je hier ziet is
 *  dus wat er werkelijk is gebeurd, niet wat de app dácht te doen.
 * ------------------------------------------------------------------ */

const SJABLOON_LABEL: Record<string, string> = {
  'aanmelding': 'Aanmelding ontvangen',
  'nieuwe-aanmelding': 'Seintje aan het management',
  'aanmelding-goedgekeurd': 'Aanmelding goedgekeurd',
  'aanmelding-afgewezen': 'Aanmelding afgewezen',
  'bericht': 'Melding uit de app',
}

export default function Post() {
  const [q, setQ] = useState('')
  const [alleenMislukt, setAlleenMislukt] = useState(false)

  const alle = useLiveQuery(
    async () => (await db.emailLog.toArray()).sort((a, b) => b.at - a.at),
    [],
    [] as EmailLog[],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().slice(0, 64)
    return alle
      .filter((e) => !alleenMislukt || e.status === 'mislukt')
      .filter((e) => !needle ||
        e.toEmail.toLowerCase().includes(needle) ||
        e.subject.toLowerCase().includes(needle) ||
        e.template.toLowerCase().includes(needle))
      .slice(0, 300)
  }, [alle, q, alleenMislukt])

  const dag = alle.filter((e) => e.at > Date.now() - 86_400_000)
  const mislukt = alle.filter((e) => e.status === 'mislukt')

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Verstuurd (24 uur)" value={dag.length} icon={<Mail size={17} />} />
        <Stat
          label="Mislukt"
          value={mislukt.length}
          icon={<MailX size={17} />}
          tone={mislukt.length ? 'danger' : 'ok'}
        />
        <Stat label="Totaal vastgelegd" value={alle.length} icon={<CheckCircle2 size={17} />} />
      </div>

      {mislukt.length > 0 && (
        <div className="waarschuwing mb">
          <AlertTriangle size={17} />
          <span>
            Er is post blijven steken. Kijk bij de eerste mislukte regel wat de
            server terugkreeg — meestal is dat een sleutel die verlopen is of
            een domein dat niet meer geverifieerd staat.
          </span>
        </div>
      )}

      <Card
        title="Verstuurde post"
        hint="Wat de serverfunctie via Resend de deur uit deed"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div className="chat-search" style={{ margin: 0, width: 220 }}>
              <Search size={14} />
              <input
                value={q}
                maxLength={64}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Adres of onderwerp"
              />
            </div>
            <button
              className={`btn sm ${alleenMislukt ? 'danger' : 'ghost'}`}
              onClick={() => setAlleenMislukt((v) => !v)}
            >
              Alleen mislukt
            </button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            text={alle.length === 0
              ? 'Er is nog niets verstuurd. Zodra er een aanmelding of een melding langskomt, staat het hier.'
              : 'Geen regels die hierop passen.'}
            icon={<Mail size={30} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Wanneer</th>
                  <th>Aan</th>
                  <th>Soort</th>
                  <th>Onderwerp</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="mono">{dateTime(e.at)}</span>
                      <div style={{ fontSize: '.71rem', color: 'var(--text-3)' }}>
                        {relative(e.at)}
                      </div>
                    </td>
                    <td>{e.toEmail}</td>
                    <td>
                      <Badge>{SJABLOON_LABEL[e.template] ?? e.template}</Badge>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>
                      {e.subject}
                      {e.error && (
                        <div style={{ fontSize: '.73rem', color: 'var(--danger)', marginTop: 3 }}>
                          {e.error}
                        </div>
                      )}
                    </td>
                    <td>
                      {e.status === 'verstuurd'
                        ? <Badge tone="ok"><CheckCircle2 size={11} /> verstuurd</Badge>
                        : <Badge tone="danger"><XCircle size={11} /> mislukt</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Hoe dit werkt" className="mt">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <ShieldCheck size={17} color="var(--brand)" style={{ flex: 'none', marginTop: 2 }} />
          <div style={{ fontSize: '.86rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 8px' }}>
              De sleutel van Resend zit niet in deze app en hoort daar ook niet:
              alles wat je meelevert aan telefoons en laptops is uit te lezen.
              Hij staat in de functie <strong>stuur-mail</strong> bij Supabase.
            </p>
            <p style={{ margin: 0 }}>
              De app geeft die functie nooit een e-mailadres mee, maar een id —
              van een dossier of van een aanmelding. Het adres zoekt de functie
              er zelf bij. Daarmee is dit geen doorgeefluik waarmee iemand
              namens truckwash.cloud post de wereld in kan sturen.
            </p>
          </div>
        </div>
      </Card>
    </>
  )
}
