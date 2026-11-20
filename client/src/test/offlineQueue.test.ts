import { describe, it, expect, beforeEach, vi } from 'vitest'
import { queueSale, queuedSales, removeQueued, syncQueuedSales, isNetworkError, newClientRef, type QueuedSalePayload } from '../utils/offlineQueue'

type SendSale = (payload: QueuedSalePayload, branchId: string | null) => Promise<unknown>

const sale = (ref: string): QueuedSalePayload => ({ client_ref: ref, items: [], payment_method: 'CASH', amount_paid: 10 })

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
    const send = vi.fn<SendSale>()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { error: { details: [{ message: 'Insufficient stock' }] } } } })
      .mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' })
    expect(await syncQueuedSales('u1', send)).toEqual({ synced: 1, refused: 1 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(queuedSales('u1').map((e) => [e.id, e.error])).toEqual([['b', 'Insufficient stock'], ['c', null], ['d', null]])

    // Refused sales aren't resent; the rest go on the next try
    const later = vi.fn<SendSale>().mockResolvedValue({})
    expect(await syncQueuedSales('u1', later)).toEqual({ synced: 2, refused: 0 })
    expect(queuedSales('u1').map((e) => e.id)).toEqual(['b'])
  })

  it('waits on temporary server problems instead of marking the sale refused', async () => {
    queueSale('u1', sale('a'), 10)
    for (const status of [401, 429, 502]) {
      const send = vi.fn<SendSale>().mockRejectedValue({ isAxiosError: true, response: { status, data: {} } })
      expect(await syncQueuedSales('u1', send)).toEqual({ synced: 0, refused: 0 })
    }
    expect(queuedSales('u1')[0].error).toBeNull()
  })

  it('sends each sale to the branch it was rung up at', async () => {
    queueSale('u1', sale('a'), 10, 'branch-a')
    queueSale('u1', sale('b'), 10)
    const send = vi.fn<SendSale>(async () => ({}))
    await syncQueuedSales('u1', send)
    expect(send.mock.calls.map(([payload, branchId]) => [payload.client_ref, branchId])).toEqual([['a', 'branch-a'], ['b', null]])
  })

  it('tells network errors from server answers and from bugs', () => {
    expect(isNetworkError({ isAxiosError: true, message: 'Network Error' })).toBe(true)
    expect(isNetworkError({ isAxiosError: true, response: { status: 422 } })).toBe(false)
    expect(isNetworkError(new TypeError('x is undefined'))).toBe(false)
  })

  it('makes UUIDs without crypto.randomUUID', () => {
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      expect(newClientRef()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})
