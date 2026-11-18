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

/** No response at all means the request never reached the server (or its answer never came back). */
export function isNetworkError(err) {
  return Boolean(err) && !err.response
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
 * stops the run so the rest wait for the next try.
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
      if (isNetworkError(err)) break
      const api = err.response?.data?.error
      const message = api?.details?.[0]?.message || api?.message || 'The server refused this sale'
      write(read().map((e) => (e.id === entry.id ? { ...e, error: message } : e)))
      refused++
    }
  }
  return { synced, refused }
}
