import type { Socket } from 'socket.io-client'

import { io as socketIo } from 'socket.io-client'

import { useAuthStore } from '@/core/auth/auth.store'
import { environment } from '@/environments/environment'

/**
 * How a socket gets built. Swappable (`ws.setSocketFactory`, or the
 * `WsService` constructor) so a spec can substitute a fake socket.
 */
export type SocketFactory = (url: string, options: Record<string, unknown>) => Socket

export const defaultSocketFactory: SocketFactory = (url, options) => socketIo(url, options)

/** The unsubscribe `subscribe` hands back; also callable as `.unsubscribe()`, like an RxJS subscription. */
export type Unsubscribe = (() => void) & { unsubscribe: () => void }

/**
 * A ReplaySubject(1) of nothing: `next()` buffers the latest emission and a
 * subscriber that arrives later still gets it, once.
 */
export class ReplayOne {
  private hasValue = false
  private listeners = new Set<() => void>()

  public next(): void {
    this.hasValue = true
    // A snapshot: a listener subscribed from inside one of these is replayed
    // by subscribe() and must not be called a second time by this loop
    for (const listener of Array.from(this.listeners)) {
      listener()
    }
  }

  public subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener)
    if (this.hasValue) {
      listener()
    }
    const unsubscribe = (() => {
      this.listeners.delete(listener)
    }) as Unsubscribe
    unsubscribe.unsubscribe = unsubscribe
    return unsubscribe
  }

  /** Resolves with the next (or the replayed) emission. */
  public toPromise(): Promise<void> {
    return new Promise((resolve) => {
      // The replay can call back before `subscribe` returns, so the
      // unsubscribe is deferred until `off` exists
      const off = this.subscribe(() => {
        queueMicrotask(() => off())
        resolve()
      })
    })
  }
}

/** The message carrying a refreshed token to an open socket (`WS_REAUTH_EVENT` on the server). */
const REAUTH_EVENT = 'reauth'

/** How long to wait for the server to accept a refreshed token before reconnecting instead. */
const REAUTH_TIMEOUT_MS = 10000

export type RequestPayload = string | Record<string, any> | Array<any>

/** One namespace. `end` is there on a handle from `connectToNamespace` and missing on a borrowed one. */
export interface IoNamespace {
  socket: Socket
  connected: ReplayOne
  /**
   * Emit `resource` with an acknowledgement. Resolves with the acknowledgement,
   * rejects with it when it carries an `error`.
   */
  request: <T = any>(resource: string, payload?: RequestPayload) => Promise<T>
  end?: () => void
}

/** A handle that holds a reference on the namespace and must `end()` it. */
export interface OwnedIoNamespace extends IoNamespace {
  end: () => void
}

export interface WsServiceDeps {
  socketFactory?: SocketFactory
  /** The token to send in each handshake, read at that moment. */
  getToken?: () => string | null
}

export class WsService {
  private socketFactory: SocketFactory
  private getToken: () => string | null

  private namespaceConnectionCache: Record<string, IoNamespace> = {}

  // How many consumers currently hold each namespace (see connectToNamespace)
  private namespaceRefCounts: Record<string, number> = {}

  constructor(deps: WsServiceDeps = {}) {
    this.socketFactory = deps.socketFactory ?? defaultSocketFactory
    this.getToken = deps.getToken ?? (() => useAuthStore.getState().token)
  }

  /**
   * Swap how sockets are built. For specs; affects namespaces opened afterwards.
   * @param factory - the new factory
   */
  public setSocketFactory(factory: SocketFactory): void {
    this.socketFactory = factory
  }

  /** Forget every cached namespace and reference. For specs; sockets are left as they are. */
  public reset(): void {
    this.namespaceConnectionCache = {}
    this.namespaceRefCounts = {}
  }

  /**
   * Wrapper function to reuse the same connection.
   *
   * `connected` replays its most recent "socket is ready" emission, so
   * subscribers that attach synchronously after this method returns still
   * receive it. This is what lets callers safely do:
   *
   *     io = ws.connectToNamespace('foo')
   *     io.connected.subscribe(() => io.socket.emit('start'))
   *
   * …without an additional `if (io.socket.connected) emit('start')` fallback —
   * adding both makes the `emit` fire twice on cache-hit (see #2806).
   *
   * Every call takes a reference on the namespace and returns a handle of its
   * own: `socket`, `connected` and `request` are the shared ones, but `end()`
   * only releases this caller's reference. The server-side 'end' — which drops
   * every subscription the socket holds, whoever started it — is emitted when
   * the last holder releases. Otherwise closing one consumer cuts off the rest
   * (e.g. the plugin logs modal ending the `log` stream the dashboard logs
   * widget is still reading). So every caller must end() exactly the handle it
   * got, and a caller that never ends keeps the server subscriptions alive for
   * everyone.
   * @param namespace - e.g. `status`
   */
  public connectToNamespace(namespace: string): OwnedIoNamespace {
    const shared = this.namespaceConnectionCache[namespace] ?? this.openNamespace(namespace)
    this.namespaceRefCounts[namespace] = (this.namespaceRefCounts[namespace] ?? 0) + 1

    // Released once: a second end() from the same consumer (e.g. a stop()
    // called twice) must not give up a reference another consumer holds
    let released = false
    return {
      socket: shared.socket,
      connected: shared.connected,
      request: shared.request,
      end: () => {
        if (released) {
          return
        }
        released = true
        this.releaseNamespace(namespace)
      },
    }
  }

