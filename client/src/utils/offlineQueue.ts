// Cash sales rung up while the server can't be reached, kept on this device until they are sent.
// Each keeps the sale's client_ref, so resending one the server did get never records it twice.
import type { CreateSalePayload } from '../types'
import { apiErrorBody, errorStatus, isRecord } from './apiErrors'

const KEY = 'pos_offline_sales'

/** A sale payload ready to queue: it always carries its client_ref */
export type QueuedSalePayload = CreateSalePayload & { client_ref: string }

export interface QueuedSale {
  id: string
  user_id: string
  branch_id: string | null
  payload: QueuedSalePayload
  total: number
  queued_at: string
  /** The server's reason for refusing it; null while it is waiting to be sent */
  error: string | null
}

function read(): QueuedSale[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    // Only this module writes the key, so a stored array is a list of queued sales
    return Array.isArray(list) ? (list as QueuedSale[]) : []
  } catch {
    return []
  }
}

function write(list: QueuedSale[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage full or blocked: nothing more can be done here
  }
}

/** A request that never reached the server, or whose answer never came back (not a bug in our code). */
export function isNetworkError(err: unknown): boolean {
  return isRecord(err) && Boolean(err.isAxiosError) && !err.response
}

/**
 * Answers worth trying again later: the server restarting (5xx), too many requests (429), a timed-out
 * request (408) or an expired login (401). Anything else is the server's final word on the sale.
 */
function isTemporary(err: unknown): boolean {
  const status = errorStatus(err)
  return isNetworkError(err) || !status || status >= 500 || [401, 408, 429].includes(status)
}

/** A random UUID, also on plain-http pages where crypto.randomUUID is missing. */
export function newClientRef(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** `branchId`: the branch an admin was working in, so the sale goes there even after a switch. */
export function queueSale(userId: string, payload: QueuedSalePayload, total: number, branchId: string | null = null): void {
  write([...read(), { id: payload.client_ref, user_id: userId, branch_id: branchId, payload, total, queued_at: new Date().toISOString(), error: null }])
}

/** This user's queued sales: waiting ones, and ones the server refused (with its reason). */
export function queuedSales(userId: string): QueuedSale[] {
  return read().filter((e) => e.user_id === userId)
}

export function removeQueued(id: string): void {
  write(read().filter((e) => e.id !== id))
}

/**
 * Sends this user's waiting sales, oldest first, with `send(payload, branchId)`. A sale the server refuses is
 * kept with its reason for a person to deal with (the customer already paid); a network error
 * (or a temporary server problem) stops the run so the rest wait for the next try.
 */
export async function syncQueuedSales(
  userId: string,
  send: (payload: QueuedSalePayload, branchId: string | null) => Promise<unknown>
): Promise<{ synced: number; refused: number }> {
  let synced = 0
  let refused = 0
  for (const entry of queuedSales(userId).filter((e) => !e.error)) {
    try {
      await send(entry.payload, entry.branch_id ?? null)
      removeQueued(entry.id)
      synced++
    } catch (err) {
      if (isTemporary(err)) break
      const api = apiErrorBody(err)
      const message = api?.details?.[0]?.message || api?.message || 'The server refused this sale'
      write(read().map((e) => (e.id === entry.id ? { ...e, error: message } : e)))
      refused++
    }
  }
  return { synced, refused }
}
