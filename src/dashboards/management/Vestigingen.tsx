import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Building2, Camera, Check, ChevronDown, ChevronRight, Clock, Compass,
  Globe, GripVertical, Image as ImageIcon, Link2, Loader2, MapPin, Plus, Power, Search, Star,
  Trash2, Upload, X,
} from 'lucide-react'
import { alleMensen, db } from '../../lib/db'
import {
  adresRegel, bezetting, codeProbleem, fotoUrl, publiekeFotoUrl,
  fotos as fotoRepo, nuOpen, opVolgorde, slugProbleem, standaardTijden, tijdenInHetKort,
  tijdProbleem, vestigingen as repo, voorstelSlug, vrijeCode, voorstelCode,
  websiteGaten, WEBSITE_DIENSTEN, zoekAdres,
  FotoProbleem, VestigingBezet,
  type Bezetting,
} from '../../lib/vestigingen'
import { WEEKDAGEN, type Location, type LocationKind, type LocationPhoto, type Openingstijden, type User } from '../../lib/types'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
// De opmaak van alles wat met de foto's te maken heeft (.vf-). Los van
// theme.css, zodat het scherm zelf en de foto's apart te lezen zijn.
import '../../styles/vestigingen.css'

/* ------------------------------------------------------------------ *
 *  Vestigingen
 *
 *  Aanmaken, wijzigen, foto's erbij, en weghalen.
 *
 *  Dat laatste is het stuk waar de meeste zorg in zit en het minste te zien
 *  is. Op een vestiging hangen installaties, storingen, werkbonnen, voorraad,
 *  roosters, kassa's en een kluis -- en een deel van die verwijzingen staat
 *  in de database op "cascade". Wissen zonder te kijken zou een halve
 *  administratie meenemen zonder een woord.
 *
 *  Dus staat er bij de knop wat eraan hangt, en weigert de database het
 *  daarnaast ook zelf. Twee sloten, want een scherm is te omzeilen en een
 *  database legt niets uit.
 * ------------------------------------------------------------------ */

