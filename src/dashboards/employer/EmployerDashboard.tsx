import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, Building2, CheckCircle2, ClipboardList, Clock, LayoutGrid,
  Loader2, Mail, MessageSquare, Plus, ShieldAlert, Trash2, Truck, UserMinus,
  UserPlus, Users, X,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { db } from '../../lib/db'
import {
  beurtenVan, chauffeursVan, koppelingen, magAfnemen, mijnWerkgevers, regels,
} from '../../lib/werkgevers'
import {
  KOPPELING_STATUS, REGEL_SOORTEN, SERVICES, WERKGEVER_STATUS,
  type RegelSoort, type ServiceKind, type WashJob, type Werkgever,
  type WerkgeverKoppeling, type WerkgeverRegel,
} from '../../lib/types'
import { dateTime, initials, money, relative, time } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { Start, type Tegel } from '../../components/Tegels'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import { useAuth } from '../../store/useAuth'
import { useNavTarget } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Het dashboard van een werkgever
 *
 *  Wat hij ziet: zijn eigen bedrijf, zijn chauffeurs, de wasbeurten die op
 *  zijn naam staan, en de afspraken over wat er per wagen mag.
 *
 *  Wat hij niet ziet: alles van Truckwash1 zelf. Geen rooster, geen
 *  voorraad, geen collega's, geen dossiers. Dat is niet alleen zo geregeld
 *  in dit scherm maar ook in de database -- de rol werkgever telt niet mee
 *  als personeel.
 * ------------------------------------------------------------------ */

const TITELS: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Start', subtitle: 'Waar wil je heen?' },
  chauffeurs: { title: 'Chauffeurs', subtitle: 'Wie er namens jou mag komen wassen' },
  beurten: { title: 'Wasbeurten', subtitle: 'Wat er op jouw naam is gedaan' },
  afspraken: { title: 'Afspraken', subtitle: 'Wat er per wagen wel en niet mag' },
  overleg: { title: 'Overleg', subtitle: 'Contact met Truckwash1' },
}

