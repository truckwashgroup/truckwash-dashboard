import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, Bell, BellOff, Building2, Check, Eye, Package, PackagePlus, TriangleAlert,
} from 'lucide-react'
import { db } from '../../lib/db'
import { markeerGezien, openAlarmen } from '../../lib/trucksupply'
import type { InventoryItem, Location, StockMovement, VoorraadAlarm } from '../../lib/types'
import { dateTime, number, relative } from '../../lib/format'
import { Badge, Bar, Card, Empty, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { useNav, usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
import {
  Foto, NieuweZending, Tabs, Zoekveld, inZending, past, standStatus,
  useAlarmen, useArtikelen, useBestellingen, useBestelregels, useVestigingen,
} from './gedeeld'

/* ------------------------------------------------------------------ *
 *  Voorraad -- alle vestigingen in één blik
 *
 *  's Ochtends wil je weten: waar is iets op? Daarom eerst een raster met
 *  per vestiging één kaart en één getal (hoeveel artikelen onder het
 *  minimum), en pas na een klik de tabel met standen. Het zoekveld bovenaan
 *  kijkt over alle vestigingen heen, want "waar is de velgenreiniger
 *  bijna op" is een vraag over een artikel, niet over een vestiging.
 *
 *  Onderaan de alarmen zelf, met wat ermee gebeurd is: open, gezien door
 *  wie, of opgelost doordat de stand weer boven het minimum kwam.
 * ------------------------------------------------------------------ */

type AlarmTab = 'open' | 'gezien' | 'opgelost'

export default function Voorraad({ startTab = 'open' }: { startTab?: AlarmTab }) {
  const user = useAuth((s) => s.user)!
  const perms = usePerms()
  const goto = useNav((s) => s.goto)
  const magBestellen = perms.can('supply.orders')

  const vestigingen = useVestigingen()
  const items = useArtikelen()
  const alarmen = useAlarmen()
  const bestellingen = useBestellingen()
  const regels = useBestelregels()
  const bewegingen = useLiveQuery(() => db.stockMovements.toArray(), [], [] as StockMovement[])

  const [zoek, setZoek] = useState('')
  const [gekozen, setGekozen] = useState<string | null>(null)
  const [alleenLaag, setAlleenLaag] = useState(false)
  const [alarmTab, setAlarmTab] = useState<AlarmTab>(startTab)
  const [zending, setZending] = useState<Location | null>(null)

  const open = useMemo(() => openAlarmen(alarmen), [alarmen])
  const laatsteBeweging = useMemo(() => {
    const m = new Map<string, StockMovement>()
    for (const b of bewegingen) {
      const huidig = m.get(b.itemId)
      if (!huidig || b.at > huidig.at) m.set(b.itemId, b)
    }
    return m
  }, [bewegingen])

  const perVestiging = useMemo(() => vestigingen.map((v) => {
    const mijn = items.filter((i) => i.locationId === v.id && i.actief !== false)
    const laag = mijn.filter((i) => i.stock < i.minStock)
    const op = mijn.filter((i) => i.stock <= 0)
    return { v, mijn, laag, op }
  }), [vestigingen, items])

  const actieveItems = useMemo(() => items.filter((i) => i.actief !== false), [items])
  const totaalLaag = actieveItems.filter((i) => i.stock < i.minStock).length
  const totaalOp = actieveItems.filter((i) => i.stock <= 0).length
  const vestigingenMetAlarm = new Set(open.map((a) => a.locationId)).size

  const naamVan = (id: string) => vestigingen.find((v) => v.id === id)?.name ?? 'Onbekende vestiging'

  async function gezien(alarm: VoorraadAlarm) {
    await markeerGezien(alarm, user)
    toast.ok(`Alarm voor ${alarm.itemNaam} op gezien gezet`)
  }

  async function inZendingZetten(item: InventoryItem) {
    try {
      const b = await inZending(item, bestellingen, regels, user)
      toast.ok(`${item.name} staat in concept ${b.nummer} voor ${naamVan(item.locationId)}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  /* ---------------------------- Een rij artikel ------------------- */

  /* Bewust als gewone functie aangeroepen (rijen(...)) en niet als <Rijen />:
     een component die binnen de render wordt gedefinieerd is voor React elke
     keer een nieuw type, en dan wordt de hele tabel bij elke wijziging opnieuw
     gemount -- met verlies van focus en scrollpositie. */
  function rijen({ lijst, metVestiging }: { lijst: InventoryItem[]; metVestiging: boolean }) {
    if (lijst.length === 0) return <Empty text="Geen artikelen gevonden." icon={<Package size={30} />} />
    return (
      <div className="table-wrap">
        <table className="data ts-tabel">
          <thead>
            <tr>
              <th>Artikel</th>
              {metVestiging && <th>Vestiging</th>}
              <th className="num">Stand</th>
              <th className="num">Minimum</th>
              <th className="num hide-mobile">Bestelhoev.</th>
              <th style={{ width: 150 }}>Status</th>
              <th className="hide-mobile">Laatste beweging</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lijst.map((i) => {
              const st = standStatus(i)
              const alarm = open.find((a) => a.itemId === i.id)
              const bew = laatsteBeweging.get(i.id)
              return (
                <tr key={i.id} className={st.label === 'Op' ? 'ts-rij-op' : st.label === 'Laag' ? 'ts-rij-laag' : ''}>
                  <td>
                    <div className="ts-artikelcel">
                      <Foto item={i} />
                      <div>
                        <strong>{i.name}</strong>
                        {i.sku && <div className="ts-sub mono">{i.sku}</div>}
                      </div>
                    </div>
                  </td>
                  {metVestiging && <td>{naamVan(i.locationId)}</td>}
                  <td className="num"><strong>{number(i.stock)}</strong> <span className="ts-sub">{i.unit}</span></td>
                  <td className="num ts-sub">{number(i.minStock)}</td>
                  <td className="num ts-sub hide-mobile">{i.bestelhoeveelheid ? number(i.bestelhoeveelheid) : '-'}</td>
                  <td>
                    <Bar value={i.stock} max={i.minStock * 2} tone={st.tone === 'danger' ? 'danger' : st.tone === 'warn' ? 'warn' : undefined} />
                    <div style={{ marginTop: 4 }}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {alarm?.gezienAt && <Badge>gezien</Badge>}
                    </div>
                  </td>
                  <td className="hide-mobile ts-sub">
                    {bew ? (
                      <>
                        <span style={{ color: bew.qty < 0 ? 'var(--warn)' : 'var(--ok)' }}>
                          {bew.qty > 0 ? '+' : ''}{number(bew.qty)}
                        </span>{' '}
                        {relative(bew.at)}
                        <div>{bew.reason}</div>
                      </>
                    ) : '-'}
                  </td>
                  <td className="ts-acties">
                    {alarm && !alarm.gezienAt && (
                      <button className="btn sm" onClick={() => void gezien(alarm)} title="Het alarm blijft uit de ochtendmail">
                        <Eye size={14} /> Gezien
                      </button>
                    )}
                    {magBestellen && (
                      <button className="btn sm primary" onClick={() => void inZendingZetten(i)} title="Toevoegen aan het concept voor deze vestiging">
                        <PackagePlus size={14} /> In zending
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  /* ---------------------------- Alarmen ---------------------------- */

  const alarmLijst = useMemo(() => {
    const lijst = alarmTab === 'open'
      ? open.filter((a) => !a.gezienAt)
      : alarmTab === 'gezien'
        ? open.filter((a) => !!a.gezienAt)
        : alarmen.filter((a) => !!a.opgelostAt).sort((a, b) => (b.opgelostAt ?? 0) - (a.opgelostAt ?? 0))
    return lijst.filter((a) => past(zoek, a.itemNaam, naamVan(a.locationId))).slice(0, 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmTab, open, alarmen, zoek, vestigingen])

  const alarmKaart = (
    <Card
      title="Alarmen"
      hint="Een alarm ontstaat als de stand onder het minimum zakt en verdwijnt als hij er weer boven komt"
      flush
      className="mt"
    >
      <div style={{ padding: '0 16px 12px' }}>
        <Tabs
          waarde={alarmTab}
          onChange={setAlarmTab}
          opties={[
            { key: 'open', label: 'Open', aantal: open.filter((a) => !a.gezienAt).length },
            { key: 'gezien', label: 'Gezien', aantal: open.filter((a) => !!a.gezienAt).length },
            { key: 'opgelost', label: 'Opgelost' },
          ]}
        />
      </div>
      {alarmLijst.length === 0 ? (
        <Empty
          text={alarmTab === 'open' ? 'Geen open alarmen. Alles staat op peil, of is gezien.' : 'Niets in deze lijst.'}
          icon={alarmTab === 'open' ? <BellOff size={30} /> : <Bell size={30} />}
        />
      ) : (
        <div className="table-wrap">
          <table className="data ts-tabel">
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Vestiging</th>
                <th className="num">Stand toen</th>
                <th className="num">Minimum</th>
                <th>Ontstaan</th>
                <th className="hide-mobile">{alarmTab === 'opgelost' ? 'Opgelost' : 'Gemaild'}</th>
                {alarmTab !== 'opgelost' && <th />}
              </tr>
            </thead>
            <tbody>
              {alarmLijst.map((a) => {
                const item = items.find((i) => i.id === a.itemId)
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="ts-artikelcel">
                        {item ? <Foto item={item} size={28} /> : null}
                        <div>
                          <strong>{a.itemNaam}</strong>
                          {item && <div className="ts-sub">nu {number(item.stock)} {item.unit}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <button className="ts-link" onClick={() => setGekozen(a.locationId)}>{naamVan(a.locationId)}</button>
                    </td>
                    <td className="num">{number(a.stand)}</td>
                    <td className="num ts-sub">{number(a.minimum)}</td>
                    <td className="ts-sub" title={dateTime(a.ontstaanAt)}>{relative(a.ontstaanAt)}</td>
                    <td className="ts-sub hide-mobile">
                      {alarmTab === 'opgelost'
                        ? (a.opgelostAt ? relative(a.opgelostAt) : '-')
                        : a.gemaildAt
                          ? <>direct {relative(a.gemaildAt)}{a.ochtendGemaildAt && ', in ochtendmail'}</>
                          : a.ochtendGemaildAt ? 'in ochtendmail' : 'nog niet'}
                    </td>
                    {alarmTab !== 'opgelost' && (
                      <td className="ts-acties">
                        {a.gezienAt ? (
                          <span className="ts-sub" title={a.gezienAt ? dateTime(a.gezienAt) : undefined}>
                            <Check size={13} /> {a.gezienDoorNaam ?? 'gezien'}
                          </span>
                        ) : (
                          <button className="btn sm" onClick={() => void gezien(a)}><Eye size={14} /> Gezien</button>
                        )}
                        {magBestellen && item && (
                          <button className="btn sm primary" onClick={() => void inZendingZetten(item)}>
                            <PackagePlus size={14} /> In zending
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )

  /* ---------------------------- Eén vestiging ---------------------- */

  if (gekozen) {
    const groep = perVestiging.find((p) => p.v.id === gekozen)
    const v = groep?.v
    const lijst = (groep?.mijn ?? [])
      .filter((i) => !alleenLaag || i.stock < i.minStock)
      .filter((i) => past(zoek, i.name, i.sku))
      .sort((a, b) => Number(b.stock < b.minStock) - Number(a.stock < a.minStock) || a.name.localeCompare(b.name, 'nl'))
    const concept = bestellingen.find((b) => b.locationId === gekozen && b.status === 'concept')

    return (
      <>
        <div className="ts-balk">
          <button className="btn sm" onClick={() => { setGekozen(null); setAlleenLaag(false) }}>
            <ArrowLeft size={14} /> Alle vestigingen
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{v?.name ?? 'Onbekende vestiging'}</h3>
            <div className="ts-sub">
              {v?.city}{groep ? ` · ${groep.mijn.length} artikelen` : ''}
              {groep && groep.laag.length > 0 && <>, <span style={{ color: 'var(--danger)' }}>{groep.laag.length} onder minimum</span></>}
              {concept && <> · concept {concept.nummer} staat open</>}
            </div>
          </div>
          <label className="ts-schakel">
            <input type="checkbox" checked={alleenLaag} onChange={(e) => setAlleenLaag(e.target.checked)} />
            Alleen onder minimum
          </label>
          {magBestellen && v && (
            <button className="btn primary sm" onClick={() => setZending(v)}>
              <PackagePlus size={14} /> Nieuwe zending
            </button>
          )}
        </div>
        <Zoekveld waarde={zoek} onChange={setZoek} placeholder="Artikel zoeken op deze vestiging…" />

        <Card flush>
          {rijen({ lijst, metVestiging: false })}
        </Card>

        <NieuweZending open={!!zending} locatie={zending} items={items} onClose={() => setZending(null)} />
      </>
    )
  }

  /* ---------------------------- Overzicht -------------------------- */

  const zoekResultaat = zoek.trim()
    ? actieveItems.filter((i) => past(zoek, i.name, i.sku, i.omschrijving, naamVan(i.locationId)))
      .sort((a, b) => Number(b.stock < b.minStock) - Number(a.stock < a.minStock) || a.name.localeCompare(b.name, 'nl'))
      .slice(0, 150)
    : null

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Artikelen" value={actieveItems.length} icon={<Package size={17} />} />
        <Stat label="Onder minimum" value={totaalLaag} icon={<TriangleAlert size={17} />} tone={totaalLaag ? 'danger' : 'ok'} />
        <Stat label="Helemaal op" value={totaalOp} icon={<TriangleAlert size={17} />} tone={totaalOp ? 'danger' : 'ok'} />
        <Stat label="Vestigingen met alarm" value={vestigingenMetAlarm} icon={<Building2 size={17} />} tone={vestigingenMetAlarm ? 'warn' : 'ok'} />
      </div>

      <Zoekveld waarde={zoek} onChange={setZoek} placeholder="Zoek een artikel over alle vestigingen…" />

      {zoekResultaat ? (
        <Card title="Gevonden" hint={`${zoekResultaat.length} ${zoekResultaat.length === 1 ? 'artikel' : 'artikelen'}`} flush>
          {rijen({ lijst: zoekResultaat, metVestiging: true })}
        </Card>
      ) : (
        <div className="ts-raster">
          {perVestiging.map(({ v, mijn, laag, op }) => {
            const toon = laag.length ? 'laag' : mijn.length ? 'goed' : 'leeg'
            return (
              <button
                key={v.id}
                className={`ts-vest ts-${toon} ${v.active ? '' : 'ts-uit'}`}
                onClick={() => setGekozen(v.id)}
              >
                <div className="ts-vest-kop">
                  <div>
                    <strong>{v.name}</strong>
                    <span className="ts-sub">{v.city}{v.active ? '' : ' · niet actief'}</span>
                  </div>
                  <span className={`ts-vest-getal ${laag.length ? 'rood' : ''}`}>{laag.length}</span>
                </div>
                <div className="ts-vest-voet">
                  <span>{mijn.length} {mijn.length === 1 ? 'artikel' : 'artikelen'}</span>
                  <span>{laag.length ? `${laag.length} onder minimum${op.length ? `, ${op.length} op` : ''}` : mijn.length ? 'alles op peil' : 'nog geen artikelen'}</span>
                </div>
                <Bar
                  value={mijn.length - laag.length}
                  max={Math.max(mijn.length, 1)}
                  tone={op.length ? 'danger' : laag.length ? 'warn' : undefined}
                />
              </button>
            )
          })}
          {perVestiging.length === 0 && (
            <Card><Empty text="Nog geen vestigingen gesynchroniseerd." icon={<Building2 size={30} />} /></Card>
          )}
        </div>
      )}

      {alarmKaart}

      {magBestellen && open.length > 0 && (
        <div className="ts-sub" style={{ marginTop: 10 }}>
          Alle open alarmen in één keer tot zendingen maken kan vanaf{' '}
          <button className="ts-link" onClick={() => goto('start')}>het startscherm</button>.
        </div>
      )}
    </>
  )
}
