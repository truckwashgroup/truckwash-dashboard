import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Package, PackagePlus } from 'lucide-react'
import { db, uid } from '../../lib/db'
import { enqueue } from '../../lib/sync'
import { nieuweBestelling, voorstelAantal, type RegelInvoer } from '../../lib/trucksupply'
import { visibleLocations } from '../../lib/locations'
import { number } from '../../lib/format'
import {
  BESTELLING_STATUS,
  type Bestelling, type BestellingStatus, type Bestelregel, type InventoryItem,
  type Location, type User, type VoorraadAlarm,
} from '../../lib/types'
import { Badge, Empty, Field, Modal } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { useNav } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Wat de schermen van Trucksupply met elkaar delen
 *
 *  De zeven schermen kijken naar dezelfde vier lijsten (vestigingen,
 *  artikelen, alarmen, bestellingen) en doen een paar dingen allemaal:
 *  een artikel in een zending zetten, een zending vanaf niets maken, een
 *  status als badge tonen. Dat staat hier één keer, zodat "in zending" in de
 *  voorraad hetzelfde doet als in het contactscherm -- en anders gedraagt
 *  de app zich per scherm net even anders, en dat merkt de gebruiker
 *  eerder dan wij.
 * ------------------------------------------------------------------ */

/* ------------------------------ Gegevens -------------------------- */

/** De vestigingen die deze gebruiker mag zien, actieve eerst, op naam. */
export function useVestigingen(): Location[] {
  const user = useAuth((s) => s.user)
  const alle = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  return useMemo(() => {
    const zichtbaar = visibleLocations(user, alle)
    // Trucksupply levert aan wasstraten; een inactieve vestiging staat achteraan
    // en niet ertussen, want daar gaat niets meer heen.
    return [...zichtbaar].sort((a, b) =>
      Number(!a.active) - Number(!b.active) || a.name.localeCompare(b.name, 'nl'))
  }, [user, alle])
}

export function useArtikelen(): InventoryItem[] {
  return useLiveQuery(() => db.inventory.orderBy('name').toArray(), [], [] as InventoryItem[])
}

export function useAlarmen(): VoorraadAlarm[] {
  return useLiveQuery(() => db.voorraadAlarmen.toArray(), [], [] as VoorraadAlarm[])
}

export function useBestellingen(): Bestelling[] {
  return useLiveQuery(
    () => db.bestellingen.orderBy('aangemaaktAt').reverse().toArray(),
    [], [] as Bestelling[])
}

export function useBestelregels(): Bestelregel[] {
  return useLiveQuery(() => db.bestelregels.toArray(), [], [] as Bestelregel[])
}

/** Een bestelling die nog niet af is: daar kan nog iets bij of uit. */
export const OPEN_STATUS: BestellingStatus[] = ['concept', 'bevestigd', 'ingepakt']

export function isOpen(b: Bestelling): boolean {
  return OPEN_STATUS.includes(b.status)
}

/** Het concept voor een vestiging waar "in zending" iets aan toevoegt. */
export function conceptVoor(bestellingen: Bestelling[], locationId: string): Bestelling | undefined {
  return bestellingen
    .filter((b) => b.locationId === locationId && b.status === 'concept')
    .sort((a, b) => b.aangemaaktAt - a.aangemaaktAt)[0]
}

/* ------------------------------ Regels ---------------------------- *
 *
 *  Een regel aan een bestaande bestelling toevoegen, wijzigen of weghalen.
 *  Dezelfde weg als de rest van de app: lokaal eerst, dan de wachtrij. De
 *  bibliotheek maakt een bestelling met haar regels in één keer; wat er
 *  daarna nog aan een concept verandert, gaat via deze drie.
 * ------------------------------------------------------------------ */

export async function regelOpslaan(regel: Bestelregel): Promise<Bestelregel> {
  const gestempeld = { ...regel, updatedAt: Date.now() }
  await db.bestelregels.put(gestempeld)
  await enqueue('bestelregels', 'put', regel.id, gestempeld)
  return gestempeld
}

export async function regelToevoegen(bestelling: Bestelling, invoer: RegelInvoer): Promise<Bestelregel> {
  return regelOpslaan({
    ...invoer,
    id: uid('bsr'),
    bestellingId: bestelling.id,
    itemNaam: invoer.itemNaam.trim(),
    updatedAt: Date.now(),
  })
}

export async function regelVerwijderen(regel: Bestelregel): Promise<void> {
  await db.bestelregels.delete(regel.id)
  await enqueue('bestelregels', 'delete', regel.id, null)
}

