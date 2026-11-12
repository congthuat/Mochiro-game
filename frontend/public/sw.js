// Mochiro service worker.
//  - Hashed build files (/assets/*) never change, so they are served from cache first:
//    the second visit starts without downloading the 3D models and code again.
//  - Pages are fetched from the network first, so a new release shows up at once; the
//    cached page is only used when the network is down.
//  - The API is never touched: scores, coins and sign-in always go to the server.
const CACHE = 'mochiro-v1'
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          })
      )
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === '/') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          }
          return response
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error()))
    )
  }
})
