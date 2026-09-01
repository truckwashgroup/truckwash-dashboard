import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Car, Check, Clock, Download, Eye, FileText, Loader2, Mail, MapPin, Plus,
  Receipt, Send, Timer, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import { documenten } from '../../lib/dossier'
import {
  adresVan, KM_TARIEF, mijnRitten, ritten as ritRepo, SOORT_LABEL, totaalKm,
  urenverzoeken, vergoeding, zoekAfstand,
} from '../../lib/urenritten'
import { mailBericht } from '../../lib/mail'
import {
  HR_STATUS, TRIP_DOEL,
  type HourRequest, type HourRequestSoort, type Location,
  type PersonnelDocument, type PersonnelPrivate, type TimeEntry, type Trip,
} from '../../lib/types'
import { dateShort, dateTime, duration, money, relative, time } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import Bekijker from '../../components/Bekijker'
import type { Bekijkbaar } from '../../lib/bekijken'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { startOfDay } from '../../lib/analytics'

const DAG = 86_400_000

/* ------------------------------------------------------------------ *
 *  Mijn zaken
 *
 *  Wat een medewerker over zichzelf moet kunnen: zijn loonstroken erbij
 *  pakken, zijn uren nakijken, en zijn kilometers verantwoorden.
 *
 *  Twee dingen zijn hier met opzet niet zelf te doen. Zijn uren wijzigt hij
 *  niet -- hij vraagt erom, en zijn leidinggevende kijkt ernaar. En zijn
 *  kilometers vult hij niet in: die worden over de weg uitgerekend van adres
 *  naar adres. Allebei om dezelfde reden: wat je zelf invult op je eigen
 *  afrekening is geen registratie meer maar een voorstel.
 * ------------------------------------------------------------------ */

type Tab = 'loon' | 'uren' | 'ritten' | 'bonnen'

const TABS: { key: Tab; label: string; icon: typeof Clock }[] = [
  { key: 'loon', label: 'Loonstroken', icon: FileText },
  { key: 'uren', label: 'Mijn uren', icon: Timer },
  { key: 'ritten', label: 'Kilometers', icon: Car },
  { key: 'bonnen', label: 'Bonnen', icon: Receipt },
]

export default function MijnZaken({ bonnen }: { bonnen?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>('loon')

  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.filter((t) => t.key !== 'bonnen' || bonnen).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              className={`btn sm ${tab === t.key ? 'primary' : 'ghost'}`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'loon' && <Loonstroken />}
      {tab === 'uren' && <MijnUren />}
      {tab === 'ritten' && <Kilometers />}
      {tab === 'bonnen' && bonnen}
    </>
  )
}

/* ================================================================== *
 *  Loonstroken
 * ================================================================== */