/** Wat er standaard van dit artikel meegaat: de bestelhoeveelheid, anders tot twee keer het minimum. */
/* voorstelAantal staat in de lib (dezelfde regel als voorstelUitAlarmen en de
   aanvraagknop op de vloer, en de zelftest rekent hem na); hier alleen
   doorgegeven zodat de schermen hem uit gedeeld blijven halen. */
export { voorstelAantal }

/**
 * Een artikel in de zending van zijn vestiging zetten.
 *
 * Is er een concept voor die vestiging, dan komt het daarbij (staat het er
 * al in, dan gaat het aantal omhoog in plaats van een tweede regel). Anders
 * ontstaat er een nieuw concept met deze ene regel.
 */
export async function inZending(
  item: InventoryItem,
  bestellingen: Bestelling[],
  regels: Bestelregel[],
  door: Pick<User, 'id' | 'name'>,
  aantal = voorstelAantal(item),
): Promise<Bestelling> {
  const concept = conceptVoor(bestellingen, item.locationId)
  if (concept) {
    const bestaand = regels.find((r) => r.bestellingId === concept.id && r.itemId === item.id)
    if (bestaand) {
      await regelOpslaan({ ...bestaand, aantal: Math.round((bestaand.aantal + aantal) * 100) / 100 })
    } else {
      await regelToevoegen(concept, {
        itemId: item.id, itemNaam: item.name, aantal, eenheid: item.unit, prijs: item.inkoopprijs,
      })
    }
    return concept
  }
  const { bestelling } = await nieuweBestelling({
    locationId: item.locationId,
    bron: 'handmatig',
    door,
    regels: [{ itemId: item.id, itemNaam: item.name, aantal, eenheid: item.unit, prijs: item.inkoopprijs }],
  })
  return bestelling
}

/* ------------------------------ Tonen ----------------------------- */

type BadgeToon = 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'

export function StatusBadge({ status }: { status: BestellingStatus }) {
  const meta = BESTELLING_STATUS[status]
  return <Badge tone={meta.tone as BadgeToon}>{meta.label}</Badge>
}

/** Op, laag of goed -- de drie woorden die de voorraad heeft. */
export function standStatus(item: InventoryItem): { label: string; tone: BadgeToon } {
  if (item.stock <= 0) return { label: 'Op', tone: 'danger' }
  if (item.stock < item.minStock) return { label: 'Laag', tone: 'warn' }
  return { label: 'Goed', tone: 'ok' }
}

/** Het plaatje van een artikel, of een grijs vakje als er geen is. */
export function Foto({ item, size = 34 }: { item: Pick<InventoryItem, 'image' | 'name'>; size?: number }) {
  return (
    <span className="ts-foto" style={{ width: size, height: size }}>
      {item.image
        ? <img src={item.image} alt="" />
        : <Package size={Math.round(size * .45)} />}
    </span>
  )
}

