import { inject, Injectable } from '@angular/core'
import { Observable, ReplaySubject } from 'rxjs'
import { Socket } from 'socket.io-client'

import { AuthService } from '@/app/core/auth/auth.service'
import { SOCKET_FACTORY } from '@/app/core/communication/socket.factory'
import { environment } from '@/environments/environment'

export interface IoNamespace {
  connected?: ReplaySubject<void>
  socket: Socket
  request: (resource: string, payload?: string | Record<string, any> | Array<any>) => Observable<any>
  end?: () => void
}

@Injectable({
  providedIn: 'root',
})
export class WsService {
  private $socketFactory = inject(SOCKET_FACTORY)
  private $auth = inject(AuthService)

  private namespaceConnectionCache: Record<string, IoNamespace> = {}

  // How many consumers currently hold each namespace (see connectToNamespace)
  private namespaceRefCounts: Record<string, number> = {}

  /**
   * Wrapper function to reuse the same connection.
   *
   * `connected` is a `ReplaySubject(1)`: the most recent "socket is ready"
   * emission is buffered so subscribers that attach synchronously after this
   * method returns still receive it. This is what lets callers safely do:
   *
   *     io = $ws.connectToNamespace('foo')
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
   *
   * @param namespace
   */
  public connectToNamespace(namespace: string): IoNamespace {
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

  // There is deliberately no "push the rotated token onto cached sockets" step.
  // The `auth` callback in establishConnectionToNamespace is re-evaluated by
  // socket.io on every (re)connect, so a rotated token is picked up on its own.
  // Forcing open sockets to reconnect on rotation is not needed either: WsGuard
  // re-verifies the JWT and re-reads the user record on every message, so an
  // expired or revoked token stops working on an already-open socket regardless.

  /**
   * Borrow a namespace some other consumer has already opened, without taking
   * a reference on it. The result has no `end()`: a borrower never owns the
   * server-side session, so it only detaches its own listeners.
   * @param namespace
   */
  public getExistingNamespace(namespace: string): IoNamespace {
    return this.namespaceConnectionCache[namespace]
  }

  /**
   * Open and cache the shared connection for a namespace.
   * @param namespace
   */
  private openNamespace(namespace: string): IoNamespace {
    const io = this.establishConnectionToNamespace(namespace)
    io.connected = new ReplaySubject<void>(1)

    // Wait for the connection and broadcast when ready. Bound once here, not
    // per connectToNamespace() call: rebinding on every call would stack a
    // `connect` listener each time — eventually tripping
    // MaxListenersExceededWarning and double-emitting on reconnect.
    io.socket.on('connect', () => {
      io.connected!.next()
    })

    this.namespaceConnectionCache[namespace] = io
    return io
  }

  /**
   * Drop one consumer's reference, ending the server-side session when it was
   * the last one.
   *
   * We deliberately do NOT call removeAllListeners(), complete() the shared
   * `connected` ReplaySubject or disconnect here, even for the last holder —
   * the socket stays cached for the next consumer, and `connected` keeps
   * replaying to it. Each consumer must therefore manage its own listener
   * teardown.
   * @param namespace
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
   * @param namespace
   */
  private establishConnectionToNamespace(namespace: string): IoNamespace {
    const socket: Socket = this.$socketFactory(`${environment.api.socket}/${namespace}`, {
      // Sent in the handshake payload rather than the URL. A token in the query
      // string is recorded by reverse proxies, access logs and monitoring, and
      // stays a usable bearer credential until it expires.
      //
      // ⚠️ Callback form, not a plain object: socket.io calls this on every
      // (re)connect, so the handshake always carries the token that is current
      // at that moment. A plain object is captured once when the socket is
      // built, and the token is loaded asynchronously now (see token-store.ts),
      // so a socket created during bootstrap would freeze `null` in its
      // handshake and be rejected by WsGuard on every retry for the life of the
      // page — which showed up as a status page stuck on its spinner.
      auth: (cb: (data: Record<string, any>) => void) => cb({ token: this.$auth.token }),
      reconnectionAttempts: 10,
      reconnectionDelayMax: 30000,
    })

    const request = (resource: string, payload: any): Observable<any> => new Observable((observer) => {
      socket.emit(resource, payload, (resp: any) => {
        // The null check matters: typeof null is 'object', so without it a
        // null acknowledgement would throw reading `.error` inside the callback
        if (resp && typeof resp === 'object' && resp.error) {
          observer.error(resp)
        } else {
          observer.next(resp)
        }
        observer.complete()
      })
    })

    return {
      socket,
      request,
    }
  }
}
