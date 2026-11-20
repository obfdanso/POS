// Mirrors the server's sale arithmetic (server/src/services/salesService.js) step for step,
// so the total shown at the till is exactly the amount the server will charge.
import type { MoneyLike } from '../types'

/** What bestPromotion needs from a promotion (an ActivePromotion from the API fits) */
export interface PromotionRule {
  product_id?: string | null
  category_id?: string | null
  percent_off: MoneyLike
}

/** What bestPromotion needs from a cart line */
export interface PromotionTarget {
  product_id: string
  category_id?: string | null
}

/** A cart line before pricing: the product's price, the quantity and the cashier's discount */
export interface CartLineInput extends PromotionTarget {
  price: MoneyLike
  quantity: number
  discount?: number | null
}

/** A line priced by applyPromotions */
export type PricedLine<I extends CartLineInput, P extends PromotionRule> = I & {
  /** The cashier's part of the discount, capped at what is left after the promotion */
  discount: number
  promotion: P | null
  promotion_discount: number
  /** Promotion plus cashier discount */
  line_discount: number
}

/** A line calculateTotals can add up */
export interface TotalsLine {
  price: MoneyLike
  quantity: number
  discount?: number | null
  line_discount?: number
}

export interface CartTotals {
  subtotal: number
  discount: number
  pointsDiscount: number
  taxAmount: number
  total: number
}

// Half-up to 2 decimals; EPSILON stops values like 1.005 (stored as 1.00499…) rounding down
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Line total after its discount: round(price × qty) − round(discount). */
export function lineTotal(price: MoneyLike, quantity: number, discount: number | null | undefined = 0): number {
  return round2(round2(parseFloat(String(price)) * quantity) - round2(discount || 0))
}

const specificity = (p: PromotionRule): number => (p.product_id ? 2 : p.category_id ? 1 : 0)

/**
 * The running promotion for an item: the biggest percentage off that applies to its product, its
 * category, or the whole store; on a tie the most specific. Same rule as the server's
 * bestPromotionFor (server/src/services/promotionService.js).
 */
export function bestPromotion<P extends PromotionRule>(item: PromotionTarget, promotions: P[] = []): P | null {
  let best: P | null = null
  for (const p of promotions) {
    const applies = p.product_id ? p.product_id === item.product_id : p.category_id ? p.category_id === item.category_id : true
    if (!applies) continue
    const pct = Number(p.percent_off)
    const bestPct = best ? Number(best.percent_off) : -1
    if (pct > bestPct || (best && pct === bestPct && specificity(p) > specificity(best))) best = p
  }
  return best
}

/**
 * Prices each cart line the way the server will: the promotion comes off first, then the cashier's
 * discount (`discount`), capped at what is left. Adds `promotion`, `promotion_discount` and
 * `line_discount` (both together); `discount` stays the cashier's part, which is what the API takes.
 */
export function applyPromotions<I extends CartLineInput, P extends PromotionRule>(items: I[], promotions: P[] = []): PricedLine<I, P>[] {
  return items.map((i) => {
    const gross = round2(parseFloat(String(i.price)) * i.quantity)
    const promotion = bestPromotion(i, promotions)
    const promotionDiscount = promotion ? round2((gross * Number(promotion.percent_off)) / 100) : 0
    const manual = Math.min(round2(i.discount || 0), round2(gross - promotionDiscount))
    return { ...i, discount: manual, promotion, promotion_discount: promotionDiscount, line_discount: round2(promotionDiscount + manual) }
  })
}

/**
 * @param items - Lines from applyPromotions use `line_discount` (promotion plus cashier discount)
 * @param cartDiscount
 * @param taxRate - percentage, e.g. 3 for 3%
 * @param pointsDiscount - value of loyalty points redeemed, applied after the cart discount
 */
export function calculateTotals(
  items: TotalsLine[],
  cartDiscount: number | null | undefined,
  taxRate: number | null | undefined,
  pointsDiscount: number | null | undefined = 0
): CartTotals {
  const subtotal = items.reduce((sum, i) => round2(sum + lineTotal(i.price, i.quantity, i.line_discount ?? i.discount)), 0)
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
export function maxRedeemablePoints(
  subtotal: number,
  discount: number | null | undefined,
  balance: number | null | undefined,
  pointValue: number
): number {
  if (!(pointValue > 0)) return 0
  const coverable = Math.floor(round2(subtotal - (discount || 0)) / pointValue + 1e-9)
  return Math.max(0, Math.min(balance || 0, coverable))
}
