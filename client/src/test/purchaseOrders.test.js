import { describe, it, expect } from 'vitest'
import { orderTotal } from '../utils/purchaseOrders'

describe('orderTotal (must match the server)', () => {
  it('adds quantity × unit cost for each line', () => {
    expect(orderTotal([{ quantity: '20', unit_cost: '32.5' }, { quantity: 6, unit_cost: 21 }])).toBe(776)
  })

  it('treats blank or invalid inputs as zero while the form is being filled', () => {
    expect(orderTotal([{ quantity: '', unit_cost: '5' }, { quantity: '3', unit_cost: '' }])).toBe(0)
  })

  it('rounds each unit cost to the pesewa like the server stores it', () => {
    expect(orderTotal([{ quantity: 3, unit_cost: '1.005' }])).toBe(3.03)
  })
})
