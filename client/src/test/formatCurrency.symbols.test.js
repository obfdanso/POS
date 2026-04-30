import { describe, it, expect } from 'vitest'
import { formatCurrency } from '../utils/formatCurrency'

describe('formatCurrency — custom currency symbols', () => {
  it('formats with USD dollar symbol', () => {
    expect(formatCurrency(50, '$')).toBe('$ 50.00')
  })

  it('formats with GBP pound symbol', () => {
    expect(formatCurrency(1234.56, '£')).toBe('£ 1,234.56')
  })

  it('formats with custom naira symbol', () => {
    expect(formatCurrency(999.99, '₦')).toBe('₦ 999.99')
  })

  it('defaults to GH₵ when no symbol provided', () => {
    expect(formatCurrency(100)).toContain('GH₵')
  })

  it('returns zero with custom symbol for NaN', () => {
    expect(formatCurrency('abc', '$')).toBe('$ 0.00')
  })

  it('handles negative amounts', () => {
    const result = formatCurrency(-50, '$')
    expect(result).toContain('$')
    expect(result).toContain('50.00')
  })

  it('formats very small decimals correctly', () => {
    expect(formatCurrency(0.01, '$')).toBe('$ 0.01')
  })

  it('handles empty string symbol gracefully', () => {
    const result = formatCurrency(100, '')
    expect(result).toContain('100.00')
  })
})
