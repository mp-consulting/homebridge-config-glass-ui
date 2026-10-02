import type { FakeApi, FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ttlCache } from '@/core/caching'
import { Confirm } from '@/core/components/confirm/Confirm'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import { PowerOptions } from '@/modules/power-options/PowerOptions'
import { Restart } from '@/modules/restart/Restart'
import { fakeApi, fakeOpenModal, fakeWs, makeSettingsState, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({
  ws: null as FakeWs | null,
  toast: null as ReturnType<typeof toastStub> | null,
  modal: null as FakeOpenModal | null,
}))
vi.mock('@/core/ws', () => ({
  get ws() {
    return holder.ws
  },
}))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))
vi.mock('@/core/ui/modal', () => ({
  openModal: (...args: Parameters<FakeOpenModal['openModal']>) => holder.modal!.openModal(...args),
}))

/**
 * Restarting Homebridge, and the menu that offers the various ways to do it.
 *
 * The restart page is the only screen in the app that has to keep working while
 * the server it is talking to disappears. It cannot poll, because the UI itself
 * may be restarting too, so it waits for the socket to come back and for a
 * status event to say Homebridge is up.
 *
 * The two timings are load-bearing and not obvious: nothing is believed for the
 * first seven seconds (Homebridge has not begun shutting down yet, so a status
 * event in that window is the *old* process saying it is fine), and after forty
 * seconds the user is warned and offered the logs.
 */
