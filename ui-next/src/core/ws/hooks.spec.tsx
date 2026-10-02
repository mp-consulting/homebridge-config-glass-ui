import type { FakeSocket } from '@/core/ws/socket.fake'

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth/auth.store'
import { useNamespace, useNamespaceConnected, useSocketEvent } from '@/core/ws/hooks'
import { fakeSocket } from '@/core/ws/socket.fake'
import { ReplayOne, WsService } from '@/core/ws/ws'

vi.mock('@/core/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key), changeLanguage: vi.fn(async () => {}) },
}))

describe('ws hooks', () => {
  let sockets: FakeSocket[]
  let service: WsService

  beforeEach(() => {
    sockets = []
    service = new WsService({
      socketFactory: () => {
        const socket = fakeSocket(false)
        sockets.push(socket)
        return socket as any
      },
    })
  })

  describe('useNamespace', () => {
    it('connects on mount and ends its own handle on unmount', () => {
      const { result, unmount } = renderHook(() => useNamespace('status', service))

      expect(result.current?.socket).toBe(sockets[0])
      expect(sockets[0].payloadsFor('end')).toHaveLength(0)

      unmount()

      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
    })

    it('leaves the session to another component still holding the namespace', () => {
      const widget = renderHook(() => useNamespace('log', service))
      const modal = renderHook(() => useNamespace('log', service))

      modal.unmount()
      expect(sockets[0].payloadsFor('end')).toHaveLength(0)

      widget.unmount()
      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
    })

    it('moves its hold when the namespace changes', () => {
      const { rerender, result } = renderHook(({ ns }) => useNamespace(ns, service), { initialProps: { ns: 'status' } })

      rerender({ ns: 'log' })

      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
      expect(result.current?.socket).toBe(sockets[1])
    })

    it('holds nothing without a namespace', () => {
      const { result } = renderHook(() => useNamespace(null, service))

      expect(result.current).toBeNull()
      expect(sockets).toHaveLength(0)
    })
  })

  describe('useSocketEvent', () => {
    it('listens while mounted and removes exactly its listener on unmount', () => {
      const io = service.connectToNamespace('status')
      const handler = vi.fn()
      const other = vi.fn()
      io.socket.on('homebridge-status', other)

      const { unmount } = renderHook(() => useSocketEvent(io, 'homebridge-status', handler))
      sockets[0].fire('homebridge-status', { status: 'up' })
      expect(handler).toHaveBeenCalledWith({ status: 'up' })

      unmount()
      sockets[0].fire('homebridge-status', { status: 'down' })

      expect(handler).toHaveBeenCalledTimes(1)
      // Another consumer's listener on the shared socket stays
      expect(other).toHaveBeenCalledTimes(2)
    })

    it('calls the latest handler without re-binding', () => {
      const io = service.connectToNamespace('status')
      const first = vi.fn()
      const second = vi.fn()

      const { rerender } = renderHook(({ handler }) => useSocketEvent(io, 'stdout', handler), { initialProps: { handler: first } })
      rerender({ handler: second })
      sockets[0].fire('stdout', 'line')

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith('line')
      expect(sockets[0].handlers('stdout')).toHaveLength(1)
    })

    it('waits for the namespace', () => {
      expect(() => renderHook(() => useSocketEvent(null, 'stdout', vi.fn()))).not.toThrow()
    })
  })

  describe('useNamespaceConnected', () => {
    it('runs on every connect, including one that already happened', () => {
      const io = service.connectToNamespace('status')
      sockets[0].fire('connect')
      const handler = vi.fn()

      const { unmount } = renderHook(() => useNamespaceConnected(io, handler))
      expect(handler).toHaveBeenCalledTimes(1)

      act(() => sockets[0].fire('connect'))
      expect(handler).toHaveBeenCalledTimes(2)

      unmount()
      sockets[0].fire('connect')
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })
})

describe('replayOne', () => {
  it('replays the last emission once to a late subscriber', () => {
    const subject = new ReplayOne()
    subject.next()
    subject.next()
    const listener = vi.fn()

    subject.subscribe(listener)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('emits nothing before the first next', () => {
    const listener = vi.fn()
    new ReplayOne().subscribe(listener)

    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribes either way round', () => {
    const subject = new ReplayOne()
    const a = vi.fn()
    const b = vi.fn()
    subject.subscribe(a)()
    subject.subscribe(b).unsubscribe()

    subject.next()

    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })
})

describe('the app ws service', () => {
  it('sends the token the auth store holds at each handshake', () => {
    const factory = vi.fn(() => fakeSocket(false) as any)
    const service = new WsService({ socketFactory: factory })
    service.connectToNamespace('status')
    const { auth } = (factory.mock.calls[0] as any[])[1]

    useAuthStore.setState({ token: 'from-the-store' })
    const cb = vi.fn()
    auth(cb)

    expect(cb).toHaveBeenCalledWith({ token: 'from-the-store' })
    useAuthStore.setState({ token: null })
  })
})
