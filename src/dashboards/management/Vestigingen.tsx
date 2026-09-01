import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, Reorder, motion } from 'framer-motion'
import {
  Building2, Camera, Check, ChevronDown, ChevronRight, Clock, Compass, Image as ImageIcon,
  Loader2, MapPin, Plus, Power, Search, Star, Trash2, Upload, X,
} from 'lucide-react'
import { alleMensen, db } from '../../lib/db'
import {
  adresRegel, bezetting, codeProbleem, coverVan, fotoUrl,
  fotos as fotoRepo, nuOpen, opVolgorde, standaardTijden, tijdenInHetKort,
  tijdProbleem, vestigingen as repo, vrijeCode, voorstelCode, zoekAdres,
  FotoProbleem, VestigingBezet,
  type Bezetting,
} from '../../lib/vestigingen'
import { WEEKDAGEN, type Location, type LocationKind, type LocationPhoto, type Openingstijden, type User } from '../../lib/types'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

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
  const cover = coverVan(fotos)
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
      <div className="vest-foto">
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
      </div>

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
 *  Het adres komt uit de lokale kopie als die er is, en anders van de
 *  server. Het object-adres wordt weer vrijgegeven zodra het plaatje uit
 *  beeld gaat -- laat je dat na, dan houdt de browser elke foto die je ooit
 *  hebt bekeken vast tot het tabblad dichtgaat.
 * ================================================================== */

function Foto({ foto, className = '' }: { foto: LocationPhoto; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let levend = true
    let hier: string | null = null

    void fotoUrl(foto).then((u) => {
      if (!levend) { if (u) URL.revokeObjectURL(u); return }
      hier = u
      setUrl(u)
    })

    return () => { levend = false; if (hier) URL.revokeObjectURL(hier) }
  }, [foto.storagePath])

  if (!url) return <div className="vest-laadt" />
  return <img className={className} src={url} alt={foto.caption ?? ''} loading="lazy" />
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

