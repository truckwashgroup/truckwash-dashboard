import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Een knop om een artikel weg te halen is er met opzet niet: een artikel dat
// ooit geleverd is staat in bewegingen en bestelregels. "Actief uit" is de weg.
import {
  AlertTriangle, Ban, Camera, Copy, Loader2, Package, PackagePlus, Pencil, ShoppingCart, X,
} from 'lucide-react'
import {
  artikelKopieerNaar, artikelOpslaan, fotoVerkleinen, kassaPrijzen, naarKassa, type ArtikelInvoer,
} from '../../lib/trucksupply'
import type { InventoryItem, Location } from '../../lib/types'
import { money, number } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
import { Foto, Zoekveld, getalUit, past, useArtikelen, useVestigingen } from './gedeeld'

/* ------------------------------------------------------------------ *
 *  Artikelen -- de catalogus van Trucksshop
 *
 *  De voorraad bestond al per vestiging, met een minimum. Wat hier bij komt
 *  is de kant van de leverancier: artikelnummer, foto, wat hij rekent, wat
 *  er standaard per keer meegaat, en de knop die het artikel in de kassa
 *  zet zodat de vestiging het ook kan verkopen.
 *
 *  Eén artikel bestaat negentien keer (per vestiging). Daarom is er de knop
 *  "Kopieer naar andere vestigingen": één keer intikken, dan aanvinken waar
 *  het ook moet komen.
 * ------------------------------------------------------------------ */

interface Vorm {
  id?: string
  locationId: string
  name: string
  sku: string
  omschrijving: string
  unit: string
  stock: string
  minStock: string
  bestelhoeveelheid: string
  inkoopprijs: string
  pricePerUnit: string
  actief: boolean
  exactCode: string
  image?: string
}

const LEEG: Vorm = {
  locationId: '', name: '', sku: '', omschrijving: '', unit: 'stuk', stock: '0',
  minStock: '0', bestelhoeveelheid: '0', inkoopprijs: '', pricePerUnit: '', actief: true, exactCode: '',
}

function vormVan(item: InventoryItem): Vorm {
  return {
    id: item.id,
    locationId: item.locationId,
    name: item.name,
    sku: item.sku ?? '',
    omschrijving: item.omschrijving ?? '',
    unit: item.unit,
    stock: String(item.stock),
    minStock: String(item.minStock),
    bestelhoeveelheid: String(item.bestelhoeveelheid ?? 0),
    inkoopprijs: item.inkoopprijs !== undefined ? String(item.inkoopprijs) : '',
    pricePerUnit: item.pricePerUnit ? String(item.pricePerUnit) : '',
    actief: item.actief !== false,
    exactCode: item.exactCode ?? '',
    image: item.image,
  }
}

/** Wat de kassa van een artikel weet: het gekoppelde product, de prijs, aan of uit. */
interface KassaInfo { productId: string; prijsIncl: number; actief: boolean }

/**
 * De kassaprijzen erbij halen.
 *
 * De pos_*-tabellen zitten niet in de synchronisatie van deze app, dus ze
 * staan niet in Dexie. En rechtstreeks lezen kon de leverancier niet:
 * pos_products_select (0012) is voor personeel, en Trucksshop is bewust
 * geen personeel. Daarom een leesdeur in de database (supply_kassa_prijzen,
 * 0048) die alleen koppeling, prijs en aan/uit teruggeeft -- voor iedereen
 * die hier mag staan.
 *
 * "geladen" zegt of het antwoord er is: pas dan mag "geen product gevonden"
 * ook echt "niet in kassa" heten. Zonder verbinding komt er niets en blijft
 * geladen uit; het scherm zegt dan "onbekend" in plaats van te gokken.
 */
function useKassaInfo(): { info: Map<string, KassaInfo>; geladen: boolean; herlaad: () => void } {
  const [info, setInfo] = useState<Map<string, KassaInfo>>(new Map())
  const [geladen, setGeladen] = useState(false)
  const [tik, setTik] = useState(0)
  useEffect(() => {
    let alive = true
    void (async () => {
      const rijen = await kassaPrijzen()
      if (!rijen || !alive) return
      const m = new Map<string, KassaInfo>()
      for (const r of rijen) {
        // Nieuwste eerst uit de deur; de eerste per artikel wint.
        if (!m.has(r.inventoryItemId)) {
          m.set(r.inventoryItemId, { productId: r.productId, prijsIncl: r.prijsIncl, actief: r.actief })
        }
      }
      setInfo(m)
      setGeladen(true)
    })()
    return () => { alive = false }
  }, [tik])
  return { info, geladen, herlaad: useCallback(() => setTik((t) => t + 1), []) }
}