export default function EmployerDashboard() {
  const me = useAuth((s) => s.user)!
  const [page, setPage] = useState('start')
  const [gekozenId, setGekozenId] = useState<string | null>(null)

  const alleWerkgevers = useLiveQuery(() => db.employers.toArray(), [], [] as Werkgever[])
  const alleLinks = useLiveQuery(() => db.employerLinks.toArray(), [], [] as WerkgeverKoppeling[])
  const alleRegels = useLiveQuery(() => db.employerRules.toArray(), [], [] as WerkgeverRegel[])
  const alleJobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const ongelezen = useOverlegTeller()

  const mijne = useMemo(
    () => mijnWerkgevers(alleWerkgevers, alleLinks, me),
    [alleWerkgevers, alleLinks, me],
  )

  const werkgever = mijne.find((w) => w.id === gekozenId) ?? mijne[0] ?? null
  const magBeheren = !!werkgever && werkgever.beheerders.includes(me.id)

  const chauffeurs = useMemo(
    () => werkgever ? chauffeursVan(alleLinks, werkgever.id) : [],
    [alleLinks, werkgever],
  )
  const beurten = useMemo(
    () => werkgever ? beurtenVan(alleJobs, werkgever.id) : [],
    [alleJobs, werkgever],
  )
  const mijnRegels = useMemo(
    () => werkgever ? alleRegels.filter((r) => r.werkgeverId === werkgever.id) : [],
    [alleRegels, werkgever],
  )

  const items: NavItem[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid },
    ...(magBeheren
      ? [{ key: 'chauffeurs', label: 'Chauffeurs', icon: Users,
           badge: chauffeurs.filter((c) => c.status === 'wacht op akkoord').length || undefined }]
      : []),
    { key: 'beurten', label: 'Wasbeurten', icon: Truck },
    ...(magBeheren ? [{ key: 'afspraken', label: 'Afspraken', icon: ClipboardList }] : []),
    { key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined },
  ]

  useNavTarget(items.map((i) => i.key), (p) => setPage(p))

  if (!werkgever) {
    return (
      <Shell
        roleLabel="Werkgever"
        items={[]}
        active="start"
        onNavigate={() => {}}
        title="Werkgever"
        subtitle="Nog geen bedrijf gekoppeld"
      >
        <Card>
          <div className="klant-welkom">
            <div className="ico"><Building2 size={30} /></div>
            <div>
              <h2>Er hangt nog geen bedrijf aan je account</h2>
              <p>
                Zodra Truckwash1 je aanvraag heeft goedgekeurd, of iemand je als
                beheerder heeft toegevoegd, verschijnt je bedrijf hier vanzelf.
              </p>
              <p className="klein">
                Duurt het lang? Neem contact op met je contactpersoon bij
                Truckwash1.
              </p>
            </div>
          </div>
        </Card>
      </Shell>
    )
  }

  const meta = TITELS[page] ?? TITELS.start
  const openVerzoeken = chauffeurs.filter((c) => c.status === 'wacht op akkoord').length
  const actieveChauffeurs = chauffeurs.filter((c) => c.status === 'actief').length
  const dezeMaand = beurten.filter(
    (b) => b.status === 'gereed' && (b.completedAt ?? 0) > Date.now() - 30 * 86_400_000)

  const tegels: Tegel[] = [
    ...(magBeheren ? [{
      key: 'chauffeurs',
      label: 'Chauffeurs',
      hint: 'Wie er namens jou mag komen wassen',
      icon: Users,
      tint: (openVerzoeken ? 'warn' : 'brand') as never,
      stat: actieveChauffeurs,
      statLabel: openVerzoeken
        ? `${openVerzoeken} wacht op akkoord`
        : actieveChauffeurs === 1 ? 'gekoppeld' : 'gekoppeld',
      urgent: openVerzoeken > 0,
      onClick: () => setPage('chauffeurs'),
    }] : []),
    {
      key: 'beurten',
      label: 'Wasbeurten',
      hint: 'Wat er op jouw naam is gedaan',
      icon: Truck,
      tint: 'info',
      stat: dezeMaand.length,
      statLabel: 'gereed deze maand',
      onClick: () => setPage('beurten'),
    },
    ...(magBeheren ? [{
      key: 'afspraken',
      label: 'Afspraken',
      hint: 'Wat er per wagen wel en niet mag',
      icon: ClipboardList,
      tint: 'oranje' as never,
      stat: mijnRegels.length,
      statLabel: mijnRegels.length === 1 ? 'afspraak' : 'afspraken',
      onClick: () => setPage('afspraken'),
    }] : []),
    {
      key: 'overleg',
      label: 'Overleg',
      hint: 'Contact met Truckwash1',
      icon: MessageSquare,
      tint: 'paars',
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    },
  ]

  return (
    <Shell
      roleLabel="Werkgever"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={`${werkgever.naam}${meta.subtitle ? ` · ${meta.subtitle}` : ''}`}
      actions={
        mijne.length > 1 ? (
          <select
            className="select hide-mobile"
            style={{ width: 200 }}
            value={werkgever.id}
            onChange={(e) => setGekozenId(e.target.value)}
          >
            {mijne.map((w) => (
              <option key={w.id} value={w.id}>{w.naam}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      {werkgever.status !== 'actief' && (
        <div className="waarschuwing mb">
          <ShieldAlert size={17} />
          <span>
            <strong>{WERKGEVER_STATUS[werkgever.status].label}.</strong>{' '}
            {werkgever.status === 'aangevraagd'
              ? 'Truckwash1 kijkt naar je aanvraag. Uitnodigen kan zodra het akkoord er is.'
              : werkgever.afwijzingReden ?? 'Neem contact op met Truckwash1.'}
          </span>
        </div>
      )}

      {page === 'start' && <Start tegels={tegels} onderschrift={werkgever.naam} />}
      {page === 'chauffeurs' && (
        <Chauffeurs werkgever={werkgever} chauffeurs={chauffeurs} beurten={beurten} />
      )}
      {page === 'beurten' && <Beurten beurten={beurten} chauffeurs={chauffeurs} />}
      {page === 'afspraken' && (
        <Afspraken werkgever={werkgever} regels={mijnRegels} beurten={beurten} />
      )}
      {page === 'overleg' && <Overleg />}
    </Shell>
  )
}

/* ================================================================== *
 *  Chauffeurs
 * ================================================================== */

function Chauffeurs({
  werkgever, chauffeurs, beurten,
}: {
  werkgever: Werkgever
  chauffeurs: WerkgeverKoppeling[]
  beurten: WashJob[]
}) {
  const me = useAuth((s) => s.user)!
  const [uitnodigen, setUitnodigen] = useState(false)
  const [eruit, setEruit] = useState<WerkgeverKoppeling | null>(null)

  const actief = chauffeurs.filter((c) => c.status === 'actief')

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Gekoppeld" value={actief.length} icon={<Users size={17} />} tone="ok" />
        <Stat
          label="Wacht op akkoord"
          value={chauffeurs.filter((c) => c.status === 'wacht op akkoord').length}
          icon={<Clock size={17} />}
          tone="warn"
        />
        <Stat
          label="Losgekoppeld"
          value={chauffeurs.filter((c) => c.status === 'beëindigd').length}
          icon={<UserMinus size={17} />}
        />
      </div>

      <Card
        title="Chauffeurs"
        hint="Zij zien de wasbeurten die op jouw naam staan"
        flush
        action={
          werkgever.status === 'actief' ? (
            <button className="btn primary sm" onClick={() => setUitnodigen(true)}>
              <UserPlus size={14} /> Uitnodigen
            </button>
          ) : undefined
        }
      >
        {chauffeurs.length === 0 ? (
          <Empty
            text="Nog geen chauffeurs. Nodig ze uit met hun e-mailadres."
            icon={<Users size={30} />}
          />
        ) : (
          <div className="chauffeur-lijst">
            {chauffeurs.map((c) => {
              const zijnBeurten = beurten.filter(
                (b) => b.createdBy === c.userId || b.assignedTo === c.userId).length
              const status = KOPPELING_STATUS[c.status]
              return (
                <div key={c.id} className={`chauffeur ${c.status === 'beëindigd' ? 'weg' : ''}`}>
                  <span className="av">{initials(c.naam)}</span>
                  <span className="tekst">
                    <span className="kop">
                      <strong>{c.naam}</strong>
                      <Badge tone={status.tone as never}>{status.label}</Badge>
                      {c.bestaandAccount && c.status === 'wacht op akkoord' && (
                        <Badge tone="info">bestaand account</Badge>
                      )}
                    </span>
                    <span className="meta">
                      {c.email} · uitgenodigd door {c.uitgenodigdDoorNaam}{' '}
                      {relative(c.uitgenodigdOp)}
                    </span>
                    {c.kentekens.length > 0 && (
                      <span className="kentekens">
                        {c.kentekens.map((k) => (
                          <span key={k} className="kenteken">{k}</span>
                        ))}
                      </span>
                    )}
                    {c.status === 'beëindigd' && c.beeindigdReden && (
                      <span className="reden">
                        Losgekoppeld door {c.beeindigdDoorNaam}: {c.beeindigdReden}
                      </span>
                    )}
                    {c.status === 'actief' && zijnBeurten > 0 && (
                      <span className="meta">{zijnBeurten} wasbeurten op zijn naam</span>
                    )}
                  </span>

                  {c.status === 'actief' && (
                    <button className="btn danger sm" onClick={() => setEruit(c)}>
                      <UserMinus size={14} /> Loskoppelen
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <UitnodigenDialoog
        open={uitnodigen}
        werkgever={werkgever}
        onClose={() => setUitnodigen(false)}
      />

      <LoskoppelenDialoog
        koppeling={eruit}
        door={me}
        onClose={() => setEruit(null)}
      />
    </>
  )
}

/* ================================================================== *
 *  Uitnodigen
 * ================================================================== */

function UitnodigenDialoog({
  open, werkgever, onClose,
}: {
  open: boolean
  werkgever: Werkgever
  onClose: () => void
}) {
  const [naam, setNaam] = useState('')
  const [email, setEmail] = useState('')
  const [bezig, setBezig] = useState(false)

  const adresOk = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())

  async function versturen() {
    if (naam.trim().length < 2) return toast.error('Vul de naam van de chauffeur in')
    if (!adresOk) return toast.error('Vul een geldig e-mailadres in')

    setBezig(true)
    try {
      const uitkomst = await koppelingen.uitnodigen({ werkgever, naam, email })

      if (!uitkomst.ok) {
        return toast.error(uitkomst.reden ?? 'Uitnodigen lukte niet')
      }

      if (uitkomst.soort === 'koppelverzoek') {
        toast.ok(
          `Er bestaat al een account op ${email.trim()}. ` +
          'We hebben gevraagd of het gekoppeld mag worden.',
        )
      } else {
        toast.ok(`${naam.trim()} heeft zijn inloggegevens per mail gekregen`)
      }

      setNaam(''); setEmail('')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Chauffeur uitnodigen"
      subtitle={`Voor ${werkgever.naam}`}
      onClose={onClose}
      width={520}
    >
      <Field label="Naam">
        <input
          className="input" value={naam} autoFocus
          onChange={(e) => setNaam(e.target.value)}
          placeholder="Jan de Vries"
        />
      </Field>

      <Field
        label="E-mailadres"
        help={email && !adresOk ? 'Dit ziet er niet uit als een e-mailadres.' : undefined}
      >
        <input
          className={`input ${email && !adresOk ? 'fout' : ''}`}
          type="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jan@bedrijf.nl"
        />
      </Field>

      <div className="signup-note">
        <Mail size={16} />
        <span>
          Bestaat er nog geen account op dit adres, dan maken we er een aan en
          krijgt hij een tijdelijk wachtwoord per mail. Bij de eerste inlog
          moet hij meteen zelf iets kiezen.
        </span>
      </div>

      <div className="aanmelding-let-op">
        <AlertTriangle size={16} />
        <span>
          Bestaat er wél al een account, dan koppelen we niets zomaar. Diegene
          krijgt de vraag of het mag — anders zou je met het adres van een
          willekeurige chauffeur zijn wasbeurten kunnen meelezen.
        </span>
      </div>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button className="btn primary" onClick={() => void versturen()} disabled={bezig}>
          {bezig ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />}
          Uitnodigen
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Loskoppelen
 * ================================================================== */

function LoskoppelenDialoog({
  koppeling, door, onClose,
}: {
  koppeling: WerkgeverKoppeling | null
  door: { id: string; name: string }
  onClose: () => void
}) {
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  if (!koppeling) return null

  return (
    <Modal
      open={!!koppeling}
      title={`${koppeling.naam} loskoppelen`}
      subtitle={koppeling.werkgeverNaam}
      onClose={onClose}
      width={500}
    >
      <p style={{ fontSize: '.88rem', color: 'var(--text-2)', lineHeight: 1.6, marginTop: 0 }}>
        Vanaf dat moment ziet {koppeling.naam.split(' ')[0]} de wasbeurten van
        dit bedrijf niet meer — ook niet de beurten die hij zelf heeft gebracht.
        Die zijn van het bedrijf, niet van hem.
      </p>
      <p style={{ fontSize: '.85rem', color: 'var(--text-3)', lineHeight: 1.55 }}>
        Zijn account blijft gewoon bestaan, net als zijn eigen gegevens. Rijdt
        hij ook voor een ander bedrijf, dan verandert daar niets.
      </p>

      <Field
        label="Reden"
        help="Komt in de mail die hij hierover krijgt. Zonder reden staat er dat die er niet is."
      >
        <textarea
          className="textarea" value={reden} autoFocus
          onChange={(e) => setReden(e.target.value)}
          placeholder="Bijv. uit dienst per 1 oktober"
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
              await koppelingen.beeindigen(koppeling, reden, door)
              toast.info(`${koppeling.naam} is losgekoppeld en heeft bericht gekregen`)
              setReden('')
              onClose()
            } finally { setBezig(false) }
          }}
        >
          <UserMinus size={15} /> Loskoppelen
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Wasbeurten
 * ================================================================== */

function Beurten({
  beurten, chauffeurs,
}: {
  beurten: WashJob[]
  chauffeurs: WerkgeverKoppeling[]
}) {
  const [zoek, setZoek] = useState('')

  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase().slice(0, 64)
    return beurten
      .filter((b) => !q || b.plate.toLowerCase().includes(q) ||
        (b.assignedName ?? '').toLowerCase().includes(q))
      .slice(0, 200)
  }, [beurten, zoek])

  const gereed = beurten.filter((b) => b.status === 'gereed')
  const bedrag = gereed
    .filter((b) => (b.completedAt ?? 0) > Date.now() - 30 * 86_400_000)
    .reduce((a, b) => a + b.priceExcl, 0)

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Totaal" value={beurten.length} icon={<Truck size={17} />} />
        <Stat label="Gereed" value={gereed.length} icon={<CheckCircle2 size={17} />} tone="ok" />
        <Stat label="Deze maand" value={money(bedrag)} icon={<Clock size={17} />} />
      </div>

      <Card
        title="Wasbeurten"
        hint="Alles wat op jouw naam is geschreven"
        flush
        action={
          <div className="chat-search" style={{ margin: 0, width: 210 }}>
            <input
              value={zoek}
              maxLength={64}
              onChange={(e) => setZoek(e.target.value)}
              placeholder="Kenteken of chauffeur"
            />
          </div>
        }
      >
        {lijst.length === 0 ? (
          <Empty
            text={beurten.length === 0
              ? 'Nog geen wasbeurten op naam van dit bedrijf.'
              : 'Niets gevonden.'}
            icon={<Truck size={30} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Kenteken</th>
                  <th>Behandeling</th>
                  <th>Wanneer</th>
                  <th>Door</th>
                  <th>Status</th>
                  <th className="num">Bedrag</th>
                </tr>
              </thead>
              <tbody>
                {lijst.map((b) => {
                  const chauffeur = chauffeurs.find(
                    (c) => c.userId === b.createdBy || c.userId === b.assignedTo)
                  return (
                    <tr key={b.id}>
                      <td><strong className="mono">{b.plate}</strong></td>
                      <td>{SERVICES[b.service].label}</td>
                      <td>
                        <span className="mono">{dateTime(b.scheduledAt)}</span>
                      </td>
                      <td style={{ color: 'var(--text-3)' }}>
                        {chauffeur?.naam ?? b.assignedName ?? '—'}
                      </td>
                      <td>
                        <Badge tone={
                          b.status === 'gereed' ? 'ok' :
                          b.status === 'bezig' ? 'brand' :
                          b.status === 'geannuleerd' ? 'danger' : 'default'
                        }>
                          {b.status}
                        </Badge>
                      </td>
                      <td className="num">{money(b.priceExcl)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

/* ================================================================== *
 *  Afspraken
 * ================================================================== */

function Afspraken({
  werkgever, regels: mijnRegels, beurten,
}: {
  werkgever: Werkgever
  regels: WerkgeverRegel[]
  beurten: WashJob[]
}) {
  const me = useAuth((s) => s.user)!
  const [nieuw, setNieuw] = useState(false)

  /** De kentekens die we van dit bedrijf kennen, uit de historie. */
  const kentekens = useMemo(
    () => [...new Set(beurten.map((b) => b.plate))].sort(),
    [beurten],
  )

  return (
    <>
      <Card className="mb">
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <ShieldAlert size={18} style={{ color: 'var(--brand)', flex: 'none', marginTop: 2 }} />
          <div style={{ fontSize: '.87rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
            <strong>Waar dit voor is.</strong> Een chauffeur die op kosten van
            de zaak een polijstbeurt van {money(SERVICES.polish.price)} afneemt
            terwijl er een buitenwas was afgesproken, is een gesprek achteraf.
            Wat je hier vastlegt komt bij die wagen niet in beeld — ook niet
            aan de kassa.
          </div>
        </div>
      </Card>

      <Card
        title="Afspraken"
        hint={`${mijnRegels.length} ${mijnRegels.length === 1 ? 'regel' : 'regels'}`}
        flush
        action={
          <button className="btn primary sm" onClick={() => setNieuw(true)}>
            <Plus size={14} /> Afspraak toevoegen
          </button>
        }
      >
        {mijnRegels.length === 0 ? (
          <Empty
            text="Nog geen afspraken. Zonder afspraken mag alles."
            icon={<ClipboardList size={30} />}
          />
        ) : (
          <div className="regel-lijst">
            {mijnRegels.map((r) => {
              const soort = REGEL_SOORTEN[r.soort]
              return (
                <div key={r.id} className={`regel t-${soort.tone}`}>
                  <span className="wat">
                    <strong>
                      {r.service ? SERVICES[r.service].label : r.productCode ?? 'Onbekend'}
                    </strong>
                    <Badge tone={soort.tone as never}>{soort.label}</Badge>
                  </span>
                  <span className="waar">
                    {r.kenteken
                      ? <span className="kenteken">{r.kenteken}</span>
                      : <span className="alles">alle wagens</span>}
                  </span>
                  {r.reden && <span className="reden">{r.reden}</span>}
                  <button
                    className="btn ghost sm"
                    onClick={() => void regels.verwijderen(r.id).then(
                      () => toast.info('Afspraak verwijderd'))}
                    title="Weghalen"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Even nakijken wat er nu voor een wagen geldt. */}
      {kentekens.length > 0 && mijnRegels.length > 0 && (
        <Proefje werkgeverId={werkgever.id} kentekens={kentekens} regels={mijnRegels} />
      )}

      <NieuweAfspraak
        open={nieuw}
        werkgever={werkgever}
        kentekens={kentekens}
        door={me}
        onClose={() => setNieuw(false)}
      />
    </>
  )
}

/** Laat zien wat er voor één wagen geldt; scheelt uitzoeken achteraf. */
function Proefje({
  werkgeverId, kentekens, regels: mijnRegels,
}: {
  werkgeverId: string
  kentekens: string[]
  regels: WerkgeverRegel[]
}) {
  const [kenteken, setKenteken] = useState(kentekens[0])

  return (
    <Card title="Wat geldt er voor deze wagen?" className="mt">
      <Field label="Kenteken">
        <select className="select" value={kenteken} onChange={(e) => setKenteken(e.target.value)}>
          {kentekens.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>

      <div className="proef-lijst">
        {(Object.keys(SERVICES) as ServiceKind[]).map((s) => {
          const uitkomst = magAfnemen(mijnRegels, { werkgeverId, kenteken, service: s })
          return (
            <div
              key={s}
              className={`proef ${!uitkomst.toegestaan ? 'nee' : uitkomst.akkoordNodig ? 'misschien' : 'ja'}`}
            >
              <span className="ico">
                {!uitkomst.toegestaan ? <X size={15} />
                  : uitkomst.akkoordNodig ? <AlertTriangle size={15} />
                  : <CheckCircle2 size={15} />}
              </span>
              <span className="tekst">
                <strong>{SERVICES[s].label}</strong>
                <span>
                  {!uitkomst.toegestaan ? 'Niet toegestaan'
                    : uitkomst.akkoordNodig ? 'Alleen met akkoord'
                    : 'Mag'}
                  {uitkomst.reden ? ` — ${uitkomst.reden}` : ''}
                </span>
              </span>
              <span className="prijs">{money(SERVICES[s].price)}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function NieuweAfspraak({
  open, werkgever, kentekens, door, onClose,
}: {
  open: boolean
  werkgever: Werkgever
  kentekens: string[]
  door: { id: string }
  onClose: () => void
}) {
  const [kenteken, setKenteken] = useState('')
  const [service, setService] = useState<ServiceKind>('polish')
  const [soort, setSoort] = useState<RegelSoort>('niet toegestaan')
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)

  async function opslaan() {
    setBezig(true)
    try {
      await regels.toevoegen({
        werkgeverId: werkgever.id,
        kenteken: kenteken || undefined,
        service,
        soort,
        reden,
        door,
      })
      toast.ok('Afspraak vastgelegd')
      setKenteken(''); setReden('')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Afspraak toevoegen"
      subtitle="Wat er bij welke wagen wel en niet mag"
      onClose={onClose}
      width={560}
    >
      <Field label="Welke behandeling">
        <select
          className="select" value={service}
          onChange={(e) => setService(e.target.value as ServiceKind)}
        >
          {(Object.keys(SERVICES) as ServiceKind[]).map((s) => (
            <option key={s} value={s}>
              {SERVICES[s].label} — {money(SERVICES[s].price)}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Voor welke wagen"
        help="Laat leeg om het voor alle wagens van dit bedrijf te laten gelden."
      >
        {kentekens.length > 0 ? (
          <select className="select" value={kenteken} onChange={(e) => setKenteken(e.target.value)}>
            <option value="">Alle wagens</option>
            {kentekens.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : (
          <input
            className="input mono" value={kenteken}
            onChange={(e) => setKenteken(e.target.value.toUpperCase())}
            placeholder="12-BND-4 (leeg = alle wagens)"
          />
        )}
      </Field>

      <Field label="Wat geldt er">
        <div className="kind-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {(Object.keys(REGEL_SOORTEN) as RegelSoort[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`kind ${soort === k ? 'on' : ''}`}
              onClick={() => setSoort(k)}
            >
              {k === 'niet toegestaan' ? <X size={17} /> : <AlertTriangle size={17} />}
              <strong>{REGEL_SOORTEN[k].label}</strong>
              <span>{REGEL_SOORTEN[k].hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Reden (optioneel)" help="Handig voor je opvolger, en voor de balie.">
        <input
          className="input" value={reden}
          onChange={(e) => setReden(e.target.value)}
          placeholder="Bijv. alleen na overleg met de wagenparkbeheerder"
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button className="btn primary" onClick={() => void opslaan()} disabled={bezig}>
          <Plus size={15} /> Vastleggen
        </button>
      </div>
    </Modal>
  )
}
