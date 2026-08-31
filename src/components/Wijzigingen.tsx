import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowRight, Check, ClipboardCheck, Clock, PenLine, ThumbsDown, Undo2, X,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  gelijk, huidigeWaarde, openVerzoeken, toonWaarde, verzoekenVan, wijzigingen,
} from '../lib/wijzigingen'
import {
  ROLE_LABELS, ROLE_ORDER, VELD_LABELS,
  type DossierWijziging, type Location, type PersonnelPrivate,
  type Role, type User, type WijzigbaarVeld,
} from '../lib/types'
import { dateTime, relative } from '../lib/format'
import { dateInputValue, dayFromDateInput } from '../lib/roster'
import { Badge, Card, Empty, Field, Modal } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Wijzigingen in een dossier
 *
 *  Een leidinggevende stelt voor, het management beslist. Het scherm laat
 *  per veld zien wat er nu staat en wat het zou worden -- goedkeuren zonder
 *  te zien wat je goedkeurt is geen goedkeuren.
 * ------------------------------------------------------------------ */

const TE_WIJZIGEN: WijzigbaarVeld[] = [
  'function', 'contractHours', 'hourlyRate', 'locationId',
  'supervisorId', 'startDate', 'endDate', 'roles',
]

/* ================================================================== *
 *  De lijst met openstaande verzoeken
 * ================================================================== */

export function OpenWijzigingen() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()

  const alle = useLiveQuery(() => db.changeRequests.toArray(), [], [] as DossierWijziging[])
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  const [afwijzen, setAfwijzen] = useState<DossierWijziging | null>(null)

  const open = useMemo(() => openVerzoeken(alle), [alle])
  if (open.length === 0) return null

  const magBeslissen = perms.can('staff.approve')

  return (
    <>
      <Card
        title="Voorgestelde wijzigingen"
        hint={magBeslissen
          ? 'Beoordeel wat een leidinggevende heeft aangevraagd'
          : 'Wacht op akkoord van het management'}
        flush
        className="mb"
      >
        <div className="cr-lijst">
          {open.map((v) => (
            <VerzoekRegel
              key={v.id}
              verzoek={v}
              locaties={locaties}
              mensen={mensen}
              magBeslissen={magBeslissen}
              magIntrekken={v.aangevraagdDoor === me.id}
              onGoedkeuren={async () => {
                await wijzigingen.goedkeuren(v, me)
                toast.ok(`Wijziging voor ${v.userName} doorgevoerd`)
              }}
              onAfwijzen={() => setAfwijzen(v)}
              onIntrekken={async () => {
                await wijzigingen.intrekken(v)
                toast.info('Verzoek ingetrokken')
              }}
            />
          ))}
        </div>
      </Card>

      <AfwijzenDialoog
        verzoek={afwijzen}
        door={me}
        onClose={() => setAfwijzen(null)}
      />
    </>
  )
}

/* ================================================================== *
 *  De geschiedenis bij één persoon
 * ================================================================== */

export function WijzigingenVan({ person }: { person: User }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()

  const alle = useLiveQuery(() => db.changeRequests.toArray(), [], [] as DossierWijziging[])
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const [afwijzen, setAfwijzen] = useState<DossierWijziging | null>(null)

  const mijne = useMemo(() => verzoekenVan(alle, person.id), [alle, person.id])
  if (mijne.length === 0) return null

  return (
    <>
      <Card title="Wijzigingen" hint={`${mijne.length} in totaal`} flush className="mt">
        <div className="cr-lijst">
          {mijne.map((v) => (
            <VerzoekRegel
              key={v.id}
              verzoek={v}
              locaties={locaties}
              mensen={mensen}
              magBeslissen={perms.can('staff.approve') && v.status === 'open'}
              magIntrekken={v.aangevraagdDoor === me.id && v.status === 'open'}
              onGoedkeuren={async () => {
                await wijzigingen.goedkeuren(v, me)
                toast.ok('Doorgevoerd')
              }}
              onAfwijzen={() => setAfwijzen(v)}
              onIntrekken={async () => {
                await wijzigingen.intrekken(v)
                toast.info('Verzoek ingetrokken')
              }}
            />
          ))}
        </div>
      </Card>

      <AfwijzenDialoog verzoek={afwijzen} door={me} onClose={() => setAfwijzen(null)} />
    </>
  )
}

/* ================================================================== *
 *  Eén verzoek
 * ================================================================== */

