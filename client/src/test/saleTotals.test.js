import { describe, it, expect } from 'vitest'
import { calculateTotals, lineTotal, maxRedeemablePoints } from '../utils/saleTotals'

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
