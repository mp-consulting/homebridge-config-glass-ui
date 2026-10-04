import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../../../static/sw.js'), 'utf8')
const ORIGIN = 'https://hb.local'

/** A tiny Cache Storage: one cache map per name. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, store)
    const key = (request: Request | string) => (typeof request === 'string' ? request : request.url)
    return {
      match: async (request: Request | string) => store.get(key(request))?.clone(),
      put: async (request: Request | string, response: Response) => {
        store.set(key(request), response)
      },
      keys: async () => [...store.keys()].map(url => new Request(url)),
      delete: async (request: Request | string) => store.delete(key(request)),
    }
  }
  return { stores, api: { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) } }
}

/** Run sw.js in a fake worker scope and hand back its listeners. */
function loadWorker(scope = `${ORIGIN}/`) {
  const listeners: Record<string, (event: any) => void> = {}
  const caches = fakeCaches()
  const fetchMock = vi.fn(async (request: Request) => {
    const response = new Response(`body of ${request.url}`, { status: 200 })
    Object.defineProperty(response, 'type', { value: 'basic' })
    return response
  })
  const self = {
    registration: { scope },
    location: new URL(scope),
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: (event: any) => void) => {
      listeners[type] = listener
    },
  }
  // eslint-disable-next-line no-new-func -- evaluates the worker script as the browser would
  new Function('self', 'caches', 'fetch', source)(self, caches.api, fetchMock)

  const fetchEvent = (url: string, init: ConstructorParameters<typeof Request>[1] & { mode?: string } = {}) => {
    const { mode, ...rest } = init
    const request = new Request(url, rest)
    if (mode) {
      // 'navigate' cannot be passed to the constructor
      Object.defineProperty(request, 'mode', { value: mode })
    }
    let responded: Promise<Response> | undefined
    listeners.fetch({ request, respondWith: (value: Promise<Response>) => {
      responded = value
    } })
    return responded
  }
  return { listeners, caches, fetchMock, fetchEvent }
}

describe('the service worker', () => {
  let worker: ReturnType<typeof loadWorker>

  beforeEach(() => {
    worker = loadWorker()
  })

  it('never touches the API, the websocket or swagger', () => {
    expect(worker.fetchEvent(`${ORIGIN}/api/accessories`)).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/api/plugins/settings-ui/x/index.html`)).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/socket.io/?EIO=4`)).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/swagger`)).toBeUndefined()
  })

  it('leaves requests with credentials, other methods and other origins alone', () => {
    expect(worker.fetchEvent(`${ORIGIN}/assets/a-ABCDEFGH.js`, { headers: { authorization: 'bearer x' } })).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/assets/a.png`, { method: 'POST', body: 'x' })).toBeUndefined()
    expect(worker.fetchEvent('https://api.openweathermap.org/data/x.json')).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/assets/a.png?v=2`)).toBeUndefined()
  })

  it('serves hashed build files from the cache once fetched', async () => {
    await worker.fetchEvent(`${ORIGIN}/assets/index-ABCDEFGH.js`)
    await worker.fetchEvent(`${ORIGIN}/assets/index-ABCDEFGH.js`)

    expect(worker.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the cached page shell for navigations when offline', async () => {
    await worker.fetchEvent(`${ORIGIN}/accessories`, { mode: 'navigate' })
    worker.fetchMock.mockRejectedValueOnce(new TypeError('offline'))

    const response = await worker.fetchEvent(`${ORIGIN}/logs`, { mode: 'navigate' })

    expect(await response!.text()).toBe(`body of ${ORIGIN}/accessories`)
  })

  it('stays inside its scope under a reverse proxy sub path', () => {
    worker = loadWorker(`${ORIGIN}/homebridge/`)

    expect(worker.fetchEvent(`${ORIGIN}/homebridge/api/status`)).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/other/app.js`)).toBeUndefined()
    expect(worker.fetchEvent(`${ORIGIN}/homebridge/assets/logo.svg`)).toBeDefined()
  })

  it('drops the caches of older versions when it activates', async () => {
    await worker.caches.api.open('hb-glass-static-v0')
    await worker.caches.api.open('someone-else')
    let done: Promise<unknown> | undefined
    worker.listeners.activate({ waitUntil: (promise: Promise<unknown>) => {
      done = promise
    } })
    await done

    expect([...worker.caches.stores.keys()]).toEqual(['someone-else'])
  })
})
