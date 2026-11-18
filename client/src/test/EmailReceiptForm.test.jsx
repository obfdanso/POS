import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailReceiptForm } from '../components/EmailReceiptForm'
import { salesService } from '../services/sales'

vi.mock('../services/sales', () => ({ salesService: { emailReceipt: vi.fn() } }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const sale = { id: 'sale-1', customer: { email: 'ama@example.com' } }

describe('EmailReceiptForm', () => {
  afterEach(() => salesService.emailReceipt.mockClear())

  it("starts with the customer's email and sends to it", async () => {
    salesService.emailReceipt.mockResolvedValue({ data: { data: { to: 'ama@example.com' } } })
    const onSent = vi.fn()
    render(<EmailReceiptForm sale={sale} onSent={onSent} onCancel={() => {}} />)
    expect(screen.getByLabelText('Customer email')).toHaveValue('ama@example.com')
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    expect(salesService.emailReceipt).toHaveBeenCalledWith('sale-1', { email: 'ama@example.com' })
  })

  it('shows an inline error for an invalid address without calling the server', () => {
    render(<EmailReceiptForm sale={{ id: 'sale-2' }} onSent={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(salesService.emailReceipt).not.toHaveBeenCalled()
  })

  it("shows the server's field error inline", async () => {
    salesService.emailReceipt.mockImplementation(async () => {
      throw Object.assign(new Error('Request failed with status code 422'), {
        response: { data: { error: { details: [{ field: 'email', message: 'Rejected by the server' }] } } },
      })
    })
    render(<EmailReceiptForm sale={{ id: 'sale-3' }} onSent={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Customer email'), { target: { value: 'x@y.co' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText('Rejected by the server')).toBeInTheDocument()
  })
})
