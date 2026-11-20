import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Input'
import { salesService } from '../services/sales'
import { formatCurrency } from '../utils/formatCurrency'
import { estimateRefund } from '../utils/refunds'
import { methodLabel, splitOtherMethods, splitRefundCash } from '../utils/payments'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'
import type { Sale, SaleItem } from '../types'

export interface ReturnModalProps {
  /** A single sale response, with its items */
  sale: Sale & { items: SaleItem[] }
  onClose: () => void
  /** Gets the sale as updated by the refund */
  onDone: (sale: Sale) => void
}

export function ReturnModal({ sale, onClose, onDone }: ReturnModalProps) {
  const returnable = sale.items.filter((i) => i.quantity > (i.refunded_quantity || 0))
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [damaged, setDamaged] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  const remaining = (item: SaleItem) => item.quantity - (item.refunded_quantity || 0)
  const refund = estimateRefund(sale, quantities)
  const units = Object.values(quantities).reduce((n, q) => n + (q || 0), 0)
  const method = methodLabel(sale.payment_method).toLowerCase()
  // A split sale pays back cash first (from the drawer), the rest by card or Mobile Money
  const cashBack = sale.payment_method === 'SPLIT' ? splitRefundCash(sale, refund) : null

  function setQuantity(item: SaleItem, value: string) {
    const q = Math.max(0, Math.min(remaining(item), parseInt(value, 10) || 0))
    setQuantities((prev) => ({ ...prev, [item.id]: q }))
    setErrors({})
  }

  function returnEverything() {
    setQuantities(Object.fromEntries(returnable.map((i) => [i.id, remaining(i)])))
    setErrors({})
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (units === 0) errs.items = 'Choose at least one item to return'
    if (!reason.trim()) errs.reason = 'Say why the items are being returned'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setIsSaving(true)
    try {
      const items = returnable
        .filter((i) => quantities[i.id] > 0)
        .map((i) => ({ sale_item_id: i.id, quantity: quantities[i.id], restock: !damaged[i.id] }))
      const res = await salesService.refund(sale.id, { items, reason: reason.trim() })
      const updated = res.data.data
      const refunded = updated.refunds?.[updated.refunds.length - 1]?.amount
      toast.success(`Refunded ${formatCurrency(refunded ?? refund)} on ${sale.transaction_id}`)
      onDone(updated)
    } catch (err) {
      setErrors(getFieldErrors(err))
      toast.error(getErrorMessage(err, 'Refund failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Return items · ${sale.transaction_id}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">How many of each item is the customer returning?</p>
          <Button type="button" size="sm" variant="secondary" onClick={returnEverything}>Return everything</Button>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
          {returnable.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-[10rem]">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.product?.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {remaining(item)} of {item.quantity} can be returned · {formatCurrency(item.unit_price)} each
                </p>
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min="0"
                  max={remaining(item)}
                  step="1"
                  value={quantities[item.id] ?? 0}
                  onChange={(e) => setQuantity(item, e.target.value)}
                  aria-label={`Quantity of ${item.product?.name} to return`}
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={!damaged[item.id]}
                  onChange={(e) => setDamaged((prev) => ({ ...prev, [item.id]: !e.target.checked }))}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Back to stock
              </label>
            </div>
          ))}
        </div>
        {errors.items && <p className="text-xs text-danger-600 dark:text-danger-400">{errors.items}</p>}

        <Input
          label="Reason"
          value={reason}
          onChange={(e) => { setReason(e.target.value); setErrors({}) }}
          maxLength={500}
          placeholder="e.g. Damaged packaging, wrong size"
          error={errors.reason}
        />

        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-sm space-y-1">
          <div className="flex justify-between font-semibold text-gray-900 dark:text-gray-100">
            <span>Refund to customer</span>
            <span>{formatCurrency(refund)}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Each item is refunded at its share of what the customer paid, after any discount.{' '}
            {cashBack
              ? <>Pay back {formatCurrency(cashBack.cash)} in cash from your open shift&apos;s drawer.
                  {cashBack.other > 0 && <> The {formatCurrency(cashBack.other)} paid by {splitOtherMethods(sale)} is refunded through Paystack; check under the sale that it was sent.</>}</>
              : sale.payment_method === 'CASH'
                ? <>Pay it back in cash; the system records it and takes it out of your open shift&apos;s drawer.</>
                : <>It is refunded to the customer&apos;s {method} through Paystack; check under the sale that it was sent.</>}
          </p>
        </div>

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" variant="danger" className="flex-1" isLoading={isSaving} disabled={units === 0}>
            Refund {units > 0 && formatCurrency(refund)}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
