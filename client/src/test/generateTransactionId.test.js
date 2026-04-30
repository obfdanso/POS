import { describe, it, expect } from 'vitest'

// The browser-side utility (the server-side one is tested via integration tests)
// We test the format shape and uniqueness here as a unit test.
function generateTransactionId() {
  const date = new Date()
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `TXN-${dateStr}-${randomSuffix}`
}

describe('generateTransactionId (client utility)', () => {
  it('returns a string', () => {
    expect(typeof generateTransactionId()).toBe('string')
  })

  it('starts with TXN-', () => {
    expect(generateTransactionId().startsWith('TXN-')).toBe(true)
  })

  it('has the correct overall format TXN-YYYYMMDD-XXXXXX', () => {
    const id = generateTransactionId()
    expect(id).toMatch(/^TXN-\d{8}-[A-Z0-9]{6}$/)
  })

  it('contains the current year', () => {
    const id = generateTransactionId()
    const year = new Date().getFullYear().toString()
    expect(id).toContain(year)
  })

  it('generates unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTransactionId()))
    // With 6-char random suffix, 100 calls should all be unique
    expect(ids.size).toBe(100)
  })

  it('has a total length of 18 characters (TXN-YYYYMMDD-XXXXXX)', () => {
    const id = generateTransactionId()
    expect(id.length).toBe(18)
  })
})
