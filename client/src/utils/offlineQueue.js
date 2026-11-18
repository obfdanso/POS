// Cash sales rung up while the server can't be reached, kept on this device until they are sent.
// Each keeps the sale's client_ref, so resending one the server did get never records it twice.

const KEY = 'pos_offline_sales'

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage full or blocked: nothing more can be done here
  }
}

/** A request that never reached the server, or whose answer never came back (not a bug in our code). */
export function isNetworkError(err) {
  return Boolean(err?.isAxiosError) && !err.response
}

/**
 * Answers worth trying again later: the server restarting (5xx), too many requests (429), a timed-out
 * request (408) or an expired login (401). Anything else is the server's final word on the sale.
 */
function isTemporary(err) {
  const status = err?.response?.status
  return isNetworkError(err) || !status || status >= 500 || [401, 408, 429].includes(status)
}

/** A random UUID, also on plain-http pages where crypto.randomUUID is missing. */
export function newClientRef() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function queueSale(userId, payload, total) {
  write([...read(), { id: payload.client_ref, user_id: userId, payload, total, queued_at: new Date().toISOString(), error: null }])
}

/** This user's queued sales: waiting ones, and ones the server refused (with its reason). */
export function queuedSales(userId) {
  return read().filter((e) => e.user_id === userId)
}

export function removeQueued(id) {
  write(read().filter((e) => e.id !== id))
}

/**
 * Sends this user's waiting sales, oldest first, with `send(payload)`. A sale the server refuses is
 * kept with its reason for a person to deal with (the customer already paid); a network error
 * (or a temporary server problem) stops the run so the rest wait for the next try.
 */
export async function syncQueuedSales(userId, send) {
  let synced = 0
  let refused = 0
  for (const entry of queuedSales(userId).filter((e) => !e.error)) {
    try {
      await send(entry.payload)
      removeQueued(entry.id)
      synced++
    } catch (err) {
      if (isTemporary(err)) break
      const api = err.response?.data?.error
      const message = api?.details?.[0]?.message || api?.message || 'The server refused this sale'
      write(read().map((e) => (e.id === entry.id ? { ...e, error: message } : e)))
      refused++
    }
  }
  return { synced, refused }
}
