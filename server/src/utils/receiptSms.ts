// Builds the text-message version of a sale receipt, kept short to fit one or two SMS.

import type { MoneyValue, ReceiptSale } from './receiptEmail'

const METHOD_LABEL: Record<string, string | undefined> = { CASH: 'Cash', MOBILE_MONEY: 'Mobile Money', CARD: 'Card', SPLIT: 'Split' }

export interface ReceiptSmsStore {
  name: string
  branch?: string | null
  currency: string
}

export function buildReceiptSms(sale: ReceiptSale, store: ReceiptSmsStore): string {
  // "₵" isn't in the basic SMS alphabet; one such character makes every part of the message hold
  // 70 characters instead of 160, so cedis are written as GHS
  const currency = store.currency === 'GH₵' ? 'GHS' : store.currency
  const money = (v: MoneyValue) => `${currency} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const units = (sale.sale_items || []).reduce((n, i) => n + i.quantity, 0)
  const date = new Date(sale.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const parts = sale.payments || []
  const change = parts.reduce((sum, p) => sum + Number(p.change_given || 0), 0)

  const paid =
    sale.payment_method === 'SPLIT'
      ? parts.map((p) => `${METHOD_LABEL[p.method]} ${money(p.amount_paid)}`).join(' + ')
      : METHOD_LABEL[sale.payment_method] || sale.payment_method

  return [
    store.branch ? `${store.name}, ${store.branch}` : store.name,
    `Receipt ${sale.transaction_id}, ${date}`,
    `${units} item${units === 1 ? '' : 's'}. Total ${money(sale.total_amount)}`,
    Number(sale.discount_amount) > 0 && `You saved ${money(sale.discount_amount)}`,
    `Paid: ${paid}${change > 0 ? `, change ${money(change)}` : ''}`,
    sale.loyalty_points_earned > 0 && `Points earned: ${sale.loyalty_points_earned}`,
    'Thank you!',
  ]
    .filter(Boolean)
    .join('\n')
}
