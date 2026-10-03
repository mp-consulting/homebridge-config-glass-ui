import type { FakeSocket } from '@/testing/fakes/ws.fake'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth/auth.store'
import { ws, WsService } from '@/core/ws/ws'
import { environment } from '@/environments/environment'
import { fakeSocket } from '@/testing/fakes/ws.fake'

const io = vi.fn()

describe('wsService', () => {
  let service: WsService
  let token: string | null
  let sockets: FakeSocket[]

  beforeEach(() => {
    sockets = []
    token = 'test-access-token'
    vi.mocked(io).mockReset()
    vi.mocked(io).mockImplementation(() => {
      const socket = fakeSocket(false)
      sockets.push(socket)
      return socket as any
    })

    service = new WsService({ socketFactory: io, getToken: () => token })
  })

  describe('connecting', () => {
    it('opens the namespace with the app reconnection settings', () => {
      service.connectToNamespace('status')

      expect(io).toHaveBeenCalledTimes(1)
      const [url, options] = vi.mocked(io).mock.calls[0]
      expect(url).toBe(`${environment.api.socket}/status`)
      expect(options).toMatchObject({ reconnectionAttempts: 10, reconnectionDelayMax: 30000 })
    })

    it('sends the token that is current at each handshake', () => {
      service.connectToNamespace('status')
      const { auth: authCallback } = vi.mocked(io).mock.calls[0][1] as any

      // socket.io calls this again on every reconnect. A plain object would
      // freeze whatever the token was when the socket was built - which during
      // bootstrap is null, and the server then rejects every retry
      const first = vi.fn()
      authCallback(first)
      expect(first).toHaveBeenCalledWith({ token: 'test-access-token' })

      token = 'rotated-token'
      const second = vi.fn()
      authCallback(second)
      expect(second).toHaveBeenCalledWith({ token: 'rotated-token' })
    })
  })

  describe('caching a namespace', () => {
    it('shares one socket between callers and does not open a second', () => {
      const first = service.connectToNamespace('status')
      const second = service.connectToNamespace('status')

      // Each caller gets its own handle (its own end()), over the same socket
      // and the same `connected` subject
      expect(second).not.toBe(first)
      expect(second.socket).toBe(first.socket)
      expect(second.connected).toBe(first.connected)
      expect(io).toHaveBeenCalledTimes(1)
    })

    it('registers the connect handler only once', () => {
      service.connectToNamespace('status')
      service.connectToNamespace('status')

      // Re-binding on a cache hit stacks a listener per call and eventually
      // trips MaxListenersExceededWarning, and doubles the emit on reconnect
      expect(sockets[0].handlers('connect')).toHaveLength(1)
    })

    it('opens a separate socket per namespace', () => {
      const status = service.connectToNamespace('status')
      const child = service.connectToNamespace('child-bridges')

      expect(child).not.toBe(status)
      expect(io).toHaveBeenCalledTimes(2)
    })

    it('replays the connection to a subscriber that arrives late', async () => {
      const namespace = service.connectToNamespace('status')

      sockets[0].fire('connect')

      // `connected` replays its last emission so a caller that subscribes after
      // the socket is already up still fires. This is what lets callers skip
      // an `if (socket.connected)` fallback, which would double-emit (#2806)
      await expect(namespace.connected.toPromise()).resolves.toBeUndefined()
    })
  })

  describe('getExistingNamespace', () => {
    it('returns nothing until the namespace has been opened', () => {
      expect(service.getExistingNamespace('status')).toBeUndefined()
    })

    it('returns the open namespace without opening another socket', () => {
      const opened = service.connectToNamespace('status')

      expect(service.getExistingNamespace('status')!.socket).toBe(opened.socket)
      expect(io).toHaveBeenCalledTimes(1)
    })

    it('hands a borrower no end(), so it cannot end the session it does not own', () => {
      service.connectToNamespace('status')

      expect(service.getExistingNamespace('status')!.end).toBeUndefined()
    })
  })

  describe('request', () => {
    it('resolves with the acknowledgement', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('get-server-uptime-info', { time: { uptime: 42 } })

      await expect(namespace.request('get-server-uptime-info')).resolves.toEqual({ time: { uptime: 42 } })
      expect(sockets[0].payloadsFor('get-server-uptime-info')).toEqual([undefined])
    })

    it('sends the payload with the request', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('get-server-network-info', {})

      await namespace.request('get-server-network-info', { netInterfaces: ['eth0'] })

      expect(sockets[0].payloadsFor('get-server-network-info')).toEqual([{ netInterfaces: ['eth0'] }])
    })

    it('fails when the server acknowledges with an error', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('restart-child-bridge', { error: 'Bridge not found' })

      await expect(namespace.request('restart-child-bridge', 'AA:BB')).rejects.toEqual({ error: 'Bridge not found' })
    })

    it('treats a null acknowledgement as an empty result', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('get-dashboard-init', null)

      // typeof null is 'object', so without the null guard this throws inside
      // the acknowledgement callback rather than resolving
      await expect(namespace.request('get-dashboard-init')).resolves.toBeNull()
    })
  })

  describe('end', () => {
    it('tells the server to end the session but leaves the listeners alone', () => {
      const namespace = service.connectToNamespace('status')

      namespace.end!()

      expect(sockets[0].emitted.at(-1)?.event).toBe('end')
      // The namespace is shared - status feeds the dashboard and every widget -
      // so wiping listeners when one consumer closes would silence the rest
      expect(sockets[0].removeAllListeners).not.toHaveBeenCalled()
    })

    it('keeps the server session while another consumer still holds the namespace', () => {
      const first = service.connectToNamespace('log')
      service.connectToNamespace('log')

      first.end!()

      // 'end' drops every server-side subscription on the socket - including
      // the ones the second consumer is still reading
      expect(sockets[0].payloadsFor('end')).toHaveLength(0)
    })

    it('ends the server session when the last consumer releases', () => {
      const first = service.connectToNamespace('log')
      const second = service.connectToNamespace('log')

      first.end!()
      second.end!()

      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
    })

    it('releases a consumer only once however often it ends', () => {
      const first = service.connectToNamespace('log')
      const second = service.connectToNamespace('log')

      // A stop() that runs twice must not give up the other consumer's hold
      first.end!()
      first.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(0)

      second.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
    })

    it('counts afresh on the cached socket after the last release', () => {
      service.connectToNamespace('log').end!()
      const again = service.connectToNamespace('log')
      const other = service.connectToNamespace('log')

      again.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(1)

      other.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(2)
      expect(io).toHaveBeenCalledTimes(1)
    })

    it('counts each namespace on its own', () => {
      const log = service.connectToNamespace('log')
      service.connectToNamespace('status')

      log.end!()

      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
      expect(sockets[1].payloadsFor('end')).toHaveLength(0)
    })
  })

  describe('a rotated token', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('is handed to every open socket, which then stays connected', () => {
      service.connectToNamespace('status')
      service.connectToNamespace('log')
      for (const socket of sockets) {
        socket.connected = true
        socket.respondTo('reauth', { ok: true })
      }

      service.handleTokenChange('refreshed-token')

      for (const socket of sockets) {
        expect(socket.payloadsFor('reauth')).toEqual([{ token: 'refreshed-token' }])
        expect(socket.disconnect).not.toHaveBeenCalled()
      }
    })

    it('is left to the next handshake for a socket that is not connected', () => {
      service.connectToNamespace('status')

      service.handleTokenChange('refreshed-token')

      expect(sockets[0].payloadsFor('reauth')).toEqual([])
    })

    it('reconnects a socket the server refuses it for, so the handshake carries it', () => {
      service.connectToNamespace('status')
      sockets[0].connected = true
      sockets[0].respondTo('reauth', { error: 'Unauthorized' })

      service.handleTokenChange('refreshed-token')

      expect(sockets[0].disconnect).toHaveBeenCalled()
      expect(sockets[0].connect).toHaveBeenCalled()
    })

    it('reconnects a socket the server does not answer', () => {
      vi.useFakeTimers()
      service.connectToNamespace('status')
      sockets[0].connected = true
      // no responder: the acknowledgement never comes
      sockets[0].emit.mockImplementation(() => sockets[0])

      service.handleTokenChange('refreshed-token')
      expect(sockets[0].connect).not.toHaveBeenCalled()

      vi.advanceTimersByTime(10000)
      expect(sockets[0].connect).toHaveBeenCalledOnce()
    })

    it('reaches the app\'s sockets whenever the signed-in token changes', () => {
      const handle = vi.spyOn(ws, 'handleTokenChange').mockImplementation(() => {})
      try {
        useAuthStore.setState({ token: 'refreshed-token' })
        useAuthStore.setState({ token: 'refreshed-token' })
        useAuthStore.setState({ token: null })

        expect(handle.mock.calls).toEqual([['refreshed-token'], [null]])
      } finally {
        handle.mockRestore()
      }
    })

    it('closes every socket on logout', () => {
      service.connectToNamespace('status')
      service.connectToNamespace('log')

      service.handleTokenChange(null)

      for (const socket of sockets) {
        expect(socket.disconnect).toHaveBeenCalled()
        expect(socket.connect).not.toHaveBeenCalled()
      }
    })
  })
})
