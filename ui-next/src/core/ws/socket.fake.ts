/**
 * Test-only fake socket.io Socket, ported from the Angular `fakeSocket`. Kept
 * next to the ws code until the shared `src/testing` fakes absorb it.
 */
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
  on: Mock<(event: string, handler: Handler) => FakeSocket>
  off: Mock<(event: string, handler?: Handler) => FakeSocket>
  emit: Mock<(event: string, ...args: any[]) => FakeSocket>
  removeAllListeners: Mock<(event?: string) => FakeSocket>
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
   * delivered synchronously, so an `io.request(...)` observable emits as soon
   * as it is subscribed. Answer with `{ error: ... }` to make the request fail
   * the way the server does.
   * @param event - the event name
   * @param response - the acknowledgement value, or a function returning it
   */
  respondTo: (event: string, response: AckResponder | any) => FakeSocket
}

export function fakeManager(): FakeManager {
  const handlers = new Map<string, Handler[]>()

  const manager = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return manager
    }),
    off: vi.fn((event: string, handler?: Handler) => {
      if (!handler) {
        handlers.delete(event)
      } else {
        handlers.set(event, (handlers.get(event) ?? []).filter(existing => existing !== handler))
      }
      return manager
    }),
  } as unknown as FakeManager

  manager.fire = (event: string, ...args: any[]) => {
    for (const handler of (handlers.get(event) ?? [])) {
      handler(...args)
    }
  }
  manager.handlers = (event: string) => [...(handlers.get(event) ?? [])]

  return manager
}

export function fakeSocket(connected = true): FakeSocket {
  const handlers = new Map<string, Handler[]>()
  const responders = new Map<string, AckResponder>()
  const emitted: Array<{ event: string, args: any[] }> = []

  const socket = {
    connected,
    id: 'fake-socket',
    io: fakeManager(),
    emitted,
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return socket
    }),
    off: vi.fn((event: string, handler?: Handler) => {
      if (!handler) {
        handlers.delete(event)
      } else {
        handlers.set(event, (handlers.get(event) ?? []).filter(existing => existing !== handler))
      }
      return socket
    }),
    removeAllListeners: vi.fn((event?: string) => {
      if (event) {
        handlers.delete(event)
      } else {
        handlers.clear()
      }
      return socket
    }),
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
    // Snapshot: a handler is allowed to detach itself while being called
    for (const handler of (handlers.get(event) ?? [])) {
      handler(...args)
    }
  }
  socket.handlers = (event: string) => [...(handlers.get(event) ?? [])]
  socket.payloadsFor = (event: string) => emitted.filter(entry => entry.event === event).map(entry => entry.args[0])
  socket.respondTo = (event: string, response: AckResponder | any) => {
    responders.set(event, typeof response === 'function' ? response : () => response)
    return socket
  }

  return socket
}
