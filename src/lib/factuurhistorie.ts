/* ------------------------------------------------------------------ *
 *  De historie van een factuur
 *
 *  Een bon los beoordelen is lastiger dan het lijkt. Is €1.240 voor Enexis
 *  veel? Dat weet je pas als je weet dat het de vorige vier keer rond de
 *  €400 was. Dan is dit geen bedrag maar een vraag.
 *
 *  Daarom komt bij elke factuur de reeks van dezelfde leverancier mee: wat er
 *  eerder is geboekt, op welke rekening, en of dit bedrag daarbij past.
 *
 *  Twee dingen die dit met opzet niet doet
 *  ---------------------------------------
 *
 *  Het keurt niets af. Een factuur die vier keer zo hoog is als de vorige kan
 *  volkomen terecht zijn -- een jaarafrekening, een nieuwe installatie. Er
 *  staat alleen dát het afwijkt, niet dat het fout is.
 *
 *  En het rekent niet met één vorige factuur. Twee bedragen naast elkaar
 *  leggen levert bij maandfacturen elke zomer een alarm op. De mediaan van de
 *  reeks is stabieler, en die vraagt om minstens drie eerdere bonnen.
 * ------------------------------------------------------------------ */

import type { Expense } from './types'

/** Hoeveel eerdere facturen we tonen. Meer wordt een tabel die niemand leest. */
const TOON = 6

/** Onder dit aantal eerdere bonnen zegt een afwijking niets. */
const GENOEG = 3

/** Vanaf hoeveel keer de mediaan het het melden waard is. */
const OPVALLEND = 1.75

export interface Historie {
  /** Eerdere facturen van dezelfde leverancier, nieuwste eerst. */
  eerder: Expense[]
  /** Het gebruikelijke bedrag, als er genoeg te vergelijken valt. */
  gebruikelijk?: number
  /** Waarom dit bedrag opvalt, in één zin. Leeg als het niets bijzonders is. */
  opmerking?: string
  /** Een eerdere bon met hetzelfde factuurnummer -- dan is dit een dubbele. */
  dubbel?: Expense
}

/**
 * Dezelfde leverancier, ongeacht hoe hij is geschreven.
 *
 * "Enexis Netbeheer B.V." en "ENEXIS NETBEHEER BV" zijn dezelfde partij, en
 * een historie die daarop struikelt is bij elke tweede factuur leeg. De
 * rechtsvorm gaat eraf en de rest wordt kleingeschreven.
 */
export function leveranciersleutel(naam: string): string {
  return (naam || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(b\s*v|n\s*v|v\s*o\s*f|c\s*v|gmbh|ltd|inc|holding)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** De middelste waarde. Ongevoelig voor die ene jaarafrekening. */
function mediaan(getallen: number[]): number | undefined {
  const op = [...getallen].sort((a, b) => a - b)
  if (!op.length) return undefined
  const midden = Math.floor(op.length / 2)
  return op.length % 2 ? op[midden] : (op[midden - 1] + op[midden]) / 2
}

export function historieVan(bon: Expense, alle: Expense[]): Historie {
  const sleutel = leveranciersleutel(bon.supplier)
  if (!sleutel) return { eerder: [] }

  const zelfde = alle
    .filter((e) => e.id !== bon.id && leveranciersleutel(e.supplier) === sleutel)
    .sort((a, b) => b.date - a.date)

  const uit: Historie = { eerder: zelfde.slice(0, TOON) }

  /*
   * Hetzelfde factuurnummer van dezelfde leverancier. Dat is geen aanwijzing
   * maar een feit: die rekening staat er al. Gebeurt vaker dan je zou denken
   * -- een leverancier stuurt een herinnering met de factuur er nog eens bij,
   * en die komt op hetzelfde inkoopadres binnen.
   */
  if (bon.factuurnummer) {
    uit.dubbel = zelfde.find((e) => e.factuurnummer === bon.factuurnummer)
  }

  /*
   * Alleen goedgekeurde bonnen tellen mee voor "gebruikelijk". Een open bon
   * is nog niemands oordeel, en een afgekeurde is juist het tegendeel.
   */
  const bedragen = zelfde
    .filter((e) => e.status === 'goedgekeurd' && e.amountExcl > 0)
    .slice(0, 12)
    .map((e) => e.amountExcl)

  if (bedragen.length >= GENOEG) {
    const midden = mediaan(bedragen)
    if (midden && midden > 0) {
      uit.gebruikelijk = midden
      if (bon.amountExcl > 0) {
        const keer = bon.amountExcl / midden
        if (keer >= OPVALLEND) {
          uit.opmerking = `Dit is ruim ${keer.toFixed(1)}× het gebruikelijke bedrag `
            + `van deze leverancier. Dat kan kloppen — een jaarafrekening of een `
            + `eenmalige levering — maar kijk het na.`
        } else if (keer <= 1 / OPVALLEND) {
          uit.opmerking = 'Dit is een stuk lager dan gebruikelijk bij deze '
            + 'leverancier. Vaak is dat een deelfactuur of een creditnota.'
        }
      }
    }
  }

  return uit
}
