// Mirrors the server's sale arithmetic (server/src/services/salesService.js) step for step,
// so the total shown at the till is exactly the amount the server will charge.

// Half-up to 2 decimals; EPSILON stops values like 1.005 (stored as 1.00499…) rounding down
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Line total after its discount: round(price × qty) − round(discount). */
export function lineTotal(price, quantity, discount = 0) {
  return round2(round2(parseFloat(price) * quantity) - round2(discount || 0))
}

/**
 * @param {{ price: number|string, quantity: number, discount?: number }[]} items
 * @param {number} cartDiscount
 * @param {number} taxRate - percentage, e.g. 3 for 3%
 * @param {number} [pointsDiscount] - value of loyalty points redeemed, applied after the cart discount
 */
export function calculateTotals(items, cartDiscount, taxRate, pointsDiscount = 0) {
  const subtotal = items.reduce((sum, i) => round2(sum + lineTotal(i.price, i.quantity, i.discount)), 0)
  const discount = Math.min(round2(cartDiscount || 0), subtotal)
  const points = Math.min(round2(pointsDiscount || 0), round2(subtotal - discount))
  const taxable = round2(subtotal - round2(discount + points))
  const taxAmount = round2(taxable * ((taxRate || 0) / 100))
  const total = round2(taxable + taxAmount)
  return { subtotal, discount, pointsDiscount: points, taxAmount, total }
}

/**
 * The most points a customer can spend on this cart: limited by their balance and by what is
 * left after discounts (the server rejects points worth more than that). 0 when redemption is off.
 */
export function maxRedeemablePoints(subtotal, discount, balance, pointValue) {
  if (!(pointValue > 0)) return 0
  const coverable = Math.floor(round2(subtotal - (discount || 0)) / pointValue + 1e-9)
  return Math.max(0, Math.min(balance || 0, coverable))
}