export default function Vestigingen() {
  const perms = usePerms()
  const mag = perms.can('locations.manage')

  const [open, setOpen] = useState<string | null>(null)
  const [nieuw, setNieuw] = useState(false)

  const alle = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const fotos = useLiveQuery(() => db.locationPhotos.toArray(), [], [] as LocationPhoto[])

  const gesorteerd = useMemo(
    () => [...alle].sort((a, b) =>
      Number(b.active) - Number(a.active)
      || (a.kind === 'hoofdkantoor' ? -1 : 0) - (b.kind === 'hoofdkantoor' ? -1 : 0)
      || a.name.localeCompare(b.name)),
    [alle],
  )

  const wasstraten = alle.filter((l) => l.active).reduce((n, l) => n + (l.bays || 0), 0)
  const uit = alle.filter((l) => !l.active).length
  const gekozen = alle.find((l) => l.id === open) ?? null

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat
          label="Vestigingen"
          value={alle.filter((l) => l.active).length}
          icon={<Building2 size={17} />}
        />
        <Stat label="Wasstraten" value={wasstraten} icon={<Compass size={17} />} tone="ok" />
        <Stat
          label="Uit"
          value={uit}
          icon={<Power size={17} />}
          tone={uit ? 'warn' : undefined}
        />
      </div>

      <div className="row mb" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Alle vestigingen</h3>
        <span className="spacer" />
        {mag && (
          <button className="btn primary sm" onClick={() => setNieuw(true)}>
            <Plus size={14} /> Nieuwe vestiging
          </button>
        )}
      </div>

      {!gesorteerd.length ? (
        <Card>
          <Empty text="Er staan nog geen vestigingen in." icon={<Building2 size={22} />} />
        </Card>
      ) : (
        <motion.div className="vest-raster" layout>
          <AnimatePresence mode="popLayout">
            {gesorteerd.map((l, i) => (
              <VestigingTegel
                key={l.id}
                locatie={l}
                fotos={fotos.filter((f) => f.locationId === l.id)}
                index={i}
                onOpen={() => setOpen(l.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <NieuweVestiging
        open={nieuw}
        bestaand={alle}
        onClose={() => setNieuw(false)}
        onKlaar={(id) => { setNieuw(false); setOpen(id) }}
      />

      <VestigingDetail
        locatie={gekozen}
        bestaand={alle}
        mag={mag}
        onClose={() => setOpen(null)}
      />
    </>
  )
}

/* ================================================================== *
 *  De tegel
 * ================================================================== */

function VestigingTegel({
  locatie, fotos, index, onOpen,
}: {
  locatie: Location
  fotos: LocationPhoto[]
  index: number
  onOpen: () => void
}) {
  // Omslag vooraan, de rest in de volgorde van het scherm -- dezelfde volgorde
  // als op de website, zodat de tegel laat zien wat een bezoeker straks ziet.
  const [cover, ...rest] = opVolgorde(fotos)
  const open = nuOpen(locatie)

  return (
    <motion.button
      layout
      type="button"
      className={`vest-tegel ${locatie.active ? '' : 'uit'}`}
      onClick={onOpen}
      initial={{ opacity: 0, y: 18, scale: .97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: .96 }}
      transition={{
        type: 'spring', stiffness: 320, damping: 28,
        // Ze komen na elkaar binnen in plaats van allemaal tegelijk. Bij
        // negentien tegels is dat het verschil tussen "het scherm bouwt zich
        // op" en "er knalt iets in beeld".
        delay: Math.min(index * .035, .4),
      }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: .985 }}
    >
      <div className="vest-foto vf-groot">
        {cover
          ? <Foto foto={cover} />
          : <div className="vest-geenfoto"><Building2 size={26} /></div>}
        <div className="vest-sluier" />
        <div className="vest-kop">
          <span className="vest-code">{locatie.code}</span>
          {locatie.kind === 'hoofdkantoor' && <Badge tone="brand">Hoofdkantoor</Badge>}
          {!locatie.active && <Badge tone="warn">Uit</Badge>}
        </div>
        {fotos.length > 1 && (
          <span className="vest-fotoaantal"><ImageIcon size={11} /> {fotos.length}</span>
        )}
        {/*
          * Op de tegel en niet alleen in het venster: de vraag "welke van de
          * negentien staan er nu eigenlijk op de site" hoor je in één blik te
          * kunnen beantwoorden, en niet door negentien keer iets te openen.
          */}
        {locatie.opWebsite && (
          <span className="vest-online" title="Staat op de website">
            <Globe size={11} /> Online
          </span>
        )}
      </div>

      {/*
        * De eerste drie na de omslag als mini's. Niet om ze te bekijken -- daar
        * zijn ze te klein voor -- maar om aan de tegel te zien dat er meer is
        * dan een plaatje, en welke. Bij meer dan drie staat er hoeveel er nog
        * achter zitten.
        */}
      {rest.length > 0 && (
        <div className="vf-ministrook">
          {rest.slice(0, 3).map((f) => (
            <span key={f.id} className="vf-mini"><Foto foto={f} /></span>
          ))}
          {rest.length > 3 && <span className="vf-mini vf-meer">+{rest.length - 3}</span>}
        </div>
      )}

      <div className="vest-body">
        <div className="vest-naam">{locatie.name}</div>
        <div className="vest-regel"><MapPin size={12} /> {adresRegel(locatie) || 'Geen adres'}</div>
        <div className="vest-voet">
          <span>{locatie.bays} {locatie.bays === 1 ? 'wasstraat' : 'wasstraten'}</span>
          {open !== null && (
            <span className={`vest-open ${open ? 'ja' : 'nee'}`}>
              <i /> {open ? 'Nu open' : 'Nu dicht'}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}

/* ================================================================== *
 *  Een foto tekenen
 *
 *  Met verbinding is het adres gewoon het openbare adres in de emmer, en
 *  doet de browser het bewaren zelf. Geen download door de app, geen kopie
 *  in de lokale opslag, geen object-adres dat weer vrij moet -- voor
 *  negentien tegels met een omslag en drie mini's was dat tachtig keer die
 *  hele dans om te tonen wat een <img> uit zichzelf kan.
 *
 *  Laadt dat plaatje niet (geen bereik, of de database is nog niet
 *  ingesteld), dan komt het uit de lokale kopie via fotoUrl(). Dat
 *  object-adres wordt weer vrijgegeven zodra het plaatje uit beeld gaat --
 *  laat je dat na, dan houdt de browser elke foto die je ooit hebt bekeken
 *  vast tot het tabblad dichtgaat.
 * ================================================================== */

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine
}

interface FotoStaat {
  url: string | null
  /** Via de lokale kopie (of het downloaden ervan), niet via het openbare adres. */
  lokaal: boolean
  /** Is er een antwoord, ook als dat "geen plaatje" is. */
  klaar: boolean
}

function beginStaat(foto: LocationPhoto): FotoStaat {
  const publiek = online() ? publiekeFotoUrl(foto) : null
  return { url: publiek, lokaal: !publiek, klaar: !!publiek }
}

function Foto({ foto, className = '' }: { foto: LocationPhoto; className?: string }) {
  const [staat, setStaat] = useState<FotoStaat>(() => beginStaat(foto))

  useEffect(() => { setStaat(beginStaat(foto)) }, [foto.storagePath])

  useEffect(() => {
    if (!staat.lokaal) return
    let levend = true
    let hier: string | null = null

    void fotoUrl(foto).then((u) => {
      if (!levend) { if (u) URL.revokeObjectURL(u); return }
      hier = u
      setStaat({ url: u, lokaal: true, klaar: true })
    })

    return () => { levend = false; if (hier) URL.revokeObjectURL(hier) }
  }, [staat.lokaal, foto.storagePath])

  if (!staat.klaar) return <div className="vest-laadt" />
  if (!staat.url) return <div className="vf-kapot"><ImageIcon size={18} /></div>
  return (
    <img
      className={className}
      src={staat.url}
      alt={foto.caption ?? ''}
      loading="lazy"
      // Het openbare adres laadt niet: dan is er geen verbinding, of het
      // bestand is weg. De lokale kopie weet het misschien nog.
      onError={() => {
        if (!staat.lokaal) setStaat({ url: null, lokaal: true, klaar: false })
      }}
    />
  )
}

/* ================================================================== *
 *  Nieuwe vestiging
 * ================================================================== */

function NieuweVestiging({
  open, bestaand, onClose, onKlaar,
}: {
  open: boolean
  bestaand: Location[]
  onClose: () => void
  onKlaar: (id: string) => void
}) {
  const [naam, setNaam] = useState('')
  const [plaats, setPlaats] = useState('')
  const [code, setCode] = useState('')
  const [handmatig, setHandmatig] = useState(false)
  const [kind, setKind] = useState<LocationKind>('vestiging')
  const [adres, setAdres] = useState('')
  const [postcode, setPostcode] = useState('')
  const [bays, setBays] = useState(2)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    if (!open) {
      setNaam(''); setPlaats(''); setCode(''); setHandmatig(false)
      setKind('vestiging'); setAdres(''); setPostcode(''); setBays(2)
    }
  }, [open])

  // Zolang je de code niet zelf hebt aangeraakt loopt hij mee met de plaats.
  useEffect(() => {
    if (handmatig) return
    const basis = voorstelCode(plaats, kind)
    setCode(basis ? vrijeCode(basis, bestaand.map((l) => l.code)) : '')
  }, [plaats, kind, handmatig, bestaand])

  const probleem = code ? codeProbleem(code, bestaand) : null
  const kan = naam.trim() && plaats.trim() && code && !probleem

  async function opslaan() {
    if (!kan || bezig) return
    setBezig(true)
    try {
      const rij = await repo.aanmaken({
        code, name: naam, kind,
        address: adres, postcode, city: plaats,
        bays, openingHours: standaardTijden(),
      })
      toast.ok(`${rij.name} staat erin.`)
      onKlaar(rij.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nieuwe vestiging"
      subtitle="Het adres, de foto's en de openingstijden vul je zo aan."
      onClose={onClose}
      width={560}
    >
      <div className="grid cols-2" style={{ gap: 12 }}>
        <Field label="Naam">
          <input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="Truckwash Utrecht"
            autoFocus
          />
        </Field>
        <Field label="Plaats">
          <input
            value={plaats}
            onChange={(e) => setPlaats(e.target.value)}
            placeholder="Utrecht"
          />
        </Field>
      </div>

      <Field label="Adres">
        <input
          value={adres}
          onChange={(e) => setAdres(e.target.value)}
          placeholder="Kanaalweg 12"
        />
      </Field>

      <div className="grid cols-2" style={{ gap: 12 }}>
        <Field label="Postcode">
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            placeholder="3526 KL"
          />
        </Field>
        <Field label="Wasstraten">
          <input
            type="number" min={0} max={20}
            value={bays}
            onChange={(e) => setBays(Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid cols-2" style={{ gap: 12 }}>
        <Field label="Soort">
          <select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            <option value="vestiging">Vestiging</option>
            <option value="hoofdkantoor">Hoofdkantoor</option>
          </select>
        </Field>
        <Field
          label="Code"
          help={probleem ?? 'Deze staat op elke werkbon en op elke kassabon.'}
        >
          <input
            value={code}
            onChange={(e) => { setHandmatig(true); setCode(e.target.value.toUpperCase()) }}
            placeholder="TW-UTR"
          />
        </Field>
      </div>

      {probleem && <p className="waarschuwing">{probleem}</p>}

      <div className="row" style={{ marginTop: 16 }}>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" disabled={!kan || bezig} onClick={opslaan}>
          {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Aanmaken
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Het detailscherm
 * ================================================================== */

const TABBEN = [
  { key: 'gegevens', naam: 'Gegevens', icoon: Building2 },
  { key: 'website', naam: 'Website', icoon: Globe },
  { key: 'fotos', naam: "Foto's", icoon: Camera },
] as const

type Tab = typeof TABBEN[number]['key']

function VestigingDetail({
  locatie, bestaand, mag, onClose,
}: {
  locatie: Location | null
  bestaand: Location[]
  mag: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('gegevens')

  useEffect(() => { setTab('gegevens') }, [locatie?.id])

  /*
   * Het formulier staat hier en niet in het tabblad.
   *
   * Anders houdt elk tabblad zijn eigen kopie bij en is alles wat je op het
   * ene hebt ingetikt weg zodra je op het andere klikt -- en dat merk je pas
   * als je terugkomt. Nu is er een formulier, een opslaanknop, en die knop
   * staat onderaan het venster in plaats van in een van de tabbladen.
   */
  const [vorm, setVorm] = useState<Location | null>(locatie)
  const [bezig, setBezig] = useState(false)
  const [wegVraag, setWegVraag] = useState(false)
  const [uitVraag, setUitVraag] = useState(false)

  useEffect(() => { setVorm(locatie) }, [locatie?.id, locatie?.updatedAt])

  const zet = useCallback(<K extends keyof Location>(k: K, v: Location[K]) =>
    setVorm((h) => (h ? { ...h, [k]: v } : h)), [])

  const probleem = vorm
    ? codeProbleem(vorm.code, bestaand, vorm.id)
      ?? slugProbleem(vorm.websiteSlug ?? '', bestaand, vorm.id)
    : null
  const veranderd = !!vorm && !!locatie && JSON.stringify(vorm) !== JSON.stringify(locatie)

  async function opslaan() {
    if (!locatie || !vorm || probleem || bezig) return
    setBezig(true)
    try {
      await repo.bijwerken(locatie.id, vorm)
      toast.ok('Opgeslagen.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={!!locatie}
      title={locatie?.name ?? ''}
      subtitle={locatie ? `${locatie.code} · ${adresRegel(locatie) || 'geen adres'}` : ''}
      onClose={onClose}
      width={780}
    >
      {locatie && vorm && (
        <>
          {/*
            * De foto's staan bovenaan, voor de tabbladen. Wie het venster van
            * Venlo opent ziet dan meteen wat er van Venlo op de website staat,
            * en of er wel iets staat -- zonder eerst een tabblad te kiezen.
            */}
          <FotoStrook
            locatie={locatie}
            mag={mag}
            verborgen={tab === 'fotos'}
            naarFotos={() => setTab('fotos')}
          />

          <div className="row" style={{ gap: 6, margin: '4px 0 16px' }}>
            {TABBEN.map(({ key, naam, icoon: Icoon }) => (
              <button
                key={key}
                className={`btn sm ${tab === key ? 'primary' : 'ghost'}`}
                onClick={() => setTab(key)}
              >
                <Icoon size={14} /> {naam}
                {key === 'website' && vorm.opWebsite && (
                  <span className="vest-stip" title="Staat op de website" />
                )}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: .18, ease: [.22, .61, .36, 1] }}
            >
              {tab === 'gegevens' && (
                <Gegevens vorm={vorm} setVorm={setVorm} zet={zet} mag={mag} probleem={probleem} />
              )}
              {tab === 'website' && (
                <Website
                  vorm={vorm} zet={zet} mag={mag} bestaand={bestaand}
                  naarFotos={() => setTab('fotos')}
                />
              )}
              {tab === 'fotos' && <Fotos locatie={locatie} mag={mag} />}
            </motion.div>
          </AnimatePresence>

          {mag && tab !== 'fotos' && (
            <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
              <button
                className={`btn sm ${locatie.active ? 'ghost' : 'ok'}`}
                onClick={() => locatie.active
                  ? setUitVraag(true)
                  : void repo.aanUit(locatie.id, true)}
              >
                <Power size={14} /> {locatie.active ? 'Uitzetten' : 'Weer aanzetten'}
              </button>
              <button className="btn ghost sm danger" onClick={() => setWegVraag(true)}>
                <Trash2 size={14} /> Verwijderen
              </button>
              <span className="spacer" />
              <AnimatePresence>
                {veranderd && (
                  <motion.button
                    className="btn primary"
                    initial={{ opacity: 0, scale: .9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: .9 }}
                    disabled={!!probleem || bezig}
                    title={probleem ?? undefined}
                    onClick={opslaan}
                  >
                    {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Opslaan
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}

          {!locatie.active && locatie.inactiveReason && (
            <p className="hint" style={{ marginTop: 10 }}>
              Uit gezet: {locatie.inactiveReason}
            </p>
          )}

          <Uitzetten open={uitVraag} locatie={locatie} onClose={() => setUitVraag(false)} />
          <Verwijderen
            open={wegVraag}
            locatie={locatie}
            onClose={() => setWegVraag(false)}
            onWeg={() => { setWegVraag(false); onClose() }}
          />
        </>
      )}
    </Modal>
  )
}

/* ------------------------------ Gegevens -------------------------- */

function Gegevens({
  vorm, setVorm, zet, mag, probleem,
}: {
  vorm: Location
  setVorm: React.Dispatch<React.SetStateAction<Location | null>>
  zet: <K extends keyof Location>(k: K, v: Location[K]) => void
  mag: boolean
  probleem: string | null
}) {
  const [zoekt, setZoekt] = useState(false)
  const [gevonden, setGevonden] = useState<string | null>(null)

  const mensen = useLiveQuery(() => alleMensen(), [], [] as User[])

  useEffect(() => { setGevonden(null) }, [vorm.id])

  async function opzoeken() {
    setZoekt(true)
    setGevonden(null)
    const uit = await zoekAdres(adresRegel(vorm))
    setZoekt(false)
    if (!uit.ok) { toast.warn(uit.reden ?? 'Niet gevonden.'); return }
    setVorm((h) => (h ? {
      ...h, lat: uit.lat, lon: uit.lon, geoLabel: uit.label, geoAt: Date.now(),
    } : h))
    setGevonden(uit.label ?? null)
  }

  return (
    <>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <Field label="Naam">
          <input value={vorm.name} disabled={!mag}
            onChange={(e) => zet('name', e.target.value)} />
        </Field>
        <Field label="Code" help={probleem ?? undefined}>
          <input value={vorm.code} disabled={!mag}
            onChange={(e) => zet('code', e.target.value.toUpperCase())} />
        </Field>
      </div>

      <Field
        label="Adres"
        help={vorm.geoLabel ? `De kaartendienst vond: ${vorm.geoLabel}` : undefined}
      >
        <div className="row" style={{ gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={vorm.address} disabled={!mag}
            onChange={(e) => zet('address', e.target.value)}
          />
          <button
            className="btn ghost sm" onClick={opzoeken}
            disabled={zoekt || !vorm.address.trim()}
            title="Opzoeken waar dit adres ligt"
          >
            {zoekt ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
          </button>
        </div>
      </Field>

      <AnimatePresence>
        {gevonden && (
          <motion.p
            className="vest-gevonden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <MapPin size={12} /> Gevonden: {gevonden}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="grid cols-3" style={{ gap: 12 }}>
        <Field label="Postcode">
          <input value={vorm.postcode} disabled={!mag}
            onChange={(e) => zet('postcode', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Plaats">
          <input value={vorm.city} disabled={!mag}
            onChange={(e) => zet('city', e.target.value)} />
        </Field>
        <Field label="Wasstraten">
          <input type="number" min={0} max={20} value={vorm.bays} disabled={!mag}
            onChange={(e) => zet('bays', Number(e.target.value))} />
        </Field>
      </div>

      <div className="grid cols-2" style={{ gap: 12 }}>
        <Field label="Telefoon">
          <input value={vorm.phone ?? ''} disabled={!mag} placeholder="030 - 123 45 67"
            onChange={(e) => zet('phone', e.target.value)} />
        </Field>
        <Field label="E-mail">
          <input value={vorm.email ?? ''} disabled={!mag} placeholder="utrecht@truckwash1group.nl"
            onChange={(e) => zet('email', e.target.value)} />
        </Field>
      </div>

      <Field label="Vestigingsmanager">
        <select
          value={vorm.managerId ?? ''}
          disabled={!mag}
          onChange={(e) => {
            const m = mensen.find((u) => u.id === e.target.value)
            setVorm((h) => (h ? { ...h, managerId: m?.id, managerName: m?.name } : h))
          }}
        >
          <option value="">Niemand aangewezen</option>
          {mensen
            .filter((u) => u.active && !u.archivedAt)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>

      <Openingstijdenblok
        tijden={vorm.openingHours}
        mag={mag}
        onZet={(t) => zet('openingHours', t)}
      />

      <Field label="Interne notitie" help="Sleutelkastje, oprit, waar de tankpas ligt.">
        <textarea
          rows={2} value={vorm.notes ?? ''} disabled={!mag}
          onChange={(e) => zet('notes', e.target.value)}
        />
      </Field>

      <p className="hint" style={{ marginTop: 10 }}>
        Deze notitie blijft binnen. Wat er naar buiten gaat staat onder “Website”.
      </p>
    </>
  )
}

/* ------------------------------- Website -------------------------- *
 *
 *  Alles wat een bezoeker van truckwash-workspace.com van deze vestiging te
 *  zien krijgt. Bewust een eigen tabblad: dan is er geen twijfel over welk
 *  vakje binnen blijft en welk vakje op straat komt te liggen.
 * ------------------------------------------------------------------ */

function Website({
  vorm, zet, mag, bestaand, naarFotos,
}: {
  vorm: Location
  zet: <K extends keyof Location>(k: K, v: Location[K]) => void
  mag: boolean
  bestaand: Location[]
  naarFotos: () => void
}) {
  const slug = vorm.websiteSlug ?? ''
  const slugFout = slugProbleem(slug, bestaand, vorm.id)
  const gaten = websiteGaten(vorm)
  const gekozen = new Set(vorm.diensten ?? [])

  // De foto's gaan sinds 0046 mee naar de site. Dit tabblad is de plek waar
  // iemand nakijkt wat er naar buiten gaat, dus hier hoort te staan hoeveel
  // dat er zijn -- en vooral of het er nul zijn.
  const aantalFotos = useLiveQuery(
    () => db.locationPhotos.where('locationId').equals(vorm.id).count(),
    [vorm.id], 0)

  /*
   * De punten worden als lijst bewaard en als tekst getoond, en die twee
   * moeten los van elkaar kunnen staan terwijl je typt.
   *
   * Zou het tekstvak rechtstreeks uit de lijst lezen, dan verdwijnt een lege
   * regel op het moment dat je hem maakt -- en dan kun je geen Enter drukken
   * om aan een volgend punt te beginnen. Dus: ruwe tekst hier, opgeschoonde
   * lijst naar het formulier.
   */
  const [ruwePunten, setRuwePunten] = useState((vorm.punten ?? []).join('\n'))
  useEffect(
    () => { setRuwePunten((vorm.punten ?? []).join('\n')) },
    [vorm.id, vorm.updatedAt],
  )

  const wissel = (s: string) => {
    const nieuw = new Set(gekozen)
    if (nieuw.has(s)) nieuw.delete(s); else nieuw.add(s)
    zet('diensten', WEBSITE_DIENSTEN.filter((d) => nieuw.has(d.slug)).map((d) => d.slug))
  }

  return (
    <>
      {/* De schakelaar staat bovenaan, want hij bepaalt of de rest ertoe doet. */}
      <motion.button
        layout
        className={`vest-schakel ${vorm.opWebsite ? 'aan' : ''}`}
        disabled={!mag}
        onClick={() => zet('opWebsite', !vorm.opWebsite)}
      >
        <span className="vest-schakel-knop">
          <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 34 }} />
        </span>
        <span>
          <strong>{vorm.opWebsite ? 'Staat op de website' : 'Staat niet op de website'}</strong>
          <small>
            {vorm.opWebsite
              ? 'Iedereen kan deze pagina zien.'
              : 'Standaard uit. Per ongeluk iets publiceren is erger dan per ongeluk iets weglaten.'}
          </small>
        </span>
      </motion.button>

      <AnimatePresence>
        {vorm.opWebsite && gaten.length > 0 && (
          <motion.p
            className="vest-gaten"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AlertTriangle size={13} />
            <span>Nog niet compleet — er ontbreekt {inHetNederlands(gaten)}.</span>
          </motion.p>
        )}
      </AnimatePresence>

      <div className={`vf-siteregel ${aantalFotos ? '' : 'waarschuwt'}`}>
        {aantalFotos ? (
          <>
            <ImageIcon size={13} />
            <span>
              {vorm.opWebsite
                ? `${aantalFotos === 1 ? 'Eén foto gaat' : `${aantalFotos} foto's gaan`} mee naar de site; de eerste is de omslag.`
                : `Zodra deze vestiging online staat ${aantalFotos === 1 ? 'gaat de foto' : `gaan de ${aantalFotos} foto's`} mee; de eerste is de omslag.`}
            </span>
          </>
        ) : (
          <>
            <AlertTriangle size={13} />
            <span>Er is nog geen foto. De site toont dan een standaardfoto.</span>
          </>
        )}
        <button type="button" className="btn ghost sm" onClick={naarFotos}>
          <Camera size={13} /> {aantalFotos || !mag ? "Foto's" : 'Foto toevoegen'}
        </button>
      </div>

      <Field
        label="Adres op de site"
        help={slugFout ?? (slug
          ? `De pagina komt op truckwash-workspace.com/locaties/${slug}/`
          : 'Zonder adres komt er geen pagina.')}
      >
        <div className="row" style={{ gap: 8 }}>
          <span className="vest-pad">/locaties/</span>
          <input
            style={{ flex: 1 }}
            value={slug} disabled={!mag} placeholder="utrecht"
            onChange={(e) => zet('websiteSlug', e.target.value.toLowerCase().trim() || undefined)}
          />
          <button
            className="btn ghost sm"
            disabled={!mag || !vorm.city.trim()}
            title="Voorstel uit de plaatsnaam"
            onClick={() => zet('websiteSlug', voorstelSlug(vorm.city) || undefined)}
          >
            <Link2 size={14} />
          </button>
        </div>
      </Field>

      <Field
        label="Introtekst"
        help="De alinea bovenaan de pagina: waarom een chauffeur juist hier stopt."
      >
        <textarea
          rows={4} value={vorm.intro ?? ''} disabled={!mag}
          placeholder="Aan de A2 bij afrit 12, met vier wasstraten en een eigen wachtruimte…"
          onChange={(e) => zet('intro', e.target.value || undefined)}
        />
      </Field>

      <Field
        label="Bereikbaarheid"
        help="De afrit, de oprit, waar de ingang zit. Het stuk waar iemand die er nog nooit is geweest echt iets aan heeft."
      >
        <textarea
          rows={3} value={vorm.bereikbaar ?? ''} disabled={!mag}
          placeholder="Vanaf de A2 afrit 12, aan het eind van de rotonde rechts. De ingang zit achter het tankstation."
          onChange={(e) => zet('bereikbaar', e.target.value || undefined)}
        />
      </Field>

      <Field
        label="Bijzonderheden"
        help="Wat hier anders is dan elders. Mag leeg blijven."
      >
        <textarea
          rows={3} value={vorm.bijzonder ?? ''} disabled={!mag}
          placeholder="Enige vestiging met een NAO-wasplaats voor tankwagens."
          onChange={(e) => zet('bijzonder', e.target.value || undefined)}
        />
      </Field>

      <Field
        label="Punten op de pagina"
        help={`Een per regel. Dit is het rijtje redenen om juist hier te stoppen${
          (vorm.punten ?? []).length ? ` — nu ${vorm.punten!.length}` : ''}.`}
      >
        {/*
          * Een tekstvak met regels, en geen rijtje losse invulvelden met een
          * plusknop. Bij acht punten is dat laatste acht keer klikken om er
          * een tussen te schuiven, en knippen en plakken uit een oude pagina
          * kan dan niet meer. Lege regels vallen vanzelf weg.
          */}
        <textarea
          rows={6} disabled={!mag}
          value={ruwePunten}
          placeholder={'500 meter vanaf de bloemenveiling\nHandwash met spons\nAlcoa / Dura Bright behandeling'}
          onChange={(e) => {
            setRuwePunten(e.target.value)
            zet('punten', e.target.value.split('\n').map((r) => r.trim()).filter(Boolean))
          }}
        />
      </Field>

      <Field
        label="Wat kan hier"
        help="Aangevinkt betekent: deze vestiging komt op de pagina van die dienst te staan."
      >
        <div className="vest-diensten">
          {WEBSITE_DIENSTEN.map((d) => {
            const aan = gekozen.has(d.slug)
            return (
              <motion.button
                key={d.slug}
                type="button"
                className={`vest-dienst ${aan ? 'aan' : ''}`}
                disabled={!mag}
                whileTap={mag ? { scale: .95 } : undefined}
                onClick={() => wissel(d.slug)}
              >
                <span className="vest-vink">
                  <AnimatePresence>
                    {aan && (
                      <motion.span
                        initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                        transition={{ type: 'spring', stiffness: 600, damping: 28 }}
                      >
                        <Check size={11} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                {d.naam}
              </motion.button>
            )
          })}
        </div>
      </Field>

      <p className="hint" style={{ marginTop: 10 }}>
        Adres, telefoon en openingstijden komen van “Gegevens”, de foto’s van
        “Foto’s” — in de volgorde die daar staat, met de omslag voorop.
      </p>
    </>
  )
}

/** "een telefoonnummer en openingstijden" in plaats van een opsomming met komma's. */
function inHetNederlands(delen: string[]): string {
  if (delen.length === 1) return delen[0]
  return `${delen.slice(0, -1).join(', ')} en ${delen[delen.length - 1]}`
}

/* --------------------------- Openingstijden ----------------------- */

function Openingstijdenblok({
  tijden, mag, onZet,
}: {
  tijden?: Openingstijden
  mag: boolean
  onZet: (t: Openingstijden) => void
}) {
  const [uit, setUit] = useState(true)
  const huidig = tijden ?? {}

  const zetDag = (dag: string, v: { van: string; tot: string } | null) =>
    onZet({ ...huidig, [dag]: v })

  return (
    <div className="vest-tijden">
      <button className="vest-tijdenkop" onClick={() => setUit((u) => !u)}>
        <Clock size={13} />
        <span>Openingstijden</span>
        <span className="hint">{tijdenInHetKort(tijden)}</span>
        <span className="spacer" />
        {uit ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence initial={false}>
        {!uit && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: .22, ease: [.22, .61, .36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {WEEKDAGEN.map((d) => {
              const v = huidig[d.key]
              const fout = v ? tijdProbleem(v) : null
              return (
                <div key={d.key} className="vest-dag">
                  <span className="vest-dagnaam">{d.lang}</span>
                  <input
                    type="time" value={v?.van ?? ''} disabled={!mag || v === null}
                    onChange={(e) => zetDag(d.key, { van: e.target.value, tot: v?.tot ?? '18:00' })}
                  />
                  <span className="vest-tot">tot</span>
                  <input
                    type="time" value={v?.tot ?? ''} disabled={!mag || v === null}
                    onChange={(e) => zetDag(d.key, { van: v?.van ?? '07:00', tot: e.target.value })}
                  />
                  <button
                    className={`btn ghost sm ${v === null ? 'primary' : ''}`}
                    disabled={!mag}
                    onClick={() => zetDag(d.key, v === null ? { van: '07:00', tot: '18:00' } : null)}
                  >
                    {v === null ? 'Dicht' : 'Dicht zetten'}
                  </button>
                  {fout && <span className="vest-dagfout">{fout}</span>}
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ----------------------------- Uitzetten -------------------------- */

function Uitzetten({
  open, locatie, onClose,
}: { open: boolean; locatie: Location; onClose: () => void }) {
  const [reden, setReden] = useState('')
  useEffect(() => { if (open) setReden('') }, [open])

  return (
    <Modal
      open={open}
      title={`${locatie.name} uitzetten`}
      subtitle="Alles blijft staan. Hij is alleen nergens meer te kiezen."
      onClose={onClose}
      width={460}
    >
      <p className="hint">
        Uitzetten is bijna altijd wat je wil bij een vestiging die dichtgaat. De uren,
        werkbonnen en cijfers van de afgelopen jaren horen er nog bij te staan.
      </p>
      <Field label="Waarom" help="Zonder reden is dit over een half jaar een raadsel.">
        <input
          value={reden} autoFocus
          onChange={(e) => setReden(e.target.value)}
          placeholder="Huur opgezegd per 1 oktober"
        />
      </Field>
      <div className="row" style={{ marginTop: 14 }}>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className="btn primary"
          disabled={!reden.trim()}
          onClick={async () => {
            await repo.aanUit(locatie.id, false, reden)
            toast.ok(`${locatie.name} staat uit.`)
            onClose()
          }}
        >
          <Power size={14} /> Uitzetten
        </button>
      </div>
    </Modal>
  )
}

/* ---------------------------- Verwijderen ------------------------- */

function Verwijderen({
  open, locatie, onClose, onWeg,
}: {
  open: boolean
  locatie: Location
  onClose: () => void
  onWeg: () => void
}) {
  const [rijen, setRijen] = useState<Bezetting[] | null>(null)
  const [naam, setNaam] = useState('')
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    if (!open) return
    setNaam('')
    setRijen(null)
    void bezetting(locatie.id).then(setRijen)
  }, [open, locatie.id])

  const bezet = (rijen?.length ?? 0) > 0
  const kan = !bezet && naam.trim().toLowerCase() === locatie.name.trim().toLowerCase()

  return (
    <Modal
      open={open}
      title={`${locatie.name} verwijderen`}
      subtitle="Dit kan niet ongedaan worden gemaakt."
      onClose={onClose}
      width={480}
    >
      {rijen === null ? (
        <p className="hint"><Loader2 size={13} className="spin" /> Even kijken wat eraan hangt…</p>
      ) : bezet ? (
        <>
          <p className="waarschuwing">
            Dit kan niet. Er hangt nog van alles aan deze vestiging:
          </p>
          <ul className="vest-bezet">
            {rijen.map((r) => (
              <li key={r.wat}><b>{r.aantal}</b> {r.wat}</li>
            ))}
          </ul>
          <p className="hint">
            Een deel daarvan zou bij het wissen zonder een woord meegaan — installaties,
            storingen, werkbonnen, voorraad en de kluis hangen er met een harde koppeling
            aan vast. Zet de vestiging uit; dan is hij nergens meer te kiezen en blijft de
            geschiedenis staan.
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="spacer" />
            <button className="btn ghost" onClick={onClose}>Sluiten</button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Er hangt niets aan deze vestiging, dus hij kan echt weg. Foto's gaan mee.
          </p>
          <Field label={`Typ "${locatie.name}" om het te bevestigen`}>
            <input value={naam} autoFocus onChange={(e) => setNaam(e.target.value)} />
          </Field>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="spacer" />
            <button className="btn ghost" onClick={onClose}>Annuleren</button>
            <button
              className="btn danger"
              disabled={!kan || bezig}
              onClick={async () => {
                setBezig(true)
                try {
                  await repo.wissen(locatie.id)
                  toast.ok(`${locatie.name} is verwijderd.`)
                  onWeg()
                } catch (e) {
                  toast.error(e instanceof VestigingBezet
                    ? e.message
                    : e instanceof Error ? e.message : 'Verwijderen mislukte.')
                } finally {
                  setBezig(false)
                }
              }}
            >
              {bezig ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Verwijderen
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

/* ================================================================== *
 *  De lichtbak
 *
 *  Een foto groot, met het bijschrift eronder. Klikken naast de foto of op
 *  het kruisje sluit hem. Wordt gebruikt vanuit de galerij bovenin en vanuit
 *  het tabblad, dus hij staat een keer.
 * ================================================================== */

function Lichtbak({ foto, onClose }: { foto: LocationPhoto | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {foto && (
        <motion.div
          className="vest-lichtbak"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: .94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: .96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Foto foto={foto} />
            {foto.caption && <p>{foto.caption}</p>}
          </motion.div>
          <button
            className="btn ghost sm vest-dicht"
            aria-label="Sluiten"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ================================================================== *
 *  De galerij bovenin het detailscherm
 *
 *  De foto's zaten achter een tabblad. Dat is de goede plek om ze te
 *  beheren, maar niet om ze te zien: wie het venster van Venlo opent hoort
 *  meteen te zien wat er van Venlo op de website staat -- en of er wel iets
 *  staat. Dit is dat uitzicht. Slepen, bijschriften en weghalen blijven in
 *  het tabblad; de knop rechtsonder brengt je erheen.
 * ================================================================== */

/** Hoeveel kleine tegels er naast de omslag staan voordat het "+N" wordt. */
const NAAST_DE_OMSLAG = 3

function FotoStrook({
  locatie, mag, verborgen, naarFotos,
}: {
  locatie: Location
  mag: boolean
  verborgen: boolean
  naarFotos: () => void
}) {
  const opgeslagen = useLiveQuery(
    () => db.locationPhotos.where('locationId').equals(locatie.id).toArray(),
    [locatie.id], [] as LocationPhoto[])
  const lijst = useMemo(() => opVolgorde(opgeslagen), [opgeslagen])
  const [groot, setGroot] = useState<LocationPhoto | null>(null)

  // In het tabblad Foto's staan ze al groot en bewerkbaar. Twee keer dezelfde
  // rij boven elkaar is verwarrend, en het venster wordt er dubbel zo lang van.
  if (verborgen) return null

  const [cover, ...rest] = lijst
  const meer = rest.length - NAAST_DE_OMSLAG

  return (
    <div className="vf-galerij">
      {cover ? (
        <button
          type="button"
          className="vf-omslag"
          title="Groot bekijken"
          onClick={() => setGroot(cover)}
        >
          <Foto foto={cover} />
          <span className="vf-etiket"><Star size={10} /> Omslag</span>
        </button>
      ) : (
        <div className="vf-omslag vf-leegvlak">
          <Camera size={22} />
          <span>Nog geen foto</span>
          <small>De tegel blijft grijs en de website toont een standaardfoto.</small>
        </div>
      )}

      <div className="vf-zij">
        {rest.slice(0, NAAST_DE_OMSLAG).map((f) => (
          <button
            key={f.id}
            type="button"
            className="vf-klein"
            title={f.caption || 'Groot bekijken'}
            onClick={() => setGroot(f)}
          >
            <Foto foto={f} />
          </button>
        ))}
        {meer > 0 && (
          <button
            type="button"
            className="vf-klein vf-meer"
            title="Alle foto's"
            onClick={naarFotos}
          >
            +{meer}
          </button>
        )}
        <button type="button" className="btn ghost sm vf-beheer" onClick={naarFotos}>
          <Camera size={14} />
          {mag ? (lijst.length ? "Foto's beheren" : "Foto's toevoegen") : "Alle foto's"}
        </button>
      </div>

      <Lichtbak foto={groot} onClose={() => setGroot(null)} />
    </div>
  )
}

/* ================================================================== *
 *  Foto's: het tabblad
 *
 *  Een raster van tegels. Bij vijf foto's las de oude lijst met rijtjes
 *  nog, bij twaalf werd het scrollen zonder overzicht -- en het ging om
 *  foto's, dus de foto hoort voorop en niet in een postzegel links van een
 *  invulveld. Ster, prullenbak en greep liggen op de tegel; het bijschrift
 *  staat eronder en is ter plekke te bewerken.
 * ================================================================== */

interface Spook {
  foto: LocationPhoto
  x: number
  y: number
  w: number
  h: number
}

function Fotos({ locatie, mag }: { locatie: Location; mag: boolean }) {
  const { user } = useAuth()
  const [bezig, setBezig] = useState(0)
  const [sleeptBestand, setSleeptBestand] = useState(false)
  const [groot, setGroot] = useState<LocationPhoto | null>(null)
  const [wegVraag, setWegVraag] = useState<string | null>(null)
  const kiezer = useRef<HTMLInputElement>(null)

  const opgeslagen = useLiveQuery(
    () => db.locationPhotos.where('locationId').equals(locatie.id).toArray(),
    [locatie.id], [] as LocationPhoto[])

  const lijst = useMemo(() => opVolgorde(opgeslagen), [opgeslagen])

  // De volgorde tijdens het slepen staat hier, zodat de tegels meelopen met
  // de aanwijzer en niet pas verspringen als de database het heeft rondgestuurd.
  const [orde, setOrde] = useState<LocationPhoto[]>(lijst)
  useEffect(() => { setOrde(lijst) }, [lijst])
  const ordeRef = useRef(orde)
  useEffect(() => { ordeRef.current = orde }, [orde])

  const [spook, setSpook] = useState<Spook | null>(null)
  // De klik die op het loslaten volgt mag de lichtbak niet openen.
  const netGesleept = useRef(false)

  const verwerk = useCallback(async (bestanden: FileList | File[]) => {
    const files = Array.from(bestanden)
    if (!files.length) return
    setBezig(files.length)
    let goed = 0
    for (const f of files) {
      try {
        await fotoRepo.upload({
          bestand: f,
          bestandsnaam: f.name,
          locatie,
          door: user ? { id: user.id, name: user.name } : undefined,
        })
        goed++
      } catch (e) {
        toast.error(e instanceof FotoProbleem
          ? e.message
          : e instanceof Error ? e.message : 'Uploaden mislukte.')
      } finally {
        setBezig((n) => n - 1)
      }
    }
    if (goed) toast.ok(goed === 1 ? 'Foto toegevoegd.' : `${goed} foto's toegevoegd.`)
  }, [locatie, user])

  /*
   * Slepen in een raster.
   *
   * Reorder van framer-motion kan maar een kant op, en een raster heeft er
   * twee. Dus met de hand: bij het vastpakken gaat er een spook met de
   * aanwijzer mee, en zolang die boven een andere tegel zweeft wisselt de
   * lijst van volgorde -- de tegels zelf schuiven met een layout-animatie op
   * hun plek. Pas bij het loslaten gaat het naar de database; elke
   * tussenstand opsturen zou een ronde langs de server maken, en die komen
   * niet gegarandeerd op volgorde terug.
   *
   * Met een muis pak je de tegel overal vast. Met een vinger alleen aan de
   * greep: een vinger op de foto moet het venster kunnen scrollen, en dat
   * gaat niet samen met slepen op hetzelfde vlak.
   *
   * De volgorde leeft tijdens het slepen in deze functie en niet in de
   * React-staat. De pointer-gebeurtenissen komen van het venster en niet van
   * React, en dan is het maar net of de laatste tussenstand al is verwerkt
   * op het moment dat je loslaat.
   */
  function pakOp(
    e: React.PointerEvent<HTMLElement>,
    f: LocationPhoto,
    tegel: HTMLElement | null,
    viaGreep: boolean,
  ) {
    if (!mag || !tegel || ordeRef.current.length < 2 || e.button !== 0) return
    // Een vinger pakt alleen de greep (anders kun je niet meer scrollen);
    // muis en pen mogen overal op de tegel.
    if (e.pointerType === 'touch' && !viaGreep) return
    // Niet vanuit het bijschrift of de knoppen: daar betekent bewegen iets anders.
    if (!viaGreep && (e.target as HTMLElement).closest('input, .vf-knoppen')) return

    const rect = tegel.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const greep = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height }
    let volgorde = [...ordeRef.current]
    let begonnen = false

    const beweeg = (ev: PointerEvent) => {
      if (!begonnen) {
        // Een paar pixels speling, anders is elke klik een sleep van nul.
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
        begonnen = true
        netGesleept.current = true
      }
      setSpook({ foto: f, x: ev.clientX - greep.dx, y: ev.clientY - greep.dy, w: greep.w, h: greep.h })

      const onder = document.elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-foto]')
      const doel = onder?.dataset.foto
      if (!doel || doel === f.id) return
      const van = volgorde.findIndex((p) => p.id === f.id)
      const naar = volgorde.findIndex((p) => p.id === doel)
      if (van < 0 || naar < 0 || van === naar) return
      volgorde = [...volgorde]
      volgorde.splice(naar, 0, volgorde.splice(van, 1)[0])
      setOrde(volgorde)
    }

    const los = () => {
      window.removeEventListener('pointermove', beweeg)
      window.removeEventListener('pointerup', los)
      window.removeEventListener('pointercancel', los)
      if (!begonnen) return
      setSpook(null)
      void bewaarVolgorde(volgorde)
      window.setTimeout(() => { netGesleept.current = false }, 0)
    }

    window.addEventListener('pointermove', beweeg)
    window.addEventListener('pointerup', los)
    window.addEventListener('pointercancel', los)
  }

  /*
   * Wat vooraan wordt losgelaten wordt de omslag.
   *
   * De tegel in het raster, de galerij bovenin en de website tonen allemaal
   * "de eerste", en dat is de omslag. Zou het slepen daar los van staan,
   * dan kun je een foto vooraan zetten die vervolgens nergens vooraan komt
   * -- twee dingen die "eerste" heten en verschillen zijn er een te veel.
   */
  async function bewaarVolgorde(nieuw: LocationPhoto[]) {
    try {
      if (nieuw.length && !nieuw[0].isCover) await fotoRepo.voorop(nieuw[0].id)
      await fotoRepo.volgorde(nieuw)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'De volgorde kon niet worden bewaard.')
    }
  }

  return (
    <>
      {mag && (
        <div
          className={`vest-drop ${sleeptBestand ? 'sleept' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setSleeptBestand(true) }}
          onDragLeave={() => setSleeptBestand(false)}
          onDrop={(e) => {
            e.preventDefault()
            setSleeptBestand(false)
            void verwerk(e.dataTransfer.files)
          }}
          onClick={() => kiezer.current?.click()}
        >
          <motion.div animate={{ scale: sleeptBestand ? 1.08 : 1 }}>
            <Upload size={20} />
          </motion.div>
          <span>Sleep foto's hierheen, of klik om te kiezen</span>
          <span className="hint">JPEG, PNG of WebP · ze worden automatisch verkleind</span>
          <input
            ref={kiezer} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
            onChange={(e) => { void verwerk(e.target.files ?? []); e.target.value = '' }}
          />
        </div>
      )}

      {bezig > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>
          <Loader2 size={13} className="spin" /> {bezig} {bezig === 1 ? 'foto' : "foto's"} onderweg…
        </p>
      )}

      {!lijst.length ? (
        <div className="vf-leeg">
          <Camera size={24} />
          <span>Nog geen foto's van deze vestiging.</span>
          <small>
            {mag
              ? 'De tegel blijft grijs en de website toont een standaardfoto tot er hierboven een is toegevoegd. De eerste wordt meteen de omslag.'
              : 'De tegel blijft grijs en de website toont een standaardfoto.'}
          </small>
        </div>
      ) : (
        <>
          {mag && orde.length > 1 && (
            <p className="hint" style={{ margin: '12px 0 0' }}>
              Sleep om de volgorde te veranderen. Wat vooraan staat is de omslag en gaat
              als eerste naar de website.
            </p>
          )}

          <div className="vf-raster">
            {orde.map((f) => {
              const vraagt = wegVraag === f.id
              return (
                <motion.div
                  key={f.id}
                  layout
                  data-foto={f.id}
                  className={`vf-tegel ${f.isCover ? 'omslag' : ''} ${spook?.foto.id === f.id ? 'sleept' : ''}`}
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                  onPointerDown={(e) => pakOp(e, f, e.currentTarget, false)}
                >
                  <button
                    type="button"
                    className="vf-beeld"
                    title={f.caption || 'Groot bekijken'}
                    onClick={() => { if (!netGesleept.current) setGroot(f) }}
                  >
                    <Foto foto={f} />
                  </button>

                  {f.isCover && <span className="vf-etiket"><Star size={10} /> Omslag</span>}

                  {mag && orde.length > 1 && (
                    <span
                      className="vf-greep"
                      title="Versleep om de volgorde te veranderen"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        pakOp(e, f, e.currentTarget.closest<HTMLElement>('.vf-tegel'), true)
                      }}
                    >
                      <GripVertical size={14} />
                    </span>
                  )}

                  {mag && (
                    <div className="vf-knoppen">
                      <button
                        type="button"
                        className={`vf-knop ${f.isCover ? 'aan' : ''}`}
                        title={f.isCover ? 'Dit is de omslag' : 'Zet deze vooraan als omslag'}
                        disabled={f.isCover}
                        onClick={() => void fotoRepo.voorop(f.id)}
                      >
                        <Star size={13} />
                      </button>
                      {/*
                        * Eerste tik vraagt, tweede tik doet. Een prullenbak op
                        * een foto op een telefoon is anders een ongeluk dat op
                        * je wacht, en een foto terughalen kan niet.
                        */}
                      <button
                        type="button"
                        className={`vf-knop ${vraagt ? 'zeker' : ''}`}
                        title={vraagt ? 'Nog een keer om echt te verwijderen' : 'Verwijderen'}
                        onClick={() => {
                          if (vraagt) { setWegVraag(null); void fotoRepo.wissen(f); return }
                          setWegVraag(f.id)
                          window.setTimeout(() => setWegVraag((v) => (v === f.id ? null : v)), 3500)
                        }}
                      >
                        <Trash2 size={13} /> {vraagt && 'Zeker?'}
                      </button>
                    </div>
                  )}

                  {/*
                    * De sleutel bevat het bijschrift, zodat het veld opnieuw
                    * wordt opgezet als het elders is gewijzigd. Zonder dat
                    * blijft een defaultValue staan op wat er stond toen de
                    * tegel voor het eerst werd getekend.
                    */}
                  <input
                    key={`${f.id}:${f.caption ?? ''}`}
                    className="vf-bijschrift"
                    defaultValue={f.caption ?? ''}
                    disabled={!mag}
                    placeholder="Bijschrift"
                    onBlur={(e) => {
                      if (e.target.value !== (f.caption ?? '')) {
                        void fotoRepo.bijschrift(f.id, e.target.value)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </motion.div>
              )
            })}
          </div>
        </>
      )}

      {spook && (
        <div
          className="vf-spook"
          style={{ left: spook.x, top: spook.y, width: spook.w, height: spook.h }}
        >
          <Foto foto={spook.foto} />
        </div>
      )}

      <Lichtbak foto={groot} onClose={() => setGroot(null)} />
    </>
  )
}
