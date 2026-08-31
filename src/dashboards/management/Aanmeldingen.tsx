import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Building2, CheckCircle2, Clock, HardHat, Inbox, Mail, MapPin,
  MessageSquareQuote, Phone, RotateCcw, ShieldCheck, ThumbsDown, UserPlus, XCircle,
} from 'lucide-react'
import { db } from '../../lib/db'
import { signups as signupRepo } from '../../lib/signups'
import {
  ROLE_LABELS, ROLE_ORDER, SIGNUP_KINDS,
  type Company, type Location, type Role, type Signup, type SignupStatus, type User,
} from '../../lib/types'
import { dateTime, initials, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import LocatiesKiezer, { type LocatieKeuze } from '../../components/LocatiesKiezer'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Aanmeldingen
 *
 *  Hier komt binnen wie zich via de app heeft aangemeld. Zo'n aanmelding
 *  is niets meer dan een account plus een verzoek: pas als hier iemand op
 *  "toelaten" drukt krijgt diegene rollen, een vestiging en toegang.
 *
 *  Dat is met opzet de enige plek waar dat kan. Er hoeft nooit iemand in
 *  Supabase te klikken.
 * ------------------------------------------------------------------ */

const STATUS_TINT: Record<SignupStatus, 'warn' | 'ok' | 'danger'> = {
  nieuw: 'warn',
  goedgekeurd: 'ok',
  afgewezen: 'danger',
}

export default function Aanmeldingen() {
  const perms = usePerms()
  const [filter, setFilter] = useState<SignupStatus | 'alles'>('nieuw')
  const [openId, setOpenId] = useState<string | null>(null)

  const alle = useLiveQuery(
    async () => (await db.signups.toArray()).sort((a, b) => b.createdAt - a.createdAt),
    [],
    [] as Signup[],
  )

  const nieuw = alle.filter((s) => s.status === 'nieuw')
  const geopend = alle.find((s) => s.id === openId) ?? null

  if (!perms.can('signups.view')) {
    return <Empty text="Je hebt geen toegang tot de aanmeldingen." icon={<Inbox size={30} />} />
  }

  if (geopend) {
    return <AanmeldingDetail signup={geopend} onBack={() => setOpenId(null)} />
  }

  const lijst = filter === 'alles' ? alle : alle.filter((s) => s.status === filter)
  const oudste = nieuw[nieuw.length - 1]

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat
          label="Wacht op beoordeling"
          value={nieuw.length}
          icon={<Inbox size={17} />}
          tone={nieuw.length ? 'warn' : 'ok'}
        />
        <Stat
          label="Langst openstaand"
          value={oudste ? relative(oudste.createdAt) : '—'}
          icon={<Clock size={17} />}
          tone={oudste && Date.now() - oudste.createdAt > 3 * 86_400_000 ? 'danger' : undefined}
        />
        <Stat
          label="Toegelaten"
          value={alle.filter((s) => s.status === 'goedgekeurd').length}
          icon={<CheckCircle2 size={17} />}
          tone="ok"
        />
      </div>

      <Card
        title="Aanmeldingen"
        hint="Iemand die zich aanmeldt heeft nog geen toegang"
        flush
        action={
          <div className="row" style={{ gap: 5 }}>
            {([
              ['nieuw', 'Nieuw'],
              ['goedgekeurd', 'Toegelaten'],
              ['afgewezen', 'Afgewezen'],
              ['alles', 'Alles'],
            ] as [SignupStatus | 'alles', string][]).map(([k, label]) => (
              <button
                key={k}
                className={`btn sm ${filter === k ? 'primary' : 'ghost'}`}
                onClick={() => setFilter(k)}
              >
                {label}
                {k === 'nieuw' && nieuw.length > 0 && (
                  <span className="badge brand" style={{ marginLeft: 4 }}>{nieuw.length}</span>
                )}
              </button>
            ))}
          </div>
        }
      >
        {lijst.length === 0 ? (
          <Empty
            text={filter === 'nieuw'
              ? 'Niets te beoordelen. Alles is afgehandeld.'
              : 'Geen aanmeldingen in deze lijst.'}
            icon={<CheckCircle2 size={30} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Wie</th>
                  <th>Meldt zich aan als</th>
                  <th>Aangemeld</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lijst.map((s) => (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(s.id)}>
                    <td>
                      <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
                        <div className="rij-av">{initials(s.name)}</div>
                        <div style={{ minWidth: 0 }}>
                          <strong>{s.name}</strong>
                          <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={s.kind === 'klant' ? 'info' : 'default'}>
                        {s.kind === 'klant' ? <Building2 size={11} /> : <HardHat size={11} />}
                        {SIGNUP_KINDS[s.kind].label}
                      </Badge>
                      {s.companyName && (
                        <div style={{ fontSize: '.72rem', color: 'var(--text-3)', marginTop: 3 }}>
                          {s.companyName}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="mono">{dateTime(s.createdAt)}</span>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                        {relative(s.createdAt)}
                      </div>
                    </td>
                    <td><Badge tone={STATUS_TINT[s.status]}>{s.status}</Badge></td>
                    <td className="num">
                      <button className="btn sm">Bekijken</button>
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

/* ================================================================== *
 *  Eén aanmelding
 * ================================================================== */

function AanmeldingDetail({ signup, onBack }: { signup: Signup; onBack: () => void }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [toelaten, setToelaten] = useState(false)
  const [afwijzen, setAfwijzen] = useState(false)

  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const locatie = locaties.find((l) => l.id === signup.locationId)

  const mag = perms.can('signups.decide')

  return (
    <>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar de aanmeldingen
      </button>

      <Card>
        <div className="person-head">
          <div className="person-avatar">{initials(signup.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ marginBottom: 3 }}>{signup.name}</h2>
            <div className="row" style={{ gap: 6 }}>
              <Badge tone={STATUS_TINT[signup.status]}>{signup.status}</Badge>
              <Badge tone={signup.kind === 'klant' ? 'info' : 'default'}>
                {SIGNUP_KINDS[signup.kind].label}
              </Badge>
              <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
                aangemeld {relative(signup.createdAt)}
              </span>
            </div>
          </div>

          {mag && signup.status === 'nieuw' && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn primary sm" onClick={() => setToelaten(true)}>
                <UserPlus size={14} /> Toelaten
              </button>
              <button className="btn danger sm" onClick={() => setAfwijzen(true)}>
                <ThumbsDown size={14} /> Afwijzen
              </button>
            </div>
          )}

          {mag && signup.status !== 'nieuw' && (
            <button
              className="btn ghost sm"
              onClick={() => void signupRepo.reopen(signup).then(() => toast.info('Weer op nieuw gezet'))}
            >
              <RotateCcw size={14} /> Opnieuw beoordelen
            </button>
          )}
        </div>

        <div className="person-fields">
          <Regel label="E-mailadres" value={signup.email} icon={<Mail size={13} />} />
          <Regel label="Telefoon" value={signup.phone ?? '—'} icon={<Phone size={13} />} />
          {signup.kind === 'klant'
            ? <Regel label="Bedrijf" value={signup.companyName ?? '—'} icon={<Building2 size={13} />} />
            : <Regel label="Zegt te werken op" value={locatie?.name ?? 'Onbekend'} icon={<MapPin size={13} />} />}
          <Regel label="Aangemeld op" value={dateTime(signup.createdAt)} />
          {signup.handledAt && (
            <Regel
              label={signup.status === 'goedgekeurd' ? 'Toegelaten door' : 'Afgewezen door'}
              value={`${signup.handledByName ?? '—'} · ${dateTime(signup.handledAt)}`}
            />
          )}
        </div>

        {signup.message && (
          <div className="aanmelding-bericht">
            <MessageSquareQuote size={16} />
            <div>
              <div className="kop">Wat diegene erbij schreef</div>
              <p>{signup.message}</p>
            </div>
          </div>
        )}

        {signup.rejectReason && (
          <div className="aanmelding-bericht afgewezen">
            <XCircle size={16} />
            <div>
              <div className="kop">Reden van afwijzing</div>
              <p>{signup.rejectReason}</p>
            </div>
          </div>
        )}

        <div className="aanmelding-let-op">
          <ShieldCheck size={16} />
          <span>
            Deze persoon heeft wel een inlogaccount, maar komt er nog niet in.
            Toegang ontstaat pas als je hier op <strong>Toelaten</strong> drukt en
            rollen toekent.
          </span>
        </div>
      </Card>

      <ToelatenDialoog
        open={toelaten}
        signup={signup}
        me={me}
        onClose={() => setToelaten(false)}
        onDone={onBack}
      />

      <AfwijzenDialoog
        open={afwijzen}
        signup={signup}
        me={me}
        onClose={() => setAfwijzen(false)}
        onDone={onBack}
      />
    </>
  )
}

function Regel({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="person-field">
      <div className="label">{label}</div>
      <div className="value row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        {icon && <span style={{ color: 'var(--text-3)' }}>{icon}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      </div>
    </div>
  )
}

/* ================================================================== *
 *  Toelaten
 * ================================================================== */

function ToelatenDialoog({
  open, signup, me, onClose, onDone,
}: {
  open: boolean
  signup: Signup
  me: User
  onClose: () => void
  onDone: () => void
}) {
  const bestaande = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const bedrijven = useLiveQuery(() => db.companies.toArray(), [], [] as Company[])

  const [roles, setRoles] = useState<Role[]>(
    signup.kind === 'klant' ? ['customer'] : ['employee'])
  const [loc, setLoc] = useState<LocatieKeuze>({
    locationId: signup.locationId,
    manages: [],
    allLocations: false,
  })
  const [personnelNumber, setPersonnelNumber] = useState('')
  const [functie, setFunctie] = useState('')
  const [contractHours, setContractHours] = useState('38')
  const [hourlyRate, setHourlyRate] = useState('')
  const [supervisorId, setSupervisorId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [busy, setBusy] = useState(false)

  /** Volgend vrij personeelsnummer voorstellen, bijv. TW-025. */
  const voorstel = useMemo(() => {
    const nums = bestaande
      .map((u) => u.personnelNumber?.match(/(\d+)\s*$/)?.[1])
      .filter(Boolean)
      .map(Number)
    return 'TW-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')
  }, [bestaande])

  const leidinggevenden = useMemo(
    () => bestaande.filter((u) => u.active &&
      (u.roles.includes('supervisor') || u.roles.includes('management'))),
    [bestaande],
  )

  const isKlant = roles.length === 1 && roles[0] === 'customer'

  async function opslaan() {
    if (roles.length === 0) return toast.error('Kies minimaal één rol')
    setBusy(true)
    try {
      await signupRepo.approve({
        signup,
        roles,
        locationId: loc.locationId,
        manages: loc.manages,
        allLocations: loc.allLocations,
        personnelNumber: isKlant ? undefined : (personnelNumber.trim() || voorstel),
        function: functie,
        contractHours: isKlant || !contractHours
          ? undefined
          : Number(contractHours.replace(',', '.')),
        hourlyRate: hourlyRate ? Number(hourlyRate.replace(',', '.')) : undefined,
        supervisorId: supervisorId || undefined,
        companyId: companyId || undefined,
        by: me,
      })
      toast.ok(`${signup.name} is toegelaten en heeft nu toegang`)
      onClose()
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`${signup.name} toelaten`}
      subtitle="Bepaal meteen wat diegene te zien krijgt en waar"
      onClose={onClose}
      width={640}
    >
      <Field label="Toegang tot welke dashboards">
        <div className="row" style={{ gap: 6 }}>
          {ROLE_ORDER.map((r) => {
            const aan = roles.includes(r)
            return (
              <button
                key={r}
                type="button"
                className={`btn sm ${aan ? 'primary' : ''}`}
                onClick={() => setRoles(aan ? roles.filter((x) => x !== r) : [...roles, r])}
              >
                {r === 'management' && <ShieldCheck size={13} />}
                {ROLE_LABELS[r]}
              </button>
            )
          })}
        </div>
        <span className="help">
          Fijner afstellen wat iemand precies mag doe je daarna in het dossier,
          onder Rechten.
        </span>
      </Field>

      {isKlant ? (
        <Field label="Koppelen aan een klant" help="Laat leeg als dit een nieuw bedrijf is">
          <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Geen bestaande klant</option>
            {bedrijven.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <LocatiesKiezer
            waarde={loc}
            onChange={setLoc}
            toonLeiding={roles.includes('supervisor') || roles.includes('management')}
          />

          <div className="grid cols-3">
            <Field label="Personeelsnummer" help={`Leeg geeft ${voorstel}`}>
              <input
                className="input" value={personnelNumber} placeholder={voorstel}
                onChange={(e) => setPersonnelNumber(e.target.value)}
              />
            </Field>
            <Field label="Functie">
              <input
                className="input" value={functie} placeholder="Wasmedewerker"
                onChange={(e) => setFunctie(e.target.value)}
              />
            </Field>
            <Field label="Contracturen">
              <input
                className="input" inputMode="decimal" value={contractHours}
                onChange={(e) => setContractHours(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid cols-2">
            <Field label="Uurtarief (€)">
              <input
                className="input" inputMode="decimal" value={hourlyRate} placeholder="22"
                onChange={(e) => setHourlyRate(e.target.value)}
              />
            </Field>
            <Field label="Valt onder">
              <select
                className="select" value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
              >
                <option value="">Niemand in het bijzonder</option>
                {leidinggevenden.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </Field>
          </div>
        </>
      )}

      <div className="aanmelding-let-op">
        <Mail size={16} />
        <span>
          {signup.name.split(' ')[0]} krijgt bericht op {signup.email} dat de
          aanmelding is goedgekeurd, en kan daarna inloggen met het wachtwoord
          dat bij het aanmelden is gekozen.
        </span>
      </div>

      <div className="row end mt">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuleren</button>
        <button className="btn primary" onClick={() => void opslaan()} disabled={busy}>
          <UserPlus size={15} /> Toelaten
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Afwijzen
 * ================================================================== */

function AfwijzenDialoog({
  open, signup, me, onClose, onDone,
}: {
  open: boolean
  signup: Signup
  me: User
  onClose: () => void
  onDone: () => void
}) {
  const [reden, setReden] = useState('')
  const [busy, setBusy] = useState(false)

  const VOORBEELDEN = [
    'We kennen dit e-mailadres niet als medewerker of klant.',
    'Er staat al een account op deze naam.',
    'Aanmelding is niet met ons afgestemd.',
  ]

  async function afwijzen() {
    setBusy(true)
    try {
      await signupRepo.reject(signup, reden, me)
      toast.info(`Aanmelding van ${signup.name} afgewezen`)
      onClose()
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Aanmelding afwijzen"
      subtitle={`${signup.name} krijgt hier bericht van op ${signup.email}`}
      onClose={onClose}
      width={520}
    >
      <Field
        label="Reden"
        help="Komt letterlijk in de mail te staan. Laat leeg om niets uit te leggen."
      >
        <textarea
          className="textarea" value={reden} maxLength={400}
          onChange={(e) => setReden(e.target.value)}
          placeholder="Kort en duidelijk"
        />
      </Field>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {VOORBEELDEN.map((v) => (
          <button key={v} className="btn sm ghost" onClick={() => setReden(v)}>{v}</button>
        ))}
      </div>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuleren</button>
        <button className="btn danger" onClick={() => void afwijzen()} disabled={busy}>
          <ThumbsDown size={15} /> Afwijzen
        </button>
      </div>
    </Modal>
  )
}