/** Een rij tabbladen: kies één, de rest is een knop. */
export function Tabs<T extends string>({
  waarde, opties, onChange,
}: {
  waarde: T
  opties: { key: T; label: string; aantal?: number }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="ts-tabs" role="tablist">
      {opties.map((o) => (
        <button
          key={o.key}
          role="tab"
          aria-selected={o.key === waarde}
          className={`ts-tab ${o.key === waarde ? 'actief' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {o.aantal !== undefined && <span className="ts-tab-n">{o.aantal}</span>}
        </button>
      ))}
    </div>
  )
}

/** Het zoekveld dat bovenaan elk scherm staat. */
export function Zoekveld({
  waarde, onChange, placeholder, children,
}: { waarde: string; onChange: (v: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className="ts-balk">
      <input
        className="input"
        type="search"
        value={waarde}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {children}
    </div>
  )
}

/** Past de zoekterm op een of meer teksten? Los van hoofdletters en spaties eromheen. */
export function past(zoek: string, ...teksten: (string | undefined)[]): boolean {
  const q = zoek.trim().toLowerCase()
  if (!q) return true
  return teksten.some((t) => t && t.toLowerCase().includes(q))
}

export function getalUit(v: string, terugval = 0): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : terugval
}

/* ------------------------------ Nieuwe zending -------------------- *
 *
 *  Vanaf niets een bestelling voor een vestiging samenstellen: de artikelen
 *  van die vestiging met een aantal erachter, de artikelen onder het minimum
 *  al ingevuld. Gebruikt vanuit het contactscherm ("Nieuwe zending"), de
 *  voorraad en de bestellingen -- daarom hier en niet in een van de drie.
 * ------------------------------------------------------------------ */

export function NieuweZending({
  open, locatie, items, onClose, onGemaakt,
}: {
  open: boolean
  locatie: Location | null
  items: InventoryItem[]
  onClose: () => void
  /** Standaard: naar de bestelling springen */
  onGemaakt?: (bestelling: Bestelling) => void
}) {
  const user = useAuth((s) => s.user)!
  const goto = useNav((s) => s.goto)
  const [aantallen, setAantallen] = useState<Record<string, string>>({})
  const [opmerking, setOpmerking] = useState('')
  const [zoek, setZoek] = useState('')
  const [bezig, setBezig] = useState(false)

  const mijnItems = useMemo(
    () => locatie
      ? items.filter((i) => i.locationId === locatie.id && i.actief !== false)
      : [],
    [items, locatie])

  // Bij het openen: wat onder het minimum staat alvast invullen. Alleen bij
  // het openen -- wie een aantal aanpast, wil niet dat een binnenkomende
  // synchronisatie het weer overschrijft.
  useEffect(() => {
    if (!open || !locatie) return
    const start: Record<string, string> = {}
    for (const i of mijnItems) {
      if (i.stock < i.minStock) start[i.id] = String(voorstelAantal(i))
    }
    setAantallen(start)
    setOpmerking('')
    setZoek('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locatie?.id])

  const regels: RegelInvoer[] = mijnItems
    .map((i) => ({
      itemId: i.id, itemNaam: i.name, aantal: getalUit(aantallen[i.id] ?? '0'),
      eenheid: i.unit, prijs: i.inkoopprijs,
    }))
    .filter((r) => r.aantal > 0)

  async function maken() {
    if (!locatie) return
    if (!regels.length) return toast.error('Vul bij minstens één artikel een aantal in.')
    setBezig(true)
    try {
      const { bestelling } = await nieuweBestelling({
        locationId: locatie.id, bron: 'handmatig', door: user, regels, opmerking,
      })
      toast.ok(`Zending ${bestelling.nummer} voor ${locatie.name} staat als concept`)
      onClose()
      if (onGemaakt) onGemaakt(bestelling)
      else goto('bestellingen', { id: bestelling.id })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nieuwe zending"
      subtitle={locatie ? `Naar ${locatie.name}. Wat onder het minimum staat is al ingevuld.` : undefined}
      onClose={onClose}
      width={640}
    >
      {mijnItems.length === 0 ? (
        <Empty text="Deze vestiging heeft nog geen artikelen. Voeg ze eerst toe onder Artikelen." />
      ) : (
        <>
          <input
            className="input sm"
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Artikel zoeken…"
            style={{ marginBottom: 10 }}
          />
          <div className="ts-kieslijst">
            {mijnItems.filter((i) => past(zoek, i.name, i.sku)).map((i) => {
              const st = standStatus(i)
              return (
                <div key={i.id} className="ts-kiesrij">
                  <Foto item={i} size={30} />
                  <div className="ts-kiestekst">
                    <strong>{i.name}</strong>
                    <span>
                      nu {number(i.stock)} {i.unit}, min. {number(i.minStock)}
                      {st.label !== 'Goed' && <> · <Badge tone={st.tone}>{st.label}</Badge></>}
                    </span>
                  </div>
                  <input
                    className="input sm ts-aantal"
                    inputMode="decimal"
                    value={aantallen[i.id] ?? ''}
                    placeholder="0"
                    onChange={(e) => setAantallen({ ...aantallen, [i.id]: e.target.value })}
                    aria-label={`Aantal ${i.name}`}
                  />
                  <span className="ts-eenheid">{i.unit}</span>
                </div>
              )
            })}
          </div>
          <Field label="Opmerking" help="Komt op de pakbon. Bijvoorbeeld: afleveren bij de achteringang.">
            <input className="input" value={opmerking} onChange={(e) => setOpmerking(e.target.value)} />
          </Field>
          <div className="row end">
            <span style={{ flex: 1, fontSize: '.8rem', color: 'var(--text-3)' }}>
              {regels.length === 0 ? 'Nog niets gekozen' : `${regels.length} ${regels.length === 1 ? 'regel' : 'regels'}`}
            </span>
            <button className="btn ghost" onClick={onClose}>Annuleren</button>
            <button className="btn primary" disabled={bezig || !regels.length} onClick={() => void maken()}>
              <PackagePlus size={15} /> Concept maken
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
