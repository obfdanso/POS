// Mirrors the server's sale arithmetic (server/src/services/salesService.js) step for step,
// so the total shown at the till is exactly the amount the server will charge.

export const round2 = (n) => Math.round(n * 100) / 100

/** Line total after its discount: round(price × qty) − round(discount). */
export function lineTotal(price, quantity, discount = 0) {
  return round2(round2(parseFloat(price) * quantity) - round2(discount || 0))
}

/**
 * @param {{ price: number|string, quantity: number, discount?: number }[]} items
 * @param {number} cartDiscount
 * @param {number} taxRate - percentage, e.g. 3 for 3%
 */
export function calculateTotals(items, cartDiscount, taxRate) {
  const subtotal = items.reduce((sum, i) => round2(sum + lineTotal(i.price, i.quantity, i.discount)), 0)
  const discount = Math.min(round2(cartDiscount || 0), subtotal)
  const taxable = round2(subtotal - discount)
  const taxAmount = parseFloat((taxable * ((taxRate || 0) / 100)).toFixed(2))
  const total = parseFloat((taxable + taxAmount).toFixed(2))
  return { subtotal, discount, taxAmount, total }
}
