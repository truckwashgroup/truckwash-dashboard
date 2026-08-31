import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, CalendarClock, Check, CreditCard, Download, Eye, EyeOff,
  FileSignature, FileText, Fingerprint, Heart, Loader2, Lock, PenLine, ScanLine,
  ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  documenten, documentenVan, dossier as dossierRepo, signalen,
  DossierFout, MAX_BESTAND, TOEGESTAAN,
} from '../lib/dossier'
import {
  bsnFormatteer, bsnGemaskeerd, bsnProbleem, ibanFormatteer, ibanProbleem,
  kortHash, leesMrz, type MrzResultaat,
} from '../lib/identiteit'
import {
  aantalGevonden, afgeleidUurloon, GeenTekstlaag, leesContract,
  type ContractGegevens,
} from '../lib/contractLezen'
import { users as userRepo } from '../lib/repo'
import { WijzigingenVan } from './Wijzigingen'
import {
  DOCUMENT_KINDS, type DocumentKind, type PersonnelDocument,
  type PersonnelPrivate, type User,
} from '../lib/types'
import { dateShort, dateTime, money, relative } from '../lib/format'
import { dateInputValue, dayFromDateInput } from '../lib/roster'
import { Badge, Card, Empty, Field, Modal } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Het personeelsdossier
 *
 *  Twee helften met een verschillend slot:
 *
 *    de gegevens  -- BSN, rekeningnummer, uurloon. Alleen het management,
 *                    plus de persoon zelf voor zijn eigen regel.
 *    de stukken   -- bestanden in een afgesloten emmer. Per stuk staat
 *                    ingesteld of de medewerker het mag zien.
 *
 *  Beide sloten zitten in de database, niet in dit scherm. Wat je hier ziet
 *  is de bediening; de beveiliging staat er los van.
 * ------------------------------------------------------------------ */

export default function Dossier({ person }: { person: User }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const magBeheren = perms.can('staff.edit')

  const prive = useLiveQuery(
    () => db.personnelPrivate.get(person.id), [person.id], undefined)
  const docs = useLiveQuery(() => db.documents.toArray(), [], [] as PersonnelDocument[])

  const [gegevens, setGegevens] = useState(false)
  const [uploaden, setUploaden] = useState(false)
  const [tekenen, setTekenen] = useState<PersonnelDocument | null>(null)
  const [verbergen, setVerbergen] = useState<PersonnelDocument | null>(null)

  const mijn = useMemo(() => documentenVan(docs, person.id), [docs, person.id])
  const aandacht = useMemo(() => signalen(docs, person.id), [docs, person.id])

  return (
    <>
      {aandacht.length > 0 && (
        <div className="dossier-signalen mb">
          {aandacht.map((s, i) => (
            <div key={i} className={`signaal ${s.soort}`}>
              {s.soort === 'tekenen' ? <FileSignature size={15} />
                : s.soort === 'verlopen' ? <AlertTriangle size={15} />
                : s.soort === 'verloopt' ? <CalendarClock size={15} />
                : <FileText size={15} />}
              <span>{s.tekst}</span>
            </div>
          ))}
        </div>
      )}

      {/* --------------------- Afgeschermde gegevens ------------------ */}

      <Card
        title="Persoons- en loongegevens"
        hint="Alleen het management en deze persoon zelf"
        action={magBeheren ? (
          <button className="btn sm" onClick={() => setGegevens(true)}>
            <PenLine size={14} /> Bewerken
          </button>
        ) : undefined}
      >
        <div className="afgeschermd">
          <Lock size={14} />
          <span>
            Deze gegevens staan in een aparte tabel waar collega’s niet bij
            komen. Ze belanden niet op het toestel van iemand anders.
          </span>
        </div>

        <div className="person-fields" style={{ marginTop: 14 }}>
          <Regel label="Geboortedatum" value={prive?.birthDate ? dateShort(prive.birthDate) : '—'} />
          <Regel label="Geboorteplaats" value={prive?.birthPlace ?? '—'} />
          <Regel label="Nationaliteit" value={prive?.nationality ?? '—'} />
          <Regel
            label="Burgerservicenummer"
            value={bsnGemaskeerd(prive?.bsn)}
            icon={<Fingerprint size={13} />}
            geheim={!!prive?.bsn}
            volledig={prive?.bsn ? bsnFormatteer(prive.bsn) : undefined}
          />
          <Regel
            label="Rekeningnummer"
            value={prive?.iban ? ibanFormatteer(prive.iban) : '—'}
            icon={<CreditCard size={13} />}
          />
          <Regel
            label="Uurtarief"
            value={prive?.hourlyRate ? money(prive.hourlyRate) : '—'}
          />
          <Regel
            label="Identiteitsbewijs"
            value={prive?.documentNumber
              ? `${prive.documentType ?? 'document'} · ${prive.documentNumber}`
              : '—'}
            badge={prive?.documentVerified
              ? <Badge tone="ok"><ShieldCheck size={11} /> gecontroleerd</Badge>
              : undefined}
          />
          <Regel
            label="Geldig tot"
            value={prive?.documentExpires ? dateShort(prive.documentExpires) : '—'}
            waarschuwing={!!prive?.documentExpires && prive.documentExpires < Date.now()}
          />
          <Regel
            label="Bij nood bellen"
            value={prive?.emergencyName
              ? `${prive.emergencyName}${prive.emergencyRelation ? ` (${prive.emergencyRelation})` : ''} · ${prive.emergencyPhone ?? ''}`
              : '—'}
            icon={<Heart size={13} />}
          />
        </div>

        {magBeheren && prive?.internalNotes && (
          <div className="aanmelding-bericht afgewezen" style={{ marginTop: 14 }}>
            <EyeOff size={16} />
            <div>
              <div className="kop">Interne notitie — niet zichtbaar voor {person.name.split(' ')[0]}</div>
              <p>{prive.internalNotes}</p>
            </div>
          </div>
        )}
      </Card>

      {/* --------------------------- Stukken -------------------------- */}

      <Card
        title="Documenten"
        hint={`${mijn.length} ${mijn.length === 1 ? 'stuk' : 'stukken'}`}
        flush
        className="mt"
        action={magBeheren ? (
          <button className="btn primary sm" onClick={() => setUploaden(true)}>
            <Upload size={14} /> Toevoegen
          </button>
        ) : undefined}
      >
        {mijn.length === 0 ? (
          <Empty
            text="Nog geen documenten. Zet hier het identiteitsbewijs en het contract in."
            icon={<FileText size={30} />}
          />
        ) : (
          <div className="doc-lijst">
            {mijn.map((d) => (
              <DocumentRegel
                key={d.id}
                doc={d}
                magBeheren={magBeheren}
                magTekenen={d.userId === me.id}
                onTekenen={() => setTekenen(d)}
                onVerbergen={() => setVerbergen(d)}
              />
            ))}
          </div>
        )}
      </Card>

      <WijzigingenVan person={person} />

      <GegevensDialoog
        open={gegevens}
        person={person}
        prive={prive}
        onClose={() => setGegevens(false)}
      />

      <UploadDialoog
        open={uploaden}
        person={person}
        door={me}
        onClose={() => setUploaden(false)}
      />

      <TekenDialoog
        doc={tekenen}
        door={me}
        onClose={() => setTekenen(null)}
      />

      <VerbergDialoog
        doc={verbergen}
        person={person}
        onClose={() => setVerbergen(null)}
      />
    </>
  )
}

