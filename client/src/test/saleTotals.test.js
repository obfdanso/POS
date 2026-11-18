import { describe, it, expect } from 'vitest'
import { calculateTotals, lineTotal } from '../utils/saleTotals'

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
    expect(totals).toEqual({ subtotal: 14, discount: 2, taxAmount: 1.2, total: 13.2 })
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
})
