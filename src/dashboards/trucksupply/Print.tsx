import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { printvel, type Printvel } from '../../lib/trucksupply'
import type { Bestelling, Bestelregel, InventoryItem, Location } from '../../lib/types'
import { Field, Modal } from '../../components/ui'

/* ------------------------------------------------------------------ *
 *  Pakbon en verzendlabel
 *
 *  Twee vellen die uit de printer moeten komen als een zending de deur
 *  uitgaat. De pakbon gaat in de doos: wat erin zit, zonder prijzen -- de
 *  vestiging hoeft niet te weten wat Trucksupply rekent, en de wasser die
 *  de doos openmaakt al helemaal niet. Het label gaat op de doos: groot
 *  het adres, groot het nummer, en een QR met datzelfde nummer voor wie
 *  later wil weten welke doos dit was.
 *
 *  Het printen loopt via window.print() met een stylesheet die alleen het
 *  vel laat zien (.ts-printvel in trucksupply.css), zoals de QR-labels van
 *  de installaties dat doen. Geen PDF-bibliotheek: de browser kan dit zelf
 *  en dan drukt het ook op een telefoon.
 * ------------------------------------------------------------------ */

function aantalTekst(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

/** Een QR-code als svg, uit de bibliotheek die de installatielabels ook gebruiken. */
export function QrCode({ tekst, size = 120 }: { tekst: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    void (async () => {
      const QRCode = await import('qrcode')
      const uit = await QRCode.toString(tekst, {
        type: 'svg', margin: 0, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      })
      if (alive) setSvg(uit)
    })()
    return () => { alive = false }
  }, [tekst])
  return (
    <div
      className="ts-qr"
      style={{ width: size, height: size }}
      // De inhoud komt uit de QR-bibliotheek, niet uit invoer van een
      // gebruiker: het is altijd een <svg> met alleen paden.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/* ------------------------------ Pakbon ---------------------------- */

export function Pakbon({ vel }: { vel: Printvel }) {
  const o = vel.ontvanger
  return (
    <div className="ts-printvel ts-pakbon">
      <header className="ts-pakbon-kop">
        <div>
          <div className="ts-pakbon-merk">Truckwash 1 Group</div>
          <h1>Pakbon</h1>
        </div>
        <div className="ts-pakbon-nummer">
          <div className="ts-groot">{vel.nummer}</div>
          <div>Datum {vel.datum}</div>
        </div>
      </header>

      <section className="ts-pakbon-adressen">
        <div>
          <div className="ts-kopje">Leverancier</div>
          <strong>{vel.afzender}</strong>
        </div>
        <div>
          <div className="ts-kopje">Bestemming</div>
          <strong>{o.naam}</strong>
          {o.adres && <div>{o.adres}</div>}
          {(o.postcode || o.plaats) && <div>{[o.postcode, o.plaats].filter(Boolean).join(' ')}</div>}
          {o.telefoon && <div>{o.telefoon}</div>}
        </div>
      </section>

      <table className="ts-pakbon-tabel">
        <thead>
          <tr>
            <th>Artikel</th>
            <th>Artikelnr.</th>
            <th className="num">Aantal</th>
            <th>Eenheid</th>
            <th className="vak">Geleverd</th>
          </tr>
        </thead>
        <tbody>
          {vel.regels.map((r, i) => (
            <tr key={i}>
              <td>{r.naam}</td>
              <td className="mono">{r.sku ?? ''}</td>
              <td className="num">{aantalTekst(r.aantal)}</td>
              <td>{r.eenheid}</td>
              <td className="vak"><span className="ts-hokje" /></td>
            </tr>
          ))}
          {vel.regels.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center' }}>(geen regels)</td></tr>
          )}
        </tbody>
      </table>

      {vel.opmerking && (
        <section className="ts-pakbon-opmerking">
          <div className="ts-kopje">Opmerking</div>
          <div>{vel.opmerking}</div>
        </section>
      )}
      {(vel.vervoerder || vel.trackTrace) && (
        <section className="ts-pakbon-opmerking">
          <div className="ts-kopje">Verzending</div>
          <div>
            {vel.vervoerder ?? '-'}
            {vel.trackTrace && <> · {vel.trackTrace}</>}
          </div>
        </section>
      )}

      <footer className="ts-pakbon-voet">
        <div className="ts-tekenregel">
          <span>Ontvangen door</span>
          <span className="lijn" />
        </div>
        <div className="ts-tekenregel">
          <span>Datum</span>
          <span className="lijn" />
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------ Verzendlabel ---------------------- */

export function Verzendlabel({ vel, colli }: { vel: Printvel; colli: string }) {
  const o = vel.ontvanger
  // Op de doos hoort groot 'Truckwash 1 <plaats>': de chauffeur zoekt de
  // wasstraat, niet de interne naam van de vestiging. Heet de vestiging al zo,
  // dan niet nog eens ervoor.
  const aan = /^truckwash/i.test(o.naam) ? o.naam : `Truckwash 1 ${o.plaats || o.naam}`
  return (
    <div className="ts-printvel ts-label">
      <div className="ts-label-aan">
        <div className="ts-kopje">Aan</div>
        <div className="ts-label-naam">{aan}</div>
        {!/^truckwash/i.test(o.naam) && !!o.plaats && <div className="ts-label-adres">{o.naam}</div>}
        {o.adres && <div className="ts-label-adres">{o.adres}</div>}
        {(o.postcode || o.plaats) && (
          <div className="ts-label-adres">{[o.postcode, o.plaats].filter(Boolean).join(' ')}</div>
        )}
        {o.telefoon && <div className="ts-label-tel">{o.telefoon}</div>}
      </div>

      <div className="ts-label-midden">
        <QrCode tekst={vel.nummer} size={112} />
        <div>
          <div className="ts-kopje">Bestelnummer</div>
          <div className="ts-label-nummer">{vel.nummer}</div>
          <div className="ts-label-colli">
            {colli.trim() ? `Colli ${colli.trim()}` : 'Colli 1/1'}
          </div>
        </div>
      </div>

      <div className="ts-label-voet">
        <div>
          <div className="ts-kopje">Van</div>
          <div>{vel.afzender} · Truckwash 1 Group</div>
        </div>
        <div>{vel.datum}</div>
      </div>
    </div>
  )
}

/* ------------------------------ Het printvenster ------------------ */

export type PrintSoort = 'pakbon' | 'label'

export function PrintModal({
  soort, bestelling, regels, locatie, items, onClose,
}: {
  soort: PrintSoort | null
  bestelling: Bestelling | null
  regels: Bestelregel[]
  locatie?: Location
  items: InventoryItem[]
  onClose: () => void
}) {
  const [colli, setColli] = useState('1/1')
  const vel = useMemo(
    () => bestelling ? printvel(bestelling, regels, locatie, items) : null,
    [bestelling, regels, locatie, items])

  const open = !!soort && !!vel
  return (
    <Modal
      open={open}
      title={soort === 'label' ? 'Verzendlabel' : 'Pakbon'}
      subtitle={soort === 'label'
        ? 'A6 staand, 105 × 148 mm. Kies dat formaat in het printvenster, of druk op A4 en knip.'
        : 'A4. Zonder prijzen: dit gaat in de doos, naar de vestiging.'}
      onClose={onClose}
      width={soort === 'label' ? 520 : 820}
    >
      {vel && soort === 'label' && (
        <Field label="Aantal colli" help="Komt op het label, bijvoorbeeld 1/2 en 2/2 als het twee dozen zijn.">
          <input className="input sm" value={colli} onChange={(e) => setColli(e.target.value)} style={{ width: 120 }} />
        </Field>
      )}
      <div className="ts-printkader">
        {vel && soort === 'pakbon' && <Pakbon vel={vel} />}
        {vel && soort === 'label' && <Verzendlabel vel={vel} colli={colli} />}
      </div>
      <div className="row end" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Sluiten</button>
        <button className="btn primary" onClick={() => window.print()}>
          <Printer size={15} /> Afdrukken
        </button>
      </div>
    </Modal>
  )
}
