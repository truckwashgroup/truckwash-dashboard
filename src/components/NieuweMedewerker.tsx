import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, FileSignature,
  FileText, Fingerprint, Loader2, ScanLine, Send, ShieldCheck, Upload,
  UserPlus, UserSearch, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { users as userRepo } from '../lib/repo'
import { mogelijkDubbel, personeel } from '../lib/personeel'
import { documenten, dossier as dossierRepo, DossierFout, MAX_BESTAND, TOEGESTAAN } from '../lib/dossier'
import {
  bsnFormatteer, bsnProbleem, ibanFormatteer, ibanProbleem, leesMrz,
  type MrzResultaat,
} from '../lib/identiteit'
import {
  aantalGevonden, afgeleidUurloon, GeenTekstlaag, leesContract,
  type ContractGegevens,
} from '../lib/contractLezen'
import {
  ROLE_LABELS, ROLE_ORDER, type Role, type User,
} from '../lib/types'
import { money } from '../lib/format'
import { dateInputValue, dayFromDateInput } from '../lib/roster'
import { Badge, Field, Modal } from './ui'
import LocatiesKiezer, { type LocatieKeuze } from './LocatiesKiezer'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Een nieuwe medewerker aanmaken
 *
 *  In stappen, en de laatste is de belangrijkste: daar gaan het
 *  identiteitsbewijs en het contract erin. Voorheen moest je iemand eerst
 *  opslaan en daarna het dossier weer opzoeken -- en dan doet niemand het.
 *
 *  De volgorde is niet vrij te kiezen. Het dossier krijgt zijn id pas bij
 *  het opslaan, en de bestanden gaan in een map met dat id. Dus: eerst het
 *  dossier aanmaken, dan de bestanden erin, dan pas wat er uit het contract
 *  kwam toepassen.
 * ------------------------------------------------------------------ */

type Stap = 'wie' | 'waar' | 'papieren' | 'klaar'

const STAPPEN: { key: Stap; label: string }[] = [
  { key: 'wie', label: 'Wie' },
  { key: 'waar', label: 'Waar en wat' },
  { key: 'papieren', label: 'Papieren' },
]

interface Papier {
  bestand: File
  soort: 'identiteitsbewijs' | 'contract' | 'diploma' | 'verklaring' | 'overig'
  titel: string
  tekenen: boolean
  verloopt?: number
}

