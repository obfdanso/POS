import { describe, it, expect, beforeEach, vi } from 'vitest'
import { queueSale, queuedSales, removeQueued, syncQueuedSales, isNetworkError } from '../utils/offlineQueue'

const sale = (ref) => ({ client_ref: ref, items: [], payment_method: 'CASH', amount_paid: 10 })

describe('offline sales queue', () => {
  beforeEach(() => localStorage.clear())

  it("keeps each user's sales apart", () => {
    queueSale('u1', sale('a'), 10)
    queueSale('u2', sale('b'), 5)
    expect(queuedSales('u1').map((e) => e.id)).toEqual(['a'])
    removeQueued('a')
    expect(queuedSales('u1')).toEqual([])
  })

  it('sends waiting sales, keeps refused ones with the reason, and stops on a network error', async () => {
    ;['a', 'b', 'c', 'd'].forEach((ref) => queueSale('u1', sale(ref), 10))
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { data: { error: { details: [{ message: 'Insufficient stock' }] } } } })
      .mockRejectedValueOnce(new Error('Network Error'))
    expect(await syncQueuedSales('u1', send)).toEqual({ synced: 1, refused: 1 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(queuedSales('u1').map((e) => [e.id, e.error])).toEqual([['b', 'Insufficient stock'], ['c', null], ['d', null]])

    // Refused sales aren't resent; the rest go on the next try
    const later = vi.fn().mockResolvedValue({})
    expect(await syncQueuedSales('u1', later)).toEqual({ synced: 2, refused: 0 })
    expect(queuedSales('u1').map((e) => e.id)).toEqual(['b'])
  })

  it('tells network errors from server answers', () => {
    expect(isNetworkError(new Error('Network Error'))).toBe(true)
    expect(isNetworkError({ response: { status: 422 } })).toBe(false)
  })
})
