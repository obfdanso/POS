import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from './Button'
import { Input } from './Input'
import { salesService } from '../services/sales'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'

/** Sends a sale's receipt by email, defaulting to the customer's address on file. */
export function EmailReceiptForm({ sale, onSent, onCancel }) {
  const [email, setEmail] = useState(sale.customer?.email || '')
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    // Enter would otherwise also reach the POS shortcuts behind the dialog
    e.stopPropagation()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address')
      return
    }
    setIsSending(true)
    try {
      const res = await salesService.emailReceipt(sale.id, { email: address })
      toast.success(`Receipt sent to ${res.data.data.to}`)
      onSent()
    } catch (err) {
      const fieldError = getFieldErrors(err).email
      if (fieldError) setError(fieldError)
      else toast.error(getErrorMessage(err, 'Could not send the receipt'))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex items-start gap-2" noValidate>
      <div className="flex-1">
        <Input
          type="email"
          aria-label="Customer email"
          placeholder="customer@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
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