export default function NieuweMedewerker({
  open, onClose, onKlaar,
}: {
  open: boolean
  onClose: () => void
  onKlaar: (id: string) => void
}) {
  const me = useAuth((s) => s.user)!
  const bestaand = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  const [stap, setStap] = useState<Stap>('wie')
  const [gemaaktId, setGemaaktId] = useState<string | null>(null)
  const [uitgenodigd, setUitgenodigd] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [voortgang, setVoortgang] = useState('')

  /* --------------------------- stap 1 --------------------------- */
  const [naam, setNaam] = useState('')
  const [email, setEmail] = useState('')
  const [telefoon, setTelefoon] = useState('')
  const [nummer, setNummer] = useState('')
  const [functie, setFunctie] = useState('')
  const [rollen, setRollen] = useState<Role[]>(['employee'])

  /* --------------------------- stap 2 --------------------------- */
  const [loc, setLoc] = useState<LocatieKeuze>({ manages: [], allLocations: false })
  const [uren, setUren] = useState('38')
  const [tarief, setTarief] = useState('')
  const [inDienst, setInDienst] = useState(dateInputValue(Date.now()))
  const [bsn, setBsn] = useState('')
  const [iban, setIban] = useState('')

  /* --------------------------- stap 3 --------------------------- */
  const [papieren, setPapieren] = useState<Papier[]>([])
  const [mrz, setMrz] = useState<MrzResultaat | null>(null)
  const [mrzTekst, setMrzTekst] = useState('')
  const [contract, setContract] = useState<ContractGegevens | null>(null)
  const [contractFout, setContractFout] = useState<string | null>(null)
  const [overnemen, setOvernemen] = useState<Set<string>>(new Set())
  const [lezen, setLezen] = useState(false)

  const voorstel = useMemo(() => {
    const nums = bestaand
      .map((u) => u.personnelNumber?.match(/(\d+)\s*$/)?.[1])
      .filter(Boolean)
      .map(Number)
    return 'TW-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')
  }, [bestaand])

  const bsnFout = bsnProbleem(bsn)
  const ibanFout = ibanProbleem(iban)

  function alles(): void {
    setStap('wie'); setNaam(''); setEmail(''); setTelefoon(''); setNummer('')
    setFunctie(''); setRollen(['employee'])
    setLoc({ manages: [], allLocations: false }); setUren('38'); setTarief('')
    setInDienst(dateInputValue(Date.now())); setBsn(''); setIban('')
    setPapieren([]); setMrz(null); setMrzTekst(''); setContract(null)
    setContractFout(null); setOvernemen(new Set())
  }

  /* ------------------------- verdergaan ------------------------- */

  function volgende() {
    if (stap === 'wie') {
      if (naam.trim().split(/\s+/).length < 2) return toast.error('Vul voor- en achternaam in')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) {
        return toast.error('Vul een geldig e-mailadres in')
      }
      if (bestaand.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
        return toast.error('Er bestaat al iemand met dit e-mailadres')
      }
      if (rollen.length === 0) return toast.error('Kies minimaal één rol')
      return setStap('waar')
    }
    if (stap === 'waar') {
      if (bsnFout) return toast.error(bsnFout)
      if (ibanFout) return toast.error(ibanFout)
      return setStap('papieren')
    }
  }

  /* --------------------- papieren toevoegen --------------------- */

  function voegPapierToe(
    bestand: File,
    soort: Papier['soort'],
  ) {
    const papier: Papier = {
      bestand,
      soort,
      titel: bestand.name.replace(/\.[a-z0-9]+$/i, ''),
      tekenen: soort === 'contract',
    }
    setPapieren((p) => [...p.filter((x) => x.soort !== soort || soort === 'overig'), papier])

    if (soort === 'contract' && bestand.type === 'application/pdf') {
      void lezenUitContract(bestand)
    }
  }

  async function lezenUitContract(bestand: File) {
    setLezen(true)
    setContractFout(null)
    try {
      const uitkomst = await leesContract(bestand)
      setContract(uitkomst)

      const zeker = new Set<string>()
      for (const [sleutel, vondst] of Object.entries(uitkomst)) {
        if (sleutel === 'tekst' || sleutel === 'bladzijden') continue
        if (vondst && typeof vondst === 'object' && 'zekerheid' in vondst
            && vondst.zekerheid === 'hoog') zeker.add(sleutel)
      }
      setOvernemen(zeker)

      // Wat we nu al kunnen invullen, vullen we vast in.
      if (uitkomst.functie && !functie) setFunctie(uitkomst.functie.waarde)
      if (uitkomst.urenPerWeek) setUren(String(uitkomst.urenPerWeek.waarde))
      if (uitkomst.startDatum) setInDienst(dateInputValue(uitkomst.startDatum.waarde))
      if (uitkomst.uurloon) setTarief(String(uitkomst.uurloon.waarde))
      else if (uitkomst.maandloon && uitkomst.urenPerWeek) {
        setTarief(String(afgeleidUurloon(uitkomst.maandloon.waarde, uitkomst.urenPerWeek.waarde)))
      }

      if (aantalGevonden(uitkomst) === 0) {
        setContractFout('Er is niets herkenbaars in gevonden. Vul de gegevens met de hand in.')
      } else {
        toast.ok(`${aantalGevonden(uitkomst)} gegevens uit het contract gehaald`)
      }
    } catch (e) {
      setContractFout(e instanceof GeenTekstlaag
        ? e.message
        : 'Het contract kon niet gelezen worden. Vul de gegevens met de hand in.')
    } finally {
      setLezen(false)
    }
  }

  function nemenUitMrz() {
    const gelezen = leesMrz(mrzTekst)
    if (!gelezen) return toast.error('Dit ziet er niet uit als een machineleesbare strook')
    setMrz(gelezen)
    if (!naam && gelezen.volledigeNaam) setNaam(gelezen.volledigeNaam)
    toast.ok(gelezen.betrouwbaar
      ? 'Overgenomen; alle controlecijfers kloppen'
      : `Overgenomen, maar controleer: ${gelezen.twijfel.join(', ')}`)
  }

  /* --------------------------- opslaan -------------------------- */

  /** De uitnodiging versturen zodra het dossier er staat. */
  async function nodigUit() {
    if (!gemaaktId) return
    setBezig(true)
    try {
      const uit = await personeel.uitnodigen(gemaaktId)
      if (!uit.ok) return toast.error(uit.reden ?? 'Uitnodigen lukte niet')
      setUitgenodigd(true)
      toast.ok(uit.soort === 'gekoppeld'
        ? 'Er bestond al een account op dit adres; dat is nu gekoppeld'
        : uit.mailVerstuurd
          ? 'De uitnodiging is verstuurd'
          : 'Account aangemaakt, maar de mail ging niet uit — kijk bij Post')
    } finally {
      setBezig(false)
    }
  }

  async function opslaan() {
    setBezig(true)
    try {
      setVoortgang('Dossier aanmaken…')

      const persoon = await userRepo.create({
        name: naam,
        email: email.trim().toLowerCase(),
        roles: rollen,
        personnelNumber: nummer.trim() || voorstel,
        phone: telefoon,
        function: functie,
        contractHours: uren ? Number(uren.replace(',', '.')) : undefined,
        startDate: inDienst ? dayFromDateInput(inDienst) : undefined,
      })
      if (!persoon) throw new Error('Het dossier kon niet worden aangemaakt')

      if (loc.locationId || loc.manages.length || loc.allLocations) {
        await userRepo.update(persoon.id, {
          locationId: loc.locationId,
          manages: loc.manages.length ? loc.manages : undefined,
          allLocations: loc.allLocations || undefined,
        })
      }

      /* --- het afgeschermde deel --- */

      setVoortgang('Afgeschermde gegevens opslaan…')
      await dossierRepo.save(persoon.id, {
        bsn: bsn.replace(/\D/g, '') || undefined,
        iban: iban.replace(/\s+/g, '').toUpperCase() || undefined,
        hourlyRate: tarief ? Number(tarief.replace(',', '.')) : undefined,
        birthDate: mrz?.geboortedatum,
        nationality: mrz?.nationaliteit || undefined,
        documentType: mrz ? (mrz.soort === 'paspoort' ? 'paspoort' : 'id-kaart') : undefined,
        documentNumber: mrz?.documentNumber || undefined,
        documentExpires: mrz?.vervaldatum,
        documentVerified: mrz?.betrouwbaar ?? false,
      })

      /* --- de papieren --- */

      let mislukt = 0
      for (const [i, papier] of papieren.entries()) {
        setVoortgang(`Document ${i + 1} van ${papieren.length} versturen…`)
        try {
          await documenten.upload({
            bestand: papier.bestand,
            bestandsnaam: papier.bestand.name,
            persoon,
            kind: papier.soort,
            title: papier.titel,
            expiresAt: papier.soort === 'identiteitsbewijs'
              ? mrz?.vervaldatum
              : papier.verloopt,
            requiresSignature: papier.tekenen,
            door: me,
          })
        } catch (e) {
          mislukt++
          toast.error(e instanceof DossierFout
            ? `${papier.titel}: ${e.message}`
            : `${papier.titel} kon niet worden opgeslagen`)
        }
      }

      /* --- wat er uit het contract kwam --- */

      if (contract && overnemen.size > 0) {
        setVoortgang('Gegevens uit het contract overnemen…')
        const patch: Partial<User> = {}
        if (overnemen.has('eindDatum') && contract.eindDatum) {
          patch.endDate = contract.eindDatum.waarde
        }
        if (overnemen.has('onbepaaldeTijd')) patch.endDate = undefined
        if (Object.keys(patch).length > 0) await userRepo.update(persoon.id, patch)
      }

      toast.ok(mislukt === 0
        ? `${naam.trim()} staat erin${papieren.length ? ` met ${papieren.length} ${papieren.length === 1 ? 'document' : 'documenten'}` : ''}`
        : `${naam.trim()} staat erin, maar ${mislukt} document(en) mislukten`)

      setGemaaktId(persoon.id)
      setStap('klaar')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt')
    } finally {
      setBezig(false)
      setVoortgang('')
    }
  }

  /* ---------------------------------------------------------------- */

  const verdenkingen = useMemo(
    () => (naam.trim().length < 3 && !email.trim()
      ? []
      : mogelijkDubbel(bestaand, {
          naam: naam.trim(), email: email.trim(), telefoon: telefoon.trim(),
        }).slice(0, 3)),
    [bestaand, naam, email, telefoon],
  )

  const stapNummer = STAPPEN.findIndex((s) => s.key === stap)

  return (
    <Modal
      open={open}
      title="Medewerker toevoegen"
      subtitle="In drie stappen, inclusief de papieren"
      onClose={() => { if (!bezig) { alles(); onClose() } }}
      width={680}
    >
      <div className="wizard-stappen">
        {STAPPEN.map((s, i) => (
          <div
            key={s.key}
            className={`wizard-stap ${i < stapNummer ? 'klaar' : ''} ${i === stapNummer ? 'nu' : ''}`}
          >
            <span className="bol">{i < stapNummer ? <Check size={13} /> : i + 1}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ============================ WIE ============================ */}

      {/*
        * Staat deze persoon er misschien al?
        *
        * Dit is het vangnet naast het uitnodigen. Twee dossiers van dezelfde
        * man ontstaan doordat het kantoor er een aanmaakt op zijn werkadres
        * en hij zich daarna zelf aanmeldt met zijn privé-adres. Op adres zijn
        * dat twee mensen; op naam en telefoonnummer valt het wél op.
        */}
      {stap === 'wie' && verdenkingen.length > 0 && (
        <div className={`waarschuwing ${verdenkingen[0].hard ? '' : 'zacht'} mb`}>
          <UserSearch size={17} />
          <span>
            <strong>
              {verdenkingen[0].hard
                ? 'Deze persoon staat er al'
                : 'Staat deze persoon er misschien al?'}
            </strong>{' '}
            {verdenkingen.map((v) => `${v.user.name} (${v.waarom})`).join(', ')}.
            {verdenkingen[0].hard
              ? ' Werk dat dossier bij in plaats van een tweede aan te maken.'
              : ' Kijk het even na — twee dossiers van dezelfde man zijn later lastig uit elkaar te halen.'}
          </span>
        </div>
      )}

      {stap === 'wie' && (
        <>
          <div className="grid cols-2">
            <Field label="Voor- en achternaam">
              <input
                className="input" value={naam} autoFocus
                onChange={(e) => setNaam(e.target.value)}
                placeholder="Jan de Vries"
              />
            </Field>
            <Field label="Personeelsnummer" help={`Leeg laten geeft ${voorstel}`}>
              <input
                className="input" value={nummer} placeholder={voorstel}
                onChange={(e) => setNummer(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid cols-2">
            <Field
              label="E-mailadres"
              help="Hiermee meldt hij zich straks zelf aan; het dossier koppelt dan vanzelf."
            >
              <input
                className="input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@truckwash1group.nl"
              />
            </Field>
            <Field label="Telefoon">
              <input
                className="input" value={telefoon} inputMode="tel"
                onChange={(e) => setTelefoon(e.target.value)}
                placeholder="06-12345678"
              />
            </Field>
          </div>

          <Field label="Functie">
            <input
              className="input" value={functie}
              onChange={(e) => setFunctie(e.target.value)}
              placeholder="Wasmedewerker"
            />
          </Field>

          <Field label="Toegang tot welke dashboards">
            <div className="row" style={{ gap: 6 }}>
              {ROLE_ORDER.map((r) => {
                const aan = rollen.includes(r)
                return (
                  <button
                    key={r}
                    type="button"
                    className={`btn sm ${aan ? 'primary' : ''}`}
                    onClick={() => setRollen(aan ? rollen.filter((x) => x !== r) : [...rollen, r])}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                )
              })}
            </div>
          </Field>
        </>
      )}

      {/* =========================== WAAR ============================ */}

      {stap === 'waar' && (
        <>
          <LocatiesKiezer
            waarde={loc}
            onChange={setLoc}
            toonLeiding={rollen.includes('supervisor') || rollen.includes('management')}
          />

          <div className="grid cols-3">
            <Field label="Contracturen per week">
              <input
                className="input" inputMode="decimal" value={uren}
                onChange={(e) => setUren(e.target.value)}
              />
            </Field>
            <Field label="Uurtarief (€)" help="Staat afgeschermd">
              <input
                className="input" inputMode="decimal" value={tarief}
                onChange={(e) => setTarief(e.target.value)}
                placeholder="22"
              />
            </Field>
            <Field label="In dienst per">
              <input
                className="input" type="date" value={inDienst}
                onChange={(e) => setInDienst(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid cols-2">
            <Field
              label="Burgerservicenummer"
              help={bsnFout ?? 'Wordt gecontroleerd met de elfproef'}
            >
              <input
                className={`input mono ${bsnFout ? 'fout' : ''}`}
                value={bsn} inputMode="numeric"
                onChange={(e) => setBsn(bsnFormatteer(e.target.value))}
                placeholder="123 456 782"
              />
            </Field>
            <Field
              label="Rekeningnummer"
              help={ibanFout ?? 'Wordt gecontroleerd met de mod-97-toets'}
            >
              <input
                className={`input mono ${ibanFout ? 'fout' : ''}`}
                value={iban}
                onChange={(e) => setIban(ibanFormatteer(e.target.value))}
                placeholder="NL91 ABNA 0417 1643 00"
              />
            </Field>
          </div>

          <div className="afgeschermd">
            <Fingerprint size={14} />
            <span>
              Deze twee komen in het afgeschermde deel van het dossier, waar
              collega’s niet bij kunnen. Het BSN mag een werkgever verwerken
              voor de loonaangifte; daar is het voor.
            </span>
          </div>
        </>
      )}

      {/* ========================= PAPIEREN ========================== */}

      {stap === 'papieren' && (
        <>
          <div className="signup-note">
            <ShieldCheck size={16} />
            <span>
              Alles wat je hier toevoegt gaat mee zodra je opslaat. Overslaan
              mag; je kunt het later altijd in het dossier zetten.
            </span>
          </div>

          {/* ---- identiteitsbewijs ---- */}

          <div className="papier-blok">
            <div className="kop">
              <Fingerprint size={17} />
              <strong>Identiteitsbewijs</strong>
              {papieren.some((p) => p.soort === 'identiteitsbewijs') && (
                <Badge tone="ok"><Check size={11} /> toegevoegd</Badge>
              )}
            </div>

            <input
              className="input"
              type="file"
              accept={TOEGESTAAN.join(',')}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) voegPapierToe(f, 'identiteitsbewijs')
              }}
            />

            <Field
              label="De twee regels onderaan overtypen (optioneel)"
              help="Naam, geboortedatum, documentnummer en vervaldatum worden dan gecontroleerd overgenomen. Het BSN staat er niet in."
            >
              <textarea
                className="textarea mono"
                style={{ minHeight: 70, letterSpacing: '.08em', fontSize: '.8rem' }}
                value={mrzTekst}
                onChange={(e) => setMrzTekst(e.target.value)}
                placeholder={'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<\nSPECI20142NLD6503101M2403096999999990<<<<<84'}
              />
            </Field>

            {mrzTekst.trim() && !mrz && (
              <button className="btn sm" onClick={nemenUitMrz} type="button">
                <ScanLine size={14} /> Uitlezen
              </button>
            )}

            {mrz && (
              <div className={`mrz-uitkomst ${mrz.betrouwbaar ? 'goed' : 'twijfel'}`}>
                <div className="kop">
                  {mrz.betrouwbaar
                    ? <><ShieldCheck size={16} /> Alle controlecijfers kloppen</>
                    : <><AlertTriangle size={16} /> Controleer: {mrz.twijfel.join(', ')}</>}
                </div>
                <div className="person-fields">
                  <div className="person-field">
                    <div className="label">Naam</div>
                    <div className="value">{mrz.volledigeNaam || '—'}</div>
                  </div>
                  <div className="person-field">
                    <div className="label">Geboortedatum</div>
                    <div className="value">
                      {mrz.geboortedatum
                        ? new Date(mrz.geboortedatum).toLocaleDateString('nl-NL')
                        : '—'}
                    </div>
                  </div>
                  <div className="person-field">
                    <div className="label">Documentnummer</div>
                    <div className="value mono">{mrz.documentNumber || '—'}</div>
                  </div>
                  <div className="person-field">
                    <div className="label">Geldig tot</div>
                    <div className="value">
                      {mrz.vervaldatum
                        ? new Date(mrz.vervaldatum).toLocaleDateString('nl-NL')
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ---- contract ---- */}

          <div className="papier-blok">
            <div className="kop">
              <FileSignature size={17} />
              <strong>Contract</strong>
              {papieren.some((p) => p.soort === 'contract') && (
                <Badge tone="ok"><Check size={11} /> toegevoegd</Badge>
              )}
            </div>

            <input
              className="input"
              type="file"
              accept={TOEGESTAAN.join(',')}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) voegPapierToe(f, 'contract')
              }}
            />

            {lezen && (
              <div className="signup-note" style={{ marginTop: 10 }}>
                <Loader2 size={16} className="spin" />
                <span>Het contract wordt gelezen…</span>
              </div>
            )}

            {contractFout && (
              <div className="signup-note" style={{ marginTop: 10 }}>
                <AlertTriangle size={16} />
                <span>{contractFout}</span>
              </div>
            )}

            {contract && aantalGevonden(contract) > 0 && (
              <div className="contract-voorstel" style={{ marginTop: 10 }}>
                <div className="kop">
                  <ScanLine size={16} />
                  <span>
                    <strong>Uit het contract gehaald en hierboven ingevuld</strong>
                    <span>
                      Loop de vorige stap na voordat je opslaat — die waarden
                      zijn voorgesteld, niet bewezen.
                    </span>
                  </span>
                </div>
                {contract.functie && <Regel label="Functie" waarde={contract.functie.waarde} />}
                {contract.urenPerWeek && (
                  <Regel label="Uren per week" waarde={`${contract.urenPerWeek.waarde} uur`} />
                )}
                {contract.maandloon && (
                  <Regel label="Bruto per maand" waarde={money(contract.maandloon.waarde)} />
                )}
                {contract.uurloon && (
                  <Regel label="Uurtarief" waarde={money(contract.uurloon.waarde)} />
                )}
                {contract.startDatum && (
                  <Regel
                    label="In dienst per"
                    waarde={new Date(contract.startDatum.waarde).toLocaleDateString('nl-NL')}
                  />
                )}
                {contract.eindDatum && (
                  <Regel
                    label="Einddatum"
                    waarde={new Date(contract.eindDatum.waarde).toLocaleDateString('nl-NL')}
                  />
                )}
                {contract.onbepaaldeTijd && <Regel label="Onbepaalde tijd" waarde="ja" />}
              </div>
            )}

            {papieren.some((p) => p.soort === 'contract') && (
              <button
                type="button"
                className={`stop-toggle ${papieren.find((p) => p.soort === 'contract')?.tekenen ? 'on' : ''}`}
                style={{ marginTop: 10 }}
                onClick={() => setPapieren((lijst) => lijst.map((p) =>
                  p.soort === 'contract' ? { ...p, tekenen: !p.tekenen } : p))}
              >
                <FileSignature size={17} />
                <span>
                  <strong>Laten ondertekenen</strong>
                  <span>
                    {naam.split(' ')[0] || 'Hij'} krijgt bericht en een mail zodra
                    hij kan inloggen.
                  </span>
                </span>
              </button>
            )}
          </div>

          {/* ---- overige stukken ---- */}

          <div className="papier-blok">
            <div className="kop">
              <FileText size={17} />
              <strong>Overige stukken</strong>
              <span className="hint">VOG, diploma, keuring — meerdere mag</span>
            </div>

            <input
              className="input"
              type="file"
              accept={TOEGESTAAN.join(',')}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) voegPapierToe(f, 'overig')
                e.target.value = ''
              }}
            />

            {papieren.filter((p) => p.soort === 'overig').length > 0 && (
              <div className="papier-lijst">
                {papieren.filter((p) => p.soort === 'overig').map((p, i) => (
                  <div key={p.bestand.name + i} className="papier">
                    <FileText size={14} />
                    <span className="n">{p.titel}</span>
                    <span className="s">{Math.round(p.bestand.size / 1024)} kB</span>
                    <button
                      className="btn ghost sm"
                      onClick={() => setPapieren((lijst) => lijst.filter((x) => x !== p))}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="afgeschermd">
            <Upload size={14} />
            <span>
              Maximaal {Math.round(MAX_BESTAND / 1024 / 1024)} MB per bestand,
              PDF of foto. Uploaden vraagt om verbinding; de rest van het
              dossier wordt hoe dan ook aangemaakt.
            </span>
          </div>
        </>
      )}

      {/* ============================ KLAAR ========================== */}

      {stap === 'klaar' && (
        <div className="signup-done">
          <CheckCircle2 size={40} />
          <h2>{naam.trim()} staat erin</h2>

          {/*
            * Meteen uitnodigen, want dat is de hele reden dat dit bestaat.
            * Wie geen uitnodiging krijgt meldt zich zelf aan -- met zijn
            * privé-adres -- en dan staan er twee dossiers van dezelfde man.
            */}
          {email.trim() ? (
            uitgenodigd ? (
              <p>
                De uitnodiging is verstuurd naar {email.trim()}. Hij kiest bij
                de eerste inlog zijn eigen wachtwoord.
              </p>
            ) : (
              <>
                <p>
                  Stuur hem meteen zijn inloggegevens. Doe je dat niet, dan
                  moet hij zich zelf aanmelden — en dan staat hij er straks
                  twee keer in.
                </p>
                <button
                  className="btn primary lg"
                  disabled={bezig}
                  onClick={() => void nodigUit()}
                  style={{ marginTop: 4 }}
                >
                  {bezig ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                  Uitnodiging versturen
                </button>
              </>
            )
          ) : (
            <p>
              Er staat geen e-mailadres bij, dus er kan geen uitnodiging uit.
              Vul er later een in bij het dossier en nodig hem alsnog uit.
            </p>
          )}
        </div>
      )}

      {/* ---------------------------- knoppen ------------------------ */}

      {stap !== 'klaar' && (
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <button
            className="btn ghost"
            onClick={() => {
              if (stap === 'waar') setStap('wie')
              else if (stap === 'papieren') setStap('waar')
              else { alles(); onClose() }
            }}
            disabled={bezig}
          >
            {stap === 'wie' ? 'Annuleren' : <><ArrowLeft size={15} /> Terug</>}
          </button>

          {stap === 'papieren' ? (
            <button className="btn primary" onClick={() => void opslaan()} disabled={bezig}>
              {bezig ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />}
              {bezig ? voortgang || 'Bezig…' : 'Aanmaken'}
            </button>
          ) : (
            <button className="btn primary" onClick={volgende}>
              Verder <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

function Regel({ label, waarde }: { label: string; waarde: string }) {
  return (
    <div className="voorstel on" style={{ cursor: 'default' }}>
      <span className="vink"><Check size={13} /></span>
      <span className="inhoud">
        <span className="rij">
          <strong>{label}</strong>
          <span className="waarde">{waarde}</span>
        </span>
      </span>
    </div>
  )
}
