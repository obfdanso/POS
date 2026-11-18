import { describe, it, expect } from 'vitest'
import { calculateTotals, lineTotal, maxRedeemablePoints, applyPromotions, bestPromotion } from '../utils/saleTotals'

describe('calculateTotals (must match the server)', () => {
  it('rounds the way the server does', () => {
    // 3 × 13.20 with a 0.10 cart discount at 3% tax: the server charges 40.69
    expect(calculateTotals([{ price: '13.2', quantity: 3 }], 0.1, 3).total).toBe(40.69)
  })

  it('applies line discounts, cart discount, then tax', () => {
    const totals = calculateTotals(
      [
        { price: 4.5, quantity: 2, discount: 1 },
        { price: '6', quantity: 1 },
      ],
      2,
      10
    )
    expect(totals).toEqual({ subtotal: 14, discount: 2, pointsDiscount: 0, taxAmount: 1.2, total: 13.2 })
  })

  it('never lets the cart discount exceed the subtotal', () => {
    expect(calculateTotals([{ price: 5, quantity: 1 }], 50, 3)).toMatchObject({ discount: 5, total: 0 })
  })

  it('rounds half a pesewa of tax up', () => {
    // 8.04 × 12.5% = 1.005 exactly, which is stored as 1.00499… in floating point
    expect(calculateTotals([{ price: '8.04', quantity: 1 }], 0, 12.5)).toMatchObject({ taxAmount: 1.01, total: 9.05 })
  })

  it('computes a line total from string prices', () => {
    expect(lineTotal('2.35', 3, 0.05)).toBe(7)
  })

  it('takes redeemed points off after the cart discount and before tax', () => {
    // 50 − 5 discount − 10 in points = 35, plus 10% tax: the server charges 38.50
    expect(calculateTotals([{ price: 10, quantity: 5 }], 5, 10, 10)).toMatchObject({ pointsDiscount: 10, taxAmount: 3.5, total: 38.5 })
  })

  it('never lets points take the total below zero', () => {
    expect(calculateTotals([{ price: 10, quantity: 1 }], 4, 0, 50)).toMatchObject({ pointsDiscount: 6, total: 0 })
  })
})

describe('maxRedeemablePoints', () => {
  it('is limited by the balance and by what is left to pay', () => {
    expect(maxRedeemablePoints(50, 0, 120, 0.1)).toBe(120)
    expect(maxRedeemablePoints(50, 45, 120, 0.1)).toBe(50) // 5 left at 0.10 a point
    expect(maxRedeemablePoints(0.3, 0, 10, 0.1)).toBe(3) // 0.3 / 0.1 is 2.999… in floating point
  })

  it('is 0 when redemption is off', () => {
    expect(maxRedeemablePoints(50, 0, 120, 0)).toBe(0)
  })
})

describe('promotions (must match the server)', () => {
  const promos = [
    { id: 'drinks', category_id: 'cat-drinks', product_id: null, percent_off: 10 },
    { id: 'cola', product_id: 'cola', category_id: null, percent_off: 25 },
    { id: 'store', product_id: null, category_id: null, percent_off: 5 },
  ]

  it('picks the biggest promotion that applies', () => {
    expect(bestPromotion({ product_id: 'cola', category_id: 'cat-drinks' }, promos).id).toBe('cola')
    expect(bestPromotion({ product_id: 'juice', category_id: 'cat-drinks' }, promos).id).toBe('drinks')
    expect(bestPromotion({ product_id: 'chips', category_id: 'cat-snacks' }, promos).id).toBe('store')
    expect(bestPromotion({ product_id: 'chips', category_id: 'cat-snacks' }, [])).toBeNull()
  })

  it('prefers the more specific promotion on a tie', () => {
    const tie = [{ id: 'store', percent_off: 10 }, { id: 'cat', category_id: 'c', percent_off: 10 }]
    expect(bestPromotion({ product_id: 'x', category_id: 'c' }, tie).id).toBe('cat')
  })

  it('takes the promotion off first, then the cashier discount, matching the server', () => {
    // Same sale as the server test: 2 colas at 10 with a 1.00 discount, and a juice at 7.99
    const [cola, juice] = applyPromotions(
      [
        { product_id: 'cola', category_id: 'cat-drinks', price: 10, quantity: 2, discount: 1 },
        { product_id: 'juice', category_id: 'cat-drinks', price: '7.99', quantity: 1 },
      ],
      promos
    )
    expect(cola).toMatchObject({ promotion_discount: 5, discount: 1, line_discount: 6 })
    expect(juice.promotion_discount).toBe(0.8)
    expect(calculateTotals([cola, juice], 0, 0).subtotal).toBe(21.19) // 14 + 7.19
  })

  it('caps the cashier discount at what is left after the promotion', () => {
    const [line] = applyPromotions([{ product_id: 'cola', price: 10, quantity: 1, discount: 9 }], promos)
    expect(line).toMatchObject({ promotion_discount: 2.5, discount: 7.5, line_discount: 10 })
  })
})

