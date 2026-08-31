import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Cake, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock,
  FileText, GraduationCap, MapPin, PartyPopper, Trash2, UserMinus, UserPlus,
  Users, Wrench,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  agenda as agendaRepo, beginVanDag, gebeurtenissen, perDag, SOORT_LABELS,
  type Gebeurtenis,
} from '../lib/agenda'
import {
  AGENDA_SOORTEN,
  type AgendaItem, type AgendaSoort, type Location, type MaintenancePlan,
  type PersonnelDocument, type PersonnelPrivate, type Shift, type User,
} from '../lib/types'
import { initials, time } from '../lib/format'
import { dateInputValue, dayFromDateInput } from '../lib/roster'
import { Badge, Card, Empty, Field, Modal } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { useLocationFilter } from '../lib/locations'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Agenda
 *
 *  Een maand in beeld, met daarnaast wat er die dag speelt. Er staan twee
 *  soorten dingen in: afspraken die iemand er zelf in zet, en wat al uit de
 *  gegevens volgt -- verjaardagen, jubilea, aflopende contracten, diensten,
 *  onderhoudsbeurten.
 *
 *  Dat tweede wordt berekend, niet bewaard. Een geboortedatum die wordt
 *  gecorrigeerd geeft meteen de juiste verjaardag.
 * ------------------------------------------------------------------ */

const DAG = 86_400_000
const DAGNAMEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

const ICOON: Record<string, typeof CalendarDays> = {
  afspraak: CalendarDays,
  verlof: MapPin,
  opleiding: GraduationCap,
  onderhoud: Wrench,
  overig: CalendarDays,
  verjaardag: Cake,
  jubileum: PartyPopper,
  indienst: UserPlus,
  uitdienst: UserMinus,
  dienst: Clock,
  contract: FileText,
  document: FileText,
  onderhoudsbeurt: Wrench,
}

/** De maandag van de week waarin deze dag valt. */
function maandagVan(ts: number): number {
  const d = new Date(beginVanDag(ts))
  const dag = (d.getDay() + 6) % 7
  return d.getTime() - dag * DAG
}