function VestigingDetail({
  locatie, bestaand, mag, onClose,
}: {
  locatie: Location | null
  bestaand: Location[]
  mag: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<'gegevens' | 'fotos'>('gegevens')

  useEffect(() => { setTab('gegevens') }, [locatie?.id])

  return (
    <Modal
      open={!!locatie}
      title={locatie?.name ?? ''}
      subtitle={locatie ? `${locatie.code} · ${adresRegel(locatie) || 'geen adres'}` : ''}
      onClose={onClose}
      width={780}
    >
      {locatie && (
        <>
          <div className="row" style={{ gap: 6, margin: '4px 0 16px' }}>
            <button
              className={`btn sm ${tab === 'gegevens' ? 'primary' : 'ghost'}`}
              onClick={() => setTab('gegevens')}
            >
              <Building2 size={14} /> Gegevens
            </button>
            <button
              className={`btn sm ${tab === 'fotos' ? 'primary' : 'ghost'}`}
              onClick={() => setTab('fotos')}
            >
              <Camera size={14} /> Foto's
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: tab === 'gegevens' ? -12 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: tab === 'gegevens' ? 12 : -12 }}
              transition={{ duration: .18, ease: [.22, .61, .36, 1] }}
            >
              {tab === 'gegevens'
                ? <Gegevens
                    locatie={locatie}
                    bestaand={bestaand}
                    mag={mag}
                    onWeg={onClose}
                  />
                : <Fotos locatie={locatie} mag={mag} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </Modal>
  )
}

/* ------------------------------ Gegevens -------------------------- */

function Gegevens({
  locatie, bestaand, mag, onWeg,
}: {
  locatie: Location
  bestaand: Location[]
  mag: boolean
  onWeg: () => void
}) {
  const [vorm, setVorm] = useState<Location>(locatie)
  const [bezig, setBezig] = useState(false)
  const [zoekt, setZoekt] = useState(false)
  const [gevonden, setGevonden] = useState<string | null>(null)
  const [wegVraag, setWegVraag] = useState(false)
  const [uitVraag, setUitVraag] = useState(false)

  const mensen = useLiveQuery(() => alleMensen(), [], [] as User[])

  useEffect(() => { setVorm(locatie); setGevonden(null) }, [locatie.id, locatie.updatedAt])

  const zet = <K extends keyof Location>(k: K, v: Location[K]) =>
    setVorm((h) => ({ ...h, [k]: v }))

  const probleem = codeProbleem(vorm.code, bestaand, vorm.id)
  const veranderd = JSON.stringify(vorm) !== JSON.stringify(locatie)

  async function opslaan() {
    if (probleem || bezig) return
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

  async function opzoeken() {
    setZoekt(true)
    setGevonden(null)
    const uit = await zoekAdres(adresRegel(vorm))
    setZoekt(false)
    if (!uit.ok) { toast.warn(uit.reden ?? 'Niet gevonden.'); return }
    setVorm((h) => ({
      ...h, lat: uit.lat, lon: uit.lon, geoLabel: uit.label, geoAt: Date.now(),
    }))
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
            setVorm((h) => ({ ...h, managerId: m?.id, managerName: m?.name }))
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

      {mag && (
        <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
          <button
            className={`btn sm ${locatie.active ? 'ghost' : 'ok'}`}
            onClick={() => locatie.active ? setUitVraag(true) : void repo.aanUit(locatie.id, true)}
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

      <Uitzetten
        open={uitVraag}
        locatie={locatie}
        onClose={() => setUitVraag(false)}
      />
      <Verwijderen
        open={wegVraag}
        locatie={locatie}
        onClose={() => setWegVraag(false)}
        onWeg={() => { setWegVraag(false); onWeg() }}
      />
    </>
  )
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
 *  Foto's
 * ================================================================== */

function Fotos({ locatie, mag }: { locatie: Location; mag: boolean }) {
  const { user } = useAuth()
  const [bezig, setBezig] = useState(0)
  const [sleept, setSleept] = useState(false)
  const [groot, setGroot] = useState<LocationPhoto | null>(null)
  const kiezer = useRef<HTMLInputElement>(null)

  const opgeslagen = useLiveQuery(
    () => db.locationPhotos.where('locationId').equals(locatie.id).toArray(),
    [locatie.id], [] as LocationPhoto[])

  const lijst = useMemo(() => opVolgorde(opgeslagen), [opgeslagen])

  // De volgorde tijdens het slepen staat hier, zodat de tegels meelopen met
  // de muis en niet pas verspringen als de database het heeft rondgestuurd.
  const [orde, setOrde] = useState<LocationPhoto[]>(lijst)
  useEffect(() => { setOrde(lijst) }, [lijst])

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

  return (
    <>
      {mag && (
        <div
          className={`vest-drop ${sleept ? 'sleept' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setSleept(true) }}
          onDragLeave={() => setSleept(false)}
          onDrop={(e) => {
            e.preventDefault()
            setSleept(false)
            void verwerk(e.dataTransfer.files)
          }}
          onClick={() => kiezer.current?.click()}
        >
          <motion.div animate={{ scale: sleept ? 1.08 : 1 }}>
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
        <Empty text="Nog geen foto's van deze vestiging." icon={<Camera size={22} />} />
      ) : (
        <Reorder.Group
          axis="y"
          values={orde}
          onReorder={setOrde}
          className="vest-fotolijst"
        >
          {orde.map((f) => (
            <Reorder.Item
              key={f.id}
              value={f}
              drag={mag ? 'y' : false}
              className="vest-fotorij"
              whileDrag={{ scale: 1.02, zIndex: 2 }}
              /*
               * Pas bij het loslaten. Tijdens het slepen zou elke tussenstand
               * een ronde langs de server maken, en die komen niet gegarandeerd
               * op volgorde terug -- dan springt de lijst na afloop alsnog.
               */
              onDragEnd={() => { if (mag) void fotoRepo.volgorde(orde) }}
            >
              <button className="vest-mini" onClick={() => setGroot(f)}>
                <Foto foto={f} />
              </button>

              <input
                className="vest-bijschrift"
                defaultValue={f.caption ?? ''}
                disabled={!mag}
                placeholder="Bijschrift"
                onBlur={(e) => {
                  if (e.target.value !== (f.caption ?? '')) {
                    void fotoRepo.bijschrift(f.id, e.target.value)
                  }
                }}
              />

              {mag && (
                <>
                  <button
                    className={`btn ghost sm ${f.isCover ? 'primary' : ''}`}
                    title={f.isCover ? 'Deze staat vooraan' : 'Zet deze vooraan'}
                    onClick={() => void fotoRepo.voorop(f.id)}
                  >
                    <Star size={14} />
                  </button>
                  <button
                    className="btn ghost sm danger"
                    title="Verwijderen"
                    onClick={() => void fotoRepo.wissen(f)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}

      <AnimatePresence>
        {groot && (
          <motion.div
            className="vest-lichtbak"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setGroot(null)}
          >
            <motion.div
              initial={{ scale: .94, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: .96, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <Foto foto={groot} />
              {groot.caption && <p>{groot.caption}</p>}
            </motion.div>
            <button
              className="btn ghost sm vest-dicht"
              aria-label="Sluiten"
              onClick={() => setGroot(null)}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
