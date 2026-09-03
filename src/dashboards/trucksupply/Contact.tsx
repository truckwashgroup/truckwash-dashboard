import { useMemo, useState } from 'react'
import {
  Building2, Clock, LayoutGrid, List, Mail, MapPin, PackagePlus, Phone, TriangleAlert, User as UserIcon,
} from 'lucide-react'
import { adresRegel, nuOpen, tijdenInHetKort } from '../../lib/vestigingen'
import type { Location } from '../../lib/types'
import { Badge, Card, Empty } from '../../components/ui'
import { usePerms } from '../../store/useNav'
import { NieuweZending, Zoekveld, past, useArtikelen, useVestigingen } from './gedeeld'

/* ------------------------------------------------------------------ *
 *  Vestigingen -- voor wie erheen moet of moet bellen
 *
 *  Het management heeft zijn eigen vestigingenscherm, met aanmaken,
 *  foto's en de website. Dit is het adresboek van de leverancier: waar is
 *  het, is het nu open, wie is de manager, en hoe kom ik er. Elk gegeven is
 *  een link die iets doet -- het adres opent de route, het nummer belt.
 *  Op een telefoon in de bus is dat het verschil tussen één tik en overtikken.
 * ------------------------------------------------------------------ */

const ROUTE = (l: Location) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresRegel(l) || l.name)}`

export default function Contact() {
  const perms = usePerms()
  const magBestellen = perms.can('supply.orders')
  const vestigingen = useVestigingen()
  const items = useArtikelen()

  const [zoek, setZoek] = useState('')
  const [weergave, setWeergave] = useState<'kaarten' | 'lijst'>(() => {
    try { return (localStorage.getItem('ts.contact.weergave') as 'kaarten' | 'lijst') || 'kaarten' } catch { return 'kaarten' }
  })
  const [zending, setZending] = useState<Location | null>(null)

  function kiesWeergave(w: 'kaarten' | 'lijst') {
    setWeergave(w)
    try { localStorage.setItem('ts.contact.weergave', w) } catch { /* privémodus */ }
  }

  const laagPer = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) {
      if (i.actief === false || i.stock >= i.minStock) continue
      m.set(i.locationId, (m.get(i.locationId) ?? 0) + 1)
    }
    return m
  }, [items])

  const lijst = vestigingen.filter((v) => past(zoek, v.name, v.city, v.address, v.postcode, v.managerName, v.phone, v.email))

  function Open({ l }: { l: Location }) {
    const open = nuOpen(l)
    if (open === null) return <Badge>tijden onbekend</Badge>
    return open ? <Badge tone="ok" dot>nu open</Badge> : <Badge tone="warn" dot>nu dicht</Badge>
  }

  return (
    <>
      <Zoekveld waarde={zoek} onChange={setZoek} placeholder="Zoek op plaats, naam, manager of telefoon…">
        <div className="ts-tabs">
          <button className={`ts-tab ${weergave === 'kaarten' ? 'actief' : ''}`} onClick={() => kiesWeergave('kaarten')} title="Kaarten"><LayoutGrid size={14} /></button>
          <button className={`ts-tab ${weergave === 'lijst' ? 'actief' : ''}`} onClick={() => kiesWeergave('lijst')} title="Lijst"><List size={14} /></button>
        </div>
      </Zoekveld>

      {lijst.length === 0 ? (
        <Card><Empty text="Geen vestiging gevonden." icon={<Building2 size={30} />} /></Card>
      ) : weergave === 'kaarten' ? (
        <div className="ts-raster">
          {lijst.map((l) => {
            const laag = laagPer.get(l.id) ?? 0
            return (
              <div key={l.id} className={`ts-contact ${l.active ? '' : 'ts-uit'}`}>
                <div className="ts-vest-kop">
                  <div>
                    <strong>{l.name}</strong>
                    <span className="ts-sub">{l.kind === 'hoofdkantoor' ? 'Hoofdkantoor' : l.city}{l.active ? '' : ' · niet actief'}</span>
                  </div>
                  <Open l={l} />
                </div>
                <div className="ts-contactblok">
                  <a href={ROUTE(l)} target="_blank" rel="noreferrer" title="Route in Google Maps">
                    <MapPin size={14} /> {adresRegel(l) || 'Geen adres bekend'}
                  </a>
                  {l.phone
                    ? <a href={`tel:${l.phone.replace(/\s/g, '')}`}><Phone size={14} /> {l.phone}</a>
                    : <span className="ts-sub"><Phone size={14} /> Geen telefoon bekend</span>}
                  {l.email && <a href={`mailto:${l.email}`}><Mail size={14} /> {l.email}</a>}
                  <span><UserIcon size={14} /> {l.managerName ?? <span className="ts-sub">Geen manager ingevuld</span>}</span>
                  <span className="ts-sub"><Clock size={14} /> {tijdenInHetKort(l.openingHours)}</span>
                </div>
                <div className="ts-vest-voet">
                  <span className={laag ? 'ts-rood' : ''}>
                    {laag ? <><TriangleAlert size={13} /> {laag} onder minimum</> : 'voorraad op peil'}
                  </span>
                  {magBestellen && l.active && (
                    <button className="btn sm primary" onClick={() => setZending(l)}>
                      <PackagePlus size={14} /> Nieuwe zending
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="data ts-tabel">
              <thead>
                <tr>
                  <th>Vestiging</th>
                  <th>Adres</th>
                  <th className="hide-mobile">Telefoon</th>
                  <th className="hide-mobile">Manager</th>
                  <th>Nu</th>
                  <th className="num">Onder min.</th>
                  {magBestellen && <th />}
                </tr>
              </thead>
              <tbody>
                {lijst.map((l) => {
                  const laag = laagPer.get(l.id) ?? 0
                  return (
                    <tr key={l.id} className={l.active ? '' : 'ts-rij-uit'}>
                      <td><strong>{l.name}</strong><div className="ts-sub">{l.city}</div></td>
                      <td><a className="ts-link" href={ROUTE(l)} target="_blank" rel="noreferrer">{adresRegel(l) || '-'}</a></td>
                      <td className="hide-mobile">{l.phone ? <a className="ts-link" href={`tel:${l.phone.replace(/\s/g, '')}`}>{l.phone}</a> : '-'}</td>
                      <td className="hide-mobile">{l.managerName ?? '-'}</td>
                      <td><Open l={l} /></td>
                      <td className={`num ${laag ? 'ts-rood' : ''}`}>{laag || '-'}</td>
                      {magBestellen && (
                        <td className="ts-acties">
                          {l.active && <button className="btn sm" onClick={() => setZending(l)}><PackagePlus size={14} /> Zending</button>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <NieuweZending open={!!zending} locatie={zending} items={items} onClose={() => setZending(null)} />
    </>
  )
}
