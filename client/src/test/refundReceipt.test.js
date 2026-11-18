import { describe, it, expect } from 'vitest'
import { buildRefundReceiptHtml } from '../utils/refundReceipt'

const fmt = (v) => `GH₵ ${parseFloat(v).toFixed(2)}`
const refund = {
  id: 'r1',
  created_at: '2026-11-18T10:00:00Z',
  amount: '9.00',
  method: 'CASH',
  reason: 'Wrong <colour>',
  user: { full_name: 'Ama Manager' },
  items: [
    { sale_item_id: 'line-pen', quantity: 1, amount: '9.00', restocked: true },
    { sale_item_id: 'line-book', quantity: 1, amount: '0.00', restocked: false },
  ],
}
const sale = {
  transaction_id: 'TXN-20261118-0001',
  created_at: '2026-11-17T10:00:00Z',
  total_amount: '45.00',
  refunded_amount: '9.00',
  customer: { name: 'Kofi' },
  items: [
    { id: 'line-pen', product: { name: 'Pen' } },
    { id: 'line-book', product: { name: 'Book & Co' } },
  ],
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
})
