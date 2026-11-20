import { describe, it, expect } from 'vitest'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'

const apiError = (error: unknown) => ({ response: { data: { success: false, error } } })

describe('getErrorMessage', () => {
  it('uses the server message, or the fallback when there is none', () => {
    expect(getErrorMessage(apiError({ message: 'Sale not found' }), 'Failed')).toBe('Sale not found')
    expect(getErrorMessage(new Error('Network Error'), 'Failed to load')).toBe('Failed to load')
  })

  it('adds a short reference for unexpected errors so staff can report it', () => {
    const err = apiError({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', request_id: '3f2a9c1e-0000-4000-8000-000000000000' })
    expect(getErrorMessage(err, 'Failed')).toBe('An unexpected error occurred (ref 3f2a9c1e)')
  })
})

describe('getFieldErrors', () => {
  it('maps details to fields', () => {
    expect(getFieldErrors(apiError({ details: [{ field: 'price', message: 'Too low' }, { message: 'no field' }] }))).toEqual({ price: 'Too low' })
  })
})