  /**
   * Hand a rotated token to the open sockets, or close them when it is gone.
   *
   * The `auth` callback in establishConnectionToNamespace covers a socket that
   * (re)connects, but an open one keeps the token of its last handshake, and
   * the server closes a socket a few minutes after that token expires (see
   * `ws-auth.ts`). So every refresh is pushed onto the open sockets with a
   * `reauth` message - which is what keeps a long-lived dashboard connected.
   * Should the server refuse it, or not answer, the socket reconnects instead,
   * and the handshake carries the new token.
   *
   * A cleared token is a logout: this browser's sockets end with it.
   * @param token - the new access token, or null
   */
  public handleTokenChange(token: string | null): void {
    for (const { socket } of Object.values(this.namespaceConnectionCache)) {
      if (!token) {
        socket.disconnect()
        continue
      }
      if (!socket.connected) {
        continue
      }
      let answered = false
      const reconnect = () => {
        socket.disconnect()
        socket.connect()
      }
      const fallback = setTimeout(() => {
        if (!answered) {
          answered = true
          reconnect()
        }
      }, REAUTH_TIMEOUT_MS)
      socket.emit(REAUTH_EVENT, { token }, (resp: any) => {
        if (answered) {
          return
        }
        answered = true
        clearTimeout(fallback)
        if (!resp?.ok) {
          reconnect()
        }
      })
    }
  }

  /**
   * Borrow a namespace some other consumer has already opened, without taking
   * a reference on it. The result has no `end()`: a borrower never owns the
   * server-side session, so it only detaches its own listeners.
   * @param namespace - e.g. `status`
   */
  public getExistingNamespace(namespace: string): IoNamespace | undefined {
    return this.namespaceConnectionCache[namespace]
  }

  /**
   * Open and cache the shared connection for a namespace.
   * @param namespace - e.g. `status`
   */
  private openNamespace(namespace: string): IoNamespace {
    const io = this.establishConnectionToNamespace(namespace)

    // Wait for the connection and broadcast when ready. Bound once here, not
    // per connectToNamespace() call: rebinding on every call would stack a
    // `connect` listener each time — eventually tripping
    // MaxListenersExceededWarning and double-emitting on reconnect.
    io.socket.on('connect', () => {
      io.connected.next()
    })

    this.namespaceConnectionCache[namespace] = io
    return io
  }

  /**
   * Drop one consumer's reference, ending the server-side session when it was
   * the last one.
   *
   * We deliberately do NOT call removeAllListeners(), stop the shared
   * `connected` replay or disconnect here, even for the last holder — the
   * socket stays cached for the next consumer, and `connected` keeps replaying
   * to it. Each consumer must therefore manage its own listener teardown (or
   * use `useSocketEvent`, which does).
   * @param namespace - e.g. `status`
   */
  private releaseNamespace(namespace: string): void {
    const remaining = (this.namespaceRefCounts[namespace] ?? 0) - 1
    if (remaining > 0) {
      this.namespaceRefCounts[namespace] = remaining
      return
    }
    delete this.namespaceRefCounts[namespace]
    this.namespaceConnectionCache[namespace]?.socket.emit('end')
  }

  /**
   * Establish a connection to the namespace
   * @param namespace - e.g. `status`
   */
  private establishConnectionToNamespace(namespace: string): IoNamespace {
    const socket: Socket = this.socketFactory(`${environment.api.socket}/${namespace}`, {
      // Sent in the handshake payload rather than the URL. A token in the query
      // string is recorded by reverse proxies, access logs and monitoring, and
      // stays a usable bearer credential until it expires.
      //
      // ⚠️ Callback form, not a plain object: socket.io calls this on every
      // (re)connect, so the handshake always carries the token that is current
      // at that moment. A plain object is captured once when the socket is
      // built, and the token is loaded asynchronously (see token-store.ts), so
      // a socket created during bootstrap would freeze `null` in its handshake
      // and be rejected by WsGuard on every retry for the life of the page —
      // which showed up as a status page stuck on its spinner.
      auth: (cb: (data: Record<string, any>) => void) => cb({ token: this.getToken() }),
      reconnectionAttempts: 10,
      reconnectionDelayMax: 30000,
    })

    const request = <T = any>(resource: string, payload?: RequestPayload): Promise<T> => new Promise<T>((resolve, reject) => {
      socket.emit(resource, payload, (resp: any) => {
        // The null check matters: typeof null is 'object', so without it a
        // null acknowledgement would throw reading `.error` inside the callback
        if (resp && typeof resp === 'object' && resp.error) {
          reject(resp)
        } else {
          resolve(resp)
        }
      })
    })

    return {
      socket,
      connected: new ReplayOne(),
      request,
    }
  }
}

/** The app's one WsService. */
export const ws = new WsService()

// Every token change - a refresh, a sign-in, a logout - reaches the open sockets
useAuthStore.subscribe((state, previous) => {
  if (state.token !== previous.token) {
    ws.handleTokenChange(state.token)
  }
})