export default function Artikelen() {
  const perms = usePerms()
  const user = useAuth((s) => s.user)
  const magBeheren = perms.can('supply.articles')
  const vestigingen = useVestigingen()
  const items = useArtikelen()
  // Sinds de leesdeur (0048) ziet iedereen op dit scherm de kassakolom.
  const toonKassa = true
  const { info: kassa, geladen: kassaGeladen, herlaad: herlaadKassa } = useKassaInfo()

  const [zoek, setZoek] = useState('')
  const [vestiging, setVestiging] = useState('')
  const [toonUit, setToonUit] = useState(false)
  const [vorm, setVorm] = useState<Vorm | null>(null)
  const [kopieer, setKopieer] = useState<InventoryItem | null>(null)
  const [naarKassaVan, setNaarKassaVan] = useState<InventoryItem | null>(null)

  const naamVan = (id: string) => vestigingen.find((v) => v.id === id)?.name ?? 'Onbekende vestiging'

  const lijst = useMemo(() => items
    .filter((i) => !vestiging || i.locationId === vestiging)
    .filter((i) => toonUit || i.actief !== false)
    .filter((i) => past(zoek, i.name, i.sku, i.omschrijving, i.exactCode, naamVan(i.locationId)))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl') || naamVan(a.locationId).localeCompare(naamVan(b.locationId), 'nl')),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, vestiging, toonUit, zoek, vestigingen])

  const uniekeNamen = new Set(items.filter((i) => i.actief !== false).map((i) => (i.sku || i.name).toLowerCase())).size
  const inKassa = items.filter((i) => kassa.has(i.id)).length
  const inactief = items.filter((i) => i.actief === false).length
  const metFoto = items.filter((i) => !!i.image).length

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Artikelen" value={items.filter((i) => i.actief !== false).length} icon={<Package size={17} />} />
        <Stat label="Unieke artikelen" value={uniekeNamen} icon={<Copy size={17} />} tone="ok" />
        {toonKassa
          // Pas als het antwoord er is telt een ontbrekend product als "niet in kassa".
          ? <Stat label="In de kassa" value={kassaGeladen ? inKassa : '-'} icon={<ShoppingCart size={17} />} tone="brand" />
          // De leverancier mag de kassa niet lezen; dan iets dat hij wél kan gebruiken.
          : <Stat label="Uit het assortiment" value={inactief} icon={<Ban size={17} />} tone="brand" />}
        <Stat label="Met foto" value={metFoto} icon={<Camera size={17} />} tone="warn" />
      </div>

      <Zoekveld waarde={zoek} onChange={setZoek} placeholder="Zoek op naam, artikelnummer of vestiging…">
        <select className="select sm" value={vestiging} onChange={(e) => setVestiging(e.target.value)} aria-label="Vestiging">
          <option value="">Alle vestigingen</option>
          {vestigingen.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <label className="ts-schakel">
          <input type="checkbox" checked={toonUit} onChange={(e) => setToonUit(e.target.checked)} />
          Ook inactieve
        </label>
        {magBeheren && (
          <button className="btn primary sm" onClick={() => setVorm({ ...LEEG, locationId: vestiging || vestigingen[0]?.id || '' })}>
            <PackagePlus size={14} /> Nieuw artikel
          </button>
        )}
      </Zoekveld>

      <Card flush>
        {lijst.length === 0 ? (
          <Empty text={items.length ? 'Geen artikelen die hieraan voldoen.' : 'Nog geen artikelen. Begin met "Nieuw artikel".'} icon={<Package size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data ts-tabel">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th className="hide-mobile">Eenheid</th>
                  <th className="num">Inkoop</th>
                  {toonKassa && <th className="num">Kassa</th>}
                  <th className="num hide-mobile">Minimum</th>
                  <th className="num hide-mobile">Bestelhoev.</th>
                  <th>Vestiging</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lijst.map((i) => {
                  const k = kassa.get(i.id)
                  return (
                    <tr key={i.id} className={i.actief === false ? 'ts-rij-uit' : ''}>
                      <td>
                        <div className="ts-artikelcel">
                          <Foto item={i} size={40} />
                          <div>
                            <strong>{i.name}</strong>
                            {i.actief === false && <> <Badge>inactief</Badge></>}
                            <div className="ts-sub">
                              {i.sku && <span className="mono">{i.sku}</span>}
                              {i.sku && i.omschrijving && ' · '}
                              {i.omschrijving}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hide-mobile ts-sub">{i.unit}</td>
                      <td className="num">{i.inkoopprijs !== undefined ? money(i.inkoopprijs) : <span className="ts-sub">-</span>}</td>
                      {toonKassa && (
                        <td className="num">
                          {k
                            ? <><span>{money(k.prijsIncl)}</span>{!k.actief && <div className="ts-sub">uit in kassa</div>}</>
                            : <span className="ts-sub">{kassaGeladen ? 'niet in kassa' : 'onbekend'}</span>}
                        </td>
                      )}
                      <td className="num hide-mobile ts-sub">{number(i.minStock)}</td>
                      <td className="num hide-mobile ts-sub">{i.bestelhoeveelheid ? number(i.bestelhoeveelheid) : '-'}</td>
                      <td>{naamVan(i.locationId)}</td>
                      <td className="ts-acties">
                        {magBeheren ? (
                          <>
                            <button className="btn sm" onClick={() => setVorm(vormVan(i))} title="Wijzigen"><Pencil size={14} /></button>
                            <button className="btn sm" onClick={() => setKopieer(i)} title="Kopieer naar andere vestigingen"><Copy size={14} /></button>
                            <button className="btn sm" onClick={() => setNaarKassaVan(i)} title="Naar de kassa"><ShoppingCart size={14} /></button>
                          </>
                        ) : (
                          <button className="btn sm ghost" onClick={() => setVorm(vormVan(i))}>Bekijken</button>
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

      <ArtikelModal
        vorm={vorm}
        vestigingen={vestigingen}
        alleenLezen={!magBeheren}
        onClose={() => setVorm(null)}
      />
      <KopieerModal item={kopieer} items={items} vestigingen={vestigingen} onClose={() => setKopieer(null)} />
      <KassaModal
        item={naarKassaVan}
        huidig={naarKassaVan ? kassa.get(naarKassaVan.id) : undefined}
        kassaBekend={toonKassa && kassaGeladen}
        onClose={() => setNaarKassaVan(null)}
        onKlaar={herlaadKassa}
      />
    </>
  )
}

/* ================================================================== *
 *  Nieuw / wijzigen
 * ================================================================== */

function ArtikelModal({
  vorm, vestigingen, alleenLezen, onClose,
}: { vorm: Vorm | null; vestigingen: Location[]; alleenLezen: boolean; onClose: () => void }) {
  const [v, setV] = useState<Vorm | null>(vorm)
  const [bezig, setBezig] = useState(false)
  const [fotoBezig, setFotoBezig] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Het formulier volgt wat er wordt geopend; daarna is het van de gebruiker.
  useEffect(() => { setV(vorm) }, [vorm])

  const zet = (patch: Partial<Vorm>) => setV((h) => (h ? { ...h, ...patch } : h))

  async function fotoKiezen(bestand: File | undefined) {
    if (!bestand) return
    setFotoBezig(true)
    try {
      const uri = await fotoVerkleinen(bestand)
      zet({ image: uri })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setFotoBezig(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function opslaan() {
    if (!v) return
    if (!v.name.trim()) return toast.error('Een artikel heeft een naam nodig.')
    if (!v.locationId) return toast.error('Kies de vestiging waar dit artikel ligt.')
    setBezig(true)
    try {
      const invoer: ArtikelInvoer = {
        id: v.id,
        locationId: v.locationId,
        name: v.name,
        unit: v.unit,
        sku: v.sku,
        omschrijving: v.omschrijving,
        image: v.image,
        minStock: getalUit(v.minStock),
        bestelhoeveelheid: getalUit(v.bestelhoeveelheid),
        inkoopprijs: v.inkoopprijs.trim() ? getalUit(v.inkoopprijs) : undefined,
        pricePerUnit: v.pricePerUnit.trim() ? getalUit(v.pricePerUnit) : undefined,
        actief: v.actief,
        exactCode: v.exactCode,
      }
      // De stand hoort bij leveringen en verbruik, niet bij dit formulier;
      // alleen een nieuw artikel krijgt hier zijn beginstand mee.
      if (!v.id) invoer.stock = getalUit(v.stock)
      const item = await artikelOpslaan(invoer)
      toast.ok(v.id ? `${item.name} bijgewerkt` : `${item.name} toegevoegd`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={!!vorm}
      title={alleenLezen ? 'Artikel' : vorm?.id ? 'Artikel wijzigen' : 'Nieuw artikel'}
      subtitle={alleenLezen ? 'Je kunt kijken; wijzigen vraagt het recht "Artikelen beheren".' : undefined}
      onClose={onClose}
      width={680}
    >
      {v && (
        <fieldset className="ts-veldset" disabled={alleenLezen}>
          <div className="ts-fotorij">
            <div className="ts-fotovak">
              {v.image ? <img src={v.image} alt="" /> : <Package size={28} />}
              {fotoBezig && <Loader2 size={18} className="spin ts-fotolader" />}
            </div>
            {!alleenLezen && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={fotoBezig}>
                  <Camera size={14} /> {v.image ? 'Andere foto' : 'Foto kiezen'}
                </button>
                {v.image && (
                  <button className="btn sm ghost" onClick={() => zet({ image: undefined })}>
                    <X size={14} /> Weg
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => void fotoKiezen(e.target.files?.[0])}
                />
                <span className="ts-sub" style={{ flexBasis: '100%' }}>
                  Wordt klein gemaakt tot een herkenningsplaatje; het gaat mee naar elk apparaat.
                </span>
              </div>
            )}
          </div>

          <div className="grid cols-2">
            <Field label="Naam">
              <input className="input" value={v.name} onChange={(e) => zet({ name: e.target.value })} autoFocus={!alleenLezen} />
            </Field>
            <Field label="Vestiging">
              <select className="select" value={v.locationId} onChange={(e) => zet({ locationId: e.target.value })}>
                <option value="">Kies…</option>
                {vestigingen.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid cols-3">
            <Field label="Artikelnummer (sku)">
              <input className="input" value={v.sku} onChange={(e) => zet({ sku: e.target.value })} placeholder="TS-0421" />
            </Field>
            <Field label="Eenheid">
              <input className="input" value={v.unit} onChange={(e) => zet({ unit: e.target.value })} placeholder="stuk, liter, doos" />
            </Field>
            <Field label="Code in Exact" help="Voor later; de koppeling synchroniseert nog niets.">
              <input className="input" value={v.exactCode} onChange={(e) => zet({ exactCode: e.target.value })} />
            </Field>
          </div>
          <Field label="Omschrijving">
            <textarea className="textarea" rows={2} value={v.omschrijving} onChange={(e) => zet({ omschrijving: e.target.value })} />
          </Field>
          <div className="grid cols-3">
            <Field label="Minimum" help="Hieronder ontstaat een alarm.">
              <input className="input" inputMode="decimal" value={v.minStock} onChange={(e) => zet({ minStock: e.target.value })} />
            </Field>
            <Field label="Bestelhoeveelheid" help="Wat er standaard per keer meegaat.">
              <input className="input" inputMode="decimal" value={v.bestelhoeveelheid} onChange={(e) => zet({ bestelhoeveelheid: e.target.value })} />
            </Field>
            {!v.id ? (
              <Field label="Beginstand" help="Wat er nu ligt. Daarna doen leveringen en verbruik het.">
                <input className="input" inputMode="decimal" value={v.stock} onChange={(e) => zet({ stock: e.target.value })} />
              </Field>
            ) : (
              <Field label="Stand" help="Verandert via leveringen en verbruik, niet hier.">
                <input className="input" value={number(getalUit(v.stock))} disabled />
              </Field>
            )}
          </div>
          {/* De trigger op inventory_items (0048) maakt bij insert meteen een alarm
              als de stand onder het minimum ligt, en de cron mailt dat binnen een
              kwartier. Wie hier 0 en een minimum intikt moet dat vooraf weten. */}
          {!v.id && !alleenLezen && getalUit(v.minStock) > 0 && getalUit(v.stock) < getalUit(v.minStock) && (
            <div className="waarschuwing zacht mb">
              <AlertTriangle size={16} />
              <span>
                Beginstand {number(getalUit(v.stock))} ligt onder het minimum {number(getalUit(v.minStock))}: bij opslaan ontstaat
                direct een alarm op {vestigingen.find((l) => l.id === v.locationId)?.name ?? 'de vestiging'} en gaat er binnen
                een kwartier een mail. Is dat niet de bedoeling, zet dan het minimum op 0 tot de vestiging heeft geteld.
              </span>
            </div>
          )}
          <div className="grid cols-3">
            <Field label="Inkoopprijs" help="Wat Trucksshop rekent, excl. btw.">
              <input className="input" inputMode="decimal" value={v.inkoopprijs} onChange={(e) => zet({ inkoopprijs: e.target.value })} placeholder="0,00" />
            </Field>
            <Field label="Interne prijs" help="Voor de voorraadwaarde. Leeg = de inkoopprijs.">
              <input className="input" inputMode="decimal" value={v.pricePerUnit} onChange={(e) => zet({ pricePerUnit: e.target.value })} placeholder="0,00" />
            </Field>
            <Field label="Actief" help="Uit: niet meer bestellen, wel in de historie.">
              <label className="ts-schakel" style={{ minHeight: 40 }}>
                <input type="checkbox" checked={v.actief} onChange={(e) => zet({ actief: e.target.checked })} />
                {v.actief ? 'Ja, wordt geleverd' : 'Nee, uit het assortiment'}
              </label>
            </Field>
          </div>
        </fieldset>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{alleenLezen ? 'Sluiten' : 'Annuleren'}</button>
        {!alleenLezen && (
          <button className="btn primary" disabled={bezig} onClick={() => void opslaan()}>
            {bezig ? <Loader2 size={15} className="spin" /> : null} Opslaan
          </button>
        )}
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Kopiëren naar andere vestigingen
 * ================================================================== */

function KopieerModal({
  item, items, vestigingen, onClose,
}: { item: InventoryItem | null; items: InventoryItem[]; vestigingen: Location[]; onClose: () => void }) {
  const [gekozen, setGekozen] = useState<Set<string>>(new Set())
  const [minimumMee, setMinimumMee] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => { setGekozen(new Set()); setMinimumMee(false) }, [item])

  // Waar staat hij al? Dezelfde regel als artikelKopieerNaar: op sku, anders op naam.
  const heeftAl = (locationId: string) => !!item && items.some((x) =>
    x.locationId === locationId && (item.sku ? x.sku === item.sku : x.name.trim().toLowerCase() === item.name.trim().toLowerCase()))

  const kandidaten = item ? vestigingen.filter((v) => v.id !== item.locationId && v.active) : []

  function wissel(id: string) {
    const n = new Set(gekozen)
    if (n.has(id)) n.delete(id); else n.add(id)
    setGekozen(n)
  }

  async function kopieren() {
    if (!item) return
    if (!gekozen.size) return toast.error('Kies minstens één vestiging.')
    setBezig(true)
    try {
      const gemaakt = await artikelKopieerNaar(item, [...gekozen], { minimumMeenemen: minimumMee })
      toast.ok(gemaakt.length
        ? `${item.name} staat nu ook op ${gemaakt.length} ${gemaakt.length === 1 ? 'vestiging' : 'vestigingen'}`
        : 'Niets gekopieerd: het artikel stond daar al.')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={!!item}
      title="Kopieer naar andere vestigingen"
      subtitle={item ? `${item.name}: dezelfde naam, prijs en foto, met stand 0. Wat er werkelijk ligt weet de vestiging.` : undefined}
      onClose={onClose}
      width={560}
    >
      {/* Stand 0 onder een minimum is voor de trigger (0048) een alarm per
          vestiging, en de cron mailt die binnen een kwartier: achttien vinkjes
          zouden achttien alarmen zijn zonder dat er op de vloer iets veranderde.
          Daarom gaat het minimum standaard niet mee; wie het wil, zet het aan
          en weet dan wat er gebeurt. */}
      {item && item.minStock > 0 && (
        <label className="row waarschuwing zacht mb" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={minimumMee}
            onChange={(e) => setMinimumMee(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Minimum van {number(item.minStock)} meenemen.</strong>{' '}
            {minimumMee
              ? <>De kopie begint op stand 0, dus dit maakt op <strong>elke gekozen vestiging direct een alarm</strong> en binnen een kwartier een mail met al die regels, terwijl er nog niets is geteld.</>
              : <>Staat uit: de kopie krijgt minimum 0 en geeft geen alarm. Verhoog het minimum per vestiging zodra de stand daar geteld is.</>}
          </span>
        </label>
      )}
      <div className="ts-kieslijst">
        {kandidaten.map((v) => {
          const al = heeftAl(v.id)
          return (
            <label key={v.id} className={`ts-kiesrij ${al ? 'ts-uit' : ''}`}>
              <input type="checkbox" disabled={al} checked={gekozen.has(v.id)} onChange={() => wissel(v.id)} />
              <div className="ts-kiestekst">
                <strong>{v.name}</strong>
                <span>{al ? 'staat er al' : v.city}</span>
              </div>
            </label>
          )
        })}
      </div>
      <div className="row end">
        <button className="btn ghost sm" onClick={() => setGekozen(new Set(kandidaten.filter((v) => !heeftAl(v.id)).map((v) => v.id)))}>
          Alles waar hij nog niet staat
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" disabled={bezig || !gekozen.size} onClick={() => void kopieren()}>
          <Copy size={15} /> Kopiëren{item && item.minStock > 0 && gekozen.size > 0 ? ` (${gekozen.size} ${gekozen.size === 1 ? 'alarm' : 'alarmen'})` : ''}
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Naar de kassa
 * ================================================================== */

const GROEPEN = ['Artikelen', 'Reiniging', 'Accessoires', 'Overig']

function KassaModal({
  item, huidig, kassaBekend, onClose, onKlaar,
}: { item: InventoryItem | null; huidig?: KassaInfo; kassaBekend: boolean; onClose: () => void; onKlaar: () => void }) {
  const [prijs, setPrijs] = useState('')
  const [groep, setGroep] = useState('Artikelen')
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    if (!item) return
    // Voorstel: wat de kassa al rekent, anders de inkoopprijs plus 21% btw.
    const start = huidig?.prijsIncl || (item.inkoopprijs ? Math.round(item.inkoopprijs * 1.21 * 100) / 100 : 0)
    setPrijs(start ? String(start).replace('.', ',') : '')
    setGroep('Artikelen')
  }, [item, huidig])

  async function doorzetten() {
    if (!item) return
    const p = getalUit(prijs, -1)
    if (p < 0) return toast.error('Vul een prijs in, inclusief btw.')
    setBezig(true)
    try {
      await naarKassa(item, p, groep)
      toast.ok(`${item.name} staat in de kassa van ${item.locationId ? 'de vestiging' : 'alle vestigingen'} voor ${money(p)}`)
      onKlaar()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={!!item}
      title="Naar de kassa"
      subtitle={item ? `${item.name}: de kassa van de vestiging kan het dan verkopen en boekt het af van deze voorraad.` : undefined}
      onClose={onClose}
      width={460}
    >
      {huidig && (
        <div className="waarschuwing zacht mb">
          <ShoppingCart size={16} />
          <span>Staat al in de kassa voor {money(huidig.prijsIncl)}{huidig.actief ? '' : ' (uit)'}. Opslaan werkt het kassaproduct bij.</span>
        </div>
      )}
      {!huidig && !kassaBekend && (
        // Geen antwoord van de leesdeur (meestal: geen verbinding). Dan zeggen
        // we eerlijk dat we niet weten of het product er al staat -- de server
        // maakt of werkt bij, dat komt hoe dan ook goed.
        <p className="ts-sub" style={{ margin: '0 0 12px' }}>
          Of dit artikel al in de kassa staat is nu niet op te halen. Staat het er al, dan wordt het bijgewerkt; anders komt het erbij.
        </p>
      )}
      <div className="grid cols-2">
        <Field label="Verkoopprijs incl. btw">
          <input className="input" inputMode="decimal" value={prijs} onChange={(e) => setPrijs(e.target.value)} autoFocus />
        </Field>
        <Field label="Groep op het kassascherm">
          <input className="input" value={groep} onChange={(e) => setGroep(e.target.value)} list="ts-groepen" />
          <datalist id="ts-groepen">{GROEPEN.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
      </div>
      <p className="ts-sub" style={{ margin: '0 0 14px' }}>
        Actief in de kassa volgt "actief" van het artikel. Werkt alleen met verbinding: de kassa heeft geen wachtrij.
      </p>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" disabled={bezig} onClick={() => void doorzetten()}>
          {bezig ? <Loader2 size={15} className="spin" /> : <ShoppingCart size={15} />} Naar de kassa
        </button>
      </div>
    </Modal>
  )
}
