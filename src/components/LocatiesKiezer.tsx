import { useLiveQuery } from 'dexie-react-hooks'
import { Building2, Check, Globe2, MapPin } from 'lucide-react'
import { db } from '../lib/db'
import type { Location } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Vestigingen toewijzen
 *
 *  Drie vragen, in deze volgorde:
 *
 *    Waar werkt iemand?           -> één vestiging, zijn thuisbasis
 *    Waar geeft hij leiding?      -> nul of meer, daar gelden zijn rechten
 *    Of overal?                   -> hoofdkantoor
 *
 *  Rechten zeggen wát iemand mag; dit zegt wáár. Een leidinggevende die
 *  roosters mag maken, maakt ze alleen voor de vestigingen die hier staan
 *  aangevinkt -- niet voor de andere achttien.
 * ------------------------------------------------------------------ */

export interface LocatieKeuze {
  locationId?: string
  manages: string[]
  allLocations: boolean
}

export default function LocatiesKiezer({
  waarde, onChange, toonLeiding = true,
}: {
  waarde: LocatieKeuze
  onChange: (v: LocatieKeuze) => void
  /** Bij een gewone medewerker heeft "waar geef je leiding" geen zin */
  toonLeiding?: boolean
}) {
  const locaties = useLiveQuery(
    async () => (await db.locations.toArray())
      .filter((l) => l.active)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'hoofdkantoor' ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [],
    [] as Location[],
  )

  function toggleManage(id: string) {
    const set = new Set(waarde.manages)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onChange({ ...waarde, manages: [...set] })
  }

  return (
    <>
      <div className="field">
        <label>Werkt op</label>
        <select
          className="select"
          value={waarde.locationId ?? ''}
          onChange={(e) => onChange({ ...waarde, locationId: e.target.value || undefined })}
        >
          <option value="">Niet aan een vestiging gebonden</option>
          {locaties.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.kind === 'hoofdkantoor' ? ' (hoofdkantoor)' : ''}
            </option>
          ))}
        </select>
        <span className="help">
          De thuisbasis. Hier hoort diegene bij in het rooster en in de cijfers.
        </span>
      </div>

      <button
        type="button"
        className={`stop-toggle ${waarde.allLocations ? 'on' : ''}`}
        onClick={() => onChange({ ...waarde, allLocations: !waarde.allLocations })}
      >
        <Globe2 size={17} />
        <span>
          <strong>Alle vestigingen</strong>
          <span>
            Voor het hoofdkantoor: overal bij, ook op vestigingen die er later
            bij komen.
          </span>
        </span>
        {waarde.allLocations && <Check size={16} />}
      </button>

      {toonLeiding && !waarde.allLocations && (
        <div className="field mt">
          <label>Geeft daarnaast leiding op</label>
          <div className="loc-picker">
            {locaties.map((l) => {
              const aan = waarde.manages.includes(l.id)
              const thuis = waarde.locationId === l.id
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`loc-pick ${aan ? 'on' : ''} ${thuis ? 'thuis' : ''}`}
                  onClick={() => toggleManage(l.id)}
                >
                  {l.kind === 'hoofdkantoor' ? <Building2 size={14} /> : <MapPin size={14} />}
                  <span className="n">{l.name}</span>
                  <span className="c">{l.code}</span>
                  {aan && <Check size={14} />}
                </button>
              )
            })}
            {locaties.length === 0 && (
              <div className="chat-none">Er zijn nog geen vestigingen ingesteld.</div>
            )}
          </div>
          <span className="help">
            Laat leeg voor iemand die geen leiding geeft. De thuisbasis hoeft
            hier niet nog eens bij.
          </span>
        </div>
      )}
    </>
  )
}

/** Korte omschrijving van waar iemand mag komen, voor in een lijst. */
export function locatieSamenvatting(
  keuze: LocatieKeuze,
  locaties: Location[],
): string {
  if (keuze.allLocations) return 'Alle vestigingen'
  const naam = (id?: string) => locaties.find((l) => l.id === id)?.name
  const thuis = naam(keuze.locationId)
  const extra = keuze.manages.map(naam).filter(Boolean) as string[]

  if (!thuis && extra.length === 0) return 'Geen vestiging'
  if (extra.length === 0) return thuis ?? 'Geen vestiging'
  return `${thuis ?? '—'} + ${extra.length} onder leiding`
}
