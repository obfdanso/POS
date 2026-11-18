import { describe, it, expect } from 'vitest'
import { estimateRefund } from '../utils/refunds'

// 3 pens at 10 + 1 book at 20 = 50, less a 5 cart discount = 45 paid
const sale = {
  total_amount: '45.00',
  subtotal: '50.00',
  refunded_amount: '0.00',
  items: [
    { id: 'pen', quantity: 3, total: '30.00', refunded_quantity: 0 },
    { id: 'book', quantity: 1, total: '20.00', refunded_quantity: 0 },
  ],
}

describe('estimateRefund (must match the server)', () => {
  it('refunds each unit at its share of what was paid', () => {
    expect(estimateRefund(sale, { pen: 1 })).toBe(9)
    expect(estimateRefund(sale, { pen: 1, book: 1 })).toBe(27)
  })

  it('is zero when nothing is selected', () => {
    expect(estimateRefund(sale, {})).toBe(0)
  })

  it('refunds exactly what is left when everything remaining is returned', () => {
    const partly = {
      ...sale,
      total_amount: '9.98',
      subtotal: '9.99',
      refunded_amount: '6.66',
      items: [{ id: 'x', quantity: 3, total: '9.99', refunded_quantity: 2 }],
    }
    expect(estimateRefund(partly, { x: 1 })).toBe(3.32)
  })
})
