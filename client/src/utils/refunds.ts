import type { MoneyLike } from '../types'
import { round2 } from './saleTotals'

/** What estimateRefund reads from a sale (an API Sale with its items fits) */
export interface RefundableSale {
  total_amount: MoneyLike
  subtotal: MoneyLike
  refunded_amount?: MoneyLike | null
  items: { id: string; quantity: number; total: MoneyLike; refunded_quantity?: number }[]
}

/**
 * The amount the server will refund for a return (mirrors processRefund in
 * server/src/services/salesService.js): each returned unit's share of what was paid, after the
 * cart discount and including tax, and exactly what is left when everything remaining is returned.
 * @param quantities - units to return, by sale item id
 */
export function estimateRefund(sale: RefundableSale, quantities: Record<string, number>): number {
  const total = parseFloat(String(sale.total_amount))
  const subtotal = parseFloat(String(sale.subtotal))
  const alreadyRefunded = parseFloat(String(sale.refunded_amount || 0))
  const unitsLeft = sale.items.reduce((n, i) => n + i.quantity - (i.refunded_quantity || 0), 0)
  const returning = sale.items.reduce((n, i) => n + (quantities[i.id] || 0), 0)
  if (returning === 0) return 0
  if (returning === unitsLeft) return round2(total - alreadyRefunded)
  const amount = sale.items.reduce((sum, i) => {
    const q = quantities[i.id] || 0
    if (!q || subtotal <= 0) return sum
    return sum + round2((total * ((parseFloat(String(i.total)) * q) / i.quantity)) / subtotal)
  }, 0)
  return Math.min(round2(amount), round2(total - alreadyRefunded))
}
