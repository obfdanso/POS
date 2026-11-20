import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailReceiptForm } from '../components/EmailReceiptForm'
import { salesService } from '../services/sales'
import { axiosResponse } from './axiosResponse'

vi.mock('../services/sales', () => ({ salesService: { emailReceipt: vi.fn() } }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const sale = { id: 'sale-1', customer: { id: 'cust-1', name: 'Ama Owusu', email: 'ama@example.com' } }

describe('EmailReceiptForm', () => {
  afterEach(() => vi.mocked(salesService.emailReceipt).mockClear())

  it("starts with the customer's email and sends to it", async () => {
    vi.mocked(salesService.emailReceipt).mockResolvedValue(axiosResponse({ success: true, data: { to: 'ama@example.com' }, message: 'Receipt sent to ama@example.com' }))
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
    vi.mocked(salesService.emailReceipt).mockImplementation(async () => {
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
