import type { UseTerminalOptions } from './hooks'
import type { LogService } from './log.service'
import type { TerminalNavigationGuard } from './terminal-navigation-guard'
import type { TerminalService } from './terminal.service'

import { act, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/testing'

import { useLog, useTerminal, useTerminalNavigationGuard } from './hooks'
import { getTerminalSettings } from './instances'

// The real wiring pulls in ws, api, modal… - none of it is needed to test the hooks
vi.mock('./instances', () => ({
  terminalService: {},
  terminalNavigationGuard: {},
  createLogService: vi.fn(),
  getTerminalSettings: vi.fn(() => undefined),
}))

function fakeTerminalService(state: { ready?: boolean, active?: boolean } = {}) {
  return {
    isTerminalReady: vi.fn(() => state.ready ?? false),
    hasActiveSession: vi.fn(() => state.active ?? false),
    startTerminal: vi.fn(() => true),
    reconnectTerminal: vi.fn(() => true),
    detachTerminal: vi.fn(),
    destroyTerminal: vi.fn(),
    destroyPersistentSession: vi.fn(async () => undefined),
  }
}

function persistence(on: boolean) {
  vi.mocked(getTerminalSettings).mockReturnValue({ persistence: on })
}

describe('useTerminal', () => {
  let service: ReturnType<typeof fakeTerminalService>

  function Host(props: UseTerminalOptions) {
    const ref = useRef<HTMLDivElement>(null)
    useTerminal(ref, { ...props, service: service as unknown as TerminalService })
    return <div ref={ref} data-testid="host" />
  }

  beforeEach(() => {
    persistence(false)
  })

  describe('on the terminal page', () => {
    it('starts a terminal in the element with the options it was given', () => {
      service = fakeTerminalService()
      const resize = { subscribe: () => () => {} }

      render(<Host options={{ fontSize: 15 }} resize={resize} />)

      expect(service.startTerminal).toHaveBeenCalledWith(screen.getByTestId('host'), { fontSize: 15 }, resize, true)
    })

    it('starts from a clean slate when a terminal is already up', () => {
      service = fakeTerminalService({ ready: true })

      render(<Host />)

      expect(service.destroyTerminal).toHaveBeenCalled()
      expect(service.startTerminal).toHaveBeenCalled()
    })

    it('rejoins a live session when persistence is on', () => {
      persistence(true)
      service = fakeTerminalService({ active: true })

      render(<Host />)

      expect(service.reconnectTerminal).toHaveBeenCalled()
      expect(service.startTerminal).not.toHaveBeenCalled()
    })

    it('drops a leftover session when persistence is off', () => {
      service = fakeTerminalService({ active: true })

      render(<Host />)

      expect(service.destroyPersistentSession).toHaveBeenCalled()
      expect(service.startTerminal).toHaveBeenCalled()
    })

    it('tells the server to drop the session on the way out, without persistence', () => {
      service = fakeTerminalService()
      const { unmount } = render(<Host />)

      unmount()

      expect(service.destroyPersistentSession).toHaveBeenCalled()
      expect(service.detachTerminal).not.toHaveBeenCalled()
    })

    it('only detaches on the way out, with persistence', () => {
      persistence(true)
      service = fakeTerminalService()
      const { unmount } = render(<Host />)

      unmount()

      expect(service.detachTerminal).toHaveBeenCalled()
      expect(service.destroyPersistentSession).not.toHaveBeenCalled()
    })
  })

  describe('in the dashboard widget', () => {
    it('reuses a terminal that is already up, without taking focus', () => {
      // Taking focus would scroll the dashboard down to the widget
      service = fakeTerminalService({ ready: true })

      render(<Host variant="widget" autoFocus={false} />)

      expect(service.destroyTerminal).not.toHaveBeenCalled()
      expect(service.reconnectTerminal).toHaveBeenCalledWith(screen.getByTestId('host'), {}, undefined, false)
    })

    it('starts a fresh one otherwise', () => {
      service = fakeTerminalService()

      render(<Host variant="widget" autoFocus={false} />)

      expect(service.startTerminal).toHaveBeenCalled()
    })

    it('ends only its own terminal on the way out', () => {
      service = fakeTerminalService()
      const { unmount } = render(<Host variant="widget" />)

      unmount()

      expect(service.destroyTerminal).toHaveBeenCalled()
      expect(service.destroyPersistentSession).not.toHaveBeenCalled()
    })
  })
})

describe('useLog', () => {
  function fakeLogService() {
    return { startTerminal: vi.fn(), destroyTerminal: vi.fn() }
  }

  let service: ReturnType<typeof fakeLogService>

  function Host({ pluginName }: { pluginName?: string }) {
    const ref = useRef<HTMLDivElement>(null)
    useLog(ref, { options: { fontSize: 12 }, pluginName, service: service as unknown as LogService })
    return <div ref={ref} data-testid="host" />
  }

  it('tails the log into the element and stops on unmount', () => {
    service = fakeLogService()
    const { unmount } = render(<Host />)

    expect(service.startTerminal).toHaveBeenCalledWith(screen.getByTestId('host'), { fontSize: 12 }, undefined, undefined)

    unmount()
    expect(service.destroyTerminal).toHaveBeenCalledOnce()
  })

  it('restarts when the plugin it is scoped to changes', () => {
    service = fakeLogService()
    const { rerender } = render(<Host pluginName="homebridge-hue" />)

    rerender(<Host pluginName="homebridge-nest" />)

    expect(service.destroyTerminal).toHaveBeenCalledOnce()
    expect(service.startTerminal).toHaveBeenLastCalledWith(expect.any(HTMLElement), { fontSize: 12 }, undefined, 'homebridge-nest')
  })
})

describe('useTerminalNavigationGuard', () => {
  function fakeGuard(allow: boolean | Promise<boolean>) {
    return {
      canDeactivate: vi.fn(async () => allow),
      handleBeforeUnload: vi.fn(() => undefined),
    }
  }

  function Page({ guard, onLeave }: { guard: ReturnType<typeof fakeGuard>, onLeave?: (next: string) => boolean }) {
    useTerminalNavigationGuard({ guard: guard as unknown as TerminalNavigationGuard, onLeave })
    return <div data-testid="terminal-page" />
  }

  it('lets the navigation through when the guard allows it', async () => {
    const guard = fakeGuard(true)
    const { router } = renderWithProviders(<Page guard={guard} />, { route: '/platform-tools/terminal' })

    await act(() => router.navigate('/plugins'))

    await waitFor(() => expect(screen.getByTestId('other-route')).toBeInTheDocument())
    expect(guard.canDeactivate).toHaveBeenCalledOnce()
  })

  it('keeps the user on the page when the guard says no', async () => {
    const guard = fakeGuard(false)
    const { router } = renderWithProviders(<Page guard={guard} />, { route: '/platform-tools/terminal' })

    await act(() => router.navigate('/plugins'))

    await waitFor(() => expect(guard.canDeactivate).toHaveBeenCalled())
    expect(screen.getByTestId('terminal-page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/platform-tools/terminal')
  })

  it('hands the next path to onLeave once the guard allowed leaving', async () => {
    const guard = fakeGuard(true)
    const onLeave = vi.fn(() => false)
    const { router } = renderWithProviders(<Page guard={guard} onLeave={onLeave} />, { route: '/platform-tools/terminal' })

    await act(() => router.navigate('/logs'))

    await waitFor(() => expect(onLeave).toHaveBeenCalledWith('/logs'))
    expect(screen.getByTestId('terminal-page')).toBeInTheDocument()
  })

  it('asks the guard when the tab is closed, until unmounted', () => {
    const guard = fakeGuard(true)
    const { unmount } = renderWithProviders(<Page guard={guard} />)

    window.dispatchEvent(new Event('beforeunload'))
    expect(guard.handleBeforeUnload).toHaveBeenCalledOnce()

    unmount()
    window.dispatchEvent(new Event('beforeunload'))
    expect(guard.handleBeforeUnload).toHaveBeenCalledOnce()
  })
})
