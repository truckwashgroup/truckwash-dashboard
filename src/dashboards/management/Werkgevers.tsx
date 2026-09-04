import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Ban, Briefcase, Building2, Check, CheckCircle2, ClipboardList,
  Mail, Phone, Plus, ShieldCheck, ThumbsDown, Truck, Users,
} from 'lucide-react'
import { db, alleMensen } from '../../lib/db'
import { chauffeursVan, werkgevers as wgRepo } from '../../lib/werkgevers'
import {
  KOPPELING_STATUS, REGEL_SOORTEN, SERVICES, WERKGEVER_STATUS,
  type Company, type User, type WashJob, type Werkgever,
  type WerkgeverKoppeling, type WerkgeverRegel, type WerkgeverStatus,
} from '../../lib/types'
import { dateTime, initials, money, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Werkgevers, vanaf de kant van Truckwash1
 *
 *  Aanmelden kan een werkgever zelf; toelaten doet het management. Dat is
 *  dezelfde volgorde als bij een medewerker, en om dezelfde reden: een
 *  account is geen toegang.
 * ------------------------------------------------------------------ */

export default function Werkgevers() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()

  const [filter, setFilter] = useState<WerkgeverStatus | 'alles'>('alles')
  const [openId, setOpenId] = useState<string | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const [afwijzen, setAfwijzen] = useState<Werkgever | null>(null)

  const alle = useLiveQuery(
    async () => (await db.employers.toArray()).sort((a, b) => b.aangevraagdOp - a.aangevraagdOp),
    [],
    [] as Werkgever[],
  )
  const links = useLiveQuery(() => db.employerLinks.toArray(), [], [] as WerkgeverKoppeling[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const regels = useLiveQuery(() => db.employerRules.toArray(), [], [] as WerkgeverRegel[])

  const geopend = alle.find((w) => w.id === openId) ?? null
  const aangevraagd = alle.filter((w) => w.status === 'aangevraagd')

  if (!perms.can('employer.view')) {
    return <Empty text="Je hebt geen toegang tot de klanten." icon={<Briefcase size={30} />} />
  }

  if (geopend) {
    return (
      <WerkgeverDetail
        werkgever={geopend}
        chauffeurs={chauffeursVan(links, geopend.id)}
        beurten={jobs.filter((j) => j.werkgeverId === geopend.id)}
        regels={regels.filter((r) => r.werkgeverId === geopend.id)}
        onTerug={() => setOpenId(null)}
        onAfwijzen={() => setAfwijzen(geopend)}
      />
    )
  }

  const lijst = filter === 'alles' ? alle : alle.filter((w) => w.status === filter)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Wacht op akkoord"
          value={aangevraagd.length}
          icon={<ClipboardList size={17} />}
          tone={aangevraagd.length ? 'warn' : 'ok'}
        />
        <Stat
          label="Actief"
          value={alle.filter((w) => w.status === 'actief').length}
          icon={<Briefcase size={17} />}
          tone="ok"
        />
        <Stat
          label="Chauffeurs"
          value={links.filter((l) => l.status === 'actief').length}
          icon={<Users size={17} />}
        />
        <Stat
          label="Wasbeurten op naam"
          value={jobs.filter((j) => j.werkgeverId).length}
          icon={<Truck size={17} />}
        />
      </div>

      <Card
        title="Klanten"
        hint="Bedrijven waarvan de chauffeurs hier komen wassen"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            {(['alles', 'aangevraagd', 'actief', 'geblokkeerd'] as const).map((k) => (
              <button
                key={k}
                className={`btn sm ${filter === k ? 'primary' : 'ghost'}`}
                onClick={() => setFilter(k)}
              >
                {k === 'alles' ? 'Alles' : WERKGEVER_STATUS[k].label}
                {k === 'aangevraagd' && aangevraagd.length > 0 && (
                  <span className="badge brand" style={{ marginLeft: 4 }}>{aangevraagd.length}</span>
                )}
              </button>
            ))}
            {perms.can('employer.manage') && (
              <button className="btn primary sm" onClick={() => setNieuw(true)}>
                <Plus size={14} /> Toevoegen
              </button>
            )}
          </div>
        }
      >
        {lijst.length === 0 ? (
          <Empty
            text={alle.length === 0
              ? 'Nog geen klanten. Voeg er een toe, of laat ze zich aanmelden.'
              : 'Geen klanten in deze lijst.'}
            icon={<Briefcase size={30} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Bedrijf</th>
                  <th>Contact</th>
                  <th className="num">Chauffeurs</th>
                  <th className="num">Wasbeurten</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lijst.map((w) => {
                  const actief = links.filter(
                    (l) => l.werkgeverId === w.id && l.status === 'actief').length
                  const beurten = jobs.filter((j) => j.werkgeverId === w.id).length
                  return (
                    <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(w.id)}>
                      <td>
                        <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
                          <div className="rij-av"><Building2 size={15} /></div>
                          <div style={{ minWidth: 0 }}>
                            <strong>{w.naam}</strong>
                            <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                              {w.plaats ?? w.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {w.contactNaam}
                        <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{w.email}</div>
                      </td>
                      <td className="num">{actief}</td>
                      <td className="num">{beurten}</td>
                      <td>
                        <Badge tone={WERKGEVER_STATUS[w.status].tone as never}>
                          {WERKGEVER_STATUS[w.status].label}
                        </Badge>
                      </td>
                      <td className="num">
                        {w.status === 'aangevraagd' && perms.can('employer.approve') ? (
                          <div className="row" style={{ gap: 5, justifyContent: 'flex-end' }}>
                            <button
                              className="btn ok sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                void wgRepo.goedkeuren(w, me).then(
                                  () => toast.ok(`${w.naam} is toegelaten`))
                              }}
                            >
                              <Check size={13} />
                            </button>
                            <button
                              className="btn danger sm"
                              onClick={(e) => { e.stopPropagation(); setAfwijzen(w) }}
                            >
                              <ThumbsDown size={13} />
                            </button>
                          </div>
                        ) : (
                          <button className="btn sm">Bekijken</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NieuweWerkgever open={nieuw} door={me} onClose={() => setNieuw(false)} onKlaar={setOpenId} />
      <AfwijzenDialoog werkgever={afwijzen} door={me} onClose={() => setAfwijzen(null)} />
    </>
  )
}

/* ================================================================== *
 *  Eén werkgever
 * ================================================================== */

function WerkgeverDetail({
  werkgever, chauffeurs, beurten, regels, onTerug, onAfwijzen,
}: {
  werkgever: Werkgever
  chauffeurs: WerkgeverKoppeling[]
  beurten: WashJob[]
  regels: WerkgeverRegel[]
  onTerug: () => void
  onAfwijzen: () => void
}) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [beheerders, setBeheerders] = useState(false)

  const gereed = beurten.filter((b) => b.status === 'gereed')
  const omzet = gereed.reduce((a, b) => a + b.priceExcl, 0)

  return (
    <>
      <button className="btn ghost sm" onClick={onTerug} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar de klanten
      </button>

      <Card>
        <div className="person-head">
          <div className="person-avatar"><Building2 size={22} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ marginBottom: 3 }}>{werkgever.naam}</h2>
            <div className="row" style={{ gap: 6 }}>
              <Badge tone={WERKGEVER_STATUS[werkgever.status].tone as never}>
                {WERKGEVER_STATUS[werkgever.status].label}
              </Badge>
              {werkgever.kvk && <Badge>KvK {werkgever.kvk}</Badge>}
              <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
                aangemeld {relative(werkgever.aangevraagdOp)}
              </span>
            </div>
          </div>

          {perms.can('employer.approve') && (
            <div className="row" style={{ gap: 6 }}>
              {werkgever.status === 'aangevraagd' && (
                <>
                  <button
                    className="btn ok sm"
                    onClick={() => void wgRepo.goedkeuren(werkgever, me).then(
                      () => toast.ok(`${werkgever.naam} is toegelaten`))}
                  >
                    <Check size={14} /> Toelaten
                  </button>
                  <button className="btn danger sm" onClick={onAfwijzen}>
                    <ThumbsDown size={14} /> Afwijzen
                  </button>
                </>
              )}
              {werkgever.status === 'actief' && (
                <button
                  className="btn sm"
                  onClick={() => void wgRepo.blokkeren(werkgever, me).then(
                    () => toast.info(`${werkgever.naam} is geblokkeerd`))}
                >
                  <Ban size={14} /> Blokkeren
                </button>
              )}
              {werkgever.status === 'geblokkeerd' && (
                <button
                  className="btn ok sm"
                  onClick={() => void wgRepo.blokkeren(werkgever, me, false).then(
                    () => toast.ok(`${werkgever.naam} staat weer open`))}
                >
                  <CheckCircle2 size={14} /> Deblokkeren
                </button>
              )}
              {perms.can('employer.manage') && (
                <button className="btn sm" onClick={() => setBeheerders(true)}>
                  <Users size={14} /> Beheerders
                </button>
              )}
            </div>
          )}
        </div>

        <div className="person-fields">
          <Regel label="Contactpersoon" value={werkgever.contactNaam} />
          <Regel label="E-mail" value={werkgever.email} icon={<Mail size={13} />} />
          <Regel label="Telefoon" value={werkgever.telefoon ?? '—'} icon={<Phone size={13} />} />
          <Regel
            label="Adres"
            value={[werkgever.adres, werkgever.postcode, werkgever.plaats]
              .filter(Boolean).join(', ') || '—'}
          />
          <Regel label="Beheerders" value={`${werkgever.beheerders.length}`} />
          <Regel
            label="Afgehandeld door"
            value={werkgever.beslistDoorNaam
              ? `${werkgever.beslistDoorNaam} · ${dateTime(werkgever.beslistOp!)}`
              : '—'}
          />
        </div>

        {werkgever.notitie && (
          <div className="aanmelding-bericht">
            <ClipboardList size={16} />
            <div>
              <div className="kop">Wat er bij de aanvraag stond</div>
              <p>{werkgever.notitie}</p>
            </div>
          </div>
        )}

        {werkgever.afwijzingReden && (
          <div className="aanmelding-bericht afgewezen">
            <ThumbsDown size={16} />
            <div>
              <div className="kop">Reden van afwijzing</div>
              <p>{werkgever.afwijzingReden}</p>
            </div>
          </div>
        )}
      </Card>

      <div className="grid cols-3" style={{ margin: '16px 0' }}>
        <Stat
          label="Chauffeurs"
          value={chauffeurs.filter((c) => c.status === 'actief').length}
          icon={<Users size={17} />}
        />
        <Stat label="Wasbeurten" value={beurten.length} icon={<Truck size={17} />} />
        <Stat label="Omzet" value={money(omzet)} icon={<CheckCircle2 size={17} />} tone="ok" />
      </div>

      <Card title="Chauffeurs" hint={`${chauffeurs.length} in totaal`} flush>
        {chauffeurs.length === 0 ? (
          <Empty text="Nog geen chauffeurs gekoppeld." icon={<Users size={30} />} />
        ) : (
          <div className="chauffeur-lijst">
            {chauffeurs.map((c) => (
              <div key={c.id} className={`chauffeur ${c.status === 'beëindigd' ? 'weg' : ''}`}>
                <span className="av">{initials(c.naam)}</span>
                <span className="tekst">
                  <span className="kop">
                    <strong>{c.naam}</strong>
                    <Badge tone={KOPPELING_STATUS[c.status].tone as never}>
                      {KOPPELING_STATUS[c.status].label}
                    </Badge>
                  </span>
                  <span className="meta">{c.email}</span>
                  {c.beeindigdReden && (
                    <span className="reden">Losgekoppeld: {c.beeindigdReden}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {regels.length > 0 && (
        <Card title="Afspraken" hint="Vastgelegd door de klant" flush className="mt">
          <div className="regel-lijst">
            {regels.map((r) => (
              <div key={r.id} className={`regel t-${REGEL_SOORTEN[r.soort].tone}`}>
                <span className="wat">
                  <strong>{r.service ? SERVICES[r.service].label : r.productCode}</strong>
                  <Badge tone={REGEL_SOORTEN[r.soort].tone as never}>
                    {REGEL_SOORTEN[r.soort].label}
                  </Badge>
                </span>
                <span className="waar">
                  {r.kenteken
                    ? <span className="kenteken">{r.kenteken}</span>
                    : <span className="alles">alle wagens</span>}
                </span>
                {r.reden && <span className="reden">{r.reden}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <BeheerdersDialoog
        open={beheerders}
        werkgever={werkgever}
        onClose={() => setBeheerders(false)}
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
 *  Beheerders
 * ================================================================== */

function BeheerdersDialoog({
  open, werkgever, onClose,
}: {
  open: boolean
  werkgever: Werkgever
  onClose: () => void
}) {
  const mensen = useLiveQuery(
    async () => (await alleMensen())
      .filter((u) => u.active)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
    [] as User[],
  )
  const [zoek, setZoek] = useState('')

  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    return mensen
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 40)
  }, [mensen, zoek])

  async function wissel(u: User) {
    const erin = werkgever.beheerders.includes(u.id)
    await wgRepo.update(werkgever.id, {
      beheerders: erin
        ? werkgever.beheerders.filter((id) => id !== u.id)
        : [...werkgever.beheerders, u.id],
    })
    toast.ok(erin ? `${u.name} is geen beheerder meer` : `${u.name} is nu beheerder`)
  }

  return (
    <Modal
      open={open}
      title="Beheerders"
      subtitle={`Wie ${werkgever.naam} mag beheren in de app`}
      onClose={onClose}
      width={480}
    >
      <div className="signup-note">
        <ShieldCheck size={16} />
        <span>
          Een beheerder kan chauffeurs uitnodigen en afspraken vastleggen. Hij
          heeft daarvoor de rol Klant nodig; die krijgt hij automatisch bij
          het goedkeuren.
        </span>
      </div>

      <Field label="Zoek een persoon">
        <input
          className="input" value={zoek} autoFocus
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Naam of e-mailadres"
        />
      </Field>

      <div className="recipient-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {lijst.map((u) => {
          const erin = werkgever.beheerders.includes(u.id)
          return (
            <button
              key={u.id}
              type="button"
              className={`recipient ${erin ? 'on' : ''}`}
              onClick={() => void wissel(u)}
            >
              <span className="av">{initials(u.name)}</span>
              <span className="who">
                <span className="n">{u.name}</span>
                <span className="f">{u.email}</span>
              </span>
              {erin && <Badge tone="brand">Beheerder</Badge>}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Toevoegen en afwijzen
 * ================================================================== */

function NieuweWerkgever({
  open, door, onClose, onKlaar,
}: {
  open: boolean
  door: User
  onClose: () => void
  onKlaar: (id: string) => void
}) {
  const bedrijven = useLiveQuery(() => db.companies.toArray(), [], [] as Company[])

  const [naam, setNaam] = useState('')
  const [kvk, setKvk] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [telefoon, setTelefoon] = useState('')
  const [plaats, setPlaats] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [bezig, setBezig] = useState(false)

  async function opslaan() {
    if (naam.trim().length < 2) return toast.error('Vul de bedrijfsnaam in')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) {
      return toast.error('Vul een geldig e-mailadres in')
    }

    setBezig(true)
    try {
      const wg = await wgRepo.aanmaken({
        naam, kvk, contactNaam: contact || naam, email, telefoon, plaats,
        companyId: companyId || undefined,
        door,
      })
      toast.ok(`${wg.naam} is toegevoegd`)
      setNaam(''); setKvk(''); setContact(''); setEmail(''); setTelefoon(''); setPlaats('')
      onKlaar(wg.id)
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Klant toevoegen"
      subtitle="Aangemaakt door Truckwash1: meteen actief"
      onClose={onClose}
      width={580}
    >
      <div className="grid cols-2">
        <Field label="Bedrijfsnaam">
          <input className="input" value={naam} autoFocus
            onChange={(e) => setNaam(e.target.value)} placeholder="Transport Jansen BV" />
        </Field>
        <Field label="KvK-nummer (optioneel)">
          <input className="input" value={kvk} onChange={(e) => setKvk(e.target.value)} />
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="Contactpersoon">
          <input className="input" value={contact}
            onChange={(e) => setContact(e.target.value)} placeholder="Mark Jansen" />
        </Field>
        <Field label="E-mailadres">
          <input className="input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="Telefoon">
          <input className="input" value={telefoon} inputMode="tel"
            onChange={(e) => setTelefoon(e.target.value)} />
        </Field>
        <Field label="Plaats">
          <input className="input" value={plaats} onChange={(e) => setPlaats(e.target.value)} />
        </Field>
      </div>

      <Field label="Facturen gaan naar" help="Koppel aan een bestaande klant, of laat leeg.">
        <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Nog niet gekoppeld</option>
          {bedrijven.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button className="btn primary" onClick={() => void opslaan()} disabled={bezig}>
          <Plus size={15} /> Toevoegen
        </button>
      </div>
    </Modal>
  )
}

function AfwijzenDialoog({
  werkgever, door, onClose,
}: {
  werkgever: Werkgever | null
  door: User
  onClose: () => void
}) {
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  if (!werkgever) return null

  return (
    <Modal
      open={!!werkgever}
      title="Aanvraag afwijzen"
      subtitle={werkgever.naam}
      onClose={onClose}
      width={480}
    >
      <Field label="Reden" help="Gaat naar de aanvrager, ook per mail.">
        <textarea
          className="textarea" value={reden} autoFocus
          onChange={(e) => setReden(e.target.value)}
          placeholder="Bijv. we kennen dit bedrijf niet als klant"
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
              await wgRepo.afwijzen(werkgever, reden, door)
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