/* ================================================================== *
 *  Eén regel
 * ================================================================== */

function Regel({
  label, value, icon, badge, geheim, volledig, waarschuwing,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  geheim?: boolean
  volledig?: string
  waarschuwing?: boolean
}) {
  const [toon, setToon] = useState(false)

  return (
    <div className="person-field">
      <div className="label">{label}</div>
      <div className="value row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        {icon && <span style={{ color: 'var(--text-3)' }}>{icon}</span>}
        <span
          className="mono"
          style={{
            overflow: 'hidden', textOverflow: 'ellipsis',
            color: waarschuwing ? 'var(--danger)' : undefined,
          }}
        >
          {geheim && toon && volledig ? volledig : value}
        </span>
        {geheim && (
          <button
            className="btn ghost sm"
            onClick={() => setToon((v) => !v)}
            title={toon ? 'Weer afschermen' : 'Even tonen'}
            style={{ padding: '2px 5px' }}
          >
            {toon ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {badge}
      </div>
    </div>
  )
}

/* ================================================================== *
 *  Documentregel
 * ================================================================== */

function DocumentRegel({
  doc, magBeheren, magTekenen, onTekenen, onVerbergen,
}: {
  doc: PersonnelDocument
  magBeheren: boolean
  magTekenen: boolean
  onTekenen: () => void
  onVerbergen: () => void
}) {
  const [bezig, setBezig] = useState(false)

  const wachtOpHandtekening = doc.requiresSignature && !doc.signedAt && !doc.declinedAt
  const verlopen = !!doc.expiresAt && doc.expiresAt < Date.now()

  async function openen() {
    setBezig(true)
    try {
      const link = await documenten.openen(doc)
      window.open(link, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof DossierFout ? e.message : 'Openen lukte niet')
    } finally {
      setBezig(false)
    }
  }

  async function weghalen() {
    if (!confirm(`"${doc.title}" definitief weghalen uit het dossier?`)) return
    await documenten.verwijderen(doc)
    toast.info('Document verwijderd')
  }

  return (
    <div className={`doc-regel ${wachtOpHandtekening ? 'wacht' : ''}`}>
      <div className="ico">
        {doc.mime === 'application/pdf' ? <FileText size={18} /> : <ScanLine size={18} />}
      </div>

      <div className="tekst">
        <div className="titel">
          <strong>{doc.title}</strong>
          <Badge>{DOCUMENT_KINDS[doc.kind].label}</Badge>
          {!doc.visibleToEmployee && (
            <Badge tone="warn"><EyeOff size={11} /> Ongezien</Badge>
          )}
          {doc.signedAt && <Badge tone="ok"><FileSignature size={11} /> Ondertekend</Badge>}
          {doc.declinedAt && <Badge tone="danger">Niet ondertekend</Badge>}
          {wachtOpHandtekening && <Badge tone="warn">Wacht op handtekening</Badge>}
          {verlopen && <Badge tone="danger">Verlopen</Badge>}
        </div>

        <div className="meta">
          {(doc.sizeBytes / 1024).toFixed(0)} kB · toegevoegd door {doc.uploadedByName}{' '}
          {relative(doc.uploadedAt)}
          {doc.expiresAt && ` · geldig tot ${dateShort(doc.expiresAt)}`}
        </div>

        {doc.description && <div className="omschrijving">{doc.description}</div>}

        {!doc.visibleToEmployee && doc.hiddenReason && (
          <div className="reden">
            <EyeOff size={12} /> Afgeschermd: {doc.hiddenReason}
          </div>
        )}

        {doc.signedAt && (
          <div className="handtekening">
            {doc.signatureImage && <img src={doc.signatureImage} alt="Handtekening" />}
            <div>
              <strong>{doc.signedName}</strong>
              <span>
                {dateTime(doc.signedAt)} · {doc.signedPlatform}
              </span>
              <span className="mono">bestand {kortHash(doc.signedHash)}</span>
            </div>
          </div>
        )}

        {doc.declinedAt && doc.declineReason && (
          <div className="reden danger">
            <X size={12} /> {doc.declineReason}
          </div>
        )}
      </div>

      <div className="acties">
        {wachtOpHandtekening && magTekenen && (
          <button className="btn primary sm" onClick={onTekenen}>
            <FileSignature size={14} /> Tekenen
          </button>
        )}
        <button className="btn ghost sm" onClick={() => void openen()} disabled={bezig} title="Openen">
          {bezig ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
        </button>
        {magBeheren && (
          <>
            <button
              className="btn ghost sm"
              onClick={onVerbergen}
              title={doc.visibleToEmployee ? 'Afschermen voor de medewerker' : 'Weer vrijgeven'}
            >
              {doc.visibleToEmployee ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button className="btn ghost sm" onClick={() => void weghalen()} title="Weghalen">
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ================================================================== *
 *  Gegevens bewerken, met de MRZ-lezer
 * ================================================================== */

function GegevensDialoog({
  open, person, prive, onClose,
}: {
  open: boolean
  person: User
  prive?: PersonnelPrivate
  onClose: () => void
}) {
  const leeg = () => ({
    birthDate: prive?.birthDate ? dateInputValue(prive.birthDate) : '',
    birthPlace: prive?.birthPlace ?? '',
    nationality: prive?.nationality ?? '',
    documentType: prive?.documentType ?? '',
    documentNumber: prive?.documentNumber ?? '',
    documentExpires: prive?.documentExpires ? dateInputValue(prive.documentExpires) : '',
    bsn: prive?.bsn ? bsnFormatteer(prive.bsn) : '',
    iban: prive?.iban ? ibanFormatteer(prive.iban) : '',
    hourlyRate: String(prive?.hourlyRate ?? ''),
    emergencyName: prive?.emergencyName ?? '',
    emergencyPhone: prive?.emergencyPhone ?? '',
    emergencyRelation: prive?.emergencyRelation ?? '',
    internalNotes: prive?.internalNotes ?? '',
  })

  const [form, setForm] = useState(leeg)
  const [sleutel, setSleutel] = useState(person.id + (prive?.updatedAt ?? 0))
  const [mrzOpen, setMrzOpen] = useState(false)
  const [gecontroleerd, setGecontroleerd] = useState(prive?.documentVerified ?? false)

  const nieuweSleutel = person.id + (prive?.updatedAt ?? 0)
  if (open && sleutel !== nieuweSleutel) {
    setSleutel(nieuweSleutel)
    setForm(leeg())
    setGecontroleerd(prive?.documentVerified ?? false)
  }

  const set = (patch: Partial<ReturnType<typeof leeg>>) => setForm({ ...form, ...patch })

  const bsnFout = bsnProbleem(form.bsn)
  const ibanFout = ibanProbleem(form.iban)

  function nemenUitMrz(r: MrzResultaat) {
    set({
      documentType: r.soort === 'paspoort' ? 'paspoort' : 'id-kaart',
      documentNumber: r.documentNumber,
      birthDate: r.geboortedatum ? dateInputValue(r.geboortedatum) : form.birthDate,
      documentExpires: r.vervaldatum ? dateInputValue(r.vervaldatum) : form.documentExpires,
      nationality: r.nationaliteit || form.nationality,
    })
    setGecontroleerd(r.betrouwbaar)
    setMrzOpen(false)
    toast.ok(r.betrouwbaar
      ? 'Gegevens overgenomen; alle controlecijfers kloppen'
      : `Overgenomen, maar controleer: ${r.twijfel.join(', ')}`)
  }

  async function opslaan() {
    if (bsnFout) return toast.error(bsnFout)
    if (ibanFout) return toast.error(ibanFout)

    await dossierRepo.save(person.id, {
      birthDate: form.birthDate ? dayFromDateInput(form.birthDate) : undefined,
      birthPlace: form.birthPlace.trim() || undefined,
      nationality: form.nationality.trim().toUpperCase() || undefined,
      documentType: (form.documentType || undefined) as PersonnelPrivate['documentType'],
      documentNumber: form.documentNumber.trim().toUpperCase() || undefined,
      documentExpires: form.documentExpires ? dayFromDateInput(form.documentExpires) : undefined,
      documentVerified: gecontroleerd,
      bsn: form.bsn.replace(/\D/g, '') || undefined,
      iban: form.iban.replace(/\s+/g, '').toUpperCase() || undefined,
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate.replace(',', '.')) : undefined,
      emergencyName: form.emergencyName.trim() || undefined,
      emergencyPhone: form.emergencyPhone.trim() || undefined,
      emergencyRelation: form.emergencyRelation.trim() || undefined,
      internalNotes: form.internalNotes.trim() || undefined,
    })
    toast.ok('Dossier bijgewerkt')
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        title="Persoons- en loongegevens"
        subtitle={person.name}
        onClose={onClose}
        width={640}
      >
        <button className="scan-cta" onClick={() => setMrzOpen(true)} type="button">
          <ScanLine size={20} />
          <span>
            <strong>Overnemen van een identiteitsbewijs</strong>
            <span>
              Uit de twee regels onderaan het document. De controlecijfers
              erin verraden meteen een typefout.
            </span>
          </span>
        </button>

        <div className="grid cols-3">
          <Field label="Geboortedatum">
            <input
              className="input" type="date" value={form.birthDate}
              onChange={(e) => set({ birthDate: e.target.value })}
            />
          </Field>
          <Field label="Geboorteplaats">
            <input
              className="input" value={form.birthPlace}
              onChange={(e) => set({ birthPlace: e.target.value })}
            />
          </Field>
          <Field label="Nationaliteit" help="Drieletterige code, bijv. NLD">
            <input
              className="input" value={form.nationality} maxLength={3}
              onChange={(e) => set({ nationality: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>

        <div className="grid cols-3">
          <Field label="Soort document">
            <select
              className="select" value={form.documentType}
              onChange={(e) => set({ documentType: e.target.value })}
            >
              <option value="">Niet ingevuld</option>
              <option value="paspoort">Paspoort</option>
              <option value="id-kaart">ID-kaart</option>
              <option value="verblijfsdocument">Verblijfsdocument</option>
              <option value="rijbewijs">Rijbewijs</option>
            </select>
          </Field>
          <Field label="Documentnummer">
            <input
              className="input mono" value={form.documentNumber}
              onChange={(e) => set({ documentNumber: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Geldig tot">
            <input
              className="input" type="date" value={form.documentExpires}
              onChange={(e) => set({ documentExpires: e.target.value })}
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
              value={form.bsn}
              inputMode="numeric"
              onChange={(e) => set({ bsn: bsnFormatteer(e.target.value) })}
              placeholder="123 456 782"
            />
          </Field>
          <Field
            label="Rekeningnummer"
            help={ibanFout ?? 'Wordt gecontroleerd met de mod-97-toets'}
          >
            <input
              className={`input mono ${ibanFout ? 'fout' : ''}`}
              value={form.iban}
              onChange={(e) => set({ iban: ibanFormatteer(e.target.value) })}
              placeholder="NL91 ABNA 0417 1643 00"
            />
          </Field>
        </div>

        <Field label="Uurtarief (€)" help="Staat afgeschermd; collega’s zien dit niet">
          <input
            className="input" inputMode="decimal" value={form.hourlyRate}
            onChange={(e) => set({ hourlyRate: e.target.value })}
            placeholder="22"
          />
        </Field>

        <div className="grid cols-3">
          <Field label="Bij nood bellen">
            <input
              className="input" value={form.emergencyName}
              onChange={(e) => set({ emergencyName: e.target.value })}
              placeholder="Naam"
            />
          </Field>
          <Field label="Telefoon">
            <input
              className="input" value={form.emergencyPhone} inputMode="tel"
              onChange={(e) => set({ emergencyPhone: e.target.value })}
            />
          </Field>
          <Field label="Relatie">
            <input
              className="input" value={form.emergencyRelation}
              onChange={(e) => set({ emergencyRelation: e.target.value })}
              placeholder="Partner, ouder"
            />
          </Field>
        </div>

        <Field
          label="Interne notitie"
          help={`${person.name.split(' ')[0]} ziet dit nooit, ook niet in zijn eigen dossier.`}
        >
          <textarea
            className="textarea" value={form.internalNotes}
            onChange={(e) => set({ internalNotes: e.target.value })}
          />
        </Field>

        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Annuleren</button>
          <button className="btn primary" onClick={() => void opslaan()}>Opslaan</button>
        </div>
      </Modal>

      <MrzDialoog open={mrzOpen} onClose={() => setMrzOpen(false)} onGelezen={nemenUitMrz} />
    </>
  )
}

/* ================================================================== *
 *  De machineleesbare strook
 * ================================================================== */

function MrzDialoog({
  open, onClose, onGelezen,
}: {
  open: boolean
  onClose: () => void
  onGelezen: (r: MrzResultaat) => void
}) {
  const [tekst, setTekst] = useState('')
  const gelezen = useMemo(() => (tekst.trim() ? leesMrz(tekst) : null), [tekst])

  return (
    <Modal
      open={open}
      title="Overnemen van een identiteitsbewijs"
      subtitle="De twee of drie regels onderaan het document"
      onClose={onClose}
      width={560}
    >
      <div className="signup-note">
        <ShieldCheck size={16} />
        <span>
          Er gaat geen foto naar een externe dienst. De regels worden hier
          gelezen en de controlecijfers erin worden nagerekend, zodat een
          verkeerd overgetypt teken er meteen uitspringt.
        </span>
      </div>

      <Field
        label="Typ of plak de regels over"
        help="Elke regel op een eigen regel. De < mag je gewoon overnemen."
      >
        <textarea
          className="textarea mono"
          style={{ minHeight: 92, letterSpacing: '.08em', fontSize: '.82rem' }}
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          placeholder={'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<\nSPECI20142NLD6503101M2403096999999990<<<<<84'}
        />
      </Field>

      {tekst.trim() && !gelezen && (
        <div className="waarschuwing">
          <AlertTriangle size={17} />
          <span>
            Dit ziet er niet uit als een machineleesbare strook. Een paspoort
            heeft twee regels van 44 tekens, een ID-kaart drie van 30.
          </span>
        </div>
      )}

      {gelezen && (
        <div className={`mrz-uitkomst ${gelezen.betrouwbaar ? 'goed' : 'twijfel'}`}>
          <div className="kop">
            {gelezen.betrouwbaar
              ? <><ShieldCheck size={16} /> Alle controlecijfers kloppen</>
              : <><AlertTriangle size={16} /> Controleer: {gelezen.twijfel.join(', ')}</>}
          </div>
          <div className="person-fields">
            <Regel label="Naam" value={gelezen.volledigeNaam || '—'} />
            <Regel label="Geboortedatum" value={gelezen.geboortedatum ? dateShort(gelezen.geboortedatum) : '—'} />
            <Regel label="Nationaliteit" value={gelezen.nationaliteit || '—'} />
            <Regel label="Documentnummer" value={gelezen.documentNumber || '—'} />
            <Regel label="Geldig tot" value={gelezen.vervaldatum ? dateShort(gelezen.vervaldatum) : '—'} />
            <Regel label="Soort" value={gelezen.soort === 'paspoort' ? 'Paspoort' : 'ID-kaart'} />
          </div>
        </div>
      )}

      <div className="aanmelding-let-op">
        <Fingerprint size={16} />
        <span>
          Het burgerservicenummer staat <strong>niet</strong> in deze strook —
          het staat er los op gedrukt. Dat vul je met de hand in; de elfproef
          controleert het daar.
        </span>
      </div>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className="btn primary"
          disabled={!gelezen}
          onClick={() => gelezen && onGelezen(gelezen)}
        >
          Overnemen
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Uploaden
 * ================================================================== */

function UploadDialoog({
  open, person, door, onClose,
}: {
  open: boolean
  person: User
  door: User
  onClose: () => void
}) {
  const [bestand, setBestand] = useState<File | null>(null)
  const [kind, setKind] = useState<DocumentKind>('contract')
  const [titel, setTitel] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [verloopt, setVerloopt] = useState('')
  const [tekenen, setTekenen] = useState(false)
  const [zichtbaar, setZichtbaar] = useState(true)
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)

  /* Wat er uit het contract kwam, en wat daarvan overgenomen mag worden. */
  const [lezen, setLezen] = useState(false)
  const [gelezen, setGelezen] = useState<ContractGegevens | null>(null)
  const [leesFout, setLeesFout] = useState<string | null>(null)
  const [overnemen, setOvernemen] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setZichtbaar(DOCUMENT_KINDS[kind].standaardZichtbaar)
    setTekenen(kind === 'contract')
  }, [kind, open])

  /**
   * Een contract uitlezen.
   *
   * Wat eruit komt wordt vóórgesteld, niet opgeslagen. Bij elk voorstel
   * staat de zin waarin het gevonden is, zodat je het kunt nakijken zonder
   * het bestand te openen. Alleen wat je aanvinkt gaat mee.
   */
  async function lezenUitContract(bestand: File) {
    setLezen(true)
    setLeesFout(null)
    try {
      const uitkomst = await leesContract(bestand)
      setGelezen(uitkomst)

      // Alles wat met hoge zekerheid is gevonden staat standaard aan; de
      // rest kijk je zelf na.
      const zeker = new Set<string>()
      for (const [sleutel, vondst] of Object.entries(uitkomst)) {
        if (sleutel === 'tekst' || sleutel === 'bladzijden') continue
        if (vondst && typeof vondst === 'object' && 'zekerheid' in vondst
            && vondst.zekerheid === 'hoog') {
          zeker.add(sleutel)
        }
      }
      setOvernemen(zeker)

      const aantal = aantalGevonden(uitkomst)
      if (aantal === 0) {
        setLeesFout(
          'Er is niets herkenbaars in gevonden. Vul de gegevens met de hand in; ' +
          'het contract zelf komt gewoon in het dossier.',
        )
      }
    } catch (e) {
      setLeesFout(e instanceof GeenTekstlaag
        ? e.message
        : 'Het contract kon niet gelezen worden. Vul de gegevens met de hand in.')
    } finally {
      setLezen(false)
    }
  }

  /** De aangevinkte waarden doorvoeren, na het uploaden. */
  async function neemOver() {
    if (!gelezen) return

    const patch: Partial<User> = {}
    if (overnemen.has('functie') && gelezen.functie) {
      patch.function = gelezen.functie.waarde
    }
    if (overnemen.has('urenPerWeek') && gelezen.urenPerWeek) {
      patch.contractHours = gelezen.urenPerWeek.waarde
    }
    if (overnemen.has('startDatum') && gelezen.startDatum) {
      patch.startDate = gelezen.startDatum.waarde
    }
    if (overnemen.has('eindDatum') && gelezen.eindDatum) {
      patch.endDate = gelezen.eindDatum.waarde
    }
    if (overnemen.has('onbepaaldeTijd') && gelezen.onbepaaldeTijd) {
      // Onbepaalde tijd betekent: geen einddatum.
      patch.endDate = undefined
    }
    if (Object.keys(patch).length > 0) await userRepo.update(person.id, patch)

    // Het uurloon hoort in het afgeschermde deel.
    let uurloon: number | undefined
    if (overnemen.has('uurloon') && gelezen.uurloon) {
      uurloon = gelezen.uurloon.waarde
    } else if (overnemen.has('maandloon') && gelezen.maandloon && gelezen.urenPerWeek) {
      uurloon = afgeleidUurloon(gelezen.maandloon.waarde, gelezen.urenPerWeek.waarde)
    }
    if (uurloon !== undefined) await dossierRepo.save(person.id, { hourlyRate: uurloon })
  }

  async function verstuur() {
    if (!bestand) return toast.error('Kies eerst een bestand')
    if (!titel.trim()) return toast.error('Geef het document een naam')

    setBezig(true)
    try {
      await documenten.upload({
        bestand,
        bestandsnaam: bestand.name,
        persoon: person,
        kind,
        title: titel,
        description: omschrijving,
        visibleToEmployee: zichtbaar,
        hiddenReason: reden,
        expiresAt: verloopt ? dayFromDateInput(verloopt) : undefined,
        requiresSignature: tekenen,
        door,
      })
      // Pas overnemen als het bestand er werkelijk staat.
      await neemOver()

      const aantal = overnemen.size
      toast.ok(tekenen
        ? `${titel} staat klaar — ${person.name.split(' ')[0]} krijgt bericht om te tekenen`
        : `${titel} is toegevoegd aan het dossier`)
      if (aantal > 0) {
        toast.info(`${aantal} ${aantal === 1 ? 'gegeven' : 'gegevens'} uit het contract overgenomen`)
      }
      setBestand(null); setTitel(''); setOmschrijving(''); setVerloopt(''); setReden('')
      setGelezen(null); setOvernemen(new Set())
      onClose()
    } catch (e) {
      toast.error(e instanceof DossierFout ? e.message : 'Uploaden mislukt')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Document toevoegen"
      subtitle={`Naar het dossier van ${person.name}`}
      onClose={onClose}
      width={600}
    >
      <Field label="Wat voor stuk is dit?">
        <div className="kind-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(Object.keys(DOCUMENT_KINDS) as DocumentKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`kind ${kind === k ? 'on' : ''}`}
              onClick={() => setKind(k)}
            >
              <FileText size={17} />
              <strong>{DOCUMENT_KINDS[k].label}</strong>
              <span>{DOCUMENT_KINDS[k].hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Bestand"
        help={`PDF of foto, maximaal ${Math.round(MAX_BESTAND / 1024 / 1024)} MB.`}
      >
        <input
          className="input"
          type="file"
          accept={TOEGESTAAN.join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setBestand(f)
            setGelezen(null)
            setLeesFout(null)
            setOvernemen(new Set())
            if (f && !titel) setTitel(f.name.replace(/\.[a-z0-9]+$/i, ''))
            if (f && f.type === 'application/pdf' && kind === 'contract') {
              void lezenUitContract(f)
            }
          }}
        />
      </Field>

      {lezen && (
        <div className="signup-note">
          <Loader2 size={16} className="spin" />
          <span>Het contract wordt gelezen…</span>
        </div>
      )}

      {leesFout && (
        <div className="signup-note">
          <AlertTriangle size={16} />
          <span>{leesFout}</span>
        </div>
      )}

      {gelezen && aantalGevonden(gelezen) > 0 && (
        <ContractVoorstel
          gegevens={gelezen}
          gekozen={overnemen}
          onWissel={(sleutel) => {
            const volgende = new Set(overnemen)
            if (volgende.has(sleutel)) volgende.delete(sleutel)
            else volgende.add(sleutel)
            setOvernemen(volgende)
          }}
        />
      )}

      <div className="grid cols-2">
        <Field label="Naam van het document">
          <input className="input" value={titel} onChange={(e) => setTitel(e.target.value)} />
        </Field>
        <Field label="Geldig tot (optioneel)">
          <input
            className="input" type="date" value={verloopt}
            onChange={(e) => setVerloopt(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Toelichting (optioneel)">
        <textarea
          className="textarea" style={{ minHeight: 64 }}
          value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)}
        />
      </Field>

      <button
        type="button"
        className={`stop-toggle ${tekenen ? 'on' : ''}`}
        onClick={() => setTekenen((v) => !v)}
      >
        <FileSignature size={17} />
        <span>
          <strong>Laten ondertekenen</strong>
          <span>
            {person.name.split(' ')[0]} krijgt bericht en een mail, en kan het
            hier tekenen.
          </span>
        </span>
      </button>

      <button
        type="button"
        className={`stop-toggle ${!zichtbaar ? 'on' : ''}`}
        onClick={() => setZichtbaar((v) => !v)}
        style={{ marginTop: 8 }}
      >
        {zichtbaar ? <Eye size={17} /> : <EyeOff size={17} />}
        <span>
          <strong>Afschermen voor {person.name.split(' ')[0]}</strong>
          <span>
            Voor een gespreksverslag of beoordeling die eerst besproken moet
            worden. Hij ziet het stuk dan niet in zijn eigen dossier.
          </span>
        </span>
      </button>

      {!zichtbaar && (
        <Field label="Waarom afgeschermd" help="Voor jezelf en je opvolger; niet zichtbaar voor de medewerker.">
          <input
            className="input" value={reden} onChange={(e) => setReden(e.target.value)}
            placeholder="Bijv. te bespreken in het gesprek van volgende week"
          />
        </Field>
      )}

      {tekenen && !zichtbaar && (
        <div className="waarschuwing" style={{ marginTop: 12 }}>
          <AlertTriangle size={17} />
          <span>
            Dit stuk staat op afgeschermd én moet ondertekend worden. Zo kan
            niemand het tekenen — hij ziet het niet.
          </span>
        </div>
      )}

      <div className="row end mt">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button
          className="btn primary"
          onClick={() => void verstuur()}
          disabled={bezig || !bestand}
        >
          {bezig ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
          {bezig ? 'Bezig…' : 'Toevoegen'}
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Afschermen
 * ================================================================== */

function VerbergDialoog({
  doc, person, onClose,
}: {
  doc: PersonnelDocument | null
  person: User
  onClose: () => void
}) {
  const [reden, setReden] = useState('')
  if (!doc) return null

  const verbergen = doc.visibleToEmployee

  async function opslaan() {
    if (!doc) return
    await documenten.zichtbaarheid(doc.id, !verbergen, reden)
    toast.ok(verbergen
      ? `${doc.title} is afgeschermd`
      : `${doc.title} is weer zichtbaar voor ${person.name.split(' ')[0]}`)
    setReden('')
    onClose()
  }

  return (
    <Modal
      open={!!doc}
      title={verbergen ? 'Afschermen' : 'Weer vrijgeven'}
      subtitle={doc.title}
      onClose={onClose}
      width={480}
    >
      {verbergen ? (
        <>
          <p style={{ fontSize: '.88rem', color: 'var(--text-2)', lineHeight: 1.6, marginTop: 0 }}>
            {person.name.split(' ')[0]} ziet dit stuk daarna niet meer in zijn
            eigen dossier. Ook de database laat het niet meer los: het is niet
            iets wat je alleen in dit scherm verstopt.
          </p>
          <Field label="Waarom" help="Zodat je over een jaar nog weet wat hier speelde.">
            <input
              className="input" value={reden} autoFocus
              onChange={(e) => setReden(e.target.value)}
              placeholder="Bijv. te bespreken in het functioneringsgesprek"
            />
          </Field>
        </>
      ) : (
        <p style={{ fontSize: '.88rem', color: 'var(--text-2)', lineHeight: 1.6, marginTop: 0 }}>
          {person.name.split(' ')[0]} kan dit stuk daarna zelf openen in zijn
          dossier.
        </p>
      )}

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className={`btn ${verbergen ? 'danger' : 'primary'}`}
          onClick={() => void opslaan()}
        >
          {verbergen ? <><EyeOff size={15} /> Afschermen</> : <><Eye size={15} /> Vrijgeven</>}
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Ondertekenen
 * ================================================================== */

export function TekenDialoog({
  doc, door, onClose,
}: {
  doc: PersonnelDocument | null
  door: User
  onClose: () => void
}) {
  const [naam, setNaam] = useState('')
  const [akkoord, setAkkoord] = useState(false)
  const [gelezen, setGelezen] = useState(false)
  const [weigeren, setWeigeren] = useState(false)
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [getekend, setGetekend] = useState(false)

  useEffect(() => {
    if (doc) {
      setNaam(door.name)
      setAkkoord(false); setGelezen(false); setWeigeren(false); setReden('')
      setGetekend(false)
    }
  }, [doc, door.name])

  if (!doc) return null

  async function openen() {
    if (!doc) return
    try {
      const link = await documenten.openen(doc)
      window.open(link, '_blank', 'noopener,noreferrer')
      setGelezen(true)
    } catch (e) {
      toast.error(e instanceof DossierFout ? e.message : 'Openen lukte niet')
    }
  }

  function tekenStart(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const r = c.getBoundingClientRect()
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(e.clientX - r.left, e.clientY - r.top)
    c.setPointerCapture(e.pointerId)
    setGetekend(true)
  }

  function tekenBeweeg(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const r = c.getBoundingClientRect()
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top)
    ctx.stroke()
  }

  function wisKrabbel() {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
    setGetekend(false)
  }

  async function tekenen() {
    if (!doc) return
    if (!gelezen) return toast.error('Open het document eerst; tekenen doe je niet blind')
    if (naam.trim().length < 3) return toast.error('Vul je volledige naam in')
    if (!akkoord) return toast.error('Zet het vinkje als je akkoord bent')

    setBezig(true)
    try {
      await documenten.ondertekenen({
        doc,
        door,
        getypteNaam: naam,
        krabbel: getekend ? canvas.current?.toDataURL('image/png') : undefined,
      })
      toast.ok('Ondertekend')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  async function nietTekenen() {
    if (!doc) return
    if (!reden.trim()) return toast.error('Geef aan waarom je niet tekent')
    setBezig(true)
    try {
      await documenten.afwijzen(doc, door, reden)
      toast.info('Doorgegeven dat je niet tekent')
      onClose()
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={!!doc}
      title={weigeren ? 'Niet ondertekenen' : 'Ondertekenen'}
      subtitle={doc.title}
      onClose={onClose}
      width={560}
    >
      {weigeren ? (
        <>
          <Field
            label="Waarom teken je niet?"
            help="Dit gaat naar degene die het document heeft klaargezet."
          >
            <textarea
              className="textarea" value={reden} autoFocus
              onChange={(e) => setReden(e.target.value)}
              placeholder="Bijv. de uren kloppen niet met wat we hebben afgesproken"
            />
          </Field>
          <div className="row end">
            <button className="btn ghost" onClick={() => setWeigeren(false)}>Terug</button>
            <button className="btn danger" onClick={() => void nietTekenen()} disabled={bezig}>
              Doorgeven
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="scan-cta" onClick={() => void openen()} type="button">
            <FileText size={20} />
            <span>
              <strong>{gelezen ? 'Nog eens openen' : 'Eerst lezen'}</strong>
              <span>
                {gelezen
                  ? 'Je hebt het document geopend.'
                  : 'Het document opent in een nieuw venster. Tekenen kan pas daarna.'}
              </span>
            </span>
          </button>

          <Field label="Je handtekening" help="Met de muis of je vinger. Mag ook leeg blijven.">
            <div className="krabbel">
              <canvas
                ref={canvas}
                width={480}
                height={140}
                onPointerDown={tekenStart}
                onPointerMove={tekenBeweeg}
              />
              {!getekend && <span className="hint">Teken hier</span>}
              <button className="btn ghost sm wis" onClick={wisKrabbel} type="button">
                <X size={13} /> Wissen
              </button>
            </div>
          </Field>

          <Field label="Je volledige naam">
            <input className="input" value={naam} onChange={(e) => setNaam(e.target.value)} />
          </Field>

          <button
            type="button"
            className={`stop-toggle ${akkoord ? 'on' : ''}`}
            onClick={() => setAkkoord((v) => !v)}
          >
            <FileSignature size={17} />
            <span>
              <strong>Ik heb het gelezen en ben akkoord</strong>
              <span>
                We leggen vast wanneer je tekende, met welke naam, en een
                vingerafdruk van het bestand — zodat later aantoonbaar is dat
                er niets aan is veranderd.
              </span>
            </span>
          </button>

          <div className="signup-note" style={{ marginTop: 12 }}>
            <ShieldCheck size={16} />
            <span>
              Dit is een eenvoudige elektronische handtekening. Voor een
              arbeidsovereenkomst is dat gebruikelijk en toereikend.
            </span>
          </div>

          <div className="row end">
            <button className="btn ghost" onClick={() => setWeigeren(true)}>
              Ik teken niet
            </button>
            <button className="btn primary" onClick={() => void tekenen()} disabled={bezig}>
              {bezig ? <Loader2 size={15} className="spin" /> : <FileSignature size={15} />}
              Ondertekenen
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

/* ================================================================== *
 *  Wat er uit het contract kwam
 *
 *  Voorstellen, geen feiten. Bij elke regel staat de zin waarin het is
 *  gevonden, zodat je het kunt nakijken zonder het bestand te openen. Wat
 *  met hoge zekerheid is herkend staat aangevinkt; de rest zet je zelf aan.
 * ================================================================== */

const VOORSTEL_LABELS: Record<string, string> = {
  functie: 'Functie',
  maandloon: 'Bruto per maand',
  uurloon: 'Uurtarief',
  urenPerWeek: 'Contracturen per week',
  startDatum: 'In dienst per',
  eindDatum: 'Uit dienst per',
  onbepaaldeTijd: 'Onbepaalde tijd',
}

function ContractVoorstel({
  gegevens, gekozen, onWissel,
}: {
  gegevens: ContractGegevens
  gekozen: Set<string>
  onWissel: (sleutel: string) => void
}) {
  const regels = (Object.keys(VOORSTEL_LABELS) as (keyof ContractGegevens)[])
    .map((sleutel) => ({ sleutel: String(sleutel), vondst: gegevens[sleutel] }))
    .filter((r) => r.vondst && typeof r.vondst === 'object' && 'waarde' in r.vondst)

  return (
    <div className="contract-voorstel">
      <div className="kop">
        <ScanLine size={16} />
        <span>
          <strong>Uit het contract gehaald</strong>
          <span>
            {gegevens.bladzijden} {gegevens.bladzijden === 1 ? 'bladzijde' : 'bladzijden'} gelezen.
            Vink aan wat overgenomen mag worden — niets gaat automatisch mee.
          </span>
        </span>
      </div>

      {regels.map(({ sleutel, vondst }) => {
        const v = vondst as { waarde: unknown; zekerheid: string; bron: string }
        const aan = gekozen.has(sleutel)
        return (
          <button
            key={sleutel}
            type="button"
            className={`voorstel ${aan ? 'on' : ''}`}
            onClick={() => onWissel(sleutel)}
          >
            <span className="vink">{aan && <Check size={13} />}</span>
            <span className="inhoud">
              <span className="rij">
                <strong>{VOORSTEL_LABELS[sleutel]}</strong>
                <span className="waarde">{toonVoorstel(sleutel, v.waarde)}</span>
                {v.zekerheid !== 'hoog' && (
                  <Badge tone="warn">controleer</Badge>
                )}
              </span>
              <span className="bron">{v.bron}</span>
            </span>
          </button>
        )
      })}

      {gegevens.maandloon && !gegevens.uurloon && gegevens.urenPerWeek && (
        <div className="voorstel-hint">
          Er staat een maandloon in, geen uurloon. Neem je het maandloon over,
          dan reken ik het uurtarief eruit:{' '}
          <strong>
            {money(afgeleidUurloon(gegevens.maandloon.waarde, gegevens.urenPerWeek.waarde))}
          </strong>{' '}
          per uur.
        </div>
      )}
    </div>
  )
}

function toonVoorstel(sleutel: string, waarde: unknown): string {
  if (sleutel === 'onbepaaldeTijd') return 'ja — geen einddatum'
  if (sleutel === 'maandloon' || sleutel === 'uurloon') return money(Number(waarde))
  if (sleutel === 'urenPerWeek') return `${waarde} uur`
  if (sleutel === 'startDatum' || sleutel === 'eindDatum') {
    return new Date(Number(waarde)).toLocaleDateString('nl-NL', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  }
  return String(waarde)
}
