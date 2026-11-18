import { round2 } from './saleTotals'

/**
 * The amount the server will refund for a return (mirrors processRefund in
 * server/src/services/salesService.js): each returned unit's share of what was paid, after the
 * cart discount and including tax, and exactly what is left when everything remaining is returned.
 * @param {{ total_amount, subtotal, refunded_amount?, items: { id, quantity, total, refunded_quantity? }[] }} sale
 * @param {Record<string, number>} quantities - units to return, by sale item id
 * @returns {number}
 */
export function estimateRefund(sale, quantities) {
  const total = parseFloat(sale.total_amount)
  const subtotal = parseFloat(sale.subtotal)
  const alreadyRefunded = parseFloat(sale.refunded_amount || 0)
  const unitsLeft = sale.items.reduce((n, i) => n + i.quantity - (i.refunded_quantity || 0), 0)
  const returning = sale.items.reduce((n, i) => n + (quantities[i.id] || 0), 0)
  if (returning === 0) return 0
  if (returning === unitsLeft) return round2(total - alreadyRefunded)
  const amount = sale.items.reduce((sum, i) => {
    const q = quantities[i.id] || 0
    if (!q || subtotal <= 0) return sum
    return sum + round2((total * ((parseFloat(i.total) * q) / i.quantity)) / subtotal)
  }, 0)
  return Math.min(round2(amount), round2(total - alreadyRefunded))
}