describe('restarting homebridge', () => {
  let api: FakeApi
  let toast: ReturnType<typeof toastStub>
  let io: FakeIoNamespace
  let modal: FakeOpenModal
  let invalidateAll: ReturnType<typeof vi.spyOn>
  let getAppSettings: ReturnType<typeof vi.spyOn>
  let setPageTitle: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetSettingsStore()
    api = fakeApi().respond('put', '/server/restart', { restartingUI: false })
    holder.ws = fakeWs()
    io = holder.ws.namespace('status')
    toast = toastStub()
    holder.toast = toast
    modal = fakeOpenModal()
    holder.modal = modal
    invalidateAll = vi.spyOn(ttlCache, 'invalidateAll')
    getAppSettings = vi.spyOn(settingsActions, 'getAppSettings').mockResolvedValue(undefined)
    setPageTitle = vi.spyOn(settingsActions, 'setPageTitle')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Render a page and let its first effects and requests settle. */
  async function open(page: 'restart' | 'power', options: { url?: string, env?: Record<string, any>, arrange?: () => void } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: options.env }) as any)
    options.arrange?.()
    const route = page === 'restart' ? '/restart' : '/power-options'
    const view = renderWithProviders(page === 'restart' ? <Restart /> : <PowerOptions />, {
      route,
      initialEntries: [options.url ?? route],
    })
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
    return view
  }

  const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname
  const fire = (status: string) => act(() => io.socket.fire('homebridge-status', { status }))
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const uiIcon = (container: HTMLElement) => container.querySelectorAll('.restart-progress-box i')[0].className

  describe('the restart page', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('asks the server to restart itself', async () => {
      const { container } = await open('restart')

      expect(api.lastCall('put', '/server/restart')?.body).toEqual({})
      expect(api.callsTo('put', '/server/restart')).toHaveLength(1)
      expect(container.querySelector('.alert-error')).toBeNull()
    })

    it('throws away every cached response', async () => {
      await open('restart')

      // Plugins, pairings, accessories - all of it describes a process that is
      // about to be replaced
      expect(invalidateAll).toHaveBeenCalled()
    })

    it('marks the ui as up straight away when only homebridge is restarting', async () => {
      const { container } = await open('restart')

      // The page it is running on is not going anywhere, so there is nothing to
      // wait for on that half
      expect(uiIcon(container)).toBe('far fa-check-circle')
    })

    it('waits for the ui to come back when it is restarting too', async () => {
      const { container } = await open('restart', {
        arrange: () => api.respond('put', '/server/restart', { restartingUI: true }),
      })

      expect(uiIcon(container)).toBe('fas fa-circle-notch fa-spin')
    })

    it('skips the restart request when something else already started one', async () => {
      const { container } = await open('restart', { url: '/restart?restarting=true' })

      // Reached from the accessory-cache modals, which restart the server
      // themselves before sending the user here
      expect(api.callsTo('put', '/server/restart')).toHaveLength(0)
      expect(uiIcon(container)).toBe('far fa-check-circle')
    })

    it('keeps the ui row pending when the ui is restarting as well', async () => {
      const { container } = await open('restart', { url: '/restart?restarting=true&uiRestarting=true' })

      expect(uiIcon(container)).toBe('fas fa-circle-notch fa-spin')
    })

    it('shows an error when the restart cannot be started', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { container } = await open('restart', {
        arrange: () => api.fail('put', '/server/restart', new Error('offline')),
      })

      expect(container.querySelector('.alert-error')?.textContent).toBe('restart.toast_server_restart_error')
      expect(toast.at('error')).toHaveLength(1)
    })

    it('ignores a status event from the process that is still shutting down', async () => {
      const view = await open('restart')

      // Deliberately most of the way through the settling period rather than at
      // zero: at zero any shortening of the wait still looks like a pass
      await advance(6500)
      fire('ok')

      // Homebridge takes a moment to even begin stopping, so an 'ok' this early
      // is the old process answering and would send the user away too soon
      expect(path(view)).toBe('/restart')
      expect(uiIcon(view.container)).toBe('far fa-check-circle')
    })

    it('believes a status event once the settling period is over', async () => {
      const view = await open('restart')
      await advance(7000)

      fire('ok')

      expect(toast.at('success')[0].message).toBe('restart.toast_server_restarted')
      expect(path(view)).toBe('/')
    })

    it('treats a pending homebridge as up as well', async () => {
      const view = await open('restart')
      await advance(7000)

      fire('pending')

      // 'pending' means the process is running and still loading plugins, which
      // is as far as this page needs it to get
      expect(path(view)).toBe('/')
    })

    it('keeps waiting while homebridge reports itself down', async () => {
      const view = await open('restart', {
        arrange: () => api.respond('put', '/server/restart', { restartingUI: true }),
      })
      await advance(7000)

      fire('down')

      expect(path(view)).toBe('/restart')
      // The event still proves the UI is answering, which is the first tick
      expect(uiIcon(view.container)).toBe('far fa-check-circle')
    })

    it('only announces the restart once', async () => {
      const view = await open('restart')
      await advance(7000)

      act(() => {
        io.socket.fire('homebridge-status', { status: 'ok' })
        io.socket.fire('homebridge-status', { status: 'ok' })
        io.socket.fire('homebridge-status', { status: 'ok' })
      })

      // Navigation is not instant, and a screen reader re-reads the toast each
      // time it is raised
      expect(toast.at('success')).toHaveLength(1)
      expect(path(view)).toBe('/')
    })

    it('asks again for the status in case the first event was missed', async () => {
      await open('restart')
      // One ask already, from the socket being connected when the page opened
      expect(io.socket.payloadsFor('monitor-server-status')).toHaveLength(1)

      await advance(7000)

      // And a second when the settling period ends: a fast restart can finish
      // inside those seven seconds, and the event that proved it was
      // deliberately ignored, so the page has to ask rather than wait
      expect(io.socket.payloadsFor('monitor-server-status')).toHaveLength(2)
    })

    it('re-subscribes and reloads its settings when the socket reconnects', async () => {
      await open('restart')
      io.socket.emitted.length = 0
      getAppSettings.mockClear()

      act(() => io.markConnected())

      // The socket was dropped by the restart, so the server has no idea this
      // page still wants status events
      expect(io.socket.emitted.some(entry => entry.event === 'monitor-server-status')).toBe(true)
      expect(getAppSettings).toHaveBeenCalled()
    })

    it('warns the user and offers the logs when it takes too long', async () => {
      const { container } = await open('restart')

      await advance(40000)

      expect(container.querySelector('.alert-warning')).not.toBeNull()
      expect(toast.at('warning')[0].message).toBe('restart.toast_server_restart_timeout')
      // Long enough to actually be read
      expect(toast.at('warning')[0].options).toEqual({ timeOut: 10000 })
      expect(container.querySelector('.alert-warning .font-monospace')?.textContent).toBe('End Process')
    })

    it('does not warn before the timeout is up', async () => {
      const { container } = await open('restart')

      await advance(39000)

      expect(container.querySelector('.alert-warning')).toBeNull()
      expect(toast.at('warning')).toHaveLength(0)
    })

    it('sends the user to the logs on request', async () => {
      const view = await open('restart')
      await advance(40000)

      fireEvent.click(screen.getByText('menu.tooltip_view_logs'))

      expect(path(view)).toBe('/logs')
    })

    it('detaches its status listener when the user navigates away', async () => {
      const view = await open('restart')
      expect(io.socket.handlers('homebridge-status')).toHaveLength(1)

      view.unmount()

      // The status namespace is shared and cached, so a listener left behind
      // would keep toasting and navigating from whatever page comes next
      expect(io.socket.handlers('homebridge-status')).toHaveLength(0)
      expect(io.end).toHaveBeenCalled()
    })

    it('stops believing status events after teardown', async () => {
      const view = await open('restart')
      await advance(7000)

      view.unmount()
      io.socket.fire('homebridge-status', { status: 'ok' })

      expect(toast.at('success')).toHaveLength(0)
    })
  })

  describe('the power options menu', () => {
    it('sets the page title', async () => {
      await open('power')

      expect(setPageTitle).toHaveBeenCalledWith('menu.restart.title')
    })

    it('offers the host controls only when the platform supports them', async () => {
      const first = await open('power')
      expect(screen.queryByText('menu.linux.label_shutdown_server')).toBeNull()
      first.unmount()

      await open('power', { env: { canShutdownRestartHost: true } })
      expect(screen.getByText('menu.linux.label_shutdown_server')).toBeInTheDocument()
      expect(screen.getByText('menu.linux.label_restart_server')).toBeInTheDocument()
    })

    it('knows when it is running in a container', async () => {
      await open('power', { env: { runningInDocker: true } })

      // Restarting the container replaces both Homebridge and the UI, so it is a
      // different option from restarting the host
      expect(screen.getByText('menu.docker.restart_container')).toBeInTheDocument()
    })

    it('restarts homebridge through the restart page', async () => {
      const view = await open('power')

      fireEvent.click(screen.getByText('menu.hbrestart.confirm_hb'))

      expect(path(view)).toBe('/restart')
    })

    it('sets the full service flag before a service restart', async () => {
      const view = await open('power')

      fireEvent.click(screen.getByText('menu.hbrestart.confirm_ui'))
      await act(async () => {})

      // Without the flag hb-service does its in-process restart, which is not
      // what the user asked for
      expect(api.callsTo('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toHaveLength(1)
      expect(path(view)).toBe('/restart')
    })

    it('stays put when the flag cannot be set', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const view = await open('power', {
        arrange: () => api.fail('put', '/platform-tools/hb-service/set-full-service-restart-flag', new Error('offline')),
      })

      fireEvent.click(screen.getByText('menu.hbrestart.confirm_ui'))
      await act(async () => {})

      // Navigating anyway would show a restart page for a restart that never
      // started
      expect(path(view)).toBe('/power-options')
      expect(toast.at('error')).toHaveLength(1)
    })

    it('sends the host restart to its own page', async () => {
      const view = await open('power', { env: { canShutdownRestartHost: true } })

      fireEvent.click(screen.getByText('menu.linux.label_restart_server'))

      expect(path(view)).toBe('/platform-tools/linux/restart-server')
    })

    it('sends a container restart to its own page', async () => {
      const view = await open('power', { env: { runningInDocker: true } })

      fireEvent.click(screen.getByText('menu.docker.restart_container'))

      expect(path(view)).toBe('/platform-tools/docker/restart-container')
    })

    it('asks before shutting the machine down', async () => {
      await open('power', { env: { canShutdownRestartHost: true } })

      fireEvent.click(screen.getByText('menu.linux.label_shutdown_server'))

      // The only action here that needs someone to physically press a power
      // button afterwards
      expect(modal.lastOpened()?.component).toBe(Confirm)
      expect(modal.lastOpened()?.options).toEqual({ size: 'lg', backdrop: 'static' })
    })

    it('shuts down once confirmed', async () => {
      const view = await open('power', { env: { canShutdownRestartHost: true } })

      fireEvent.click(screen.getByText('menu.linux.label_shutdown_server'))
      await act(async () => modal.lastOpened()!.ref.close())

      expect(path(view)).toBe('/platform-tools/linux/shutdown-server')
    })

    it('does nothing when the shutdown is called off', async () => {
      const view = await open('power', { env: { canShutdownRestartHost: true } })

      fireEvent.click(screen.getByText('menu.linux.label_shutdown_server'))
      await act(async () => modal.lastOpened()!.ref.dismiss('Dismiss'))

      expect(path(view)).toBe('/power-options')
    })

    it('clears the pending-restart reminder whichever route is taken', async () => {
      await open('power')
      settingsActions.showRestartToast()
      const reminder = toast.at('info')[0]

      fireEvent.click(screen.getByText('menu.hbrestart.confirm_hb'))

      // The user is acting on that reminder right now, so leaving it on screen
      // would tell them to do something they have just done
      expect(toast.clear).toHaveBeenCalledWith(reminder.toastId)
      expect(settingsActions.hasRestartToast()).toBe(false)
    })

    it('copes with there being no reminder to clear', async () => {
      const view = await open('power')

      fireEvent.click(screen.getByText('menu.hbrestart.confirm_hb'))

      expect(toast.clear).not.toHaveBeenCalled()
      expect(path(view)).toBe('/restart')
    })
  })
})
