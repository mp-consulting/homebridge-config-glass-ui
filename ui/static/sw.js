/* Homebridge Glass UI service worker: makes the UI installable and its static
 * files load offline-fast. It only ever caches the UI's own static files
 * (scripts, styles, fonts, images, the page shell): never the API, the
 * websocket, plugin settings pages or anything sent with credentials in a
 * header. Hashed build files are served cache-first (their names change with
 * their content); everything else network-first with the cache as fallback.
 */
/* eslint-disable no-restricted-globals */
const CACHE = 'hb-glass-static-v1'
const MAX_ENTRIES = 400
const SCOPE_PATH = new URL(self.registration ? self.registration.scope : self.location.href).pathname.replace(/[^/]*$/, '')
const NEVER = ['api/', 'socket.io/', 'swagger']
const STATIC_FILE = /\.(?:js|mjs|css|woff2?|ttf|eot|svg|png|jpe?g|webp|gif|ico|webmanifest|json)$/i
const HASHED_FILE = /-[\w-]{8}\.(?:js|css|woff2?|ttf|eot|svg)$/i

/** Whether a request may be answered from, and stored in, the cache. */
function isCacheable(request) {
  if (request.method !== 'GET' || request.headers.has('authorization') || request.headers.has('range')) {
    return false
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH) || url.search) {
    return false
  }
  const path = url.pathname.slice(SCOPE_PATH.length)
  if (NEVER.some(prefix => path.startsWith(prefix))) {
    return false
  }
  return request.mode === 'navigate' || STATIC_FILE.test(path)
}

async function trim(cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(key)
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
    await trim(cache)
  }
  return response
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') {
      await cache.put(key, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(key)
    if (cached) {
      return cached
    }
    throw error
  }
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('hb-glass-static-') && name !== CACHE) {
        await caches.delete(name)
      }
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (!isCacheable(request)) {
    return
  }
  if (request.mode === 'navigate') {
    // Every page of the app is the same shell: keep one copy of it
    event.respondWith(networkFirst(request, new URL(SCOPE_PATH, self.location.origin).href))
  } else if (HASHED_FILE.test(new URL(request.url).pathname)) {
    event.respondWith(cacheFirst(request))
  } else {
    event.respondWith(networkFirst(request, request))
  }
})
