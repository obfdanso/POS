import { describe, it, expect } from 'vitest'
import { methodLabel, paymentLines, splitCash, splitRefundCash, splitOtherMethods } from '../utils/payments'

const splitSale = {
  payment_method: 'SPLIT',
  payments: [
    { method: 'CASH', amount_paid: '40', change_given: '10', reference: null },
    { method: 'MOBILE_MONEY', amount_paid: '20', change_given: '0', reference: 'QM-1' },
  ],
  refunds: [],
}

describe('methodLabel', () => {
  it('names every method', () => {
    expect(methodLabel('MOBILE_MONEY')).toBe('Mobile Money')
    expect(methodLabel('SPLIT')).toBe('Split')
  })
})

describe('paymentLines', () => {
  it('shows amount paid, change and reference for a single method', () => {
    const lines = paymentLines({ payment_method: 'CASH', payment: { method: 'CASH', amount_paid: '50', change_given: '5' } })
    expect(lines).toEqual([
      { label: 'Amount Paid:', amount: '50' },
      { label: 'Change:', amount: 5, strong: true },
    ])
    expect(paymentLines({ payment_method: 'CARD', payments: [{ method: 'CARD', amount_paid: '9', change_given: '0', reference: 'R1' }] }))
      .toEqual([{ label: 'Amount Paid:', amount: '9' }, { label: 'Reference:', text: 'R1' }])
  })

  it('lists each part of a split payment', () => {
    expect(paymentLines(splitSale)).toEqual([
      { label: 'Cash:', amount: '40' },
      { label: 'Mobile Money:', amount: '20' },
      { label: 'Change:', amount: 10, strong: true },
      { label: 'Mobile Money ref:', text: 'QM-1' },
    ])
  })
})

describe('splitCash', () => {
  it('works out the cash due and the change', () => {
    expect(splitCash(50, '20', '40')).toEqual({ due: 30, change: 10 })
    expect(splitCash(10.1, '0.1', '10')).toEqual({ due: 10, change: 0 })
  })

  it('rejects a missing part, a part covering everything, and too little cash', () => {
    expect(splitCash(50, '', '50').error).toMatch(/Enter the amount/)
    expect(splitCash(50, '50', '0').error).toMatch(/single payment method/)
    expect(splitCash(50, '20', '29.99')).toMatchObject({ due: 30, error: 'Cash must be at least 30.00' })
    expect(splitCash(50, '20', '').error).toBeTruthy()
  })
})

describe('splitRefundCash', () => {
  it('pays cash back first, up to the cash taken less change and earlier cash refunds', () => {
    expect(splitRefundCash(splitSale, 25)).toEqual({ cash: 25, other: 0 })
    expect(splitRefundCash(splitSale, 45)).toEqual({ cash: 30, other: 15 })
    expect(splitRefundCash({ ...splitSale, refunds: [{ cash_amount: '30' }] }, 20)).toEqual({ cash: 0, other: 20 })
  })

  it('names the other methods', () => {
    expect(splitOtherMethods(splitSale)).toBe('Mobile Money')
  })
})
