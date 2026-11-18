import { round2 } from './saleTotals'

export const PO_STATUS = {
  ORDERED: { label: 'Ordered', variant: 'primary' },
  PARTIALLY_RECEIVED: { label: 'Part received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'default' },
}

/** Order total as the server computes it: Σ quantity × unit cost (each cost rounded to the pesewa). */
export function orderTotal(lines) {
  return round2(lines.reduce((sum, l) => sum + (parseInt(l.quantity, 10) || 0) * round2(parseFloat(l.unit_cost) || 0), 0))
}
