// QuickMart service worker: makes the app installable and lets its screens load without a
// connection. API calls and uploaded images always go to the network, so prices, stock and sales
// are never served from a stale cache.
const CACHE = 'quickmart-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']
const NETWORK_ONLY = /^\/(api|uploads|product-images)\//

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

async function cacheResponse(request, response) {
  if (response.ok) {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || NETWORK_ONLY.test(url.pathname)) return

  // Pages: the latest app when online, the cached one when not (every route is the same SPA shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => cacheResponse('/index.html', response))
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Hashed build files never change, so a cached copy is always right
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((r) => cacheResponse(request, r))))
    return
  }

  // Icons and other public files: answer from the cache, refresh it in the background
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((r) => cacheResponse(request, r))
        .catch(() => cached)
      return cached || network
    })
  )
})
