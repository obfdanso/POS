import { round2 } from './saleTotals'

export const METHOD_LABEL = { CASH: 'Cash', MOBILE_MONEY: 'Mobile Money', CARD: 'Card', SPLIT: 'Split' }

export function methodLabel(method) {
  return METHOD_LABEL[method] || method?.replace('_', ' ') || ''
}

/**
 * The payment lines for a receipt: what was paid (each part of a split payment), the change given
 * from the cash part, then any Paystack references. Each line is { label, amount } or { label, text }.
 */
export function paymentLines(sale) {
  const parts = sale.payments?.length ? sale.payments : sale.payment ? [sale.payment] : []
  const isSplit = sale.payment_method === 'SPLIT'
  const lines = isSplit
    ? parts.map((p) => ({ label: `${methodLabel(p.method)}:`, amount: p.amount_paid }))
    : parts.slice(0, 1).filter((p) => parseFloat(p.amount_paid) > 0).map((p) => ({ label: 'Amount Paid:', amount: p.amount_paid }))
  const change = round2(parts.reduce((sum, p) => sum + (parseFloat(p.change_given) || 0), 0))
  if (change > 0) lines.push({ label: 'Change:', amount: change, strong: true })
  for (const p of isSplit ? parts : parts.slice(0, 1)) {
    if (p.reference) lines.push({ label: isSplit ? `${methodLabel(p.method)} ref:` : 'Reference:', text: p.reference })
  }
  return lines
}

/** The card / Mobile Money methods a split sale used, e.g. "Mobile Money". */
export function splitOtherMethods(sale) {
  const others = (sale.payments || []).filter((p) => p.method !== 'CASH').map((p) => methodLabel(p.method))
  return others.join(' and ') || 'card or Mobile Money'
}

/**
 * How a refund of `amount` on a split sale is paid back, as the server does it: cash first, up to
 * the cash the sale took (net of change) less cash already refunded; the rest by card/Mobile Money.
 */
export function splitRefundCash(sale, amount) {
  const cashTaken = (sale.payments || [])
    .filter((p) => p.method === 'CASH')
    .reduce((sum, p) => sum + parseFloat(p.amount_paid) - parseFloat(p.change_given || 0), 0)
  const cashRefunded = (sale.refunds || []).reduce((sum, r) => sum + (parseFloat(r.cash_amount) || 0), 0)
  const cash = Math.max(0, Math.min(round2(amount), round2(cashTaken - cashRefunded)))
  return { cash, other: round2(amount - cash) }
}

/**
 * Splits `total` between a card or Mobile Money part of `otherAmount` and cash for the rest.
 * Returns the cash still due, the change from `cashGiven`, and an error message when the amounts
 * don't work (the same rules the server applies).
 */
export function splitCash(total, otherAmount, cashGiven) {
  const other = round2(Number(otherAmount))
  if (!Number.isFinite(other) || other <= 0) return { error: 'Enter the amount to charge by card or Mobile Money' }
  const due = round2(total - other)
  if (due <= 0) return { error: `That covers the whole total; use a single payment method instead` }
  const given = round2(Number(cashGiven))
  if (cashGiven === '' || !Number.isFinite(given) || given < due) return { due, error: `Cash must be at least ${due.toFixed(2)}` }
  return { due, change: round2(given - due) }
}
