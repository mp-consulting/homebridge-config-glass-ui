import type { Mock } from 'vitest'

import { vi } from 'vitest'

type Handler = (...args: any[]) => void
type AckResponder = (payload: any) => any

/**
 * A stand-in for the socket.io Manager behind a socket (`socket.io`). In
 * socket.io-client 4.x the reconnection events (`reconnect`,
 * `reconnect_attempt`, ...) are emitted here, never on the Socket itself.
 */
export interface FakeManager {
  on: Mock<(event: string, handler: Handler) => FakeManager>
  off: Mock<(event: string, handler?: Handler) => FakeManager>

  /**
   * Deliver a Manager event to the registered handlers.
   * @param event - the event name, e.g. 'reconnect'
   * @param args - the payload
   */
  fire: (event: string, ...args: any[]) => void

  /**
   * The handlers currently registered for an event.
   * @param event - the event name
   */
  handlers: (event: string) => Handler[]
}

export interface FakeSocket {
  connected: boolean
  id: string
  io: FakeManager
  auth?: unknown
  on: Mock<(event: string, handler: Handler) => FakeSocket>
  once: Mock<(event: string, handler: Handler) => FakeSocket>
  off: Mock<(event: string, handler?: Handler) => FakeSocket>
  emit: Mock<(event: string, ...args: any[]) => FakeSocket>
  removeAllListeners: Mock<(event?: string) => FakeSocket>
  connect: Mock<() => FakeSocket>
  disconnect: Mock<() => FakeSocket>

  /** Everything the code under test has emitted, in order. */
  emitted: Array<{ event: string, args: any[] }>

  /**
   * Deliver a server event to the handlers the code under test registered.
   * @param event - the event name
   * @param args - the payload
   */
  fire: (event: string, ...args: any[]) => void

  /**
   * The handlers currently registered for an event. Useful for proving a
   * component detached its listener on teardown.
   * @param event - the event name
   */
  handlers: (event: string) => Handler[]

  /**
   * The payloads emitted for one event.
   * @param event - the event name
   */
  payloadsFor: (event: string) => any[]

  /**
   * Answer the acknowledgement callback for an emitted event. Responses are
   * delivered synchronously, so an `io.request(...)` promise settles on the
   * next microtask. Answer with `{ error: ... }` to make the request fail the
   * way the server does.
   * @param event - the event name
   * @param response - the acknowledgement value, or a function returning it
   */
  respondTo: (event: string, response: AckResponder | any) => FakeSocket
}

/**
 * The `connected` signal of an IoNamespace: `subscribe(cb)` returns an
 * unsubscribe function, and a subscriber that arrives after a connect is
 * replayed the last one (the ReplaySubject(1) semantics of `ws.service.ts`).
 */
export interface FakeConnected {
  subscribe: (cb: () => void) => () => void
  /** Emit a connect to every subscriber (and remember it for late ones). */
  next: () => void
  /** How many subscribers are attached right now. */
  subscriberCount: () => number
}

export interface FakeIoNamespace {
  socket: FakeSocket
  connected: FakeConnected
  request: Mock<(resource: string, payload?: any) => Promise<any>>
  end: Mock<() => void>

  /** The resource and payload of every `request()` call, in order. */
  requests: Array<{ resource: string, payload: any }>

  /** Mark the socket connected, firing `connect` handlers and `connected`. */
  markConnected: () => void

  /** Mark the socket disconnected and fire its `disconnect` handlers. */
  markDisconnected: (reason?: string) => void
}

export interface FakeNamespaceOptions {
  /**
   * Whether the namespace starts connected. Defaults to true, which is the
   * cache-hit case widgets actually meet: the status page opened the socket
   * before the widget was created, so `connected` already holds its value.
   * Pass false to drive the connect sequence yourself.
   */
  connected?: boolean
}

