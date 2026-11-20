import { describe, it, expect } from 'vitest'
import { buildRefundReceiptHtml } from '../utils/refundReceipt'
import type { MoneyLike, Refund, Sale, SaleItem } from '../types'

const fmt = (v: MoneyLike | null | undefined) => `GH₵ ${parseFloat(String(v)).toFixed(2)}`
const refund: Refund = {
  id: 'r1',
  sale_id: 's1',
  user_id: 'u1',
  shift_id: null,
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
  amount: '9.00',
  method: 'CASH',
  cash_amount: '9.00',
  reason: 'Wrong <colour>',
  gateway_status: null,
  gateway_amount: null,
  branch_id: 'b1',
  user: { id: 'u1', full_name: 'Ama Manager' },
  items: [
    { sale_item_id: 'line-pen', quantity: 1, amount: '9.00', restocked: true },
    { sale_item_id: 'line-book', quantity: 1, amount: '0.00', restocked: false },
  ],
}
const saleItem = (id: string, name: string): SaleItem => ({
  id,
  sale_id: 's1',
  product_id: `p-${id}`,
  quantity: 1,
  unit_price: '9.00',
  unit_cost: null,
  discount: '0.00',
  total: '9.00',
  refunded_quantity: 0,
  promotion_id: null,
  promotion_discount: '0.00',
  product: { id: `p-${id}`, name, sku: id },
  created_at: '2026-11-17T10:00:00Z',
  updated_at: '2026-11-17T10:00:00Z',
})
const sale: Sale = {
  id: 's1',
  transaction_id: 'TXN-20261118-0001',
  user_id: 'u1',
  customer_id: 'c1',
  subtotal: '45.00',
  discount_amount: '0.00',
  tax_amount: '0.00',
  total_amount: '45.00',
  payment_method: 'CASH',
  payment_status: 'COMPLETED',
  notes: null,
  loyalty_points_earned: 0,
  refunded_amount: '9.00',
  loyalty_points_reversed: 0,
  loyalty_points_redeemed: 0,
  points_discount: '0.00',
  loyalty_points_restored: 0,
  client_ref: null,
  shift_id: null,
  branch_id: 'b1',
  created_at: '2026-11-17T10:00:00Z',
  updated_at: '2026-11-17T10:00:00Z',
  customer: { id: 'c1', name: 'Kofi' },
  items: [saleItem('line-pen', 'Pen'), saleItem('line-book', 'Book & Co')],
  refunds: [refund],
}

describe('buildRefundReceiptHtml', () => {
  const html = buildRefundReceiptHtml(sale, refund, { store_name: 'QuickMart' }, fmt)

  it('lists the returned items with their refund amounts', () => {
    expect(html).toContain('Pen')
    expect(html).toContain('Book &amp; Co')
    expect(html).toContain('(not restocked)')
    expect(html).toContain('GH₵ 9.00')
    expect(html).toContain('TXN-20261118-0001')
    expect(html).toContain('Cash')
  })

  it('escapes user-entered text', () => {
    expect(html).toContain('Wrong &lt;colour&gt;')
    expect(html).not.toContain('<colour>')
  })

  it('shows the running total only on the latest refund', () => {
    expect(html).toContain('Sale total refunded')
    const older = buildRefundReceiptHtml({ ...sale, refunds: [refund, { ...refund, id: 'r2' }] }, refund, {}, fmt)
    expect(older).not.toContain('Sale total refunded')
  })

  it('names the branch that took the return back, with its address', () => {
    const atBranch = { ...refund, branch: { id: 'b2', name: 'Accra Mall', code: 'ACC', address: 'Spintex Rd', phone: '030-1' } }
    const slip = buildRefundReceiptHtml({ ...sale, refunds: [atBranch] }, atBranch, { store_name: 'QuickMart', store_address: 'Kumasi HQ' }, fmt)
    expect(slip).toContain('Accra Mall')
    expect(slip).toContain('Spintex Rd')
    expect(slip).not.toContain('Kumasi HQ')
  })
})
