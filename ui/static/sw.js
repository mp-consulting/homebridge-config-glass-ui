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

/* Browser notifications (Settings, Notifications, Browser): the server sends
 * { title, body, tag, path, urgent } encrypted with Web Push. A click opens
 * (or focuses) the UI on `path`.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Homebridge'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    icon: `${SCOPE_PATH}assets/android-chrome-192x192.png`,
    badge: `${SCOPE_PATH}assets/favicon-32x32.png`,
    requireInteraction: data.urgent === true,
    data: { path: typeof data.path === 'string' && data.path.startsWith('/') && !data.path.startsWith('//') ? data.path : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.path) || '/'
  const target = new URL(SCOPE_PATH + path.replace(/^\/+/, ''), self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(new URL(SCOPE_PATH, self.location.origin).href) && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) {
          await client.navigate(target).catch(() => undefined)
        }
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