function VerzoekRegel({
  verzoek, locaties, mensen, magBeslissen, magIntrekken,
  onGoedkeuren, onAfwijzen, onIntrekken,
}: {
  verzoek: DossierWijziging
  locaties: Location[]
  mensen: User[]
  magBeslissen: boolean
  magIntrekken: boolean
  onGoedkeuren: () => Promise<void>
  onAfwijzen: () => void
  onIntrekken: () => Promise<void>
}) {
  const [bezig, setBezig] = useState(false)
  const hulp = { locaties, mensen }

  const tint =
    verzoek.status === 'goedgekeurd' ? 'ok' :
    verzoek.status === 'afgewezen' ? 'danger' :
    verzoek.status === 'ingetrokken' ? 'default' : 'warn'

  return (
    <div className={`cr-regel ${verzoek.status}`}>
      <div className="kop">
        <strong>{verzoek.userName}</strong>
        <Badge tone={tint as never}>{verzoek.status}</Badge>
        <span className="wie">
          voorgesteld door {verzoek.aangevraagdDoorNaam} · {relative(verzoek.aangevraagdOp)}
        </span>
        {verzoek.ingaandOp && (
          <Badge tone="info">
            <Clock size={11} /> per {new Date(verzoek.ingaandOp).toLocaleDateString('nl-NL')}
          </Badge>
        )}
      </div>

      <div className="velden">
        {verzoek.velden.map((v) => (
          <div key={v.veld} className="veld">
            <span className="naam">{VELD_LABELS[v.veld]}</span>
            <span className="oud">{toonWaarde(v.veld, v.oud, hulp)}</span>
            <ArrowRight size={13} />
            <span className="nieuw">{toonWaarde(v.veld, v.nieuw, hulp)}</span>
          </div>
        ))}
      </div>

      {verzoek.reden && <div className="reden">{verzoek.reden}</div>}

      {verzoek.status === 'afgewezen' && verzoek.afwijzingReden && (
        <div className="reden afgewezen">
          <X size={12} /> {verzoek.afwijzingReden}
        </div>
      )}

      {verzoek.beslistOp && (
        <div className="beslist">
          {verzoek.status === 'goedgekeurd' ? 'Goedgekeurd' : 'Afgewezen'} door{' '}
          {verzoek.beslistDoorNaam} · {dateTime(verzoek.beslistOp)}
        </div>
      )}

      {(magBeslissen || magIntrekken) && (
        <div className="row" style={{ gap: 6, marginTop: 10 }}>
          {magBeslissen && (
            <>
              <button
                className="btn ok sm"
                disabled={bezig}
                onClick={async () => { setBezig(true); try { await onGoedkeuren() } finally { setBezig(false) } }}
              >
                <Check size={14} /> Goedkeuren en doorvoeren
              </button>
              <button className="btn danger sm" onClick={onAfwijzen} disabled={bezig}>
                <ThumbsDown size={14} /> Afwijzen
              </button>
            </>
          )}
          {magIntrekken && (
            <button
              className="btn ghost sm"
              disabled={bezig}
              onClick={async () => { setBezig(true); try { await onIntrekken() } finally { setBezig(false) } }}
            >
              <Undo2 size={14} /> Intrekken
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ================================================================== *
 *  Afwijzen
 * ================================================================== */

function AfwijzenDialoog({
  verzoek, door, onClose,
}: {
  verzoek: DossierWijziging | null
  door: User
  onClose: () => void
}) {
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  if (!verzoek) return null

  return (
    <Modal
      open={!!verzoek}
      title="Wijziging afwijzen"
      subtitle={`${verzoek.userName} — voorgesteld door ${verzoek.aangevraagdDoorNaam}`}
      onClose={onClose}
      width={480}
    >
      <Field
        label="Waarom niet"
        help="Gaat naar de aanvrager, ook per mail. Zonder reden begint hij morgen opnieuw."
      >
        <textarea
          className="textarea" value={reden} autoFocus
          onChange={(e) => setReden(e.target.value)}
          placeholder="Bijv. eerst bespreken met de vestigingsmanager"
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button
          className="btn danger"
          disabled={bezig}
          onClick={async () => {
            setBezig(true)
            try {
              await wijzigingen.afwijzen(verzoek, reden, door)
              toast.info('Afgewezen')
              setReden('')
              onClose()
            } finally { setBezig(false) }
          }}
        >
          <ThumbsDown size={15} /> Afwijzen
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Een wijziging aanvragen
 * ================================================================== */

export function WijzigingAanvragen({
  open, person, prive, onClose,
}: {
  open: boolean
  person: User
  prive?: PersonnelPrivate
  onClose: () => void
}) {
  const me = useAuth((s) => s.user)!
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  const [gekozen, setGekozen] = useState<Set<WijzigbaarVeld>>(new Set())
  const [waarden, setWaarden] = useState<Partial<Record<WijzigbaarVeld, unknown>>>({})
  const [reden, setReden] = useState('')
  const [ingaand, setIngaand] = useState('')
  const [bezig, setBezig] = useState(false)

  const hulp = { locaties, mensen }
  const leidinggevenden = mensen.filter(
    (u) => u.active && (u.roles.includes('supervisor') || u.roles.includes('management')))

  function wissel(veld: WijzigbaarVeld) {
    const volgende = new Set(gekozen)
    if (volgende.has(veld)) {
      volgende.delete(veld)
      const zonder = { ...waarden }
      delete zonder[veld]
      setWaarden(zonder)
    } else {
      volgende.add(veld)
      // Beginnen bij wat er nu staat: dan hoeft alleen het verschil getypt.
      setWaarden({ ...waarden, [veld]: huidigeWaarde(veld, person, prive) })
    }
    setGekozen(volgende)
  }

  const echteWijzigingen = [...gekozen].filter(
    (veld) => !gelijk(huidigeWaarde(veld, person, prive), waarden[veld]))

  async function indienen() {
    if (echteWijzigingen.length === 0) {
      return toast.error('Er verandert nog niets aan wat je hebt gekozen')
    }
    if (reden.trim().length < 5) {
      return toast.error('Geef aan waarom; anders is het niet te beoordelen')
    }

    setBezig(true)
    try {
      const verzoek = await wijzigingen.aanvragen({
        persoon: person,
        prive,
        voorstel: Object.fromEntries(
          echteWijzigingen.map((v) => [v, waarden[v]])) as Partial<Record<WijzigbaarVeld, unknown>>,
        reden,
        ingaandOp: ingaand ? dayFromDateInput(ingaand) : undefined,
        door: me,
      })
      if (!verzoek) return toast.error('Er verandert niets')

      toast.ok('Voorstel ingediend — het management krijgt bericht')
      setGekozen(new Set()); setWaarden({}); setReden(''); setIngaand('')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Wijziging aanvragen"
      subtitle={`Voor ${person.name} — het management beslist`}
      onClose={onClose}
      width={640}
    >
      <Field label="Wat verandert er?">
        <div className="row" style={{ gap: 6 }}>
          {TE_WIJZIGEN.map((veld) => (
            <button
              key={veld}
              type="button"
              className={`btn sm ${gekozen.has(veld) ? 'primary' : ''}`}
              onClick={() => wissel(veld)}
            >
              {VELD_LABELS[veld]}
            </button>
          ))}
        </div>
      </Field>

      {gekozen.size === 0 && (
        <div className="signup-note">
          <PenLine size={16} />
          <span>
            Kies hierboven wat er moet veranderen. Je ziet dan wat er nu staat,
            met daarnaast het vak om het nieuwe in te vullen.
          </span>
        </div>
      )}

      {[...gekozen].map((veld) => (
        <div key={veld} className="cr-invoer">
          <div className="naam">{VELD_LABELS[veld]}</div>
          <div className="nu">
            nu: <strong>{toonWaarde(veld, huidigeWaarde(veld, person, prive), hulp)}</strong>
          </div>
          <VeldInvoer
            veld={veld}
            waarde={waarden[veld]}
            onChange={(v) => setWaarden({ ...waarden, [veld]: v })}
            locaties={locaties}
            leidinggevenden={leidinggevenden}
          />
        </div>
      ))}

      <Field label="Per wanneer (optioneel)">
        <input
          className="input" type="date" value={ingaand}
          onChange={(e) => setIngaand(e.target.value)}
        />
      </Field>

      <Field label="Waarom" help="Het management leest dit voordat het beslist.">
        <textarea
          className="textarea" value={reden}
          onChange={(e) => setReden(e.target.value)}
          placeholder="Bijv. draait sinds september structureel meer uren"
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button
          className="btn primary"
          onClick={() => void indienen()}
          disabled={bezig || echteWijzigingen.length === 0}
        >
          <ClipboardCheck size={15} /> Indienen
          {echteWijzigingen.length > 0 && ` (${echteWijzigingen.length})`}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

function VeldInvoer({
  veld, waarde, onChange, locaties, leidinggevenden,
}: {
  veld: WijzigbaarVeld
  waarde: unknown
  onChange: (v: unknown) => void
  locaties: Location[]
  leidinggevenden: User[]
}) {
  switch (veld) {
    case 'function':
      return (
        <input
          className="input" value={(waarde as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Wasmedewerker"
        />
      )

    case 'contractHours':
    case 'hourlyRate':
      return (
        <input
          className="input" inputMode="decimal"
          value={waarde === undefined || waarde === null ? '' : String(waarde)}
          onChange={(e) => {
            const t = e.target.value.replace(',', '.')
            onChange(t === '' ? undefined : Number(t))
          }}
          placeholder={veld === 'hourlyRate' ? '22.50' : '38'}
        />
      )

    case 'startDate':
    case 'endDate':
      return (
        <input
          className="input" type="date"
          value={waarde ? dateInputValue(Number(waarde)) : ''}
          onChange={(e) => onChange(e.target.value ? dayFromDateInput(e.target.value) : undefined)}
        />
      )

    case 'locationId':
      return (
        <select
          className="select" value={(waarde as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Niet aan een vestiging gebonden</option>
          {locaties.filter((l) => l.active).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      )

    case 'supervisorId':
      return (
        <select
          className="select" value={(waarde as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Niemand in het bijzonder</option>
          {leidinggevenden.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      )

    case 'roles': {
      const huidig = (waarde as Role[]) ?? []
      return (
        <div className="row" style={{ gap: 5 }}>
          {ROLE_ORDER.map((r) => {
            const aan = huidig.includes(r)
            return (
              <button
                key={r}
                type="button"
                className={`btn sm ${aan ? 'primary' : ''}`}
                onClick={() => onChange(aan ? huidig.filter((x) => x !== r) : [...huidig, r])}
              >
                {ROLE_LABELS[r]}
              </button>
            )
          })}
        </div>
      )
    }

    default:
      return null
  }
}
