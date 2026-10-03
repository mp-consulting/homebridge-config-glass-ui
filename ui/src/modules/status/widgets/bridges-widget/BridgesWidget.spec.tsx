import type { BridgesDeps } from '@/modules/status/widgets/bridges-widget/bridges.store'
import type { FakeIoNamespace, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth'
import { ttlCache } from '@/core/caching'
import { useSettingsStore } from '@/core/settings'
import { ws as realWs } from '@/core/ws'
import { createBridgesStore, isChildMatterEnabled } from '@/modules/status/widgets/bridges-widget/bridges.store'
import { BridgesWidget } from '@/modules/status/widgets/bridges-widget/BridgesWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { fakeWs, makeAuthState, makeSettingsState } from '@/testing'

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

/**
 * The bridges widget: the main Homebridge instance plus every child bridge, each
 * with a status and a restart button.
 *
 * It announces restarts to a screen reader, and only when the user asked for
 * one. The row already says "Restarting", so the announcement waits for the
 * status to actually settle before saying what happened - and says it once per
 * click, not once per status event.
 */
describe('the bridges widget', () => {
  let ws: FakeWs
  let mainIo: FakeIoNamespace
  let childIo: FakeIoNamespace
  let teardown: () => void
  let deps: BridgesDeps & { api: { put: Mock<(...args: any[]) => any> }, cache: { invalidateAll: Mock<(...args: any[]) => any> }, toastError: Mock<(...args: any[]) => any> }

  function makeBridge(overrides: Record<string, any> = {}): any {
    return {
      username: '0E:11:11:11:11:11',
      name: 'Kitchen Bridge',
      plugin: 'homebridge-test',
      status: 'ok',
      paired: true,
      pid: 1234,
      ...overrides,
    }
  }

  /** Build the controller the widget renders, the way the widget does. */
  async function open(options: { matterSupport?: boolean, status?: Record<string, any>, bridges?: any[], admin?: boolean } = {}) {
    ws = fakeWs()
    mainIo = ws.namespace('status')
    childIo = ws.namespace('child-bridges')
    mainIo.socket.respondTo('get-homebridge-status', options.status ?? { status: 'ok', name: 'Homebridge' })
    childIo.socket.respondTo('get-homebridge-child-bridge-status', options.bridges ?? [])
    childIo.socket.respondTo('restart-child-bridge', {})
    deps = {
      ws: ws as any,
      api: { put: vi.fn(async () => ({})) },
      cache: { invalidateAll: vi.fn() },
      toastError: vi.fn(),
      // Keys, like the Angular specs' untranslated pipe
      t: key => key,
      isAdmin: options.admin ?? true,
      isMatterSupported: options.matterSupport ?? false,
    }
    const ctrl = createBridgesStore(deps)
    teardown = ctrl.getState().connect()
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }
    return ctrl
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('listing the bridges', () => {
    it('reads the main homebridge status', async () => {
      const ctrl = await open({ status: { status: 'ok', name: 'My Homebridge' } })

      expect(ctrl.getState().homebridgeStatus).toMatchObject({ status: 'ok', name: 'My Homebridge' })
    })

    it('lists the child bridges by name', async () => {
      const ctrl = await open({
        bridges: [
          makeBridge({ name: 'Zulu', username: '0E:33:33:33:33:33' }),
          makeBridge({ name: 'Alpha', username: '0E:11:11:11:11:11' }),
        ],
      })

      // Sorted, because the server returns them in config order and the user scans this list looking for one bridge
      expect(ctrl.getState().childBridges.map(bridge => bridge.name)).toEqual(['Alpha', 'Zulu'])
    })

    it('asks the server to keep it posted', async () => {
      await open()

      expect(childIo.socket.payloadsFor('monitor-child-bridge-status')).toHaveLength(1)
    })

    it('starts every bridge as not restarting', async () => {
      const ctrl = await open({ bridges: [makeBridge()] })

      expect(ctrl.getState().childBridges[0].restarting).toBe(false)
    })

    it('updates a bridge in place when its status changes', async () => {
      const ctrl = await open({ bridges: [makeBridge()] })

      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'down' }))

      expect(ctrl.getState().childBridges).toHaveLength(1)
      expect(ctrl.getState().childBridges[0].status).toBe('down')
    })

    it('adds a bridge it has not seen before', async () => {
      const ctrl = await open({ bridges: [makeBridge({ name: 'Zulu' })] })

      childIo.socket.fire('child-bridge-status-update', makeBridge({ name: 'Alpha', username: '0E:22:22:22:22:22' }))

      // A plugin can be configured while the page is open
      expect(ctrl.getState().childBridges.map(bridge => bridge.name)).toEqual(['Alpha', 'Zulu'])
    })

    it('marks the main bridge as down when the socket drops', async () => {
      const ctrl = await open()

      mainIo.socket.fire('disconnect')

      // The server is gone, so its last reported status is no longer true
      expect(ctrl.getState().homebridgeStatus?.status).toBe('down')
    })

    it('keeps the bridge name when the socket drops', async () => {
      const ctrl = await open({ status: { status: 'ok', name: 'My Homebridge' } })

      mainIo.socket.fire('disconnect')

      // Only the status is replaced, so the row does not lose its label
      expect(ctrl.getState().homebridgeStatus?.name).toBe('My Homebridge')
    })
  })

  describe('the bridge status icons', () => {
    it('reads no matter config as not enabled for the aria label', async () => {
      const ctrl = await open({ matterSupport: true, bridges: [makeBridge()] })

      expect(isChildMatterEnabled(ctrl.getState().childBridges[0])).toBe(false)
    })

    it('treats a configured matter bridge as enabled', async () => {
      const ctrl = await open({ matterSupport: true, bridges: [makeBridge({ matterConfig: { port: 5540 } })] })

      expect(isChildMatterEnabled(ctrl.getState().childBridges[0])).toBe(true)
    })

    it('treats a matter bridge turned off in place as not enabled', async () => {
      // Still configured, so the icon shows, but it is not advertising anything
      const ctrl = await open({ matterSupport: true, bridges: [makeBridge({ matterConfig: { port: 5540, enabled: false } })] })

      expect(isChildMatterEnabled(ctrl.getState().childBridges[0])).toBe(false)
    })

    it('maps the main bridge into the shared icon source', async () => {
      const ctrl = await open({
        matterSupport: true,
        status: { status: 'ok', hap: { enabled: false, externalsOnly: true }, matter: { enabled: true, externalsOnly: true } },
      })

      expect(ctrl.getState().mainBridgeIconSource()).toEqual({
        status: 'ok',
        hap: { enabled: false, externalsOnly: true },
        matterConfig: { enabled: true, externalsOnly: true },
      })
    })
  })

  describe('what a screen reader hears', () => {
    it('reads the name, the status and the restart action', async () => {
      const ctrl = await open({ status: { status: 'ok', name: 'My Homebridge' } })

      expect(ctrl.getState().mainBridgeAriaLabel()).toBe('My Homebridge, status.services.label_running, menu.tooltip_restart')
    })

    it('says restarting instead of a status while in transition', async () => {
      const ctrl = await open({ status: { status: 'pending', name: 'My Homebridge' } })

      // And drops the restart action, because pressing it again does nothing
      expect(ctrl.getState().mainBridgeAriaLabel()).toBe('My Homebridge, status.services.label_restarting')
    })

    it('leaves out the restart action for a non-admin', async () => {
      const ctrl = await open({ status: { status: 'ok', name: 'My Homebridge' }, admin: false })

      expect(ctrl.getState().mainBridgeAriaLabel()).toBe('My Homebridge, status.services.label_running')
    })

    it('falls back to Homebridge when the status has no name', async () => {
      const ctrl = await open({ status: { status: 'ok' } })

      expect(ctrl.getState().mainBridgeAriaLabel()).toContain('Homebridge,')
    })

    it('adds the matter state when matter is supported', async () => {
      const ctrl = await open({ matterSupport: true, status: { status: 'ok', name: 'My Homebridge', matter: { enabled: true } } })

      expect(ctrl.getState().mainBridgeAriaLabel())
        .toBe('My Homebridge, status.services.label_running, status.services.matter_running, menu.tooltip_restart')
    })

    it('says matter is not enabled when it is not configured', async () => {
      const ctrl = await open({ matterSupport: true, status: { status: 'ok', name: 'My Homebridge' } })

      expect(ctrl.getState().mainBridgeAriaLabel()).toContain('status.services.matter_not_enabled')
    })

    it('leaves matter out entirely when the server does not support it', async () => {
      const ctrl = await open({ status: { status: 'ok', name: 'My Homebridge' } })

      expect(ctrl.getState().mainBridgeAriaLabel()).not.toContain('matter')
    })

    it('leaves matter out during a transition', async () => {
      const ctrl = await open({ matterSupport: true, status: { status: 'pending', name: 'My Homebridge' } })

      expect(ctrl.getState().mainBridgeAriaLabel()).not.toContain('matter')
    })

    it('reads a child bridge the same way', async () => {
      const ctrl = await open({ bridges: [makeBridge({ name: 'Kitchen Bridge' })] })

      expect(ctrl.getState().childBridgeAriaLabel(ctrl.getState().childBridges[0])).toBe('Kitchen Bridge, status.services.label_running, menu.tooltip_restart')
    })

    it('says restarting for a child bridge being restarted', async () => {
      const ctrl = await open({ bridges: [makeBridge()] })

      expect(ctrl.getState().childBridgeAriaLabel({ ...ctrl.getState().childBridges[0], restarting: true })).toBe('Kitchen Bridge, status.services.label_restarting')
    })
  })

  describe('restarting homebridge', () => {
    it('asks the server and clears every cache', async () => {
      vi.useFakeTimers()
      const ctrl = await open()

      await ctrl.getState().restartHomebridge()

      expect(deps.api.put).toHaveBeenCalledWith('/server/restart', {})
      // Everything cached describes a process that is being replaced
      expect(deps.cache.invalidateAll).toHaveBeenCalled()
      expect(ctrl.getState().isRestarting).toBe(true)
    })

    it('stops showing as restarting when homebridge reports itself up', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()

      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })

      expect(ctrl.getState().isRestarting).toBe(false)
    })

    it('gives up waiting after fifteen seconds', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()

      await vi.advanceTimersByTimeAsync(15000)

      // Otherwise a restart that never reports back leaves the row spinning
      expect(ctrl.getState().isRestarting).toBe(false)
    })

    it('tells the user when the restart cannot be started', async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const ctrl = await open()
      deps.api.put.mockRejectedValue(new Error('offline'))

      await ctrl.getState().restartHomebridge()

      expect(deps.toastError).toHaveBeenCalledWith('restart.toast_server_restart_error', 'toast.title_error')
      expect(deps.cache.invalidateAll).not.toHaveBeenCalled()
    })
  })

  describe('restarting a child bridge', () => {
    it('asks the child socket to restart it by id', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })

      await ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      expect(childIo.requests.at(-1)).toEqual({ resource: 'restart-child-bridge', payload: '0E:11:11:11:11:11' })
    })

    it('shows that one bridge as restarting, not all of them', async () => {
      vi.useFakeTimers()
      const ctrl = await open({
        bridges: [makeBridge({ name: 'Alpha', username: '0E:11:11:11:11:11' }), makeBridge({ name: 'Beta', username: '0E:22:22:22:22:22' })],
      })

      void ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      expect(ctrl.getState().childBridges[0].restarting).toBe(true)
      expect(ctrl.getState().childBridges[1].restarting).toBe(false)
    })

    it('stops showing as restarting when that bridge reports itself up', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })
      void ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'ok' }))

      expect(ctrl.getState().childBridges[0].restarting).toBe(false)
    })

    it('keeps showing as restarting while it is still down', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })
      void ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'down' }))

      // A bridge on its way back up reports down first
      expect(ctrl.getState().childBridges[0].restarting).toBe(true)
    })

    it('gives up waiting after fifteen seconds', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })
      void ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      await vi.advanceTimersByTimeAsync(15000)

      expect(ctrl.getState().childBridges[0].restarting).toBe(false)
    })

    it('tells the user when the restart is refused', async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const ctrl = await open({ bridges: [makeBridge()] })
      childIo.socket.respondTo('restart-child-bridge', { error: 'not running' })

      await ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      expect(deps.toastError).toHaveBeenCalledWith('status.widget.bridge.restart_error', 'toast.title_error')
    })
  })

  describe('announcing a finished restart', () => {
    async function restartHomebridgeAndSettle(ctrl: ReturnType<typeof createBridgesStore>, finalStatus = 'ok') {
      await ctrl.getState().restartHomebridge()
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: finalStatus, name: 'Homebridge' })
      await vi.advanceTimersByTimeAsync(3000)
    }

    it('says nothing until the status has settled', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })

      await vi.advanceTimersByTimeAsync(3000)

      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
    })

    it('waits before speaking, because the status flaps on the way up', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })

      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
    })

    it('announces the finished state three seconds after it settles', async () => {
      vi.useFakeTimers()
      const ctrl = await open()

      await restartHomebridgeAndSettle(ctrl)

      // The delay lets plugins finish loading, so the announcement reflects the state the user will actually see
      expect(ctrl.getState().homebridgeLiveMessage).toBe('status.widget.bridge.restart_complete_with_status')
    })

    it('clears the announcement so it is not read again', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await restartHomebridgeAndSettle(ctrl)

      await vi.advanceTimersByTimeAsync(3000)

      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
    })

    it('announces only once per restart', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })
      await vi.advanceTimersByTimeAsync(3000)
      const first = ctrl.getState().homebridgeLiveMessage

      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })
      await vi.advanceTimersByTimeAsync(3000)

      // A live region that repeats is read out again every time
      expect(first).not.toBe('')
      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
    })

    it('says nothing when it drops back to restarting before the announcement', async () => {
      // ⚠️ A restart that settles and then goes pending again - a plugin crashing
      // homebridge on load - would otherwise be announced as finished
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })

      await vi.advanceTimersByTimeAsync(3000)

      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
    })

    it('says nothing about a child bridge that drops back to restarting', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })
      await ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'pending' }))
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'ok' }))
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'pending' }))

      await vi.advanceTimersByTimeAsync(3000)

      expect(ctrl.getState().childBridgeLiveMessages['0E:11:11:11:11:11']).toBeFalsy()
    })

    it('tracks a bridge that has no username by its name', async () => {
      // Without the fallback a bridge whose config carries no username is filed
      // under `undefined`, so any two of them share one restart state and one announcement
      vi.useFakeTimers()
      const nameless = makeBridge({ username: undefined, name: 'Nameless Bridge' })
      const ctrl = await open({ bridges: [nameless] })

      await ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])
      childIo.socket.fire('child-bridge-status-update', { ...nameless, status: 'pending' })
      childIo.socket.fire('child-bridge-status-update', { ...nameless, status: 'ok' })
      await vi.advanceTimersByTimeAsync(3000)

      expect(ctrl.getState().childBridgeLiveMessages['Nameless Bridge']).toBeTruthy()
    })

    it('says nothing about a restart the user did not ask for', async () => {
      vi.useFakeTimers()
      const ctrl = await open()

      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })
      // Exactly the settle delay, not longer: advancing past the follow-up clear
      // would make an announcement that *was* made look like one that was not
      await vi.advanceTimersByTimeAsync(3000)

      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
    })

    it('announces a restart that ended with homebridge down', async () => {
      vi.useFakeTimers()
      const ctrl = await open()

      await restartHomebridgeAndSettle(ctrl, 'down')

      // The whole point of the announcement: telling a screen reader user the restart finished badly
      expect(ctrl.getState().homebridgeLiveMessage).toBe('status.widget.bridge.restart_complete_with_status')
    })

    it('announces a finished child bridge restart against that bridge', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })
      void ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])

      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'pending' }))
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'ok' }))
      await vi.advanceTimersByTimeAsync(3000)

      // Keyed by bridge, so restarting two at once does not cross the messages
      expect(ctrl.getState().childBridgeLiveMessages['0E:11:11:11:11:11']).toBe('status.widget.bridge.restart_complete_with_status')
    })

    it('clears a child bridge message again too', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })
      void ctrl.getState().restartChildBridge(ctrl.getState().childBridges[0])
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'pending' }))
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'ok' }))
      await vi.advanceTimersByTimeAsync(6000)

      expect(ctrl.getState().childBridgeLiveMessages['0E:11:11:11:11:11']).toBe('')
    })

    it('says nothing about a child bridge restarting on its own', async () => {
      vi.useFakeTimers()
      const ctrl = await open({ bridges: [makeBridge()] })

      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'pending' }))
      childIo.socket.fire('child-bridge-status-update', makeBridge({ status: 'ok' }))
      await vi.advanceTimersByTimeAsync(6000)

      expect(ctrl.getState().childBridgeLiveMessages['0E:11:11:11:11:11']).toBeUndefined()
    })

    it('drops its pending announcements when the widget is removed', async () => {
      vi.useFakeTimers()
      const ctrl = await open()
      await ctrl.getState().restartHomebridge()
      mainIo.socket.fire('homebridge-status', { status: 'pending', name: 'Homebridge' })
      mainIo.socket.fire('homebridge-status', { status: 'ok', name: 'Homebridge' })

      teardown()
      await vi.advanceTimersByTimeAsync(6000)

      // A timer firing into a destroyed widget announces into nothing
      expect(ctrl.getState().homebridgeLiveMessage).toBe('')
      expect(childIo.end).toHaveBeenCalled()
    })

    it('releases its hold on the shared status socket when the widget is removed', async () => {
      // end() only drops this widget's reference - the ws service keeps the
      // server session up while the status page still holds it
      await open()

      teardown()

      expect(mainIo.end).toHaveBeenCalledTimes(1)
    })

    it('detaches its own listeners when the widget is removed', async () => {
      await open()
      const before = {
        status: mainIo.socket.handlers('homebridge-status').length,
        disconnect: mainIo.socket.handlers('disconnect').length,
        child: childIo.socket.handlers('child-bridge-status-update').length,
      }

      teardown()

      expect(mainIo.socket.handlers('homebridge-status')).toHaveLength(before.status - 1)
      expect(mainIo.socket.handlers('disconnect')).toHaveLength(before.disconnect - 1)
      expect(childIo.socket.handlers('child-bridge-status-update')).toHaveLength(before.child - 1)
      expect(mainIo.connected.subscriberCount()).toBe(0)
      expect(childIo.connected.subscriberCount()).toBe(0)
    })
  })

  /** The rendered rows, against the app's singletons. */
  describe('the rows', () => {
    const appWs = realWs as unknown as FakeWs

    async function render_(options: { admin?: boolean, bridges?: any[], status?: Record<string, any> } = {}) {
      useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
      useSettingsStore.setState(makeSettingsState())
      appWs.namespaces.clear()
      const main = appWs.namespace('status')
      const child = appWs.namespace('child-bridges')
      main.socket.respondTo('get-homebridge-status', options.status ?? { status: 'ok', name: 'My Homebridge' })
      child.socket.respondTo('get-homebridge-child-bridge-status', options.bridges ?? [makeBridge()])
      child.socket.respondTo('restart-child-bridge', {})
      const result = render(
        <BridgesWidget
          widget={{ component: 'BridgesWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false }}
          resizeEvent={createWidgetEvent()}
          configureEvent={createWidgetEvent()}
          updateWidget={vi.fn()}
          saveWidgets={vi.fn()}
        />,
      )
      await act(async () => {})
      return { ...result, main, child }
    }

    it('shows the main bridge and each child bridge as a button', async () => {
      await render_()

      expect(screen.getByRole('button', { name: 'My Homebridge, status.services.label_running, menu.tooltip_restart' })).toHaveTextContent('My Homebridge')
      expect(screen.getByRole('button', { name: 'Kitchen Bridge, status.services.label_running, menu.tooltip_restart' })).toHaveTextContent('Kitchen Bridge')
      expect(screen.getAllByRole('status')).toHaveLength(2)
    })

    it('restarts homebridge from its row', async () => {
      vi.useFakeTimers()
      const put = vi.spyOn(api, 'put').mockResolvedValue({})
      const invalidateAll = vi.spyOn(ttlCache, 'invalidateAll')
      const { container } = await render_()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^My Homebridge/ }))
      })

      expect(put).toHaveBeenCalledWith('/server/restart', {})
      expect(invalidateAll).toHaveBeenCalled()
      // Every row spins while the server restarts
      expect(container.querySelectorAll('.fa-circle-notch')).toHaveLength(2)
      expect(screen.getByRole('button', { name: /^My Homebridge/ })).toHaveAttribute('aria-disabled', 'true')
    })

    it('restarts a child bridge from its row', async () => {
      vi.useFakeTimers()
      const { child } = await render_()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Kitchen Bridge/ }))
      })

      expect(child.requests.at(-1)).toEqual({ resource: 'restart-child-bridge', payload: '0E:11:11:11:11:11' })
    })

    it('gives a non-admin nothing to press', async () => {
      const put = vi.spyOn(api, 'put').mockResolvedValue({})
      const { container } = await render_({ admin: false })

      fireEvent.click(screen.getByRole('button', { name: /^My Homebridge/ }))

      expect(put).not.toHaveBeenCalled()
      expect(container.querySelector('.fa-power-off')).toBeNull()
      expect(screen.getByRole('button', { name: /^My Homebridge/ })).toHaveAttribute('aria-disabled', 'true')
    })

    it('lets go of both sockets when removed', async () => {
      const { unmount, main, child } = await render_()

      unmount()

      expect(main.end).toHaveBeenCalled()
      expect(child.end).toHaveBeenCalled()
    })
  })
})
