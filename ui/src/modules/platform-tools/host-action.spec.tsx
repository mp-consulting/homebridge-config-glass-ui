import type { FakeApi } from '@/testing'

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOST_ACTION_CONFIRMED } from '@/modules/platform-tools/host-action'
import { Component as ShutdownRoute } from '@/modules/platform-tools/linux/shutdown-linux/route'
import { fakeApi, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({ toast: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))

/**
 * The host restart, container restart and shutdown pages act on mount, so
 * their routes only render them when Power Options sent the user there after
 * a confirmation. Anything else (a typed URL, a bookmark, a reload, the back
 * button) goes back to Power Options without touching the machine.
 */
describe('the confirmed host action routes', () => {
  let api: FakeApi

  beforeEach(() => {
    holder.toast = toastStub()
    api = fakeApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function visit(state?: unknown) {
    const view = renderWithProviders(<ShutdownRoute />, {
      route: '/platform-tools/linux/shutdown-server',
      initialEntries: [{ pathname: '/platform-tools/linux/shutdown-server', state }],
      routes: [{ path: '/power-options', element: <div data-testid="power-options" /> }],
    })
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
    return view
  }

  it('does nothing on a bare visit and goes back to Power Options', async () => {
    const view = await visit()

    expect(api.callsTo('put', '/platform-tools/linux/shutdown-host')).toHaveLength(0)
    expect(view.router.state.location.pathname).toBe('/power-options')
  })

  it('acts once when reached with the confirmation, which it then clears', async () => {
    const view = await visit(HOST_ACTION_CONFIRMED)

    expect(api.callsTo('put', '/platform-tools/linux/shutdown-host')).toHaveLength(1)
    expect(view.router.state.location.pathname).toBe('/platform-tools/linux/shutdown-server')
    // A reload or a step back to this history entry finds no confirmation
    expect(view.router.state.location.state).toBeNull()
    expect(view.container.querySelector('h4')?.textContent).toBe('platform.linux.shutting_down_server')
  })
})