function handlerRegistry() {
  const handlers = new Map<string, Handler[]>()
  return {
    add(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    remove(event: string, handler?: Handler) {
      if (!handler) {
        handlers.delete(event)
      } else {
        // Like socket.io, `off` also finds a `once` handler by the function it wraps
        handlers.set(event, (handlers.get(event) ?? []).filter(existing => existing !== handler && (existing as any).listener !== handler))
      }
    },
    clear() {
      handlers.clear()
    },
    // Snapshot: a handler is allowed to detach itself while being called
    list: (event: string) => [...(handlers.get(event) ?? [])],
  }
}

export function fakeManager(): FakeManager {
  const registry = handlerRegistry()

  const manager = {
    on: vi.fn((event: string, handler: Handler) => {
      registry.add(event, handler)
      return manager
    }),
    off: vi.fn((event: string, handler?: Handler) => {
      registry.remove(event, handler)
      return manager
    }),
  } as unknown as FakeManager

  manager.fire = (event: string, ...args: any[]) => {
    for (const handler of registry.list(event)) {
      handler(...args)
    }
  }
  manager.handlers = registry.list

  return manager
}

/**
 * A socket.io `Socket` stand-in. Use it on its own to drive code that takes a
 * socket, or `vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket(false)) }))`
 * to drive the ws layer itself.
 * @param connected - the initial `connected` flag
 */
export function fakeSocket(connected = true): FakeSocket {
  const registry = handlerRegistry()
  const responders = new Map<string, AckResponder>()
  const emitted: Array<{ event: string, args: any[] }> = []

  const socket = {
    connected,
    id: 'fake-socket',
    io: fakeManager(),
    emitted,
    on: vi.fn((event: string, handler: Handler) => {
      registry.add(event, handler)
      return socket
    }),
    once: vi.fn((event: string, handler: Handler) => {
      const wrapped: Handler = (...args) => {
        registry.remove(event, wrapped)
        handler(...args)
      }
      ;(wrapped as any).listener = handler
      registry.add(event, wrapped)
      return socket
    }),
    off: vi.fn((event: string, handler?: Handler) => {
      registry.remove(event, handler)
      return socket
    }),
    removeAllListeners: vi.fn((event?: string) => {
      if (event) {
        registry.remove(event)
      } else {
        registry.clear()
      }
      return socket
    }),
    connect: vi.fn(() => socket),
    disconnect: vi.fn(() => {
      socket.connected = false
      return socket
    }),
    emit: vi.fn((event: string, ...args: any[]) => {
      emitted.push({ event, args })
      const ack = args.at(-1)
      if (typeof ack === 'function') {
        const responder = responders.get(event)
        ack(responder ? responder(args[0]) : undefined)
      }
      return socket
    }),
  } as unknown as FakeSocket

  socket.fire = (event: string, ...args: any[]) => {
    for (const handler of registry.list(event)) {
      handler(...args)
    }
  }
  socket.handlers = registry.list
  socket.payloadsFor = (event: string) => emitted.filter(entry => entry.event === event).map(entry => entry.args[0])
  socket.respondTo = (event: string, response: AckResponder | any) => {
    responders.set(event, typeof response === 'function' ? response : () => response)
    return socket
  }

  return socket
}

/** A replaying `connected` signal (see FakeConnected). */
export function fakeConnected(): FakeConnected {
  const subscribers = new Set<() => void>()
  let hasFired = false

  return {
    subscribe(cb) {
      // A wrapper per subscription, so the same callback can subscribe twice
      const entry = () => cb()
      subscribers.add(entry)
      if (hasFired) {
        entry()
      }
      return () => {
        subscribers.delete(entry)
      }
    },
    next() {
      hasFired = true
      // Snapshot: a subscriber that subscribes another from inside must not run this round
      for (const entry of Array.from(subscribers)) {
        entry()
      }
    },
    subscriberCount: () => subscribers.size,
  }
}

/**
 * A stand-in for one namespace returned by `ws.connectToNamespace`.
 *
 * `request` is the real mapping, not a spy returning a canned value, so specs
 * exercise the `{ error }` rejection and the null-acknowledgement guard exactly
 * as production does.
 * @param options - see FakeNamespaceOptions
 */
export function fakeIoNamespace(options: FakeNamespaceOptions = {}): FakeIoNamespace {
  const isConnected = options.connected ?? true
  const socket = fakeSocket(isConnected)
  const connected = fakeConnected()
  const requests: Array<{ resource: string, payload: any }> = []

  const request = (resource: string, payload?: any) => new Promise<any>((resolve, reject) => {
    requests.push({ resource, payload })
    socket.emit(resource, payload, (resp: any) => {
      if (resp && typeof resp === 'object' && resp.error) {
        reject(resp)
      } else {
        resolve(resp)
      }
    })
  })

  const io = {
    socket,
    connected,
    requests,
    request: vi.fn(request),
    end: vi.fn(),
  } as unknown as FakeIoNamespace

  io.markConnected = () => {
    socket.connected = true
    socket.fire('connect')
    connected.next()
  }

  io.markDisconnected = (reason = 'transport close') => {
    socket.connected = false
    socket.fire('disconnect', reason)
  }

  if (isConnected) {
    connected.next()
  }

  return io
}

export interface FakeWs {
  connectToNamespace: Mock<(name: string) => FakeIoNamespace>
  getExistingNamespace: Mock<(name: string) => FakeIoNamespace | undefined>

  /** Every namespace created so far. */
  namespaces: Map<string, FakeIoNamespace>

  /**
   * Get or create a namespace up front, so a spec can arrange responses and
   * grab the socket before the code under test asks for it.
   * @param name - the namespace name, e.g. 'status'
   * @param options - see FakeNamespaceOptions, applied only on creation
   */
  namespace: (name: string, options?: FakeNamespaceOptions) => FakeIoNamespace
}

/**
 * A stand-in for the `ws` singleton of `@/core/ws`:
 *
 *     vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
 *     import { ws as realWs } from '@/core/ws'
 *     const ws = realWs as unknown as FakeWs
 *
 * `connectToNamespace` creates on first use and returns the identical object
 * afterwards (the caching rule from #2806), and `getExistingNamespace` returns
 * only what already exists - widgets use the second and assume the status page
 * opened the socket first, so arrange with `ws.namespace('status')` first.
 */
export function fakeWs(): FakeWs {
  const namespaces = new Map<string, FakeIoNamespace>()

  const namespace = (name: string, options?: FakeNamespaceOptions) => {
    if (!namespaces.has(name)) {
      namespaces.set(name, fakeIoNamespace(options))
    }
    return namespaces.get(name)!
  }

  return {
    namespaces,
    namespace,
    connectToNamespace: vi.fn((name: string) => namespace(name)),
    getExistingNamespace: vi.fn((name: string) => namespaces.get(name)),
  }
}