function Loonstroken() {
  const me = useAuth((s) => s.user)!
  const [kijkt, setKijkt] = useState<number | null>(null)
  const [mailt, setMailt] = useState<string | null>(null)

  const stukken = useLiveQuery(
    async () => (await db.documents.where('userId').equals(me.id).toArray())
      .filter((d) => d.kind === 'loonstrook' && d.visibleToEmployee)
      .sort((a, b) => b.uploadedAt - a.uploadedAt),
    [me.id],
    [] as PersonnelDocument[],
  )

  const teBekijken: Bekijkbaar[] = stukken.map((d) => ({
    naam: d.title,
    mime: d.mime,
    size: d.sizeBytes,
    haal: () => documenten.openen(d),
  }))

  /**
   * De strook naar je eigen postvak sturen.
   *
   * Naar je eigen adres, en nergens anders heen -- de serverfunctie zoekt
   * dat adres zelf op bij je dossier. Een knop waarmee je een loonstrook
   * naar een willekeurig adres kunt sturen is een knop waarmee iemand anders
   * dat ook kan.
   */
  async function stuurNaarMij(doc: PersonnelDocument) {
    setMailt(doc.id)
    try {
      const uit = await mailBericht(me.id, {
        titel: `Je loonstrook: ${doc.title}`,
        tekst:
          `Je vroeg om ${doc.title}. Hij staat klaar in het dashboard onder ` +
          'Mijn zaken → Loonstroken. Om hem te openen moet je inloggen; we ' +
          'sturen loonstroken niet als bijlage mee, want post is geen kluis.',
        van: 'Het kantoor',
      })
      if (!uit || uit.sent === 0) {
        toast.error('Versturen lukte niet — probeer het zo nog eens')
        return
      }
      toast.ok(`Bericht verstuurd naar ${me.email}`)
    } finally {
      setMailt(null)
    }
  }

  return (
    <Card
      title="Loonstroken"
      hint="Je maandelijkse afrekeningen en jaaropgaven"
      flush
    >
      {stukken.length === 0 ? (
        <Empty
          text="Er staan nog geen loonstroken in je dossier."
          icon={<FileText size={30} />}
        />
      ) : (
        <div className="papier-lijst" style={{ margin: 0 }}>
          {stukken.map((d, i) => (
            <div className="papier" key={d.id}>
              <FileText size={16} />
              <span className="n">{d.title}</span>
              <span className="s">{dateShort(d.uploadedAt)}</span>

              <button className="btn ghost sm" onClick={() => setKijkt(i)} title="Bekijken">
                <Eye size={14} />
              </button>
              <button
                className="btn ghost sm"
                disabled={mailt === d.id}
                onClick={() => void stuurNaarMij(d)}
                title={`Een bericht sturen naar ${me.email}`}
              >
                {mailt === d.id ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="signup-note" style={{ margin: '14px 16px 16px' }}>
        <Download size={16} />
        <span>
          Bekijken kan hier; opslaan doe je met de knop in het venster dat
          opengaat. Naar je mail sturen kan ook — dan krijg je een bericht op{' '}
          {me.email} dat er een nieuwe strook klaarstaat. De strook zelf gaat
          niet als bijlage mee: post is geen kluis.
        </span>
      </div>

      <Bekijker
        bestanden={teBekijken}
        index={kijkt}
        onSluiten={() => setKijkt(null)}
        onWissel={setKijkt}
      />
    </Card>
  )
}

/* ================================================================== *
 *  Mijn uren
 * ================================================================== */

function MijnUren() {
  const me = useAuth((s) => s.user)!
  const [vragen, setVragen] = useState(false)

  const entries = useLiveQuery(
    async () => {
      const vanaf = startOfDay(Date.now() - 41 * DAG)
      return (await db.timeEntries.where('userId').equals(me.id).toArray())
        .filter((e) => e.start >= vanaf)
        .sort((a, b) => b.start - a.start)
    },
    [me.id],
    [] as TimeEntry[],
  )

  const verzoeken = useLiveQuery(
    async () => (await db.hourRequests.where('userId').equals(me.id).toArray())
      .sort((a, b) => b.aangevraagdOp - a.aangevraagdOp),
    [me.id],
    [] as HourRequest[],
  )

  const weekVanaf = startOfDay(Date.now() - 6 * DAG)
  const weekMin = entries
    .filter((e) => e.start >= weekVanaf && e.end)
    .reduce((a, e) => a + (e.end! - e.start) / 60000, 0)
  const totaalMin = entries
    .filter((e) => e.end)
    .reduce((a, e) => a + (e.end! - e.start) / 60000, 0)

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat label="Deze week" value={duration(weekMin * 60000)} icon={<Timer size={17} />} />
        <Stat label="Laatste zes weken" value={duration(totaalMin * 60000)} icon={<Timer size={17} />} />
        <Stat
          label="Verzoeken open"
          value={verzoeken.filter((v) => v.status === 'nieuw').length}
          icon={<Clock size={17} />}
          tone={verzoeken.some((v) => v.status === 'nieuw') ? 'warn' : undefined}
        />
      </div>

      <Card
        title="Wat er geregistreerd staat"
        hint="Laatste zes weken"
        flush
        action={
          <button className="btn sm" onClick={() => setVragen(true)}>
            <Plus size={14} /> Klopt er iets niet?
          </button>
        }
      >
        {entries.length === 0 ? (
          <Empty text="Er staan nog geen uren op je naam." icon={<Timer size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Datum</th><th>Van</th><th>Tot</th>
                  <th>Omschrijving</th><th className="num">Duur</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{dateShort(e.start)}</td>
                    <td className="mono">{time(e.start)}</td>
                    <td className="mono">{e.end ? time(e.end) : '—'}</td>
                    <td>{e.note ?? '—'}</td>
                    <td className="num">{e.end ? duration(e.end - e.start) : 'loopt'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {verzoeken.length > 0 && (
        <Card title="Je verzoeken" hint="Wat je hebt gevraagd en wat ermee is gebeurd" flush className="mt">
          <div className="verzoek-lijst">
            {verzoeken.map((v) => (
              <div className="verzoek" key={v.id}>
                <div className="kop">
                  <strong>{SOORT_LABEL[v.soort]}</strong>
                  <Badge tone={HR_STATUS[v.status].tone as never}>
                    {HR_STATUS[v.status].label}
                  </Badge>
                  <span className="meta">{relative(v.aangevraagdOp)}</span>
                </div>
                <div className="wat">
                  {dateShort(v.van)} · {time(v.van)}
                  {v.tot ? ` tot ${time(v.tot)}` : ''}
                </div>
                {v.toelichting && <div className="reden">{v.toelichting}</div>}
                {v.beslistDoorNaam && (
                  <div className="besluit">
                    {v.status === 'goedgekeurd' ? <Check size={13} /> : <X size={13} />}
                    {v.beslistDoorNaam}, {dateTime(v.beslistOp ?? 0)}
                    {v.beslissingReden ? ` — ${v.beslissingReden}` : ''}
                  </div>
                )}
                {v.status === 'nieuw' && (
                  <button
                    className="btn ghost sm"
                    onClick={() => void urenverzoeken.intrekken(v)
                      .then(() => toast.info('Verzoek ingetrokken'))}
                  >
                    Intrekken
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <VerzoekDialoog open={vragen} onClose={() => setVragen(false)} entries={entries} />
    </>
  )
}

function VerzoekDialoog({
  open, onClose, entries,
}: {
  open: boolean
  onClose: () => void
  entries: TimeEntry[]
}) {
  const me = useAuth((s) => s.user)!
  const [soort, setSoort] = useState<HourRequestSoort>('vergeten')
  const [dag, setDag] = useState(() => new Date().toISOString().slice(0, 10))
  const [van, setVan] = useState('08:00')
  const [tot, setTot] = useState('17:00')
  const [entryId, setEntryId] = useState('')
  const [toelichting, setToelichting] = useState('')
  const [bezig, setBezig] = useState(false)

  const opDeDag = useMemo(() => {
    const begin = new Date(dag + 'T00:00').getTime()
    return entries.filter((e) => e.start >= begin && e.start < begin + DAG)
  }, [entries, dag])

  function stempel(tijd: string): number {
    return new Date(`${dag}T${tijd}`).getTime()
  }

  async function versturen() {
    if (toelichting.trim().length < 10) {
      return toast.error('Leg even uit wat er is gebeurd; je leidinggevende moet het kunnen beoordelen')
    }
    const vanMs = stempel(van)
    const totMs = tot ? stempel(tot) : undefined
    if (totMs && totMs <= vanMs) return toast.error('De eindtijd ligt vóór de begintijd')

    setBezig(true)
    try {
      await urenverzoeken.indienen({
        door: me,
        soort,
        van: vanMs,
        tot: totMs,
        entryId: entryId || undefined,
        toelichting,
      })
      toast.ok('Je verzoek staat bij je leidinggevende')
      setToelichting('')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Klopt er iets niet aan je uren?"
      subtitle="Je leidinggevende kijkt ernaar"
      onClose={onClose}
      width={560}
    >
      <div className="signup-note">
        <Clock size={16} />
        <span>
          Je kunt je uren niet zelf aanpassen — dat is met opzet. Wat je hier
          invult is een verzoek: je leidinggevende ziet wat er staat, wat jij
          zegt dat het moet zijn, en beslist. Alles blijft bewaard.
        </span>
      </div>

      <Field label="Wat is er aan de hand?">
        <select
          className="select"
          value={soort}
          onChange={(e) => setSoort(e.target.value as HourRequestSoort)}
        >
          {(Object.keys(SOORT_LABEL) as HourRequestSoort[]).map((k) => (
            <option key={k} value={k}>{SOORT_LABEL[k]}</option>
          ))}
        </select>
      </Field>

      <div className="grid cols-3">
        <Field label="Welke dag">
          <input className="input" type="date" value={dag} onChange={(e) => setDag(e.target.value)} />
        </Field>
        <Field label="Van">
          <input className="input" type="time" value={van} onChange={(e) => setVan(e.target.value)} />
        </Field>
        <Field label="Tot">
          <input className="input" type="time" value={tot} onChange={(e) => setTot(e.target.value)} />
        </Field>
      </div>

      {opDeDag.length > 0 && (
        <Field
          label="Gaat het over een bestaande registratie?"
          help="Laat leeg als er die dag helemaal niets staat."
        >
          <select className="select" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
            <option value="">Er staat niets — deze moet erbij</option>
            {opDeDag.map((e) => (
              <option key={e.id} value={e.id}>
                {time(e.start)} – {e.end ? time(e.end) : 'loopt nog'}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field
        label="Wat is er gebeurd?"
        help="Hoe concreter, hoe sneller het is rechtgezet."
      >
        <textarea
          className="textarea"
          rows={3}
          value={toelichting}
          onChange={(e) => setToelichting(e.target.value.slice(0, 800))}
          placeholder="Bijv. ik was er om 8 uur maar de kassa deed het niet, Nour heeft me binnen zien komen"
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void versturen()} disabled={bezig}>
          {bezig ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Versturen
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Kilometers
 * ================================================================== */

function Kilometers() {
  const me = useAuth((s) => s.user)!
  const [nieuw, setNieuw] = useState(false)

  const alle = useLiveQuery(() => db.trips.toArray(), [], [] as Trip[])
  const mijn = useMemo(
    () => mijnRitten(alle, me.id, startOfDay(Date.now() - 89 * DAG)),
    [alle, me.id],
  )

  const dezeMaand = mijn.filter((r) => r.op >= startOfDay(Date.now() - 29 * DAG))

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat label="Kilometers (30d)" value={`${totaalKm(dezeMaand)} km`} icon={<Car size={17} />} />
        <Stat
          label="Vergoeding (30d)"
          value={money(vergoeding(dezeMaand, KM_TARIEF))}
          delta={{ text: `${money(KM_TARIEF)} per km`, dir: 'flat' }}
          icon={<Receipt size={17} />}
          tone="ok"
        />
        <Stat
          label="Nog te beoordelen"
          value={mijn.filter((r) => r.status === 'nieuw').length}
          icon={<Clock size={17} />}
        />
      </div>

      <Card
        title="Je ritten"
        hint="Laatste drie maanden"
        flush
        action={
          <button className="btn primary sm" onClick={() => setNieuw(true)}>
            <Plus size={14} /> Rit toevoegen
          </button>
        }
      >
        {mijn.length === 0 ? (
          <Empty text="Je hebt nog geen ritten ingevoerd." icon={<Car size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Datum</th><th>Van</th><th>Naar</th><th>Waarvoor</th>
                  <th className="num">Km</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {mijn.map((r) => (
                  <tr key={r.id}>
                    <td>{dateShort(r.op)}</td>
                    <td>{r.vanLabel}</td>
                    <td>{r.naarLabel}</td>
                    <td>
                      {TRIP_DOEL[r.doel].label}
                      {r.retour && <span style={{ color: 'var(--text-3)' }}> · retour</span>}
                    </td>
                    <td className="num">{Math.round(r.km * (r.retour ? 2 : 1) * 10) / 10}</td>
                    <td>
                      <Badge tone={(r.status === 'goedgekeurd' ? 'ok'
                        : r.status === 'afgewezen' ? 'danger' : 'warn') as never}>
                        {r.status}
                      </Badge>
                    </td>
                    <td>
                      {r.status === 'nieuw' && (
                        <button
                          className="btn ghost sm"
                          onClick={() => void ritRepo.verwijderen(r.id)}
                          title="Weghalen"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RitDialoog open={nieuw} onClose={() => setNieuw(false)} />
    </>
  )
}

function RitDialoog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAuth((s) => s.user)!
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const prive = useLiveQuery(() => db.personnelPrivate.get(me.id), [me.id], undefined as PersonnelPrivate | undefined)

  const [dag, setDag] = useState(() => new Date().toISOString().slice(0, 10))
  const [doel, setDoel] = useState<'woon-werk' | 'klant' | 'vestiging' | 'anders'>('woon-werk')
  const [vanKeuze, setVanKeuze] = useState('thuis')
  const [naarKeuze, setNaarKeuze] = useState(me.locationId ?? '')
  const [vrijAdres, setVrijAdres] = useState('')
  const [retour, setRetour] = useState(true)
  const [toelichting, setToelichting] = useState('')

  const [bezig, setBezig] = useState(false)
  const [gevonden, setGevonden] = useState<{ km: number; van: string; naar: string } | null>(null)

  // Zelfde vorm als een vestigingsadres: straat, dan postcode en plaats.
  const thuisAdres = [
    (prive?.address ?? '').trim(),
    [prive?.postcode, prive?.city].map((d) => (d ?? '').trim()).filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')

  function adresVoor(keuze: string): { label: string; adres: string } {
    if (keuze === 'thuis') return { label: 'Thuis', adres: thuisAdres }
    if (keuze === 'vrij') return { label: vrijAdres.trim(), adres: vrijAdres.trim() }
    const loc = locaties.find((l) => l.id === keuze)
    return { label: loc?.name ?? '', adres: adresVan(loc) }
  }

  const van = adresVoor(vanKeuze)
  const naar = adresVoor(naarKeuze)
  const kanZoeken = !!van.adres && !!naar.adres && van.adres !== naar.adres

  async function bereken() {
    setBezig(true)
    setGevonden(null)
    try {
      const uit = await zoekAfstand(van.adres, naar.adres)
      if (!uit.ok || uit.km === undefined) {
        return toast.error(uit.reden ?? 'De afstand kon niet worden opgezocht')
      }
      setGevonden({ km: uit.km, van: uit.van ?? van.adres, naar: uit.naar ?? naar.adres })
    } finally {
      setBezig(false)
    }
  }

  async function bewaar() {
    if (!gevonden) return
    setBezig(true)
    try {
      await ritRepo.toevoegen({
        door: me,
        op: new Date(dag + 'T12:00').getTime(),
        vanLabel: van.label,
        naarLabel: naar.label,
        vanAdres: gevonden.van,
        naarAdres: gevonden.naar,
        km: gevonden.km,
        retour,
        doel,
        toelichting,
      })
      toast.ok(`Rit van ${gevonden.km} km vastgelegd`)
      setGevonden(null)
      setToelichting('')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Rit toevoegen"
      subtitle="De afstand wordt over de weg uitgerekend"
      onClose={onClose}
      width={560}
    >
      {!thuisAdres && (
        <div className="waarschuwing zacht mb">
          <MapPin size={17} />
          <span>
            Je woonadres staat nog niet in je dossier, dus woon-werkverkeer
            kan de app niet uitrekenen. Vraag het kantoor om het toe te voegen.
          </span>
        </div>
      )}

      <div className="grid cols-2">
        <Field label="Welke dag">
          <input className="input" type="date" value={dag} onChange={(e) => setDag(e.target.value)} />
        </Field>
        <Field label="Waarvoor">
          <select
            className="select"
            value={doel}
            onChange={(e) => setDoel(e.target.value as typeof doel)}
          >
            {(Object.keys(TRIP_DOEL) as (keyof typeof TRIP_DOEL)[]).map((k) => (
              <option key={k} value={k}>{TRIP_DOEL[k].label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="Vanaf">
          <select
            className="select"
            value={vanKeuze}
            onChange={(e) => { setVanKeuze(e.target.value); setGevonden(null) }}
          >
            <option value="thuis" disabled={!thuisAdres}>Thuis</option>
            {locaties.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="vrij">Een ander adres…</option>
          </select>
        </Field>
        <Field label="Naar">
          <select
            className="select"
            value={naarKeuze}
            onChange={(e) => { setNaarKeuze(e.target.value); setGevonden(null) }}
          >
            <option value="thuis" disabled={!thuisAdres}>Thuis</option>
            {locaties.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="vrij">Een ander adres…</option>
          </select>
        </Field>
      </div>

      {(vanKeuze === 'vrij' || naarKeuze === 'vrij') && (
        <Field label="Het andere adres" help="Straat, huisnummer, postcode en plaats.">
          <input
            className="input"
            value={vrijAdres}
            onChange={(e) => { setVrijAdres(e.target.value); setGevonden(null) }}
            placeholder="Bijv. Handelsweg 14, 3542 AB Utrecht"
          />
        </Field>
      )}

      <label className="row" style={{ gap: 8, margin: '4px 0 14px', cursor: 'pointer' }}>
        <input type="checkbox" checked={retour} onChange={(e) => setRetour(e.target.checked)} />
        <span style={{ fontSize: '.87rem' }}>Heen en terug</span>
      </label>

      {gevonden ? (
        <div className="rit-uitkomst">
          <Car size={20} />
          <div>
            <strong>
              {gevonden.km} km enkele reis
              {retour && ` · ${Math.round(gevonden.km * 2 * 10) / 10} km heen en terug`}
            </strong>
            <span>{gevonden.van} → {gevonden.naar}</span>
          </div>
        </div>
      ) : (
        <button
          className="btn block"
          disabled={!kanZoeken || bezig}
          onClick={() => void bereken()}
        >
          {bezig ? <Loader2 size={15} className="spin" /> : <MapPin size={15} />}
          Afstand opzoeken
        </button>
      )}

      <Field label="Toelichting (optioneel)">
        <input
          className="input"
          value={toelichting}
          onChange={(e) => setToelichting(e.target.value.slice(0, 300))}
          placeholder="Bijv. ingesprongen in Almere"
        />
      </Field>

      <div className="signup-note">
        <Car size={16} />
        <span>
          Je kunt geen kilometers zelf invullen — de afstand komt van de
          routedienst, over de weg. Dat is niet omdat je niet te vertrouwen
          bent, maar omdat een vergoeding waarbij iedereen zijn eigen getal
          invult voor niemand meer na te rekenen is.
        </span>
      </div>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void bewaar()} disabled={!gevonden || bezig}>
          <Check size={15} /> Vastleggen
        </button>
      </div>
    </Modal>
  )
}
