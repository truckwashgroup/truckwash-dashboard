import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Clock, Loader2, X } from 'lucide-react'
import { db } from '../lib/db'
import { openVerzoeken, SOORT_LABEL, urenverzoeken } from '../lib/urenritten'
import { HR_STATUS, type HourRequest, type TimeEntry } from '../lib/types'
import { dateShort, dateTime, relative, time } from '../lib/format'
import { Badge, Card, Empty, Field, Modal } from './ui'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Urenverzoeken beoordelen
 *
 *  Wie vergeet in te klokken kan er zelf niets aan doen -- klokken gaat via
 *  de kassa, en dat blijft zo. Hier komt zijn verzoek terecht: wat er staat,
 *  wat hij zegt dat het moet zijn, en waarom.
 *
 *  Goedkeuren zet de uren ook werkelijk recht. Een goedkeuring die de
 *  urenstaat niet raakt is een goedkeuring die niets betekent -- dan sta je
 *  twee weken later alsnog met de hand te rekenen.
 * ------------------------------------------------------------------ */

export default function Urenverzoeken({ teamIds }: { teamIds?: Set<string> }) {
  const me = useAuth((s) => s.user)!
  const [afwijzen, setAfwijzen] = useState<HourRequest | null>(null)
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)

  const alle = useLiveQuery(() => db.hourRequests.toArray(), [], [] as HourRequest[])
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])

  const open = openVerzoeken(alle)
    .filter((v) => !teamIds || teamIds.has(v.userId))
  const afgehandeld = alle
    .filter((v) => v.status !== 'nieuw' && (!teamIds || teamIds.has(v.userId)))
    .sort((a, b) => (b.beslistOp ?? 0) - (a.beslistOp ?? 0))
    .slice(0, 8)

  return (
    <>
      <Card
        title="Verzoeken om uren recht te zetten"
        hint={open.length ? 'Deze wachten op jou' : 'Niets open'}
        flush
      >
        {open.length === 0 ? (
          <Empty text="Geen openstaande verzoeken." icon={<Clock size={30} />} />
        ) : (
          <div className="verzoek-lijst">
            {open.map((v) => {
              const bestaand = v.entryId ? entries.find((e) => e.id === v.entryId) : undefined
              return (
                <div className="verzoek open" key={v.id}>
                  <div className="kop">
                    <strong>{v.userName}</strong>
                    <Badge tone="warn">{SOORT_LABEL[v.soort]}</Badge>
                    <span className="meta">{relative(v.aangevraagdOp)}</span>
                  </div>

                  <div className="vergelijk">
                    <div>
                      <span className="l">Staat nu</span>
                      <span className="w">
                        {bestaand
                          ? `${time(bestaand.start)} – ${bestaand.end ? time(bestaand.end) : 'loopt'}`
                          : 'niets op deze dag'}
                      </span>
                    </div>
                    <div>
                      <span className="l">Moet worden</span>
                      <span className="w nieuw">
                        {dateShort(v.van)} · {time(v.van)}
                        {v.tot ? ` – ${time(v.tot)}` : ''}
                      </span>
                    </div>
                  </div>

                  {v.toelichting && <div className="reden">{v.toelichting}</div>}

                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn ok sm"
                      disabled={bezig === v.id}
                      onClick={async () => {
                        setBezig(v.id)
                        try {
                          await urenverzoeken.goedkeuren(v, me)
                          toast.ok(`Uren van ${v.userName} rechtgezet`)
                        } finally { setBezig(null) }
                      }}
                    >
                      {bezig === v.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                      Goedkeuren
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => { setReden(''); setAfwijzen(v) }}
                    >
                      <X size={14} /> Afwijzen
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {afgehandeld.length > 0 && (
        <Card title="Eerder behandeld" hint="De laatste acht" flush className="mt">
          <div className="verzoek-lijst">
            {afgehandeld.map((v) => (
              <div className="verzoek" key={v.id}>
                <div className="kop">
                  <strong>{v.userName}</strong>
                  <Badge tone={HR_STATUS[v.status].tone as never}>
                    {HR_STATUS[v.status].label}
                  </Badge>
                  <span className="meta">{dateShort(v.van)}</span>
                </div>
                <div className="besluit">
                  {v.beslistDoorNaam
                    ? `${v.beslistDoorNaam}, ${dateTime(v.beslistOp ?? 0)}`
                    : 'Ingetrokken door de aanvrager'}
                  {v.beslissingReden ? ` — ${v.beslissingReden}` : ''}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={!!afwijzen}
        title="Verzoek afwijzen"
        subtitle={afwijzen ? `${afwijzen.userName} krijgt dit te lezen` : ''}
        onClose={() => setAfwijzen(null)}
      >
        <Field label="Waarom niet?" help="Kort mag, maar zeg iets.">
          <textarea
            className="textarea"
            rows={3}
            value={reden}
            onChange={(e) => setReden(e.target.value.slice(0, 400))}
            placeholder="Bijv. je stond die dag niet ingeroosterd, even samen naar kijken"
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setAfwijzen(null)}>Annuleren</button>
          <button
            className="btn danger"
            disabled={!reden.trim()}
            onClick={async () => {
              if (!afwijzen) return
              await urenverzoeken.afwijzen(afwijzen, reden, me)
              setAfwijzen(null)
              toast.info('Afgewezen, de melder heeft bericht')
            }}
          >
            <X size={15} /> Afwijzen
          </button>
        </div>
      </Modal>
    </>
  )
}
