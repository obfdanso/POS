import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Button } from './Button'
import { Input } from './Input'
import { salesService } from '../services/sales'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'
import type { Sale } from '../types'

export interface SmsReceiptFormProps {
  sale: Pick<Sale, 'id' | 'customer'>
  onSent: () => void
  onCancel: () => void
}

/** Texts a sale's receipt, defaulting to the customer's phone number on file. */
export function SmsReceiptForm({ sale, onSent, onCancel }: SmsReceiptFormProps) {
  const [phone, setPhone] = useState(sale.customer?.phone || '')
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Enter would otherwise also reach the POS shortcuts behind the dialog
    e.stopPropagation()
    const number = phone.trim()
    // The server checks the number properly; this only catches obvious typos
    if (!/^\+?[\d\s\-().]{7,20}$/.test(number)) {
      setError('Enter a valid phone number, e.g. 024-123-4567')
      return
    }
    setIsSending(true)
    try {
      const res = await salesService.smsReceipt(sale.id, { phone: number })
      toast.success(res.data.message)
      onSent()
    } catch (err) {
      const fieldError = getFieldErrors(err).phone
      if (fieldError) setError(fieldError)
      else toast.error(getErrorMessage(err, 'Could not text the receipt'))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex items-start gap-2" noValidate>
      <div className="flex-1">
        <Input
          type="tel"
          aria-label="Customer phone number"
          placeholder="024-123-4567"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setError('')
          }}
          error={error}
          autoFocus
        />
      </div>
      <Button type="submit" isLoading={isSending}>Send</Button>
      <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
    </form>
  )
}
