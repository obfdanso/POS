import type { PurchaseOrderStatus } from '../types'
import { round2 } from './saleTotals'

export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; variant: 'primary' | 'warning' | 'success' | 'default' }> = {
  ORDERED: { label: 'Ordered', variant: 'primary' },
  PARTIALLY_RECEIVED: { label: 'Part received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'default' },
}

/** An order line as typed into the form (inputs give strings) or loaded from the API */
export interface OrderLineInput {
  quantity: string | number
  unit_cost: string | number
}

/** Order total as the server computes it: Σ quantity × unit cost (each cost rounded to the pesewa). */
export function orderTotal(lines: OrderLineInput[]): number {
  return round2(lines.reduce((sum, l) => sum + (parseInt(String(l.quantity), 10) || 0) * round2(parseFloat(String(l.unit_cost)) || 0), 0))
}
