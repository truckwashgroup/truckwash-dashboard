import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, Ban, Check, ClipboardCopy, Copy, KeyRound, Loader2, MapPin,
  Monitor, Plus, Power, Receipt, ShieldCheck, Trash2, Vault, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import {
  apparaatVan, bewegingenVan, codeProbleem, coupureLabel, coupuresOpVolgorde,
  GELDIGHEID, kassas as kassaRepo, kluisVan, koppelcodes, laatsteBonnen,
  laatsteTelling, openCodes, saldoVan, schoonCode, stilte, tellingAchterstallig,
  toonCode, voorstelCode, waardeVan, apparaten as apparaatRepo,
  type LaatsteBon,
} from '../../lib/kassa'
import {
  POS_DEVICE_STATUS, SAFE_MOVE_SOORT,
  type Location, type PosDevice, type PosPairing, type PosRegister,
  type PosSafe, type PosSafeMove,
} from '../../lib/types'
import { dateTime, duration, money, nogGeldig, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Kassa's
 *
 *  De beheerkant van het kassasysteem: welke kassa's er zijn, welk apparaat
 *  erop staat, en wat er in de kluis zit.
 *
 *  Twee dingen die dit scherm bewust niet kan. De printer- en
 *  pinautomaatinstellingen zet de kassa zelf -- die weet welk apparaat eraan
 *  hangt -- dus die staan hier alleen ter informatie. En een kluisboeking is
 *  niet te wijzigen of te wissen; de database weigert dat, en een knop die
 *  alleen een foutmelding oplevert is erger dan geen knop.
 * ------------------------------------------------------------------ */

export default function Kassas() {
  const [tab, setTab] = useState<'kassas' | 'kluis'>('kassas')
  const perms = usePerms()

  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button
          className={`btn sm ${tab === 'kassas' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('kassas')}
        >
          <Monitor size={14} /> Kassa's en apparaten
        </button>
        {perms.can('pos.safe') && (
          <button
            className={`btn sm ${tab === 'kluis' ? 'primary' : 'ghost'}`}
            onClick={() => setTab('kluis')}
          >
            <Vault size={14} /> Kluis
          </button>
        )}
      </div>

      {tab === 'kassas' ? <KassaBeheer /> : <Kluizen />}
    </>
  )
}

/* ================================================================== *
 *  De kassa's, per vestiging
 * ================================================================== */

function KassaBeheer() {
  const [nieuw, setNieuw] = useState<Location | null>(null)
  const [bonnen, setBonnen] = useState<Map<string, LaatsteBon>>(new Map())

  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const alle = useLiveQuery(() => db.posRegisters.toArray(), [], [] as PosRegister[])
  const apparaten = useLiveQuery(() => db.posDevices.toArray(), [], [] as PosDevice[])

  // Eén keer bij het openen; het verkoopjournaal halen we niet binnen.
  useEffect(() => { void laatsteBonnen().then(setBonnen) }, [])

  const metKassas = useMemo(
    () => locaties
      .map((l) => ({ locatie: l, kassas: alle.filter((r) => r.locationId === l.id) }))
      .filter((r) => r.kassas.length > 0 || r.locatie.kind !== 'hoofdkantoor')
      .sort((a, b) => a.locatie.name.localeCompare(b.locatie.name)),
    [locaties, alle],
  )

  const actief = apparaten.filter((a) => a.status === 'actief').length
  const stil = apparaten.filter(
    (a) => a.status === 'actief' && (stilte(a) ?? 0) > 3 * 86_400_000).length

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat label="Kassa's" value={alle.length} icon={<Monitor size={17} />} />
        <Stat label="Apparaten actief" value={actief} icon={<Check size={17} />} tone="ok" />
        <Stat
          label="Al dagen stil"
          value={stil}
          icon={<AlertTriangle size={17} />}
          tone={stil ? 'warn' : undefined}
        />
      </div>

      {metKassas.map(({ locatie, kassas }) => (
        <Card
          key={locatie.id}
          title={locatie.name}
          hint={`${locatie.code} · ${kassas.length} ${kassas.length === 1 ? 'kassa' : "kassa's"}`}
          className="mb"
          flush
          action={
            <button className="btn sm" onClick={() => setNieuw(locatie)}>
              <Plus size={14} /> Kassa erbij
            </button>
          }
        >
          {kassas.length === 0 ? (
            <Empty text="Op deze vestiging staat nog geen kassa." icon={<Monitor size={28} />} />
          ) : (
            <div className="kassa-lijst">
              {kassas
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((k) => (
                  <KassaRegel
                    key={k.id}
                    kassa={k}
                    apparaat={apparaatVan(apparaten, k.id)}
                    bon={bonnen.get(k.id)}
                  />
                ))}
            </div>
          )}
        </Card>
      ))}

      <NieuweKassa
        locatie={nieuw}
        bestaand={alle}
        onClose={() => setNieuw(null)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén kassa
 * ------------------------------------------------------------------ */

function KassaRegel({
  kassa, apparaat, bon,
}: {
  kassa: PosRegister
  apparaat?: PosDevice
  bon?: LaatsteBon
}) {
  const me = useAuth((s) => s.user)!
  const [koppelen, setKoppelen] = useState(false)
  const [bezig, setBezig] = useState(false)

  const codes = useLiveQuery(() => db.posPairings.toArray(), [], [] as PosPairing[])
  const open = openCodes(codes, kassa.id)

  const stilSinds = apparaat ? stilte(apparaat) : null
  const langStil = stilSinds !== null && stilSinds > 3 * 86_400_000

  return (
    <div className={`kassa-regel ${kassa.active ? '' : 'uit'}`}>
      <div className="kop">
        <span className="code">{kassa.code}</span>
        <strong>{kassa.name}</strong>
        {!kassa.active && <Badge tone="default">Uit</Badge>}
        {apparaat && (
          <Badge tone={POS_DEVICE_STATUS[apparaat.status].tone as never}>
            {POS_DEVICE_STATUS[apparaat.status].label}
          </Badge>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="btn ghost sm"
          onClick={() => void kassaRepo.aanUit(kassa, !kassa.active)}
          title={kassa.active
            ? 'Uitzetten: er kan geen nieuw apparaat meer op gekoppeld worden'
            : 'Weer aanzetten'}
        >
          <Power size={14} />
        </button>
      </div>

      <div className="cijfers">
        <span><Receipt size={13} /> {kassa.lastSeq} bonnen</span>
        {bon && (
          <span title={dateTime(bon.op)}>
            laatste {bon.bonnummer} · {money(bon.bedrag)} · {relative(bon.op)}
          </span>
        )}
      </div>

      {/* --------------------------- het apparaat ------------------- */}

      {apparaat ? (
        <Apparaat apparaat={apparaat} langStil={langStil} stilSinds={stilSinds} />
      ) : (
        <div className="geen-apparaat">
          <Monitor size={15} />
          <span>Er staat nog geen apparaat op deze kassa.</span>
        </div>
      )}

      {/* -------------------------- de koppelcodes ------------------ */}

      {open.length > 0 && (
        <div className="codes">
          {open.map((c) => (
            <div className="code-regel" key={c.id}>
              <span className="cijfers-groot">{toonCode(c.code)}</span>
              <span className="tot">verloopt {nogGeldig(c.expiresAt)}</span>
              <button
                className="btn ghost sm"
                onClick={() => {
                  void navigator.clipboard.writeText(toonCode(c.code))
                    .then(() => toast.ok('Code gekopieerd'))
                    .catch(() => toast.error('Kopiëren lukte niet'))
                }}
                title="Kopiëren"
              ><Copy size={13} /></button>
              <button
                className="btn ghost sm"
                onClick={() => void koppelcodes.intrekken(c)
                  .then(() => toast.info('Code ingetrokken'))}
                title="Intrekken"
              ><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn sm"
          disabled={!kassa.active || bezig}
          title={kassa.active
            ? undefined
            : 'Deze kassa staat uit; zet hem aan om te kunnen koppelen'}
          onClick={() => setKoppelen(true)}
        >
          <KeyRound size={14} /> Koppelcode maken
        </button>
      </div>

      <KoppelcodeDialoog
        open={koppelen}
        kassa={kassa}
        door={me}
        bezetDoor={apparaat}
        onClose={() => setKoppelen(false)}
        onBezig={setBezig}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Het apparaat dat op een kassa staat
 * ------------------------------------------------------------------ */

function Apparaat({
  apparaat, langStil, stilSinds,
}: {
  apparaat: PosDevice
  langStil: boolean
  stilSinds: number | null
}) {
  const [bezig, setBezig] = useState(false)
  const [wissen, setWissen] = useState(false)
  const [forceren, setForceren] = useState(false)
  const [reden, setReden] = useState('')

  const ingetrokken = apparaat.status === 'ingetrokken'
  const klaar = !!apparaat.wipedAt

  /*
   * Wanneer je mag opgeven op een apparaat dat zich niet afmeldt.
   *
   * Een levende kassa meldt zich elk uur. Wie twee uur zwijgt komt dus niet
   * "zo meteen nog even" langs, en dan is wachten geen strategie meer maar
   * uitstel. Onder die grens laten we deze knop weg: iemand die net op Eruit
   * gooien heeft gedrukt hoort de kassa zijn werk te laten doen.
   *
   * Een apparaat dat zich nog nooit heeft gemeld telt ook mee -- daar valt
   * per definitie niets van te verwachten.
   */
  const TWEE_UUR = 2 * 60 * 60_000
  const komtNietMeer = !apparaat.lastSeenAt
    || Date.now() - apparaat.lastSeenAt > TWEE_UUR

  return (
    <div className="apparaat">
      <div className="wat">
        <Monitor size={15} />
        <span className="n">{apparaat.name || 'Naamloos apparaat'}</span>
        {/*
          * De versie hoort hier te staan, want de kassa werkt zichzelf bij.
          * "Hij doet het vanzelf" is een bewering tot je het kunt nakijken --
          * en zonder dit nummer is er geen enkele manier om te zien welke
          * tablet achterloopt.
          *
          * Staat er niets, dan is dat zelf een antwoord: een kassa meldt zijn
          * versie pas vanaf 0.16.0. Vandaar dat hier niet een leeg vakje komt
          * maar "versie onbekend" -- leeg leest als "dit veld doet niets", en
          * dan gaat niemand er meer naar kijken.
          */}
        <span className="s" title={apparaat.appVersion
          ? undefined
          : 'Deze kassa heeft zijn versie niet gemeld. Dat doen ze vanaf 0.16.0, '
            + 'dus hij staat op een oudere versie.'}>
          {apparaat.platform}
          {apparaat.appVersion
            ? ` · v${apparaat.appVersion}`
            : ' · versie onbekend'}
        </span>
        <span className={`s ${langStil ? 'stil' : ''}`}>
          {apparaat.lastSeenAt
            ? `laatst gezien ${relative(apparaat.lastSeenAt)}`
            : 'heeft zich nog niet gemeld'}
          {langStil && stilSinds !== null && ` (${duration(stilSinds)})`}
        </span>
      </div>

      {/*
        * Intrekken is geen handeling maar een opdracht. De kassa ziet hem bij
        * zijn volgende ronde, stuurt eerst zijn wachtrij leeg en wist zichzelf
        * daarna. Zolang dat niet is gebeurd kan er omzet op staan die nog niet
        * binnen is -- en dan mag het inlogaccount er niet af.
        */}
      {ingetrokken && (
        <div className={`afmelding ${klaar ? 'klaar' : 'wacht'}`}>
          {klaar ? <ShieldCheck size={15} /> : <Loader2 size={15} className="spin" />}
          <span>
            {klaar
              ? `Afgemeld op ${dateTime(apparaat.wipedAt!)}. Wat erop stond is binnen.`
              : 'Wacht op afmelden. Het apparaat stuurt eerst zijn wachtrij leeg ' +
                'en wist zichzelf daarna; tot die tijd kan er omzet op staan.'}
          </span>
        </div>
      )}

      <div className="row" style={{ gap: 6 }}>
        {apparaat.status === 'actief' && (
          <button
            className="btn sm"
            disabled={bezig}
            onClick={async () => {
              setBezig(true)
              try {
                await apparaatRepo.blokkeren(apparaat)
                toast.info('Geblokkeerd — de kassa blijft wel versturen wat er nog op staat')
              } finally { setBezig(false) }
            }}
          >
            <Ban size={14} /> Blokkeren
          </button>
        )}

        {apparaat.status === 'geblokkeerd' && (
          <button
            className="btn ok sm"
            disabled={bezig}
            onClick={async () => {
              setBezig(true)
              try {
                await apparaatRepo.vrijgeven(apparaat)
                toast.ok('Weer aangezet — er is geen nieuwe code nodig')
              } finally { setBezig(false) }
            }}
          >
            <Check size={14} /> Weer aanzetten
          </button>
        )}

        {!ingetrokken && (
          <button
            className="btn danger sm"
            disabled={bezig}
            onClick={async () => {
              setBezig(true)
              try {
                await apparaatRepo.intrekken(apparaat)
                toast.info('Opdracht verstuurd — het apparaat meldt zich af zodra het kan')
              } finally { setBezig(false) }
            }}
          >
            <Trash2 size={14} /> Eruit gooien
          </button>
        )}

        {ingetrokken && klaar && (
          <button className="btn danger sm" onClick={() => setWissen(true)}>
            <Trash2 size={14} /> Apparaat definitief wissen
          </button>
        )}

        {ingetrokken && !klaar && komtNietMeer && (
          <button className="btn ghost sm" onClick={() => setForceren(true)}>
            <AlertTriangle size={14} /> Meldt zich niet af
          </button>
        )}
      </div>

      <Modal
        open={wissen}
        title="Apparaat definitief wissen"
        subtitle="Het inlogaccount en het dossier gaan weg"
        onClose={() => setWissen(false)}
      >
        <div className="signup-note">
          <ShieldCheck size={16} />
          <span>
            Dit apparaat heeft zich afgemeld op {dateTime(apparaat.wipedAt ?? 0)},
            dus alles wat erop stond is binnen. Wat nu weggaat is het
            inlogaccount waarmee het meepraatte — de bonnen die het heeft
            gemaakt blijven staan.
          </span>
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={() => setWissen(false)}>Annuleren</button>
          <button
            className="btn danger"
            disabled={bezig}
            onClick={async () => {
              setBezig(true)
              try {
                const uit = await apparaatRepo.definitiefWissen(apparaat)
                if (!uit.ok) return toast.error(uit.reden ?? 'Wissen lukte niet')
                setWissen(false)
                toast.ok('Apparaat gewist')
              } finally { setBezig(false) }
            }}
          >
            <Trash2 size={15} /> Wissen
          </button>
        </div>
      </Modal>

      {/*
        * De uitweg voor een apparaat dat zich nooit meer afmeldt.
        *
        * Dit venster praat het niet goed. Wat hier weggaat kan omzet bevatten
        * die alleen op dat toestel bestond, en dat staat er dan ook zo. Wat
        * het wel doet is de keuze mogelijk maken: zonder deze knop bleef een
        * kwijtgeraakte tablet voor altijd als "wacht op afmelden" in de lijst
        * staan, en dan is er geen beslissing meer te nemen -- alleen nog een
        * regel die je moet negeren.
        *
        * De reden is verplicht en gaat het verwijderlogboek in.
        */}
      <Modal
        open={forceren}
        title="Dit apparaat meldt zich niet af"
        subtitle="Wegwissen zonder dat de wachtrij binnen is"
        onClose={() => { setForceren(false); setReden('') }}
      >
        <div className="waarschuwing">
          <AlertTriangle size={16} />
          <span>
            {apparaat.lastSeenAt
              ? `Deze kassa heeft zich voor het laatst gemeld ${relative(apparaat.lastSeenAt)}`
                + (stilSinds !== null ? ` (${duration(stilSinds)} geleden)` : '')
                + '. '
              : 'Deze kassa heeft zich nog nooit gemeld. '}
            Zolang hij zich niet afmeldt, weet niemand of er nog bonnen op
            stonden die nooit zijn verstuurd. Wist je hem nu, dan komt die
            omzet ook nooit meer binnen — en dat merk je pas bij de
            maandafsluiting.
          </span>
        </div>
        <div className="signup-note">
          <ShieldCheck size={16} />
          <span>
            Doe dit alleen als het toestel echt weg is: kwijt, kapot, of
            opnieuw ingericht. Staat hij ergens uit, zet hem dan één keer aan —
            hij maakt zijn wachtrij leeg en meldt zich vanzelf af, en dan kun
            je hem gewoon wissen.
          </span>
        </div>
        <Field label="Waarom mag dit toch weg?">
          <input
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="bijv. tablet gestolen in Aalsmeer, aangifte gedaan"
            maxLength={200}
          />
        </Field>
        <div className="row end">
          <button
            className="btn ghost"
            onClick={() => { setForceren(false); setReden('') }}
          >
            Annuleren
          </button>
          <button
            className="btn danger"
            disabled={bezig || reden.trim().length < 3}
            onClick={async () => {
              setBezig(true)
              try {
                const uit = await apparaatRepo.definitiefWissen(apparaat, {
                  forceren: true, reden,
                })
                if (!uit.ok) return toast.error(uit.reden ?? 'Wissen lukte niet')
                setForceren(false)
                setReden('')
                toast.ok('Apparaat gewist — vastgelegd in het verwijderlogboek')
              } finally { setBezig(false) }
            }}
          >
            <Trash2 size={15} /> Toch wissen
          </button>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Een koppelcode maken
 * ------------------------------------------------------------------ */

function KoppelcodeDialoog({
  open, kassa, door, bezetDoor, onClose, onBezig,
}: {
  open: boolean
  kassa: PosRegister
  door: { id: string; name: string }
  bezetDoor?: PosDevice
  onClose: () => void
  onBezig: (v: boolean) => void
}) {
  const [uren, setUren] = useState(24)
  const [gemaakt, setGemaakt] = useState<PosPairing | null>(null)
  const [bezig, setBezig] = useState(false)

  const bezet = bezetDoor && bezetDoor.status !== 'ingetrokken'

  return (
    <Modal
      open={open}
      title={`Koppelcode voor ${kassa.code}`}
      subtitle="Het apparaat tikt deze code in en is daarna gekoppeld"
      onClose={() => { setGemaakt(null); onClose() }}
    >
      {bezet && !gemaakt && (
        <div className="waarschuwing zacht mb">
          <AlertTriangle size={17} />
          <span>
            Op deze kassa staat al een apparaat ({bezetDoor!.name || 'naamloos'}).
            Er kan er maar één tegelijk op — twee apparaten geven dezelfde
            bonnummers. Gooi het oude er eerst uit.
          </span>
        </div>
      )}

      {gemaakt ? (
        <>
          <div className="koppelcode-groot">
            <span className="code">{toonCode(gemaakt.code)}</span>
            <span className="tot">Verloopt {nogGeldig(gemaakt.expiresAt)}</span>
          </div>

          <div className="signup-note">
            <KeyRound size={16} />
            <span>
              Tik deze code in op de kassa. De streepjes mag je meetikken, die
              haalt hij eruit. De code werkt één keer, en daarna niet meer.
            </span>
          </div>

          <div className="row end">
            <button className="btn ghost" onClick={() => { setGemaakt(null); onClose() }}>
              Sluiten
            </button>
            <button
              className="btn primary"
              onClick={() => {
                void navigator.clipboard.writeText(toonCode(gemaakt.code))
                  .then(() => toast.ok('Code gekopieerd'))
                  .catch(() => toast.error('Kopiëren lukte niet'))
              }}
            >
              <ClipboardCopy size={15} /> Kopieer de code
            </button>
          </div>
        </>
      ) : (
        <>
          <Field label="Hoe lang blijft de code geldig?">
            <select
              className="select"
              value={uren}
              onChange={(e) => setUren(Number(e.target.value))}
            >
              {GELDIGHEID.map((g) => (
                <option key={g.uren} value={g.uren}>{g.label}</option>
              ))}
            </select>
          </Field>

          <div className="row end">
            <button className="btn ghost" onClick={onClose}>Annuleren</button>
            <button
              className="btn primary"
              disabled={bezig}
              onClick={async () => {
                setBezig(true); onBezig(true)
                try {
                  setGemaakt(await koppelcodes.maken({ kassa, urenGeldig: uren, door }))
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Code maken lukte niet')
                } finally { setBezig(false); onBezig(false) }
              }}
            >
              {bezig ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              Code maken
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Een kassa erbij
 * ------------------------------------------------------------------ */

function NieuweKassa({
  locatie, bestaand, onClose,
}: {
  locatie: Location | null
  bestaand: PosRegister[]
  onClose: () => void
}) {
  const [code, setCode] = useState('')
  const [naam, setNaam] = useState('')
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    if (locatie) {
      setCode(voorstelCode(locatie, bestaand))
      setNaam('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locatie?.id])

  const probleem = code ? codeProbleem(code, bestaand) : null

  return (
    <Modal
      open={!!locatie}
      title={locatie ? `Kassa erbij op ${locatie.name}` : ''}
      subtitle="De code komt op elke bon te staan"
      onClose={onClose}
    >
      <Field
        label="Code"
        help={probleem ?? `Wordt opgeslagen als ${schoonCode(code) || '—'}`}
      >
        <input
          className={`input mono ${probleem ? 'fout' : ''}`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="KAS-UTR-1"
        />
      </Field>

      <Field label="Naam" help="Waar staat hij? Bijv. Balie, Buitenzuil.">
        <input
          className="input"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
          placeholder="Balie"
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className="btn primary"
          disabled={bezig || !!probleem || !naam.trim() || !locatie}
          onClick={async () => {
            if (!locatie) return
            setBezig(true)
            try {
              await kassaRepo.aanmaken({ code, naam, locationId: locatie.id })
              toast.ok(`${schoonCode(code)} staat erin`)
              onClose()
            } finally { setBezig(false) }
          }}
        >
          <Plus size={15} /> Aanmaken
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  De kluis
 * ================================================================== */

function Kluizen() {
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const kluizen = useLiveQuery(() => db.posSafes.toArray(), [], [] as PosSafe[])
  const bewegingen = useLiveQuery(() => db.posSafeMoves.toArray(), [], [] as PosSafeMove[])

  const [open, setOpen] = useState<string | null>(null)

  const rijen = useMemo(
    () => locaties
      .map((l) => ({ locatie: l, kluis: kluisVan(kluizen, l.id) }))
      .filter((r) => !!r.kluis)
      .map((r) => ({
        ...r,
        saldo: saldoVan(bewegingen, r.kluis!.id),
        telling: tellingAchterstallig(bewegingen, r.kluis!.id),
      }))
      .sort((a, b) => a.locatie.name.localeCompare(b.locatie.name)),
    [locaties, kluizen, bewegingen],
  )

  const totaal = rijen.reduce((a, r) => a + r.saldo, 0)
  const achter = rijen.filter((r) => r.telling.achterstallig).length

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat label="In de kluizen" value={money(totaal)} icon={<Vault size={17} />} />
        <Stat label="Kluizen" value={rijen.length} icon={<MapPin size={17} />} />
        <Stat
          label="Te lang niet geteld"
          value={achter}
          icon={<AlertTriangle size={17} />}
          tone={achter ? 'warn' : undefined}
        />
      </div>

      {achter > 0 && (
        <div className="waarschuwing zacht mb">
          <AlertTriangle size={17} />
          <span>
            <strong>
              {achter === 1 ? 'Eén kluis is te lang niet geteld.' : `${achter} kluizen zijn te lang niet geteld.`}
            </strong>{' '}
            Zonder telling weet niemand of de administratie nog met de kluis
            klopt — het saldo hieronder is dan een optelsom van boekingen en
            geen vaststelling.
          </span>
        </div>
      )}

      {rijen.map(({ locatie, kluis, saldo, telling }) => (
        <Card
          key={kluis!.id}
          title={locatie.name}
          hint={telling.nooit
            ? 'Nog nooit geteld'
            : `Laatst geteld ${relative(telling.sinds!)}`}
          className="mb"
          action={
            <button
              className="btn sm ghost"
              onClick={() => setOpen(open === kluis!.id ? null : kluis!.id)}
            >
              {open === kluis!.id ? 'Inklappen' : 'Boekingen'}
            </button>
          }
        >
          <div className="kluis-kop">
            <div className="saldo">
              <span className="l">In de kluis</span>
              <span className="b">{money(saldo)}</span>
            </div>
            {telling.achterstallig && (
              <Badge tone="warn">
                <AlertTriangle size={11} /> {telling.nooit ? 'nooit geteld' : 'tel hem'}
              </Badge>
            )}
          </div>

          {open === kluis!.id && (
            <Boekingen bewegingen={bewegingenVan(bewegingen, kluis!.id)} />
          )}
        </Card>
      ))}

      {rijen.length === 0 && (
        <Card>
          <Empty
            text="Er zijn nog geen kluizen. Die worden aangemaakt zodra het schema is bijgewerkt."
            icon={<Vault size={30} />}
          />
        </Card>
      )}
    </>
  )
}

function Boekingen({ bewegingen }: { bewegingen: PosSafeMove[] }) {
  if (bewegingen.length === 0) {
    return <Empty text="Nog geen boekingen." icon={<Vault size={28} />} />
  }

  return (
    <div className="kluis-lijst">
      {bewegingen.map((m) => {
        const telling = m.soort === 'telling'
        const inhoud = coupuresOpVolgorde(telling ? m.counted : m.coins)
        return (
          <div className={`kluis-boeking ${telling ? 'telling' : ''}`} key={m.id}>
            <div className="kop">
              <strong>{SAFE_MOVE_SOORT[m.soort].label}</strong>
              {telling ? (
                <>
                  <span className="bedrag">{money(waardeVan(m.counted))} geteld</span>
                  {m.difference !== undefined && m.difference !== 0 && (
                    <Badge tone={Math.abs(m.difference) > 5 ? 'danger' : 'warn'}>
                      {m.difference > 0 ? '+' : ''}{money(m.difference)} verschil
                    </Badge>
                  )}
                  {m.difference === 0 && <Badge tone="ok">klopte precies</Badge>}
                </>
              ) : (
                <span className={`bedrag ${m.amount < 0 ? 'af' : 'bij'}`}>
                  {m.amount > 0 ? '+' : ''}{money(m.amount)}
                </span>
              )}
              <span className="wanneer">{dateTime(m.at)}</span>
            </div>

            <div className="wie">
              {m.userName || 'onbekend'}
              {m.reason ? ` · ${m.reason}` : ''}
              {telling && m.expected !== undefined && ` · verwacht ${money(m.expected)}`}
            </div>

            {inhoud.length > 0 && (
              <div className="coupures">
                {inhoud.map(([sleutel, aantal]) => (
                  <span className="coupure" key={sleutel}>
                    <span className="aantal">{aantal}×</span> {coupureLabel(sleutel)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
