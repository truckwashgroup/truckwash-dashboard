import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Check, ClipboardCopy, FileText, Loader2, PackageCheck, Sparkles,
  ThumbsDown, Wand2, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import {
  omvangVan, opdrachtTekst, plannen as planRepo, gesprekUit,
} from '../../lib/devplan'
import {
  PLAN_OMVANG, PLAN_RISICO, PLAN_STATUS, TICKET_KINDS,
  type DevPlan, type Ticket, type TicketMessage,
} from '../../lib/types'
import { dateTime, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
import { useUpdates } from '../../lib/updates'

/* ------------------------------------------------------------------ *
 *  Plannen
 *
 *  Hier staat wat er uit een melding is gekomen, en hier wordt besloten wat
 *  ervan gebouwd wordt. Per stap een vinkje.
 *
 *  Waarom vinkjes en geen ja/nee op het geheel: een wens is zelden één ding.
 *  "Kan de postbus ook bijlagen tonen en meteen doorsturen naar Exact" zijn
 *  twee besluiten, en het eerste kan best doorgaan terwijl het tweede wacht.
 *  Zonder die knip wordt het één keer ja of één keer nee, en dat is allebei
 *  te grof.
 *
 *  Wat er uitgaat is geen half werk maar een besluit. Daarom krijgt de melder
 *  ook te horen wat er níét gebeurt -- anders wacht hij op iets wat nooit komt.
 * ------------------------------------------------------------------ */

export default function Plannen() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'alles'>('open')

  const alle = useLiveQuery(() => db.devPlans.toArray(), [], [] as DevPlan[])
  const meldingen = useLiveQuery(() => db.tickets.toArray(), [], [] as Ticket[])

  const zichtbaar = useMemo(() => {
    const lijst = filter === 'open'
      ? alle.filter((p) => p.status === 'concept' || p.status === 'ter beoordeling')
      : alle
    return [...lijst].sort((a, b) => b.gemaaktOp - a.gemaaktOp)
  }, [alle, filter])

  const wacht = alle.filter((p) => p.status === 'ter beoordeling').length
  const akkoord = alle.filter((p) => p.status === 'goedgekeurd').length

  const gekozen = open ? alle.find((p) => p.id === open) : undefined
  if (gekozen) {
    return (
      <PlanDetail
        plan={gekozen}
        ticket={meldingen.find((t) => t.id === gekozen.ticketId)}
        door={me}
        magBeslissen={perms.can('dev.approve')}
        onTerug={() => setOpen(null)}
      />
    )
  }

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat label="Wacht op akkoord" value={wacht} icon={<FileText size={17} />}
          tone={wacht ? 'warn' : undefined} />
        <Stat label="Goedgekeurd" value={akkoord} icon={<Check size={17} />} tone="ok" />
        <Stat label="Uitgevoerd" value={alle.filter((p) => p.status === 'uitgevoerd').length}
          icon={<PackageCheck size={17} />} />
      </div>

      <Card
        title="Plannen"
        hint="Uit een melding gedestilleerd, klaar om er vinkjes bij te zetten"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            {(['open', 'alles'] as const).map((k) => (
              <button
                key={k}
                className={`btn sm ${filter === k ? 'primary' : 'ghost'}`}
                onClick={() => setFilter(k)}
              >
                {k === 'open' ? 'Nog te doen' : 'Alles'}
              </button>
            ))}
          </div>
        }
      >
        {zichtbaar.length === 0 ? (
          <Empty
            text={filter === 'open'
              ? 'Geen plannen die op je wachten.'
              : 'Er zijn nog geen plannen gemaakt.'}
            icon={<FileText size={30} />}
          />
        ) : (
          <div className="plan-lijst">
            {zichtbaar.map((p) => {
              const status = PLAN_STATUS[p.status]
              const omvang = omvangVan(p)
              return (
                <button key={p.id} className="plan-regel" onClick={() => setOpen(p.id)}>
                  <div className="kop">
                    <strong>{p.titel}</strong>
                    <Badge tone={status.tone as never}>{status.label}</Badge>
                    {p.bron === 'gesprek' && (
                      <Badge tone="info"><Sparkles size={11} /> uit een gesprek</Badge>
                    )}
                  </div>
                  <div className="meta">
                    {p.ticketNumber} · {omvang.stappen} van {p.stappen.length} stappen aan ·
                    {' '}{PLAN_OMVANG[omvang.zwaarte].label.toLowerCase()} werk ·
                    {' '}{relative(p.gemaaktOp)}
                    {p.uitgevoerdIn && ` · uitgeleverd in ${p.uitgevoerdIn}`}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}

/* ================================================================== *
 *  Eén plan
 * ================================================================== */

function PlanDetail({
  plan, ticket, door, magBeslissen, onTerug,
}: {
  plan: DevPlan
  ticket?: Ticket
  door: { id: string; name: string }
  magBeslissen: boolean
  onTerug: () => void
}) {
  const [bezig, setBezig] = useState(false)
  const [afwijzen, setAfwijzen] = useState(false)
  const [reden, setReden] = useState('')
  const [opmerking, setOpmerking] = useState('')
  const [uitgeleverd, setUitgeleverd] = useState(false)
  const huidig = useUpdates((s) => s.version)
  const [versie, setVersie] = useState(huidig)

  const berichten = useLiveQuery(
    () => db.ticketMessages.where('ticketId').equals(plan.ticketId).toArray(),
    [plan.ticketId],
    [] as TicketMessage[],
  )
  const gesprek = useMemo(() => gesprekUit(berichten, plan.ticketId), [berichten, plan.ticketId])

  const gekozen = plan.stappen.filter((s) => s.gekozen)
  const beslist = plan.status === 'goedgekeurd' || plan.status === 'afgewezen'
    || plan.status === 'uitgevoerd'
  const vast = plan.status === 'uitgevoerd'

  async function kopieer() {
    try {
      await navigator.clipboard.writeText(opdrachtTekst(plan, ticket))
      toast.ok('De opdracht staat op je klembord')
    } catch {
      toast.error('Kopiëren lukte niet — je browser wil het niet')
    }
  }

  return (
    <>
      <button className="btn ghost sm" onClick={onTerug} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar de plannen
      </button>

      <Card>
        <div className="plan-kop">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{plan.titel}</h2>
            <div className="meta">
              {plan.ticketNumber}
              {ticket && ` · ${TICKET_KINDS[ticket.kind].label.toLowerCase()} van ${ticket.reportedByName}`}
              {' · '}opgesteld {relative(plan.gemaaktOp)}
              {plan.bron === 'gesprek' ? ' na een gesprek' : ' uit de vaste vragen'}
            </div>
          </div>
          <Badge tone={PLAN_STATUS[plan.status].tone as never}>
            {PLAN_STATUS[plan.status].label}
          </Badge>
        </div>

        <div className="plan-aanleiding">{plan.aanleiding}</div>

        {plan.beoordeeldDoorNaam && (
          <div className="plan-besluit">
            {plan.status === 'afgewezen' ? <X size={15} /> : <Check size={15} />}
            <span>
              {PLAN_STATUS[plan.status].label} door {plan.beoordeeldDoorNaam},{' '}
              {dateTime(plan.beoordeeldOp ?? 0)}
              {plan.opmerking && <> — {plan.opmerking}</>}
            </span>
          </div>
        )}
      </Card>

      <Card
        title="De stappen"
        hint={beslist
          ? `${gekozen.length} van de ${plan.stappen.length} gaan gebouwd worden`
          : 'Zet uit wat je niet wilt. Wat aan blijft staan, wordt gebouwd.'}
        className="mt"
        flush
      >
        <div className="stap-lijst">
          {plan.stappen.map((s, i) => (
            <div key={s.id} className={`stap ${s.gekozen ? '' : 'uit'}`}>
              <label className="vink">
                <input
                  type="checkbox"
                  checked={s.gekozen}
                  disabled={beslist || !magBeslissen}
                  onChange={(e) => void planRepo.zetStap(plan.id, s.id, e.target.checked)}
                />
              </label>

              <div className="tekst">
                <div className="kop">
                  <strong>{i + 1}. {s.titel}</strong>
                  <Badge tone={PLAN_RISICO[s.risico].tone as never}>
                    {PLAN_RISICO[s.risico].label}
                  </Badge>
                  <Badge>{PLAN_OMVANG[s.omvang].label}</Badge>
                  {s.raakt && <span className="raakt">{s.raakt}</span>}
                </div>

                <p className="wat">{s.wat}</p>
                {s.waarom && <p className="waarom">Waarom: {s.waarom}</p>}

                {!beslist && magBeslissen && (
                  <input
                    className="input sm"
                    placeholder={s.gekozen
                      ? 'Aantekening bij deze stap (gaat mee in de opdracht)'
                      : 'Waarom niet? Dit hoort de melder te lezen'}
                    defaultValue={s.opmerking ?? ''}
                    onBlur={(e) => void planRepo.zetStapOpmerking(plan.id, s.id, e.target.value)}
                  />
                )}
                {beslist && s.opmerking && (
                  <p className="opmerking">{s.opmerking}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {plan.buitenScope && (
        <Card title="Buiten bereik" hint="Wel gezien, bewust niet ingepland" className="mt">
          <p style={{ fontSize: '.87rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
            {plan.buitenScope}
          </p>
        </Card>
      )}

      {gesprek.length > 0 && (
        <Card title="Het gesprek met de melder" className="mt" flush>
          <div className="gesprek-terug">
            {gesprek.map((b, i) => (
              <div className="beurt" key={i}>
                <div className="v">{b.vraag}</div>
                <div className="a">{b.antwoord}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ------------------------- de knoppen ------------------------ */}

      <Card className="mt">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => void kopieer()}>
            <ClipboardCopy size={14} /> Kopieer opdracht
          </button>

          <span style={{ flex: 1 }} />

          {plan.status === 'concept' && (
            <button
              className="btn primary sm"
              disabled={bezig}
              onClick={async () => {
                setBezig(true)
                try {
                  await planRepo.indienen(plan)
                  toast.ok('Klaargezet om te beoordelen')
                } finally { setBezig(false) }
              }}
            >
              <Wand2 size={14} /> Klaarzetten om te beoordelen
            </button>
          )}

          {plan.status === 'ter beoordeling' && magBeslissen && (
            <>
              <button className="btn danger sm" onClick={() => setAfwijzen(true)}>
                <ThumbsDown size={14} /> Afwijzen
              </button>
              <button
                className="btn primary sm"
                disabled={bezig || gekozen.length === 0}
                onClick={async () => {
                  setBezig(true)
                  try {
                    await planRepo.goedkeuren(plan, door, opmerking)
                    toast.ok(`Akkoord — ${gekozen.length} stappen gaan gebouwd worden`)
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Goedkeuren lukte niet')
                  } finally { setBezig(false) }
                }}
              >
                {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                Akkoord met {gekozen.length} {gekozen.length === 1 ? 'stap' : 'stappen'}
              </button>
            </>
          )}

          {plan.status === 'goedgekeurd' && (
            <button className="btn ok sm" onClick={() => setUitgeleverd(true)}>
              <PackageCheck size={14} /> Uitgeleverd in een versie
            </button>
          )}
        </div>

        {plan.status === 'ter beoordeling' && magBeslissen && (
          <Field
            label="Aantekening bij je akkoord"
            help="Gaat mee in de opdracht en in het bericht aan de melder"
          >
            <textarea
              className="textarea"
              rows={2}
              value={opmerking}
              onChange={(e) => setOpmerking(e.target.value.slice(0, 1000))}
              placeholder="Bijv. graag eerst op één vestiging proberen"
            />
          </Field>
        )}

        {gekozen.length === 0 && plan.status === 'ter beoordeling' && (
          <div className="signup-note" style={{ marginTop: 12, marginBottom: 0 }}>
            <X size={16} />
            <span>
              Er staat geen enkele stap aan. Wil je niets van dit plan, wijs
              het dan af met een reden — dan weet de melder waar hij aan toe is.
            </span>
          </div>
        )}

        {vast && (
          <div className="signup-note" style={{ marginTop: 12, marginBottom: 0 }}>
            <PackageCheck size={16} />
            <span>
              Dit plan is uitgevoerd in versie {plan.uitgevoerdIn} en staat
              daarmee vast. Wat er nu anders moet, wordt een nieuwe melding.
            </span>
          </div>
        )}
      </Card>

      {/* ------------------------- afwijzen -------------------------- */}

      <Modal
        open={afwijzen}
        title="Plan afwijzen"
        subtitle="De melder krijgt dit te lezen"
        onClose={() => setAfwijzen(false)}
      >
        <Field label="Waarom doen we dit niet?" help="Kort mag, maar zeg iets.">
          <textarea
            className="textarea"
            rows={4}
            value={reden}
            onChange={(e) => setReden(e.target.value.slice(0, 1000))}
            placeholder="Bijv. dit kan al via Beheer → Vestigingen, ik loop het even met je door"
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setAfwijzen(false)}>Annuleren</button>
          <button
            className="btn danger"
            disabled={!reden.trim()}
            onClick={async () => {
              await planRepo.afwijzen(plan, reden, door)
              setAfwijzen(false)
              toast.info('Afgewezen, de melder heeft bericht')
            }}
          >
            <ThumbsDown size={15} /> Afwijzen
          </button>
        </div>
      </Modal>

      {/* ------------------------ uitgeleverd ------------------------ */}

      <Modal
        open={uitgeleverd}
        title="Uitgeleverd"
        subtitle="In welke versie zit het?"
        onClose={() => setUitgeleverd(false)}
      >
        <Field label="Versie">
          <input
            className="input mono"
            value={versie}
            onChange={(e) => setVersie(e.target.value.slice(0, 20))}
          />
        </Field>
        <div className="signup-note">
          <PackageCheck size={16} />
          <span>
            De melding gaat op opgelost en de melder krijgt bericht met het
            versienummer erbij. Daarna staat dit plan vast.
          </span>
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={() => setUitgeleverd(false)}>Annuleren</button>
          <button
            className="btn ok"
            disabled={!versie.trim()}
            onClick={async () => {
              await planRepo.uitgevoerd(plan, versie, door)
              setUitgeleverd(false)
              toast.ok(`Vastgelegd als uitgeleverd in ${versie}`)
            }}
          >
            <PackageCheck size={15} /> Vastleggen
          </button>
        </div>
      </Modal>
    </>
  )
}
