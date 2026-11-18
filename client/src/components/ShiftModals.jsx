import { useState } from 'react'
import toast from 'react-hot-toast'
import { Modal } from './Modal'
import { Input } from './Input'
import { Button } from './Button'
import { shiftsService } from '../services/shifts'
import { formatCurrency } from '../utils/formatCurrency'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'
import { round2 } from '../utils/saleTotals'

function Line({ label, value, strong = false, className = '' }) {
  return (
    <div className={`flex justify-between text-sm ${strong ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'} ${className}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

/** Counted minus expected: green when it balances, amber when over, red when short. */
export function CashDifference({ difference }) {
  const d = round2(Number(difference) || 0)
  if (d === 0) return <span className="text-success-600 font-semibold">Balanced</span>
  return d > 0
    ? <span className="text-warning-600 font-semibold">Over by {formatCurrency(d)}</span>
    : <span className="text-danger-600 font-semibold">Short by {formatCurrency(-d)}</span>
}

/** Takings for a shift: float, sales by payment method, refunds, and the cash the drawer should hold. */
export function ShiftSummary({ shift }) {
  const s = shift.summary
  return (
    <div className="space-y-1.5 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-3">
      <Line label="Opening float" value={formatCurrency(shift.opening_float)} />
      <Line label={`Cash sales (${s.by_method.CASH.count})`} value={formatCurrency(s.cash_sales)} />
      {s.cash_refunds > 0 && <Line label="Cash refunds" value={`-${formatCurrency(s.cash_refunds)}`} />}
      <Line label="Expected in drawer" value={formatCurrency(shift.expected_cash ?? s.expected_cash)} strong className="border-t border-gray-200 dark:border-gray-700 pt-1.5" />
      <Line label={`Mobile money (${s.by_method.MOBILE_MONEY.count})`} value={formatCurrency(s.by_method.MOBILE_MONEY.total)} className="pt-1.5" />
      <Line label={`Card (${s.by_method.CARD.count})`} value={formatCurrency(s.by_method.CARD.total)} />
      <Line label={`All sales (${s.sales_count})`} value={formatCurrency(s.sales_total)} />
    </div>
  )
}

export function OpenShiftModal({ isOpen, onClose, onOpened }) {
  const [openingFloat, setOpeningFloat] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = Number(openingFloat)
    if (openingFloat === '' || !Number.isFinite(amount) || amount < 0) {
      setErrors({ opening_float: 'Enter the cash in the drawer, 0 or more' })
      return
    }
    setIsSaving(true)
    try {
      const res = await shiftsService.open({ opening_float: amount, ...(notes.trim() && { notes: notes.trim() }) })
      toast.success('Shift opened')
      setOpeningFloat('')
      setNotes('')
      setErrors({})
      onOpened(res.data.data)
    } catch (err) {
      setErrors(getFieldErrors(err))
      toast.error(getErrorMessage(err, 'Could not open the shift'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Open shift" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Count the cash in the drawer before your first sale. It is compared with your count when you close the shift.
        </p>
        <Input
          label="Opening float"
          type="number"
          min="0"
          step="0.01"
          value={openingFloat}
          onChange={(e) => { setOpeningFloat(e.target.value); setErrors({}) }}
          error={errors.opening_float}
          placeholder="0.00"
          autoFocus
        />
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} error={errors.notes} />
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" className="flex-1" isLoading={isSaving}>Open shift</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Count the drawer and close the shift; then shows the result until dismissed. */
export function CloseShiftModal({ shift, onClose, onClosed }) {
  const [countedCash, setCountedCash] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const [closedShift, setClosedShift] = useState(null)

  const expected = shift?.summary?.expected_cash ?? 0
  const counted = Number(countedCash)
  const hasCount = countedCash !== '' && Number.isFinite(counted) && counted >= 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (!hasCount) {
      setErrors({ counted_cash: 'Enter the cash counted in the drawer, 0 or more' })
      return
    }
    setIsSaving(true)
    try {
      const res = await shiftsService.close(shift.id, { counted_cash: counted, ...(notes.trim() && { notes: notes.trim() }) })
      setClosedShift(res.data.data)
      onClosed(res.data.data)
    } catch (err) {
      setErrors(getFieldErrors(err))
      toast.error(getErrorMessage(err, 'Could not close the shift'))
    } finally {
      setIsSaving(false)
    }
  }

  if (!shift) return null

  if (closedShift) {
    return (
      <Modal isOpen onClose={onClose} title="Shift closed" size="sm">
        <div className="space-y-4">
          <ShiftSummary shift={closedShift} />
          <div className="space-y-1.5">
            <Line label="Counted" value={formatCurrency(closedShift.counted_cash)} strong />
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-300">Result</span>
              <CashDifference difference={closedShift.difference} />
            </div>
          </div>
          <Button className="w-full" onClick={onClose} autoFocus>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen onClose={onClose} title="Close shift" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ShiftSummary shift={shift} />
        <Input
          label="Cash counted in drawer"
          type="number"
          min="0"
          step="0.01"
          value={countedCash}
          onChange={(e) => { setCountedCash(e.target.value); setErrors({}) }}
          error={errors.counted_cash}
          placeholder={Number(expected).toFixed(2)}
          autoFocus
        />
        {hasCount && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-300">Difference</span>
            <CashDifference difference={round2(counted - expected)} />
          </div>
        )}
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} error={errors.notes} />
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" variant="danger" className="flex-1" isLoading={isSaving}>Close shift</Button>
        </div>
      </form>
    </Modal>
  )
}