export default function Agenda() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const huidigeLocatie = useLocationFilter((s) => s.current)

  const [maand, setMaand] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  })
  const [gekozen, setGekozen] = useState(() => beginVanDag(Date.now()))
  const [nieuw, setNieuw] = useState(false)
  const [alleDiensten, setAlleDiensten] = useState(false)

  const items = useLiveQuery(() => db.agendaItems.toArray(), [], [] as AgendaItem[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const prive = useLiveQuery(() => db.personnelPrivate.toArray(), [], [] as PersonnelPrivate[])
  const shifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[])
  const documenten = useLiveQuery(() => db.documents.toArray(), [], [] as PersonnelDocument[])
  const onderhoud = useLiveQuery(() => db.maintenancePlans.toArray(), [], [] as MaintenancePlan[])
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  /* Het raster loopt van de maandag vóór de eerste tot de zondag ná de
     laatste; anders staat er een halve week leeg in beeld. */
  const rasterVan = useMemo(() => maandagVan(maand), [maand])
  const rasterTot = useMemo(() => {
    const eind = new Date(maand)
    eind.setMonth(eind.getMonth() + 1)
    return maandagVan(eind.getTime() - 1) + 7 * DAG
  }, [maand])

  const alles = useMemo(
    () => gebeurtenissen({
      van: rasterVan,
      tot: rasterTot,
      ik: me,
      items, mensen, prive, shifts, documenten, onderhoud,
      alleDiensten,
    }),
    [rasterVan, rasterTot, me, items, mensen, prive, shifts, documenten, onderhoud, alleDiensten],
  )

  const zichtbaar = useMemo(
    () => huidigeLocatie
      ? alles.filter((g) => !g.locationId || g.locationId === huidigeLocatie)
      : alles,
    [alles, huidigeLocatie],
  )

  const kaart = useMemo(() => perDag(zichtbaar), [zichtbaar])
  const vandaag = beginVanDag(Date.now())
  const opDeze = kaart.get(gekozen) ?? []

  const dagen = useMemo(() => {
    const uit: number[] = []
    for (let d = rasterVan; d < rasterTot; d += DAG) uit.push(d)
    return uit
  }, [rasterVan, rasterTot])

  if (!perms.can('agenda.view')) {
    return <Empty text="Je hebt geen toegang tot de agenda." icon={<CalendarDays size={30} />} />
  }

  const maandNaam = new Date(maand).toLocaleDateString('nl-NL', {
    month: 'long', year: 'numeric',
  })

  function schuif(richting: number) {
    const d = new Date(maand)
    d.setMonth(d.getMonth() + richting)
    setMaand(d.getTime())
  }

  return (
    <>
      <div className="grid sidebar-right">
        <Card
          title={maandNaam.charAt(0).toUpperCase() + maandNaam.slice(1)}
          flush
          action={
            <div className="row" style={{ gap: 5 }}>
              <button
                className={`btn sm ${alleDiensten ? 'primary' : 'ghost'}`}
                onClick={() => setAlleDiensten((v) => !v)}
                title="Ook de diensten van collega's tonen"
              >
                <Users size={14} /> <span className="hide-mobile">Iedereen</span>
              </button>
              <button className="btn ghost sm" onClick={() => schuif(-1)} aria-label="Vorige maand">
                <ChevronLeft size={15} />
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  const d = new Date()
                  setMaand(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
                  setGekozen(beginVanDag(Date.now()))
                }}
              >
                Vandaag
              </button>
              <button className="btn ghost sm" onClick={() => schuif(1)} aria-label="Volgende maand">
                <ChevronRight size={15} />
              </button>
            </div>
          }
        >
          <div className="agenda-raster">
            {DAGNAMEN.map((d) => (
              <div key={d} className="dagnaam">{d}</div>
            ))}

            {dagen.map((dag) => {
              const opDag = kaart.get(dag) ?? []
              const buitenMaand = new Date(dag).getMonth() !== new Date(maand).getMonth()
              return (
                <button
                  key={dag}
                  className={[
                    'agenda-dag',
                    buitenMaand ? 'buiten' : '',
                    dag === vandaag ? 'vandaag' : '',
                    dag === gekozen ? 'gekozen' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setGekozen(dag)}
                >
                  <span className="nummer">{new Date(dag).getDate()}</span>
                  <span className="stipjes">
                    {opDag.slice(0, 4).map((g) => (
                      <span key={g.id} className={`stip t-${SOORT_LABELS[g.soort].tint}`} />
                    ))}
                    {opDag.length > 4 && <span className="meer">+{opDag.length - 4}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>

        <Card
          title={new Date(gekozen).toLocaleDateString('nl-NL', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
          hint={opDeze.length === 0 ? 'Niets gepland' : `${opDeze.length} dingen`}
          flush
          action={
            perms.can('agenda.edit') ? (
              <button className="btn primary sm" onClick={() => setNieuw(true)}>
                <CalendarPlus size={14} /> Toevoegen
              </button>
            ) : undefined
          }
        >
          {opDeze.length === 0 ? (
            <Empty text="Er staat niets op deze dag." icon={<CalendarDays size={30} />} />
          ) : (
            <div className="agenda-dagvulling">
              {opDeze.map((g) => (
                <GebeurtenisRegel
                  key={g.id}
                  g={g}
                  locaties={locaties}
                  magWissen={perms.can('agenda.edit') && !!g.item}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <NieuweAfspraak
        open={nieuw}
        dag={gekozen}
        onClose={() => setNieuw(false)}
        door={me}
        mensen={mensen}
        locaties={locaties}
      />
    </>
  )
}

/* ================================================================== *
 *  Eén gebeurtenis
 * ================================================================== */

function GebeurtenisRegel({
  g, locaties, magWissen,
}: {
  g: Gebeurtenis
  locaties: Location[]
  magWissen: boolean
}) {
  const Icon = ICOON[g.soort] ?? CalendarDays
  const meta = SOORT_LABELS[g.soort]
  const plek = locaties.find((l) => l.id === g.locationId)

  async function wissen() {
    if (!g.item) return
    if (!confirm(`"${g.titel}" uit de agenda halen?`)) return
    await agendaRepo.remove(g.item.id)
    toast.info('Uit de agenda gehaald')
  }

  return (
    <div className={`agenda-regel t-${meta.tint}`}>
      <span className="ico"><Icon size={16} /></span>

      <span className="tekst">
        <span className="kop">
          <strong>{g.titel}</strong>
          <Badge>{meta.label}</Badge>
        </span>
        <span className="wanneer">
          {g.heleDag
            ? 'Hele dag'
            : `${time(g.startAt!)} – ${time(g.endAt!)}`}
          {plek && ` · ${plek.name}`}
        </span>
        {g.toelichting && <span className="toelichting">{g.toelichting}</span>}
        {g.item && g.item.deelnemers.length > 0 && (
          <span className="deelnemers">
            {g.item.deelnemers.length} {g.item.deelnemers.length === 1 ? 'deelnemer' : 'deelnemers'}
          </span>
        )}
      </span>

      {magWissen && (
        <button className="btn ghost sm" onClick={() => void wissen()} title="Weghalen">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

/* ================================================================== *
 *  Een afspraak toevoegen
 * ================================================================== */

function NieuweAfspraak({
  open, dag, onClose, door, mensen, locaties,
}: {
  open: boolean
  dag: number
  onClose: () => void
  door: User
  mensen: User[]
  locaties: Location[]
}) {
  const [titel, setTitel] = useState('')
  const [soort, setSoort] = useState<AgendaSoort>('afspraak')
  const [omschrijving, setOmschrijving] = useState('')
  const [datum, setDatum] = useState(dateInputValue(dag))
  const [heleDag, setHeleDag] = useState(false)
  const [van, setVan] = useState('09:00')
  const [tot, setTot] = useState('10:00')
  const [locatie, setLocatie] = useState('')
  const [deelnemers, setDeelnemers] = useState<string[]>([])
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    if (open) setDatum(dateInputValue(dag))
  }, [open, dag])

  const kandidaten = useMemo(
    () => mensen
      .filter((u) => u.active && !u.roles.includes('customer'))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [mensen],
  )

  async function opslaan() {
    if (titel.trim().length < 3) return toast.error('Geef de afspraak een naam')

    const basis = dayFromDateInput(datum)
    const [vanU, vanM] = van.split(':').map(Number)
    const [totU, totM] = tot.split(':').map(Number)

    const startAt = heleDag ? basis : basis + vanU * 3_600_000 + vanM * 60_000
    const endAt = heleDag ? basis + DAG - 1 : basis + totU * 3_600_000 + totM * 60_000

    if (endAt <= startAt) return toast.error('De eindtijd ligt vóór de begintijd')

    setBezig(true)
    try {
      await agendaRepo.create({
        title: titel,
        description: omschrijving,
        soort,
        startAt,
        endAt,
        heleDag,
        locationId: locatie || undefined,
        deelnemers,
        door,
      })
      toast.ok(deelnemers.length > 0
        ? `${titel} staat erin — ${deelnemers.length} ${deelnemers.length === 1 ? 'deelnemer krijgt' : 'deelnemers krijgen'} bericht`
        : `${titel} staat in de agenda`)
      setTitel(''); setOmschrijving(''); setDeelnemers([])
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Afspraak toevoegen"
      subtitle="Verjaardagen en jubilea hoef je niet in te voeren; die staan er al"
      onClose={onClose}
      width={600}
    >
      <Field label="Wat is het?">
        <div className="kind-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {(Object.keys(AGENDA_SOORTEN) as AgendaSoort[]).map((k) => {
            const Icon = ICOON[k] ?? CalendarDays
            return (
              <button
                key={k}
                type="button"
                className={`kind ${soort === k ? 'on' : ''}`}
                onClick={() => setSoort(k)}
              >
                <Icon size={17} />
                <strong>{AGENDA_SOORTEN[k].label}</strong>
                <span>{AGENDA_SOORTEN[k].hint}</span>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Naam">
        <input
          className="input" value={titel} autoFocus
          onChange={(e) => setTitel(e.target.value)}
          placeholder="Bijv. Keuring hogedrukinstallatie"
        />
      </Field>

      <div className="grid cols-3">
        <Field label="Datum">
          <input
            className="input" type="date" value={datum}
            onChange={(e) => setDatum(e.target.value)}
          />
        </Field>
        <Field label="Van">
          <input
            className="input" type="time" value={van} disabled={heleDag}
            onChange={(e) => setVan(e.target.value)}
          />
        </Field>
        <Field label="Tot">
          <input
            className="input" type="time" value={tot} disabled={heleDag}
            onChange={(e) => setTot(e.target.value)}
          />
        </Field>
      </div>

      <button
        type="button"
        className={`stop-toggle ${heleDag ? 'on' : ''}`}
        onClick={() => setHeleDag((v) => !v)}
      >
        <CalendarDays size={17} />
        <span>
          <strong>Hele dag</strong>
          <span>Voor iets zonder begin- en eindtijd, zoals een vrije dag.</span>
        </span>
      </button>

      <Field label="Vestiging (optioneel)" help="Laat leeg als het niet aan een plek hangt.">
        <select className="select" value={locatie} onChange={(e) => setLocatie(e.target.value)}>
          <option value="">Geen vestiging</option>
          {locaties.filter((l) => l.active).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Toelichting (optioneel)">
        <textarea
          className="textarea" style={{ minHeight: 64 }}
          value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)}
        />
      </Field>

      <Field
        label="Wie moeten erbij zijn"
        help="Zij krijgen bericht en een mail; laat leeg als het alleen voor jou is."
      >
        <div className="recipient-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {kandidaten.map((u) => {
            const aan = deelnemers.includes(u.id)
            return (
              <button
                key={u.id}
                type="button"
                className={`recipient ${aan ? 'on' : ''}`}
                onClick={() => setDeelnemers(aan
                  ? deelnemers.filter((id) => id !== u.id)
                  : [...deelnemers, u.id])}
              >
                <span className="av">{initials(u.name)}</span>
                <span className="who">
                  <span className="n">{u.name}</span>
                  <span className="f">{u.function ?? u.roles.join(', ')}</span>
                </span>
                {aan && <Badge tone="brand">Erbij</Badge>}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button className="btn primary" onClick={() => void opslaan()} disabled={bezig}>
          <CalendarPlus size={15} /> Toevoegen
        </button>
      </div>
    </Modal>
  )
}
