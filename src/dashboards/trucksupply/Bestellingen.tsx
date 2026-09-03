import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Building2, Check, FileText, Loader2, Mail, MapPin, Package, PackageCheck,
  PackagePlus, Phone, Plus, Printer, Send, Tag, Trash2, Truck, User as UserIcon, X,
} from 'lucide-react'
import {
  VOLGENDE_STATUS, bestellingBijwerken, bestellingVerwijderen, isConceptNummer, magNaar,
  mailBestelling, regelGeleverd, zetStatus,
} from '../../lib/trucksupply'
import { adresRegel } from '../../lib/vestigingen'
import {
  BESTELLING_STATUS,
  type Bestelling, type BestellingStatus, type Bestelregel, type InventoryItem, type Location,
} from '../../lib/types'
import { dateTime, money, number, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
import { PrintModal, type PrintSoort } from './Print'
import {
  Foto, NieuweZending, OPEN_STATUS, StatusBadge, Tabs, Zoekveld, getalUit, isOpen, past,
  regelOpslaan, regelToevoegen, regelVerwijderen, useArtikelen, useBestellingen, useBestelregels,
  useVestigingen, voorstelAantal,
} from './gedeeld'

/* ------------------------------------------------------------------ *
 *  Bestellingen -- van concept tot ontvangen
 *
 *  Een bestelling loopt in stappen: concept, bevestigd, ingepakt, verzonden,
 *  ontvangen. De knoppen staan in die volgorde en tonen alleen de volgende
 *  stap; wie een concept ziet, ziet "Bevestigen" en niet vijf knoppen.
 *
 *  Het moment dat telt is "verzonden": dan boekt de app de regels bij op de
 *  voorraad van de vestiging, en gaat het alarm daar vanzelf uit. Dat staat
 *  ook bij de knop, want het is het enige dat niet terug te draaien is met
 *  een klik.
 * ------------------------------------------------------------------ */

type Tab = 'open' | BestellingStatus | 'alles'

const BRON: Record<Bestelling['bron'], string> = {
  voorraad: 'uit de alarmen',
  handmatig: 'zelf samengesteld',
  aanvraag: 'aangevraagd door de vestiging',
}

const STAPKNOP: Partial<Record<BestellingStatus, { label: string; icon: typeof Check; hint: string }>> = {
  bevestigd: { label: 'Bevestigen', icon: Check, hint: 'De bestelling staat vast en krijgt een nummer' },
  ingepakt:  { label: 'Ingepakt', icon: Package, hint: 'De doos is dicht; pas hier het geleverde aantal aan als het afwijkt' },
  verzonden: { label: 'Verzenden', icon: Truck, hint: 'Boekt de voorraad bij op de vestiging' },
  ontvangen: { label: 'Ontvangen', icon: PackageCheck, hint: 'De vestiging heeft hem binnen' },
}

export default function Bestellingen({
  openId, onOpened,
}: { openId?: string | null; onOpened?: () => void }) {
  const perms = usePerms()
  const mag = perms.can('supply.orders')

  const vestigingen = useVestigingen()
  const items = useArtikelen()
  const bestellingen = useBestellingen()
  const regels = useBestelregels()

  const [tab, setTab] = useState<Tab>('open')
  const [zoek, setZoek] = useState('')
  const [gekozenId, setGekozenId] = useState<string | null>(null)
  const [kiesVestiging, setKiesVestiging] = useState(false)
  const [zending, setZending] = useState<Location | null>(null)

  // Van buiten geopend (zoekbalk, tegel, "in zending"): meteen het detail.
  useEffect(() => {
    if (openId) { setGekozenId(openId); onOpened?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const naamVan = (id: string) => vestigingen.find((v) => v.id === id)?.name ?? 'Onbekende vestiging'
  const aantalPer = (status: BestellingStatus) => bestellingen.filter((b) => b.status === status).length

  const lijst = useMemo(() => bestellingen
    .filter((b) => tab === 'alles' ? true : tab === 'open' ? isOpen(b) : b.status === tab)
    .filter((b) => past(zoek, b.nummer, naamVan(b.locationId), b.aangemaaktDoorNaam, b.vervoerder, b.trackTrace, b.opmerking)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bestellingen, tab, zoek, vestigingen])

  const gekozen = bestellingen.find((b) => b.id === gekozenId) ?? null
  const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0)
  const vandaagVerzonden = bestellingen.filter((b) => (b.verzondenAt ?? 0) >= vandaag.getTime()).length

  if (gekozen) {
    return (
      <Detail
        bestelling={gekozen}
        regels={regels.filter((r) => r.bestellingId === gekozen.id)}
        locatie={vestigingen.find((v) => v.id === gekozen.locationId)}
        items={items}
        mag={mag}
        onTerug={() => setGekozenId(null)}
      />
    )
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Concept" value={aantalPer('concept')} icon={<FileText size={17} />} />
        <Stat label="Bevestigd en ingepakt" value={aantalPer('bevestigd') + aantalPer('ingepakt')} icon={<Package size={17} />} tone="warn" />
        <Stat label="Onderweg" value={aantalPer('verzonden')} icon={<Truck size={17} />} tone="brand" />
        <Stat label="Vandaag verzonden" value={vandaagVerzonden} icon={<PackageCheck size={17} />} tone="ok" />
      </div>

      <Zoekveld waarde={zoek} onChange={setZoek} placeholder="Zoek op nummer, vestiging, vervoerder…">
        {mag && (
          <button className="btn primary sm" onClick={() => setKiesVestiging(true)}>
            <PackagePlus size={14} /> Nieuwe zending
          </button>
        )}
      </Zoekveld>

      <Card flush>
        <div style={{ padding: '0 16px 12px' }}>
          <Tabs
            waarde={tab}
            onChange={setTab}
            opties={[
              { key: 'open', label: 'Open', aantal: bestellingen.filter(isOpen).length },
              { key: 'concept', label: 'Concept', aantal: aantalPer('concept') },
              { key: 'bevestigd', label: 'Bevestigd', aantal: aantalPer('bevestigd') },
              { key: 'ingepakt', label: 'Ingepakt', aantal: aantalPer('ingepakt') },
              { key: 'verzonden', label: 'Verzonden', aantal: aantalPer('verzonden') },
              { key: 'ontvangen', label: 'Ontvangen' },
              { key: 'geannuleerd', label: 'Geannuleerd' },
              { key: 'alles', label: 'Alles' },
            ]}
          />
        </div>
        {lijst.length === 0 ? (
          <Empty
            text={bestellingen.length ? 'Geen bestellingen in deze lijst.' : 'Nog geen bestellingen. Maak er een vanuit de voorraad, of met "Nieuwe zending".'}
            icon={<Package size={30} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data ts-tabel ts-klikbaar">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th>Vestiging</th>
                  <th>Status</th>
                  <th className="num">Regels</th>
                  <th className="hide-mobile">Bron</th>
                  <th className="hide-mobile">Aangemaakt</th>
                  <th className="hide-mobile">Verzonden</th>
                </tr>
              </thead>
              <tbody>
                {lijst.map((b) => {
                  const n = regels.filter((r) => r.bestellingId === b.id).length
                  return (
                    <tr key={b.id} onClick={() => setGekozenId(b.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setGekozenId(b.id)}>
                      <td>
                        <strong className="mono">{isConceptNummer(b.nummer) ? 'concept' : b.nummer}</strong>
                        {isConceptNummer(b.nummer) && <div className="ts-sub">krijgt een nummer bij bevestigen</div>}
                      </td>
                      <td>{naamVan(b.locationId)}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="num">{n}</td>
                      <td className="hide-mobile ts-sub">{BRON[b.bron]}</td>
                      <td className="hide-mobile ts-sub" title={dateTime(b.aangemaaktAt)}>{relative(b.aangemaaktAt)} · {b.aangemaaktDoorNaam}</td>
                      <td className="hide-mobile ts-sub">{b.verzondenAt ? <>{relative(b.verzondenAt)}{b.vervoerder && ` · ${b.vervoerder}`}</> : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <VestigingKiezer
        open={kiesVestiging}
        vestigingen={vestigingen}
        onClose={() => setKiesVestiging(false)}
        onKies={(v) => { setKiesVestiging(false); setZending(v) }}
      />
      <NieuweZending
        open={!!zending}
        locatie={zending}
        items={items}
        onClose={() => setZending(null)}
        onGemaakt={(b) => setGekozenId(b.id)}
      />
    </>
  )
}

/* ================================================================== *
 *  Voor welke vestiging?
 * ================================================================== */

function VestigingKiezer({
  open, vestigingen, onClose, onKies,
}: { open: boolean; vestigingen: Location[]; onClose: () => void; onKies: (v: Location) => void }) {
  const [zoek, setZoek] = useState('')
  return (
    <Modal open={open} title="Nieuwe zending" subtitle="Voor welke vestiging?" onClose={onClose} width={480}>
      <input className="input sm" type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Vestiging zoeken…" autoFocus style={{ marginBottom: 10 }} />
      <div className="ts-kieslijst">
        {vestigingen.filter((v) => v.active && past(zoek, v.name, v.city)).map((v) => (
          <button key={v.id} className="ts-kiesrij ts-knop" onClick={() => onKies(v)}>
            <Building2 size={16} />
            <div className="ts-kiestekst"><strong>{v.name}</strong><span>{v.city}</span></div>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  Eén bestelling
 * ================================================================== */

function Detail({
  bestelling, regels, locatie, items, mag, onTerug,
}: {
  bestelling: Bestelling
  regels: Bestelregel[]
  locatie?: Location
  items: InventoryItem[]
  mag: boolean
  onTerug: () => void
}) {
  const user = useAuth((s) => s.user)!
  const [bezig, setBezig] = useState(false)
  const [verzendOpen, setVerzendOpen] = useState(false)
  const [annuleerOpen, setAnnuleerOpen] = useState(false)
  const [doorsturen, setDoorsturen] = useState(false)
  const [regelErbij, setRegelErbij] = useState(false)
  const [print, setPrint] = useState<PrintSoort | null>(null)
  const [opmerking, setOpmerking] = useState(bestelling.opmerking ?? '')

  useEffect(() => { setOpmerking(bestelling.opmerking ?? '') }, [bestelling.id, bestelling.opmerking])

  const b = bestelling
  const magRegels = mag && (b.status === 'concept' || b.status === 'bevestigd')
  // Weghalen kan alleen in concept: zo staat het in bestelregels_delete (0048).
  // Bij bevestigd zou de regel hier verdwijnen, op de server geweigerd worden en
  // bij de volgende pull als spook terugkomen -- terwijl de pakbon die de server
  // mailt hem wél noemt. Wie iets niet meestuurt, zet het aantal op 0.
  const magVerwijderen = mag && b.status === 'concept'
  const magGeleverd = mag && b.status === 'ingepakt'
  const toonGeleverd = magGeleverd || regels.some((r) => r.geleverd !== undefined)
  const volgende = VOLGENDE_STATUS[b.status].filter((s) => s !== 'geannuleerd')[0]
  const totaal = regels.reduce((som, r) => som + (r.prijs ?? 0) * (r.geleverd ?? r.aantal), 0)
  const mijnItems = items.filter((i) => i.locationId === b.locationId && i.actief !== false && !regels.some((r) => r.itemId === i.id))

  async function doe(werk: () => Promise<unknown>, melding?: string) {
    setBezig(true)
    try {
      await werk()
      if (melding) toast.ok(melding)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(false)
    }
  }

  function stap(naar: BestellingStatus) {
    if (!magNaar(b.status, naar)) return
    if (naar === 'verzonden') return setVerzendOpen(true)
    void doe(() => zetStatus(b, naar, user), `${b.nummer}: ${BESTELLING_STATUS[naar].label.toLowerCase()}`)
  }

  const knop = volgende ? STAPKNOP[volgende] : undefined

  return (
    <>
      <div className="ts-balk">
        <button className="btn sm" onClick={onTerug}><ArrowLeft size={14} /> Alle bestellingen</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0 }} className="mono">
            {isConceptNummer(b.nummer) ? 'Concept (nummer volgt bij bevestigen)' : b.nummer}
          </h3>
          <div className="ts-sub">
            {locatie?.name ?? 'Onbekende vestiging'} · {BRON[b.bron]} · {dateTime(b.aangemaaktAt)} door {b.aangemaaktDoorNaam}
          </div>
        </div>
        <StatusBadge status={b.status} />
      </div>

      <div className="grid sidebar-right">
        <div>
          <Card
            title="Regels"
            hint={magVerwijderen
              ? 'Aantal aanpassen kan tot hij ingepakt is'
              : magRegels
                ? 'Aantal aanpassen kan tot hij ingepakt is; weghalen kan alleen in concept, zet het aantal op 0 als iets niet meegaat'
                : magGeleverd ? 'Wijkt het af? Vul in wat er werkelijk meegaat' : undefined}
            flush
            action={magRegels && mijnItems.length > 0 ? (
              <button className="btn sm" onClick={() => setRegelErbij(true)}><Plus size={14} /> Regel toevoegen</button>
            ) : undefined}
          >
            {regels.length === 0 ? (
              <Empty text="Nog geen regels." icon={<Package size={30} />} />
            ) : (
              <div className="table-wrap">
                <table className="data ts-tabel">
                  <thead>
                    <tr>
                      <th>Artikel</th>
                      <th className="num">Aantal</th>
                      {toonGeleverd && <th className="num">Geleverd</th>}
                      <th className="num hide-mobile">Prijs</th>
                      {magVerwijderen && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {regels.map((r) => {
                      const item = items.find((i) => i.id === r.itemId)
                      return (
                        <tr key={r.id}>
                          <td>
                            <div className="ts-artikelcel">
                              {item && <Foto item={item} size={30} />}
                              <div>
                                <strong>{r.itemNaam}</strong>
                                <div className="ts-sub">
                                  {item?.sku && <span className="mono">{item.sku} · </span>}
                                  {item ? `nu ${number(item.stock)} ${item.unit} op de vestiging` : 'artikel niet (meer) in de voorraad'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="num">
                            {magRegels ? (
                              <AantalVeld waarde={r.aantal} eenheid={r.eenheid} onChange={(n) => void doe(() => regelOpslaan({ ...r, aantal: n }))} />
                            ) : <>{number(r.aantal)} <span className="ts-sub">{r.eenheid}</span></>}
                          </td>
                          {toonGeleverd && (
                            <td className="num">
                              {magGeleverd ? (
                                <AantalVeld waarde={r.geleverd ?? r.aantal} eenheid={r.eenheid} onChange={(n) => void doe(() => regelGeleverd(r, n))} />
                              ) : r.geleverd !== undefined && r.geleverd !== r.aantal
                                ? <strong>{number(r.geleverd)}</strong>
                                : <span className="ts-sub">{number(r.geleverd ?? r.aantal)}</span>}
                            </td>
                          )}
                          <td className="num hide-mobile ts-sub">{r.prijs !== undefined ? money(r.prijs) : '-'}</td>
                          {magVerwijderen && (
                            <td className="ts-acties">
                              <button className="btn sm ghost" title="Regel weghalen" onClick={() => void doe(() => regelVerwijderen(r))}>
                                <Trash2 size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                  {totaal > 0 && (
                    <tfoot>
                      <tr>
                        <td className="ts-sub">Inkoopwaarde (niet op de pakbon)</td>
                        <td className="num" colSpan={toonGeleverd ? 3 : 2}>{money(totaal)}</td>
                        {magVerwijderen && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>

          <Card title="Opmerking" hint="Komt op de pakbon" className="mt">
            {mag && b.status !== 'ontvangen' && b.status !== 'geannuleerd' ? (
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <textarea className="textarea" rows={2} style={{ flex: 1 }} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} placeholder="Bijvoorbeeld: afleveren bij de achteringang" />
                <button
                  className="btn sm"
                  disabled={bezig || opmerking.trim() === (b.opmerking ?? '')}
                  onClick={() => void doe(() => bestellingBijwerken(b, { opmerking }), 'Opmerking opgeslagen')}
                >
                  Opslaan
                </button>
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{b.opmerking || <span className="ts-sub">Geen opmerking.</span>}</div>
            )}
          </Card>
        </div>

        <div>
          <Card title="Vestiging">
            {locatie ? (
              <div className="ts-contactblok">
                <strong>{locatie.name}</strong>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresRegel(locatie))}`} target="_blank" rel="noreferrer">
                  <MapPin size={14} /> {adresRegel(locatie) || 'Geen adres'}
                </a>
                {locatie.phone && <a href={`tel:${locatie.phone.replace(/\s/g, '')}`}><Phone size={14} /> {locatie.phone}</a>}
                {locatie.email && <a href={`mailto:${locatie.email}`}><Mail size={14} /> {locatie.email}</a>}
                {locatie.managerName && <span><UserIcon size={14} /> {locatie.managerName}</span>}
              </div>
            ) : <Empty text="Vestiging niet gevonden." icon={<Building2 size={26} />} />}
          </Card>

          <Card title="Afhandeling" className="mt">
            <div className="ts-stappen">
              {(['concept', 'bevestigd', 'ingepakt', 'verzonden', 'ontvangen'] as BestellingStatus[]).map((s) => {
                const rang = ['concept', 'bevestigd', 'ingepakt', 'verzonden', 'ontvangen']
                const gehaald = b.status !== 'geannuleerd' && rang.indexOf(s) <= rang.indexOf(b.status)
                const tijd = s === 'bevestigd' ? b.bevestigdAt : s === 'verzonden' ? b.verzondenAt : s === 'ontvangen' ? b.ontvangenAt : s === 'concept' ? b.aangemaaktAt : undefined
                return (
                  <div key={s} className={`ts-stap ${gehaald ? 'gehaald' : ''}`}>
                    <span className="bol" />
                    <span>{BESTELLING_STATUS[s].label}</span>
                    <span className="ts-sub">{gehaald && tijd ? dateTime(tijd) : ''}</span>
                  </div>
                )
              })}
              {b.status === 'geannuleerd' && <div className="ts-stap geannuleerd"><span className="bol" /><span>Geannuleerd</span></div>}
            </div>

            {(b.vervoerder || b.trackTrace) && (
              <div className="ts-sub" style={{ marginTop: 10 }}>
                <Truck size={13} /> {b.vervoerder ?? 'Vervoerder onbekend'}{b.trackTrace && <> · <span className="mono">{b.trackTrace}</span></>}
              </div>
            )}
            {b.doorgestuurdNaar && (
              <div className="ts-sub" style={{ marginTop: 6 }}>
                <Send size={13} /> Pakbon gemaild naar {b.doorgestuurdNaar}{b.doorgestuurdAt && `, ${relative(b.doorgestuurdAt)}`}
              </div>
            )}

            {mag && (
              <div className="ts-knoppen">
                {knop && volgende && (
                  <button className="btn primary block" disabled={bezig || (regels.length === 0 && volgende !== 'ontvangen')} onClick={() => stap(volgende)} title={knop.hint}>
                    {bezig ? <Loader2 size={15} className="spin" /> : <knop.icon size={15} />} {knop.label}
                  </button>
                )}
                {volgende === 'verzonden' && (
                  <p className="ts-sub" style={{ margin: 0 }}>
                    Bij verzenden wordt de voorraad van {locatie?.name ?? 'de vestiging'} bijgeboekt met wat er meegaat; het alarm gaat daar dan vanzelf uit.
                  </p>
                )}
                {regels.length === 0 && volgende !== 'ontvangen' && (
                  <p className="ts-sub" style={{ margin: 0 }}>Zonder regels valt er niets te {volgende === 'bevestigd' ? 'bevestigen' : volgende === 'ingepakt' ? 'inpakken' : 'verzenden'}.</p>
                )}
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setPrint('pakbon')} disabled={!regels.length}><Printer size={14} /> Pakbon</button>
                  <button className="btn sm" onClick={() => setPrint('label')}><Tag size={14} /> Verzendlabel</button>
                  <button className="btn sm" onClick={() => setDoorsturen(true)} disabled={!regels.length}><Send size={14} /> Doorsturen</button>
                </div>
                {OPEN_STATUS.includes(b.status) && (
                  <div className="row" style={{ gap: 6 }}>
                    {b.status === 'concept' && (
                      <button className="btn sm ghost" disabled={bezig} onClick={() => {
                        if (!confirm('Dit concept weggooien? Er is nog niets verzonden.')) return
                        void doe(async () => { await bestellingVerwijderen(b); onTerug() }, 'Concept weggegooid')
                      }}>
                        <Trash2 size={14} /> Weggooien
                      </button>
                    )}
                    <button className="btn sm danger" disabled={bezig} onClick={() => setAnnuleerOpen(true)}>
                      <X size={14} /> Annuleren
                    </button>
                  </div>
                )}
              </div>
            )}
            {!mag && (
              <div className="row" style={{ gap: 6, marginTop: 12 }}>
                <button className="btn sm" onClick={() => setPrint('pakbon')} disabled={!regels.length}><Printer size={14} /> Pakbon</button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* --- verzenden --- */}
      <VerzendModal
        open={verzendOpen}
        bestelling={b}
        onClose={() => setVerzendOpen(false)}
        onVerzend={(vervoerder, trackTrace) => {
          setVerzendOpen(false)
          void doe(async () => {
            const bij = await bestellingBijwerken(b, { vervoerder, trackTrace })
            await zetStatus(bij, 'verzonden', user)
          }, `${b.nummer} verzonden; de voorraad van ${locatie?.name ?? 'de vestiging'} is bijgeboekt`)
        }}
      />

      {/* --- annuleren --- */}
      <AnnuleerModal
        open={annuleerOpen}
        onClose={() => setAnnuleerOpen(false)}
        onAnnuleer={(reden) => {
          setAnnuleerOpen(false)
          void doe(async () => {
            const tekst = [b.opmerking, `Geannuleerd: ${reden}`].filter(Boolean).join('\n')
            const bij = await bestellingBijwerken(b, { opmerking: tekst })
            await zetStatus(bij, 'geannuleerd', user)
          }, `${b.nummer} geannuleerd`)
        }}
      />

      {/* --- doorsturen --- */}
      <DoorstuurModal
        open={doorsturen}
        bestelling={b}
        locatie={locatie}
        onClose={() => setDoorsturen(false)}
        onVerstuur={(naar, bericht) => {
          setDoorsturen(false)
          void doe(() => mailBestelling(b, naar, bericht), `Pakbon gemaild naar ${naar}`)
        }}
      />

      {/* --- regel toevoegen --- */}
      <RegelModal
        open={regelErbij}
        items={mijnItems}
        onClose={() => setRegelErbij(false)}
        onKies={(item, aantal) => {
          setRegelErbij(false)
          void doe(() => regelToevoegen(b, {
            itemId: item.id, itemNaam: item.name, aantal, eenheid: item.unit, prijs: item.inkoopprijs,
          }), `${item.name} toegevoegd`)
        }}
      />

      <PrintModal soort={print} bestelling={b} regels={regels} locatie={locatie} items={items} onClose={() => setPrint(null)} />
    </>
  )
}

/* ------------------------------------------------------------------ */

/** Een aantal dat je in de tabel zelf verandert; opslaan bij verlaten of Enter. */
function AantalVeld({ waarde, eenheid, onChange }: { waarde: number; eenheid: string; onChange: (n: number) => void }) {
  const [tekst, setTekst] = useState(String(waarde))
  useEffect(() => { setTekst(String(waarde)) }, [waarde])
  function klaar() {
    const n = getalUit(tekst, -1)
    // Nul of minder zetten we terug: een regel met nul stuks is geen regel.
    // Wil je iets niet meesturen, haal de regel weg (concept) of zet het
    // geleverde aantal lager bij het inpakken.
    if (n <= 0) return setTekst(String(waarde))
    if (n !== waarde) onChange(n)
  }
  return (
    <span className="ts-aantalveld">
      <input
        className="input sm ts-aantal"
        inputMode="decimal"
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        onBlur={klaar}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Aantal"
      />
      <span className="ts-sub">{eenheid}</span>
    </span>
  )
}

function VerzendModal({
  open, bestelling, onClose, onVerzend,
}: { open: boolean; bestelling: Bestelling; onClose: () => void; onVerzend: (vervoerder: string, trackTrace: string) => void }) {
  const [vervoerder, setVervoerder] = useState(bestelling.vervoerder ?? 'Eigen bus')
  const [tt, setTt] = useState(bestelling.trackTrace ?? '')
  useEffect(() => { if (open) { setVervoerder(bestelling.vervoerder ?? 'Eigen bus'); setTt(bestelling.trackTrace ?? '') } }, [open, bestelling])
  return (
    <Modal open={open} title="Verzenden" subtitle="Hiermee wordt de voorraad van de vestiging bijgeboekt met wat er meegaat." onClose={onClose} width={460}>
      <Field label="Vervoerder">
        <input className="input" value={vervoerder} onChange={(e) => setVervoerder(e.target.value)} list="ts-vervoerders" autoFocus />
        <datalist id="ts-vervoerders">
          {['Eigen bus', 'PostNL', 'DHL', 'DPD', 'GLS', 'UPS'].map((v) => <option key={v} value={v} />)}
        </datalist>
      </Field>
      <Field label="Track & trace" help="Mag leeg als het met de eigen bus gaat.">
        <input className="input" value={tt} onChange={(e) => setTt(e.target.value)} />
      </Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => onVerzend(vervoerder, tt)}><Truck size={15} /> Verzenden en bijboeken</button>
      </div>
    </Modal>
  )
}

function AnnuleerModal({ open, onClose, onAnnuleer }: { open: boolean; onClose: () => void; onAnnuleer: (reden: string) => void }) {
  const [reden, setReden] = useState('')
  useEffect(() => { if (open) setReden('') }, [open])
  return (
    <Modal open={open} title="Bestelling annuleren" subtitle="De bestelling blijft staan als geannuleerd, met de reden in de opmerking." onClose={onClose} width={440}>
      <Field label="Reden">
        <input className="input" value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Bijvoorbeeld: dubbel aangemaakt" autoFocus />
      </Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Terug</button>
        <button className="btn danger" disabled={!reden.trim()} onClick={() => onAnnuleer(reden.trim())}><X size={15} /> Annuleren</button>
      </div>
    </Modal>
  )
}

function DoorstuurModal({
  open, bestelling, locatie, onClose, onVerstuur,
}: { open: boolean; bestelling: Bestelling; locatie?: Location; onClose: () => void; onVerstuur: (naar: string, bericht: string) => void }) {
  const [naar, setNaar] = useState('')
  const [bericht, setBericht] = useState('')
  useEffect(() => {
    if (!open) return
    setNaar(bestelling.doorgestuurdNaar ?? locatie?.email ?? '')
    setBericht(`Hierbij de pakbon van zending ${bestelling.nummer}${locatie ? ` voor ${locatie.name}` : ''}.`)
  }, [open, bestelling, locatie])
  return (
    <Modal open={open} title="Pakbon doorsturen" subtitle="Als tekst per mail, naar de vestiging of een vervoerder. Zonder prijzen." onClose={onClose} width={480}>
      <Field label="Naar">
        <input className="input" type="email" value={naar} onChange={(e) => setNaar(e.target.value)} placeholder="naam@bedrijf.nl" autoFocus />
      </Field>
      <Field label="Bericht">
        <textarea className="textarea" rows={3} value={bericht} onChange={(e) => setBericht(e.target.value)} />
      </Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" disabled={!naar.trim()} onClick={() => onVerstuur(naar, bericht)}><Send size={15} /> Versturen</button>
      </div>
    </Modal>
  )
}

function RegelModal({
  open, items, onClose, onKies,
}: { open: boolean; items: InventoryItem[]; onClose: () => void; onKies: (item: InventoryItem, aantal: number) => void }) {
  const [zoek, setZoek] = useState('')
  const [gekozen, setGekozen] = useState<InventoryItem | null>(null)
  const [aantal, setAantal] = useState('')
  useEffect(() => { if (open) { setZoek(''); setGekozen(null); setAantal('') } }, [open])

  return (
    <Modal open={open} title="Regel toevoegen" subtitle="Uit de artikelen van deze vestiging die er nog niet in staan." onClose={onClose} width={520}>
      {!gekozen ? (
        <>
          <input className="input sm" type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Artikel zoeken…" autoFocus style={{ marginBottom: 10 }} />
          <div className="ts-kieslijst">
            {items.filter((i) => past(zoek, i.name, i.sku)).map((i) => (
              <button key={i.id} className="ts-kiesrij ts-knop" onClick={() => { setGekozen(i); setAantal(String(voorstelAantal(i))) }}>
                <Foto item={i} size={30} />
                <div className="ts-kiestekst">
                  <strong>{i.name}</strong>
                  <span>nu {number(i.stock)} {i.unit}, min. {number(i.minStock)}</span>
                </div>
              </button>
            ))}
            {items.length === 0 && <Empty text="Alle artikelen van deze vestiging staan er al in." />}
          </div>
        </>
      ) : (
        <>
          <div className="ts-kiesrij" style={{ marginBottom: 12 }}>
            <Foto item={gekozen} size={34} />
            <div className="ts-kiestekst"><strong>{gekozen.name}</strong><span>{gekozen.unit}</span></div>
            <button className="btn sm ghost" onClick={() => setGekozen(null)}>Ander artikel</button>
          </div>
          <Field label={`Aantal (${gekozen.unit})`}>
            <input className="input" inputMode="decimal" value={aantal} onChange={(e) => setAantal(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && getalUit(aantal) > 0 && onKies(gekozen, getalUit(aantal))} />
          </Field>
          <div className="row end">
            <button className="btn ghost" onClick={onClose}>Annuleren</button>
            <button className="btn primary" disabled={getalUit(aantal) <= 0} onClick={() => onKies(gekozen, getalUit(aantal))}><Plus size={15} /> Toevoegen</button>
          </div>
        </>
      )}
    </Modal>
  )
}
