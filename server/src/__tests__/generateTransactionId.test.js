const generateTransactionId = require('../utils/generateTransactionId')

describe('generateTransactionId', () => {
  it('formats as TXN-YYYYMMDD-NNNN', () => {
    expect(generateTransactionId(new Date(2026, 2, 19), 1)).toBe('TXN-20260319-0001')
  })

  it('zero-pads month, day, and sequence', () => {
    expect(generateTransactionId(new Date(2026, 0, 5), 42)).toBe('TXN-20260105-0042')
  })

  it('keeps sequences above 9999 intact', () => {
    expect(generateTransactionId(new Date(2026, 11, 31), 12345)).toBe('TXN-20261231-12345')
  })

  it('matches the documented pattern', () => {
    expect(generateTransactionId(new Date(), 7)).toMatch(/^TXN-\d{8}-\d{4}$/)
  })
})
