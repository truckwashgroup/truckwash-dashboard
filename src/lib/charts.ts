/**
 * Gedeelde grafiekstijl, zodat alle dashboards dezelfde kleuren en assen
 * gebruiken. Begint met het merkgeel en loopt daarna door koele tinten,
 * zodat reeksen naast elkaar te onderscheiden blijven.
 */

export const PALETTE = [
  '#f8c010', // merkgeel
  '#58b6f5', // lucht
  '#45e2c4', // mint
  '#b48bff', // paars
  '#f4685f', // rood
  '#8ea3c4', // grijsblauw
]

export const BRAND = PALETTE[0]
export const COOL = PALETTE[1]

export const axis = { stroke: '#6b7d9e', fontSize: 11 }

export const gridStroke = '#1a2740'

export const tooltipStyle = {
  background: '#16223a',
  border: '1px solid #22314f',
  borderRadius: 10,
  fontSize: 12,
  color: '#e8eefc',
}

export const hoverFill = { fill: 'rgba(255,255,255,.04)' }
