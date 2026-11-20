import type { GatewayRefundStatus, MoneyLike, PaymentMethod } from '../types'
import { round2 } from './saleTotals'

const LABELS = { CASH: 'Cash', MOBILE_MONEY: 'Mobile Money', CARD: 'Card', SPLIT: 'Split' } satisfies Record<PaymentMethod, string>

/** Display names by payment method (undefined for anything unknown) */
export const METHOD_LABEL: Readonly<Record<string, string | undefined>> = LABELS

export function methodLabel(method: string | null | undefined): string {
  return (method ? METHOD_LABEL[method] : undefined) || method?.replace('_', ' ') || ''
}

/** A payment part as these helpers read it: an API Payment, or one built at the till */
export interface PaymentPart {
  method: string
  amount_paid: MoneyLike
  change_given?: MoneyLike | null
  reference?: string | null
}

/** A sale's payments as these helpers read them */
export interface SalePayments {
  payment_method: string
  payments?: PaymentPart[]
  payment?: PaymentPart | null
}

/** One line of a receipt's payment section: an amount, or text such as a reference */
export interface PaymentLine {
  label: string
  amount?: MoneyLike
  text?: string
  strong?: boolean
}

/**
 * The payment lines for a receipt: what was paid (each part of a split payment), the change given
 * from the cash part, then any Paystack references. Each line is { label, amount } or { label, text }.
 */
export function paymentLines(sale: SalePayments): PaymentLine[] {
  const parts = sale.payments?.length ? sale.payments : sale.payment ? [sale.payment] : []
  const isSplit = sale.payment_method === 'SPLIT'
  const lines: PaymentLine[] = isSplit
    ? parts.map((p) => ({ label: `${methodLabel(p.method)}:`, amount: p.amount_paid }))
    : parts.slice(0, 1).filter((p) => parseFloat(String(p.amount_paid)) > 0).map((p) => ({ label: 'Amount Paid:', amount: p.amount_paid }))
  const change = round2(parts.reduce((sum, p) => sum + (parseFloat(String(p.change_given)) || 0), 0))
  if (change > 0) lines.push({ label: 'Change:', amount: change, strong: true })
  for (const p of isSplit ? parts : parts.slice(0, 1)) {
    if (p.reference) lines.push({ label: isSplit ? `${methodLabel(p.method)} ref:` : 'Reference:', text: p.reference })
  }
  return lines
}

/** The card / Mobile Money methods a split sale used, e.g. "Mobile Money". */
export function splitOtherMethods(sale: { payments?: PaymentPart[] }): string {
  const others = (sale.payments || []).filter((p) => p.method !== 'CASH').map((p) => methodLabel(p.method))
  return others.join(' and ') || 'card or Mobile Money'
}

/**
 * How a refund of `amount` on a split sale is paid back, as the server does it: cash first, up to
 * the cash the sale took (net of change) less cash already refunded; the rest by card/Mobile Money.
 */
export function splitRefundCash(
  sale: { payments?: PaymentPart[]; refunds?: { cash_amount?: MoneyLike | null }[] },
  amount: number
): { cash: number; other: number } {
  const cashTaken = (sale.payments || [])
    .filter((p) => p.method === 'CASH')
    .reduce((sum, p) => sum + parseFloat(String(p.amount_paid)) - parseFloat(String(p.change_given || 0)), 0)
  const cashRefunded = (sale.refunds || []).reduce((sum, r) => sum + (parseFloat(String(r.cash_amount)) || 0), 0)
  const cash = Math.max(0, Math.min(round2(amount), round2(cashTaken - cashRefunded)))
  return { cash, other: round2(amount - cash) }
}

export interface GatewayStatusInfo {
  label: string
  tone: 'warning' | 'muted' | 'success' | 'danger'
  action: string | null
}

// How a refund's card / Mobile Money part is going through Paystack
export const GATEWAY_STATUS: Record<GatewayRefundStatus, GatewayStatusInfo> = {
  NOT_SENT: { label: 'Not sent to Paystack', tone: 'warning', action: 'Send to Paystack' },
  PENDING: { label: 'Sent to Paystack, pending', tone: 'muted', action: 'Check status' },
  PROCESSING: { label: 'Paystack is processing it', tone: 'muted', action: 'Check status' },
  PROCESSED: { label: 'Refunded by Paystack', tone: 'success', action: null },
  FAILED: { label: 'Paystack refund failed', tone: 'danger', action: 'Try again' },
}

/** splitCash's answer: an error (with the cash due once it is known), or the cash due and the change */
export type SplitCashResult = { error: string; due?: number; change?: undefined } | { due: number; change: number; error?: undefined }

/**
 * Splits `total` between a card or Mobile Money part of `otherAmount` and cash for the rest.
 * Returns the cash still due, the change from `cashGiven`, and an error message when the amounts
 * don't work (the same rules the server applies).
 */
export function splitCash(total: number, otherAmount: string | number, cashGiven: string | number): SplitCashResult {
  const other = round2(Number(otherAmount))
  if (!Number.isFinite(other) || other <= 0) return { error: 'Enter the amount to charge by card or Mobile Money' }
  const due = round2(total - other)
  if (due <= 0) return { error: `That covers the whole total; use a single payment method instead` }
  const given = round2(Number(cashGiven))
  if (cashGiven === '' || !Number.isFinite(given) || given < due) return { due, error: `Cash must be at least ${due.toFixed(2)}` }
  return { due, change: round2(given - due) }
}
