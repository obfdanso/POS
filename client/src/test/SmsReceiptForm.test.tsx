import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'
import { SmsReceiptForm } from '../components/SmsReceiptForm'
import { salesService } from '../services/sales'
import { axiosResponse } from './axiosResponse'

vi.mock('../services/sales', () => ({ salesService: { smsReceipt: vi.fn() } }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const sale = { id: 'sale-1', customer: { id: 'cust-1', name: 'Ama Owusu', phone: '024-555-0199' } }

describe('SmsReceiptForm', () => {
  afterEach(() => vi.mocked(salesService.smsReceipt).mockReset())

  it("starts with the customer's phone number and texts it", async () => {
    vi.mocked(salesService.smsReceipt).mockResolvedValue(axiosResponse({ success: true, data: { to: '+233245550199' }, message: 'Receipt texted to +233245550199' }))
    const onSent = vi.fn()
    render(<SmsReceiptForm sale={sale} onSent={onSent} onCancel={() => {}} />)
    expect(screen.getByLabelText('Customer phone number')).toHaveValue('024-555-0199')
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    expect(salesService.smsReceipt).toHaveBeenCalledWith('sale-1', { phone: '024-555-0199' })
    expect(toast.success).toHaveBeenCalledWith('Receipt texted to +233245550199')
  })

  it('shows an inline error for something that is not a phone number', () => {
    render(<SmsReceiptForm sale={{ id: 'sale-2' }} onSent={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Customer phone number'), { target: { value: 'call me' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByText('Enter a valid phone number, e.g. 024-123-4567')).toBeInTheDocument()
    expect(salesService.smsReceipt).not.toHaveBeenCalled()
  })

  it('says when SMS is not set up on the server', async () => {
    vi.mocked(salesService.smsReceipt).mockImplementation(async () => {
      throw Object.assign(new Error('Request failed with status code 503'), {
        response: { data: { error: { code: 'SMS_NOT_CONFIGURED', message: "SMS receipts aren't set up on this server." } } },
      })
    })
    render(<SmsReceiptForm sale={sale} onSent={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("SMS receipts aren't set up on this server."))
  })
})
