import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, QrCode, Wrench } from 'lucide-react'
import { db } from '../lib/db'
import { faults as faultRepo, assets as assetRepo } from '../lib/techniek'
import {
  ASSET_CATEGORIES, FAULT_SEVERITY, type Asset, type FaultSeverity, type Location,
} from '../lib/types'
import { Badge, Field, Modal } from './ui'
import QrScanner from './QrScanner'
import { useAuth } from '../store/useAuth'
import { useLocationFilter, visibleLocations } from '../lib/locations'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Storing melden
 *
 *  Bedoeld voor iedereen op de vloer, niet alleen voor de technische dienst.
 *  Wie het defect ziet, meldt het -- en dat is meestal de wasser.
 *
 *  De snelste weg is het QR-label op het apparaat scannen: dan staan de
 *  vestiging en de installatie al ingevuld en hoef je alleen nog te
 *  beschrijven wat er is.
 * ------------------------------------------------------------------ */

const MAX_TITLE = 90
const MAX_BODY = 600

export default function StoringMelden({
  open,
  onClose,
  presetAssetId,
}: {
  open: boolean
  onClose: () => void
  presetAssetId?: string
}) {
  const me = useAuth((s) => s.user)!
  const currentLocation = useLocationFilter((s) => s.current)

  const locations = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const assets = useLiveQuery(() => db.assets.toArray(), [], [] as Asset[])

  const mijnLocaties = useMemo(
    () => visibleLocations(me, locations).filter((l) => l.kind === 'vestiging'),
    [me, locations],
  )

  const [locationId, setLocationId] = useState('')
  const [assetId, setAssetId] = useState(presetAssetId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<FaultSeverity>('middel')
  const [stops, setStops] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)

  // Vestiging voorinvullen: wat bovenin gekozen staat, anders je eigen
  const gekozenLocatie =
    locationId || currentLocation || me.locationId || mijnLocaties[0]?.id || ''

  useEffect(() => {
    if (open && presetAssetId) setAssetId(presetAssetId)
  }, [open, presetAssetId])

  // Het apparaat bepaalt de vestiging, niet andersom
  const asset = assets.find((a) => a.id === assetId)
  const effectieveLocatie = asset?.locationId ?? gekozenLocatie

  const lokaleAssets = useMemo(
    () => assets
      .filter((a) => a.locationId === effectieveLocatie)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [assets, effectieveLocatie],
  )

  async function handleScan(code: string) {
    setScanning(false)
    const gevonden = await assetRepo.find(code)
    if (!gevonden) {
      return toast.error(`Geen apparaat gevonden met code ${code}`)
    }
    setAssetId(gevonden.id)
    setLocationId(gevonden.locationId)
    toast.ok(`${gevonden.name} — ${gevonden.code}`)
  }

  async function submit() {
    if (!effectieveLocatie) return toast.error('Kies een vestiging')
    if (title.trim().length < 4) return toast.error('Geef kort aan wat er is')
    if (description.trim().length < 5) return toast.error('Beschrijf wat je ziet of hoort')

    setBusy(true)
    try {
      const melding = await faultRepo.report({
        locationId: effectieveLocatie,
        assetId: assetId || undefined,
        assetName: asset?.name,
        title: title.slice(0, MAX_TITLE),
        description: description.slice(0, MAX_BODY),
        severity,
        stopsProduction: stops,
        by: { id: me.id, name: me.name },
      })

      toast.ok(`Storing ${melding.number} gemeld — de technische dienst is op de hoogte`)
      setTitle('')
      setDescription('')
      setSeverity('middel')
      setStops(false)
      setAssetId('')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open && !scanning}
        title="Storing melden"
        subtitle="Hoe eerder we het weten, hoe korter de stilstand."
        onClose={onClose}
        width={560}
      >
        <button className="scan-cta" onClick={() => setScanning(true)}>
          <QrCode size={22} />
          <span>
            <strong>Scan het QR-label op het apparaat</strong>
            <span>Dan staan de vestiging en de installatie meteen goed</span>
          </span>
        </button>

        {asset && (
          <div className="asset-picked">
            <Wrench size={16} />
            <div>
              <strong>{asset.name}</strong>
              <div>
                {asset.code} · {ASSET_CATEGORIES[asset.category]}
                {asset.location ? ` · ${asset.location}` : ''}
              </div>
            </div>
            <button className="btn ghost sm" onClick={() => setAssetId('')}>Wissen</button>
          </div>
        )}

        {!asset && (
          <>
            <Field label="Vestiging">
              <select
                className="select"
                value={effectieveLocatie}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {mijnLocaties.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Installatie" help="Weet je het niet zeker? Laat leeg en beschrijf het hieronder.">
              <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">— onbekend of niet in de lijst —</option>
                {lokaleAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <Field label="Wat is er?" help={`${title.length}/${MAX_TITLE}`}>
          <input
            className="input"
            value={title}
            maxLength={MAX_TITLE}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bijv. Zijborstel draait onregelmatig"
          />
        </Field>

        <Field label="Wat zie of hoor je?" help={`${description.length}/${MAX_BODY}`}>
          <textarea
            className="textarea"
            value={description}
            maxLength={MAX_BODY}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Wanneer gebeurt het, hoe klinkt het, wat heb je al geprobeerd?"
          />
        </Field>

        <Field label="Hoe erg is het?">
          <div className="severity-row">
            {(Object.keys(FAULT_SEVERITY) as FaultSeverity[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`severity ${severity === k ? 'on' : ''} sev-${k}`}
                onClick={() => setSeverity(k)}
              >
                <strong>{FAULT_SEVERITY[k].label}</strong>
                <span>{FAULT_SEVERITY[k].hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <button
          type="button"
          className={`stop-toggle ${stops ? 'on' : ''}`}
          onClick={() => setStops(!stops)}
        >
          <AlertTriangle size={17} />
          <span>
            <strong>De installatie ligt stil</strong>
            <span>Zet dit aan als er nu niet gewassen kan worden</span>
          </span>
          <span className={`perm-switch ${stops ? 'on' : ''}`}><span className="knob" /></span>
        </button>

        <div className="row end" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Annuleren</button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy}>
            Melding versturen
          </button>
        </div>
      </Modal>

      <QrScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onScan={(code) => void handleScan(code)}
        title="Scan het label op het apparaat"
      />
    </>
  )
}

/** Knop voor in de balk van elk dashboard. */
export function StoringMeldenKnop() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)} title="Een defect doorgeven">
        <AlertTriangle size={14} /> Storing
      </button>
      <StoringMelden open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function SeverityBadge({ severity }: { severity: FaultSeverity }) {
  const meta = FAULT_SEVERITY[severity]
  return <Badge tone={meta.tone as never}>{meta.label}</Badge>
}
