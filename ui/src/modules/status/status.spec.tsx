import type { StatusStoreApi } from '@/modules/status/status.store'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { notifications } from '@/core/notifications'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { Credits } from '@/modules/status/credits/Credits'
import defaultLayout from '@/modules/status/default-dashboard-layout.json'
import { Status } from '@/modules/status/Status'
import { createStatusStore } from '@/modules/status/status.store'
import { WidgetControl } from '@/modules/status/widget-control/WidgetControl'
import { WidgetVisibility } from '@/modules/status/widget-visibility/WidgetVisibility'
import { AVAILABLE_WIDGETS } from '@/modules/status/widgets/widget.types'
import { fakeOpenModal, fakeWs, locationReload, makeAuthState, makeSettingsState, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({
  toast: null as ReturnType<typeof toastStub> | null,
  modal: null as FakeOpenModal | null,
  ws: null as FakeWs | null,
  widgetProps: new Map<string, WidgetProps>(),
}))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))
vi.mock('@/core/ui/modal', () => ({
  openModal: (...args: Parameters<FakeOpenModal['openModal']>) => holder.modal!.openModal(...args),
}))
vi.mock('@/core/ws', () => ({
  get ws() {
    return holder.ws
  },
}))
// Every widget has its own spec; here each one is a stub that records its props
vi.mock('@/modules/status/widgets/widgetRegistry', async () => {
  const { AVAILABLE_WIDGETS: names } = await import('@/modules/status/widgets/widget.types')
  const Stub = (props: WidgetProps) => {
    holder.widgetProps.set(props.widget.component, props)
    return <div data-testid={`widget-${props.widget.component}`} />
  }
  return { widgetRegistry: Object.fromEntries(names.map(name => [name, Stub])) }
})

/**
 * The status page - the dashboard the user lands on.
 *
 * It is a grid of widgets whose positions are saved on the server, and most of
 * the interesting behaviour is about that layout: it is loaded over the
 * websocket rather than HTTP, the "loaded" flag is only set once the layout has
 * actually been applied so a dropped acknowledgement retries on the next
 * reconnect, and there is a whole keyboard reordering mode that exists because a
 * drag-and-drop grid is unusable with a screen reader.
 */
describe('status page', () => {
  let ws: FakeWs
  let io: FakeIoNamespace
  let modal: FakeOpenModal
  let toast: ReturnType<typeof toastStub>
  let store: StatusStoreApi
  let navigationGuard: { canDeactivate: ReturnType<typeof vi.fn>, handleBeforeUnload: ReturnType<typeof vi.fn> }
  let setPageTitle: ReturnType<typeof vi.spyOn>

  /**
   * A saved widget as the layout endpoint returns it.
   * @param component - the widget's component name
   * @param overrides - fields to change
   */
  function widget(component: string, overrides: Record<string, any> = {}) {
    return { x: 0, y: 0, cols: 5, rows: 5, component, mobileOrder: 0, ...overrides }
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /** The current store state (the Angular component instance). */
  const page = () => store.getState()

  /**
   * Build the page.
   * @param options - how to set it up
   * @param options.layout - the saved widget layout
   * @param options.rpiThrottled - the throttle report from the server
   * @param options.failLoad - make the layout request error
   * @param options.connected - whether the socket starts connected
   * @param options.admin - whether the signed-in user is an admin
   * @param options.matterSupport - whether the running homebridge speaks matter
   * @param options.enableAccessories - whether accessory control is switched on
   * @param options.glassMode - the glass look (wider grid gutters)
   */
  async function open(options: {
    layout?: any[]
    rpiThrottled?: Record<string, boolean>
    failLoad?: boolean
    connected?: boolean
    admin?: boolean
    matterSupport?: boolean
    enableAccessories?: boolean
    glassMode?: boolean
  } = {}) {
    useSettingsStore.setState(makeSettingsState({
      env: {
        enableAccessories: options.enableAccessories ?? true,
        featureFlags: { matterSupport: options.matterSupport ?? true },
      },
      glassMode: options.glassMode ?? true,
    }))
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    toast = toastStub()
    holder.toast = toast
    modal = fakeOpenModal()
    holder.modal = modal
    ws = fakeWs()
    holder.ws = ws
    io = ws.namespace('status', { connected: options.connected ?? true })
    navigationGuard = { canDeactivate: vi.fn(async () => true), handleBeforeUnload: vi.fn(() => 'stay') }
    setPageTitle = vi.spyOn(settingsActions, 'setPageTitle')

    io.socket.respondTo('get-dashboard-init', options.failLoad
      ? { error: 'no layout' }
      : { layout: options.layout ?? [], rpiThrottled: options.rpiThrottled })
    io.socket.respondTo('set-dashboard-layout', {})

    store = createStatusStore({ navigationGuard: navigationGuard as any })
    const view = renderWithProviders(<Status store={store} />)
    await settle()
    return view
  }

  /** The layout most recently sent to the server. */
  function savedLayout(): any[] {
    return io.requests.filter(request => request.resource === 'set-dashboard-layout').at(-1)?.payload
  }

  const components = () => page().dashboard.map(item => item.component)

  beforeEach(() => {
    locationReload.mockClear()
    holder.widgetProps.clear()
    notifications.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('loading the dashboard', () => {
    it('shows the instance name rather than a page name', async () => {
      await open()

      // Called with nothing: the status page is the one screen titled after the
      // Homebridge instance itself
      expect(setPageTitle).toHaveBeenCalledWith()
    })

    it('asks the socket for the saved layout', async () => {
      await open({ layout: [widget('CpuWidgetComponent'), widget('MemoryWidgetComponent')] })

      expect(ws.connectToNamespace).toHaveBeenCalledWith('status')
      expect(components()).toEqual(['CpuWidgetComponent', 'MemoryWidgetComponent'])
    })

    it('asks the server to stream its status', async () => {
      await open()

      expect(io.socket.payloadsFor('monitor-server-status')).toHaveLength(1)
    })

    it('reports the console as up once the socket connects', async () => {
      await open()

      expect(page().consoleStatus).toBe('up')
    })

    it('reports the console as down before it connects', async () => {
      const { container } = await open({ connected: false })

      // The spinner is the only sign the page has lost the server
      expect(page().consoleStatus).toBe('down')
      expect(page().dashboard).toEqual([])
      expect(container.querySelector('.status-container')).not.toBeNull()
    })

    it('reports the console as down again when the socket drops', async () => {
      await open()

      act(() => io.socket.fire('disconnect'))

      expect(page().consoleStatus).toBe('down')
    })

    it('loads the layout on the connect that arrives late', async () => {
      await open({ connected: false, layout: [widget('CpuWidgetComponent')] })

      act(() => io.markConnected())
      await settle()

      expect(components()).toEqual(['CpuWidgetComponent'])
    })

    it('tries again on the next connect when the first load fails', async () => {
      await open({ failLoad: true })
      expect(toast.at('error')).toHaveLength(1)

      io.socket.respondTo('get-dashboard-init', { layout: [widget('CpuWidgetComponent')] })
      act(() => io.markConnected())
      await settle()

      // The flag is only set once the layout has been applied, so a dropped
      // acknowledgement does not leave the dashboard permanently empty
      expect(components()).toEqual(['CpuWidgetComponent'])
    })

    it('does not reload the layout on a reconnect', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      act(() => io.markConnected())
      await settle()

      // Reapplying it would undo anything the user has moved since
      expect(io.requests.filter(request => request.resource === 'get-dashboard-init')).toHaveLength(2)
      expect(io.requests.filter(request => request.resource === 'set-dashboard-layout')).toHaveLength(0)
    })

    it('raises the raspberry pi throttle warning', async () => {
      await open({ rpiThrottled: { UnderVoltage: true } })

      expect(notifications.get('raspberryPiThrottled')).toEqual({ UnderVoltage: true })
    })

    it('reloads the page when the server is running different code', async () => {
      await open()

      act(() => io.socket.fire('homebridge-status', { packageVersion: '99.0.0' }))

      // The bundle this page was served from no longer matches the server, so
      // its socket contract may not either
      expect(locationReload).toHaveBeenCalled()
    })

    it('stays put when the versions agree', async () => {
      await open()

      act(() => io.socket.fire('homebridge-status', { packageVersion: useSettingsStore.getState().uiVersion }))

      expect(locationReload).not.toHaveBeenCalled()
    })

    it('lets go of the socket and its listeners on leaving', async () => {
      const view = await open()

      view.unmount()

      expect(io.end).toHaveBeenCalled()
      expect(io.socket.handlers('homebridge-status')).toHaveLength(0)
      expect(io.connected.subscriberCount()).toBe(0)
    })
  })

  describe('unlocking the grid', () => {
    it('starts locked', async () => {
      const { container } = await open({ layout: [widget('CpuWidgetComponent')] })

      // A dashboard that rearranges itself on a stray drag is worse than one
      // that needs a button pressed first
      expect(page().isUnlocked).toBe(false)
      expect(container.querySelector('.gridster')).not.toHaveClass('layout-editing')
    })

    it('allows dragging and resizing when unlocked', async () => {
      const { container } = await open({ layout: [widget('CpuWidgetComponent')] })

      act(() => page().unlockLayout())

      expect(page().isUnlocked).toBe(true)
      expect(container.querySelector('.gridster')).toHaveClass('layout-editing')
      expect(container.querySelector('.widget-grip')).not.toBeNull()
    })

    it('marks the widgets undraggable again when locked', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      act(() => page().unlockLayout())
      expect(page().dashboard[0].draggable).toBe(true)

      act(() => page().lockLayout())

      // The saved layout carries each widget's draggable flag (the Angular UI's
      // gridster wrote it), so it has to follow the lock
      expect(page().isUnlocked).toBe(false)
      expect(page().dashboard[0].draggable).toBe(false)
    })

    it('does not write the layout just for locking', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      act(() => page().unlockLayout())

      act(() => page().lockLayout())

      // Nothing has moved, so there is nothing to save; the write happens when
      // the grid reports a change, when a widget asks, or on leaving reorder mode
      expect(savedLayout()).toBeUndefined()
    })

    it('saves a reorder in progress rather than discarding it', async () => {
      await open({
        layout: [widget('CpuWidgetComponent'), widget('MemoryWidgetComponent', { mobileOrder: 1 })],
      })
      vi.useFakeTimers()
      act(() => {
        page().unlockLayout()
        page().toggleReorderMode()
        page().moveComponent('MemoryWidgetComponent', -1)
      })

      act(() => page().lockLayout())

      // Locking means "I am done", so an unsaved reorder is applied rather than
      // thrown away
      expect(page().reorderMode).toBe(false)
      expect(savedLayout().map((item: any) => item.component)).toEqual(['MemoryWidgetComponent', 'CpuWidgetComponent'])
    })

    it('puts every widget back on cancel', async () => {
      await open({ layout: [widget('CpuWidgetComponent', { x: 0, y: 0 })] })
      act(() => page().unlockLayout())
      act(() => page().applyGridLayout([{ i: 'CpuWidgetComponent', x: 7, y: 3, w: 6, h: 4 }], true))

      act(() => page().cancelLayoutEditing())

      expect(page().isUnlocked).toBe(false)
      expect(page().dashboard[0]).toMatchObject({ x: 0, y: 0, cols: 5, rows: 5 })
      expect(savedLayout()[0]).toMatchObject({ x: 0, y: 0, cols: 5, rows: 5 })
    })

    it('finishes editing on escape', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      act(() => page().unlockLayout())

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(page().isUnlocked).toBe(false)
    })

    it('leaves escape to an open dialog', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      act(() => page().unlockLayout())
      const dialog = document.createElement('div')
      dialog.className = 'modal show'
      document.body.append(dialog)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(page().isUnlocked).toBe(true)
      dialog.remove()
    })

    it('toggles editing from the header button', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      fireEvent.click(screen.getByRole('button', { name: 'status.layout.edit' }))
      expect(page().isUnlocked).toBe(true)
      expect(screen.getByRole('button', { name: 'status.layout.done', pressed: true })).toHaveClass('active')

      fireEvent.click(screen.getByRole('button', { name: 'status.layout.done', pressed: true }))
      expect(page().isUnlocked).toBe(false)
    })

    it('shows no editing controls to a non-admin', async () => {
      await open({ admin: false, layout: [widget('CpuWidgetComponent')] })

      expect(screen.queryByRole('button', { name: 'status.layout.edit' })).toBeNull()
    })
  })

  describe('saving the layout', () => {
    it('saves when a widget asks it to', async () => {
      await open({ layout: [widget('AccessoriesWidgetComponent')] })

      // The accessories widget reorders its own contents, and that is part of
      // the saved layout
      await act(async () => holder.widgetProps.get('AccessoriesWidgetComponent')!.saveWidgets({ accessoryOrder: ['a', 'b'] }))

      expect(savedLayout()).toEqual([expect.objectContaining({ component: 'AccessoriesWidgetComponent', accessoryOrder: ['a', 'b'] })])
    })

    it('never sends private keys a layout might carry', async () => {
      await open({ layout: [widget('CpuWidgetComponent', { $resizeEvent: {} })] })

      await act(async () => page().saveWidgets())

      const [saved] = savedLayout()
      expect(saved.$resizeEvent).toBeUndefined()
      expect(saved.component).toBe('CpuWidgetComponent')
    })

    it('sorts by the mobile order so the phone layout matches', async () => {
      await open({
        layout: [
          widget('CpuWidgetComponent', { mobileOrder: 2 }),
          widget('MemoryWidgetComponent', { mobileOrder: 0 }),
          widget('NetworkWidgetComponent', { mobileOrder: 1 }),
        ],
      })

      await act(async () => page().saveWidgets())

      expect(components()).toEqual(['MemoryWidgetComponent', 'NetworkWidgetComponent', 'CpuWidgetComponent'])
    })

    it('does not send the layout for a non-admin', async () => {
      // The layout is shared by every user and the server refuses the write
      // from a non-admin, so sending it only produced a rejected request
      await open({ admin: false, layout: [widget('AccessoriesWidgetComponent')] })

      await act(async () => page().saveWidgets())

      expect(savedLayout()).toBeUndefined()
    })

    it('keeps going when the save is refused', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      io.socket.respondTo('set-dashboard-layout', { error: 'read only' })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await act(async () => page().saveWidgets())

      // Logged rather than shown: the user has not asked for anything, this is a
      // background write
      expect(toast.at('error')).toHaveLength(0)
    })

    it('takes positions from the grid and saves when a drag ends', async () => {
      await open({ layout: [widget('CpuWidgetComponent'), widget('MemoryWidgetComponent', { x: 5 })] })

      act(() => page().applyGridLayout([
        { i: 'CpuWidgetComponent', x: 10, y: 2, w: 4, h: 3 },
        { i: 'MemoryWidgetComponent', x: 5, y: 0, w: 5, h: 5 },
      ], true))

      expect(savedLayout()).toEqual([
        { component: 'CpuWidgetComponent', x: 10, y: 2, cols: 4, rows: 3, mobileOrder: 0, draggable: false },
        { component: 'MemoryWidgetComponent', x: 5, y: 0, cols: 5, rows: 5, mobileOrder: 0, draggable: false },
      ])
    })

    it('takes compacted positions without saving them', async () => {
      await open({ layout: [widget('CpuWidgetComponent', { y: 4 })] })

      act(() => page().applyGridLayout([{ i: 'CpuWidgetComponent', x: 0, y: 0, w: 5, h: 5 }], false))

      expect(page().dashboard[0].y).toBe(0)
      expect(savedLayout()).toBeUndefined()
    })

    it('tells a widget it was resized', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      const resized = vi.fn()
      holder.widgetProps.get('CpuWidgetComponent')!.resizeEvent.subscribe(resized)

      act(() => page().gridResizeEvent('CpuWidgetComponent'))

      expect(resized).toHaveBeenCalledTimes(1)
    })

    it('lets a widget store a setting without saving', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      act(() => holder.widgetProps.get('CpuWidgetComponent')!.updateWidget({ refreshInterval: 10 }))

      // Angular wrote such defaults onto the widget object; they go out with the next save
      expect(page().dashboard[0].refreshInterval).toBe(10)
      expect(holder.widgetProps.get('CpuWidgetComponent')!.widget.refreshInterval).toBe(10)
      expect(savedLayout()).toBeUndefined()
    })
  })

  describe('choosing which widgets to show', () => {
    it('opens the visibility modal with the current dashboard', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      const done = page().addWidget()

      expect(modal.lastOpened()?.component).toBe(WidgetVisibility)
      expect(modal.lastOpened()?.props?.dashboard).toHaveLength(1)
      expect(modal.lastOpened()?.options).toEqual({ size: 'lg', backdrop: 'static' })
      modal.lastOpened()!.ref.dismiss('Dismiss')
      await done
    })

    it('opens it from the eye button while editing', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      act(() => page().unlockLayout())

      fireEvent.click(screen.getByRole('button', { name: 'status.widget.show_hide' }))

      expect(modal.lastOpened()?.component).toBe(WidgetVisibility)
    })

    it('adds a newly visible widget at the bottom', async () => {
      await open({ layout: [widget('CpuWidgetComponent', { y: 0, rows: 5 })] })

      const done = page().addWidget()
      modal.lastOpened()!.ref.close([
        { component: 'MemoryWidgetComponent', showOnDesktop: true, showOnMobile: true, cols: 5, rows: 5, mobileOrder: 1 },
      ])
      await act(async () => done)

      // Placed below everything else so turning a widget on does not shove the
      // user's arrangement around
      const added = page().dashboard.find(item => item.component === 'MemoryWidgetComponent')
      expect(added?.y).toBe(5)
    })

    it('removes a widget hidden on both desktop and mobile', async () => {
      await open({ layout: [widget('CpuWidgetComponent'), widget('MemoryWidgetComponent')] })

      const done = page().addWidget()
      modal.lastOpened()!.ref.close([
        { component: 'MemoryWidgetComponent', showOnDesktop: false, showOnMobile: false, cols: 5, rows: 5, mobileOrder: 1 },
      ])
      await act(async () => done)

      expect(components()).toEqual(['CpuWidgetComponent'])
    })

    it('keeps a widget that is hidden on only one of the two', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      const done = page().addWidget()
      modal.lastOpened()!.ref.close([
        { component: 'CpuWidgetComponent', showOnDesktop: false, showOnMobile: true, hideOnDesktop: true, cols: 5, rows: 5, mobileOrder: 0 },
      ])
      await act(async () => done)

      // Still in the layout, just not drawn on the wider screen
      expect(page().dashboard).toHaveLength(1)
      expect(page().dashboard[0].hideOnDesktop).toBe(true)
      expect(screen.queryByTestId('widget-CpuWidgetComponent')).toBeNull()
    })

    it('keeps the event streams of a widget when its visibility changes', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })
      const before = page().eventsFor('CpuWidgetComponent').resizeEvent

      const done = page().addWidget()
      modal.lastOpened()!.ref.close([
        { component: 'CpuWidgetComponent', showOnDesktop: true, showOnMobile: true, cols: 5, rows: 5, mobileOrder: 0 },
      ])
      await act(async () => done)

      // The widget is not rebuilt, so replacing its events would leave it
      // listening to one nothing writes to
      expect(page().eventsFor('CpuWidgetComponent').resizeEvent).toBe(before)
    })

    it('changes nothing when the modal is dismissed', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      const done = page().addWidget()
      modal.lastOpened()!.ref.dismiss('Dismiss')
      await act(async () => done)

      expect(components()).toEqual(['CpuWidgetComponent'])
      expect(savedLayout()).toBeUndefined()
    })
  })

  describe('the settings of a single widget', () => {
    it('opens the control modal for that widget', async () => {
      await open({ layout: [widget('WeatherWidgetComponent')] })

      const done = page().manageWidget(page().dashboard[0])

      expect(modal.lastOpened()?.component).toBe(WidgetControl)
      expect(modal.lastOpened()?.props?.widget.component).toBe('WeatherWidgetComponent')
      modal.lastOpened()!.ref.dismiss('Dismiss')
      await done
    })

    it('merges the saved settings and tells the widget to re-read them', async () => {
      await open({ layout: [widget('WeatherWidgetComponent')] })
      const configured = vi.fn()
      page().eventsFor('WeatherWidgetComponent').configureEvent.subscribe(configured)

      const done = page().manageWidget(page().dashboard[0])
      modal.lastOpened()!.ref.close({ ...page().dashboard[0], location: { id: '1' } })
      await act(async () => done)
      await settle()

      expect(page().dashboard[0].location).toEqual({ id: '1' })
      expect(configured).toHaveBeenCalled()
      expect(savedLayout()[0].location).toEqual({ id: '1' })
    })

    it('opens from the cog of a widget that has settings', async () => {
      await open({ layout: [widget('CpuWidgetComponent'), widget('UptimeWidgetComponent')] })
      act(() => page().unlockLayout())

      // Only widgets with settings beyond visibility get a cog
      expect(screen.getAllByRole('button', { name: 'status.reorder.widget_settings' })).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'status.reorder.widget_settings' }))

      expect(modal.lastOpened()?.props?.widget.component).toBe('CpuWidgetComponent')
    })

    it('finds the widget by component name', async () => {
      await open({ layout: [widget('WeatherWidgetComponent')] })

      page().manageWidgetByComponent('WeatherWidgetComponent')

      expect(modal.lastOpened()?.component).toBe(WidgetControl)
      modal.lastOpened()!.ref.dismiss('Dismiss')
    })

    it('does nothing for a widget that is not on the dashboard', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      page().manageWidgetByComponent('WeatherWidgetComponent')

      expect(modal.opened).toHaveLength(0)
    })

    it('opens the credits', async () => {
      await open()

      fireEvent.click(screen.getByRole('button', { name: 'status.credits.title' }))

      expect(modal.lastOpened()?.component).toBe(Credits)
    })
  })

  describe('reordering with the keyboard', () => {
    /**
     * Build the page with three widgets in a known order.
     */
    async function openThree() {
      const view = await open({
        layout: [
          widget('CpuWidgetComponent', { mobileOrder: 0 }),
          widget('MemoryWidgetComponent', { mobileOrder: 1 }),
          widget('NetworkWidgetComponent', { mobileOrder: 2 }),
        ],
      })
      vi.useFakeTimers()
      return view
    }

    const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() })

    it('selects the first widget and offers the instructions', async () => {
      await openThree()

      act(() => page().toggleReorderMode())

      // The instructions are the first widget's accessible description, so they
      // are read straight after its name rather than racing a live region
      expect(page().reorderMode).toBe(true)
      expect(page().selectedReorderComponent).toBe('CpuWidgetComponent')
      expect(page().showReorderHelp).toBe(true)
      expect(screen.getByRole('option', { name: 'status.reorder.item_label', selected: true })).toHaveAttribute('aria-describedby', 'reorder-instructions')
    })

    it('replaces the grid with the list', async () => {
      const { container } = await openThree()

      act(() => page().toggleReorderMode())

      expect(screen.getAllByRole('option')).toHaveLength(3)
      expect(container.querySelector('.gridster')).toHaveAttribute('hidden')
    })

    it('moves the keyboard focus onto the selected widget', async () => {
      // ⚠️ The selection is only announced because focus follows it. Without this
      // the reader stays on whatever was focused when the mode was entered and
      // says nothing as the user tabs.
      await openThree()
      act(() => page().toggleReorderMode())
      act(() => vi.runOnlyPendingTimers())
      expect(document.activeElement?.id).toBe('reorder-item-CpuWidgetComponent')

      fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
      act(() => vi.runOnlyPendingTimers())

      expect(document.activeElement?.id).toBe('reorder-item-MemoryWidgetComponent')
    })

    it('moves the selected widget up and down', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => page().onReorderKeydown(key('ArrowDown')))
      expect(components()).toEqual(['MemoryWidgetComponent', 'CpuWidgetComponent', 'NetworkWidgetComponent'])

      act(() => page().onReorderKeydown(key('ArrowUp')))
      expect(components()).toEqual(['CpuWidgetComponent', 'MemoryWidgetComponent', 'NetworkWidgetComponent'])
    })

    it('moves with the row buttons too', async () => {
      await openThree()
      act(() => page().toggleReorderMode())
      const [, memory] = screen.getAllByRole('option')

      fireEvent.click(memory.querySelectorAll('button')[0])

      expect(components()).toEqual(['MemoryWidgetComponent', 'CpuWidgetComponent', 'NetworkWidgetComponent'])
      // The first row cannot go up, nor the last down
      const rows = screen.getAllByRole('option')
      expect(rows[0].querySelectorAll('button')[0]).toBeDisabled()
      expect(rows[2].querySelectorAll('button')[1]).toBeDisabled()
    })

    it('renumbers the mobile order after a move', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => {
        page().moveComponent('NetworkWidgetComponent', -1)
      })

      // The rendered order comes from mobileOrder, so leaving it stale would
      // show a different order from the list the user is editing
      expect(page().dashboard.map(item => item.mobileOrder)).toEqual([0, 1, 2])
      expect(components()).toEqual(['CpuWidgetComponent', 'NetworkWidgetComponent', 'MemoryWidgetComponent'])
    })

    it('refuses to move the first widget up', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      expect(page().moveComponent('CpuWidgetComponent', -1)).toBe(false)
      expect(page().dashboard[0].component).toBe('CpuWidgetComponent')
    })

    it('refuses to move the last widget down', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      expect(page().moveComponent('NetworkWidgetComponent', 1)).toBe(false)
    })

    it('refuses to move a widget that is not there', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      expect(page().moveComponent('WeatherWidgetComponent', 1)).toBe(false)
    })

    it('moves the selection with tab, wrapping round the ends', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => page().onReorderKeydown(key('Tab')))
      expect(page().selectedReorderComponent).toBe('MemoryWidgetComponent')

      act(() => page().onReorderKeydown(key('Tab', true)))
      expect(page().selectedReorderComponent).toBe('CpuWidgetComponent')

      // Wrapping keeps the user inside the list instead of tabbing out of the
      // mode they are in
      act(() => page().onReorderKeydown(key('Tab', true)))
      expect(page().selectedReorderComponent).toBe('NetworkWidgetComponent')
    })

    it('wraps round the end of the list', async () => {
      // ⚠️ Tab is the only way through the list here, so stopping at the end would
      // leave the first widget unreachable without leaving the mode
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => {
        page().onReorderKeydown(key('Tab'))
        page().onReorderKeydown(key('Tab'))
        page().onReorderKeydown(key('Tab'))
      })

      expect(page().selectedReorderComponent).toBe('CpuWidgetComponent')
    })

    it('drops the instructions after the first keypress', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => page().onReorderKeydown(key('Tab')))

      // They only need reading once, and repeating them on every arrow press
      // would drown out the position announcements
      expect(page().showReorderHelp).toBe(false)
    })

    it.each([
      ['Home', ['NetworkWidgetComponent', 'CpuWidgetComponent', 'MemoryWidgetComponent']],
      ['ArrowLeft', ['NetworkWidgetComponent', 'CpuWidgetComponent', 'MemoryWidgetComponent']],
    ])('sends the widget to the top on %s', async (k, expected) => {
      // A long dashboard would otherwise need one arrow press per position
      await openThree()
      act(() => {
        page().toggleReorderMode()
        page().setSelectedReorderComponent('NetworkWidgetComponent')
      })

      act(() => page().onReorderKeydown(key(k)))

      expect(components()).toEqual(expected)
    })

    it.each([
      ['End', ['MemoryWidgetComponent', 'NetworkWidgetComponent', 'CpuWidgetComponent']],
      ['ArrowRight', ['MemoryWidgetComponent', 'NetworkWidgetComponent', 'CpuWidgetComponent']],
    ])('sends the widget to the bottom on %s', async (k, expected) => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => page().onReorderKeydown(key(k)))

      expect(components()).toEqual(expected)
    })

    it('leaves the mode on escape, keeping the changes', async () => {
      await openThree()
      act(() => page().toggleReorderMode())
      act(() => page().onReorderKeydown(key('ArrowDown')))

      act(() => page().onReorderKeydown(key('Escape')))

      // ⚠️ Escape means "I am finished", not "undo": the moves have already been
      // announced as done, so throwing them away here would contradict that
      expect(page().reorderMode).toBe(false)
      expect(savedLayout().map((item: any) => item.component))
        .toEqual(['MemoryWidgetComponent', 'CpuWidgetComponent', 'NetworkWidgetComponent'])
    })

    it.each([
      ['a key it does not use', 'a'],
      ['the space bar', ' '],
      ['enter', 'Enter'],
    ])('lets %s through to the page', async (_case, k) => {
      // ⚠️ Swallowing everything would make the mode a keyboard trap
      await openThree()
      act(() => page().toggleReorderMode())
      const event = key(k)

      act(() => page().onReorderKeydown(event))

      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it.each(['ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab', 'Escape'])('takes %s for itself', async (k) => {
      // Otherwise arrow keys scroll the page underneath and tab leaves the list
      await openThree()
      act(() => page().toggleReorderMode())
      const event = key(k)

      act(() => page().onReorderKeydown(event))

      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    it('carries on when the widget has not been rendered yet', async () => {
      await openThree()

      expect(() => page().focusReorderItem('MemoryWidgetComponent')).not.toThrow()
    })

    it('ignores keys when not reordering', async () => {
      await openThree()

      act(() => page().onReorderKeydown(key('ArrowDown')))

      expect(page().dashboard[0].component).toBe('CpuWidgetComponent')
    })

    it('ignores a selection request for a widget that is not there', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => page().setSelectedReorderComponent('WeatherWidgetComponent'))

      expect(page().selectedReorderComponent).toBe('CpuWidgetComponent')
    })

    it('saves and announces when the mode is left', async () => {
      await openThree()
      act(() => page().toggleReorderMode())
      act(() => {
        page().moveComponent('MemoryWidgetComponent', -1)
      })

      act(() => page().toggleReorderMode())

      expect(page().reorderMode).toBe(false)
      expect(page().selectedReorderComponent).toBeNull()
      expect(page().actionLiveMessage).toContain('status.reorder.disabled')
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('status.reorder.disabled')
      expect(savedLayout().map((item: any) => item.component))
        .toEqual(['MemoryWidgetComponent', 'CpuWidgetComponent', 'NetworkWidgetComponent'])
    })

    it('hands focus back to the toggle button on leaving', async () => {
      await openThree()
      // Reorder mode is entered from layout editing, where the toggle stays
      act(() => page().unlockLayout())
      act(() => page().toggleReorderMode())

      act(() => page().toggleReorderMode())
      act(() => vi.runOnlyPendingTimers())

      expect(document.activeElement?.id).toBe('reorder-toggle-button')
    })

    it('re-announces the same message twice in a row', async () => {
      await openThree()
      act(() => page().toggleReorderMode())

      act(() => {
        page().moveComponent('MemoryWidgetComponent', -1)
      })
      const first = page().actionLiveMessage
      act(() => {
        page().moveComponent('MemoryWidgetComponent', 1)
        page().moveComponent('MemoryWidgetComponent', -1)
      })

      // An unchanged live region is not read again, so an invisible character is
      // added to force it
      expect(page().actionLiveMessage).not.toBe(first)
      expect(page().actionLiveMessage).toContain('status.reorder.moved')
    })

    it('names the widgets in a way a screen reader can read', async () => {
      await openThree()

      // Component names are not something to read aloud
      expect(page().getWidgetDisplayName('CpuWidgetComponent')).toBe('status.cpu.title_cpu')
      expect(page().getWidgetDisplayName('AccessoriesWidgetComponent')).toBe('menu.label_accessories')
      expect(page().getReorderItemAriaLabel('CpuWidgetComponent')).toBe('status.reorder.item_label')
    })
  })

  describe('leaving the page with a terminal widget', () => {
    it('leaves freely when there is no terminal widget', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      expect(page().canDeactivate()).toBe(true)
      expect(navigationGuard.canDeactivate).not.toHaveBeenCalled()
    })

    it('asks the guard when a terminal widget is on the dashboard', async () => {
      await open({ layout: [widget('TerminalWidgetComponent')] })

      await expect(page().canDeactivate()).resolves.toBe(true)

      // A terminal widget may have a command running, which navigating away
      // would kill
      expect(navigationGuard.canDeactivate).toHaveBeenCalled()
    })

    it('asks the guard on an in-app navigation', async () => {
      const { router } = await open({ layout: [widget('TerminalWidgetComponent')] })
      navigationGuard.canDeactivate.mockResolvedValue(false)

      await act(async () => {
        void router.navigate('/plugins')
      })
      await settle()

      expect(navigationGuard.canDeactivate).toHaveBeenCalled()
      expect(screen.queryByTestId('other-route')).toBeNull()
    })

    it('warns before the browser tab closes on a terminal widget', async () => {
      await open({ layout: [widget('TerminalWidgetComponent')] })

      window.dispatchEvent(new Event('beforeunload'))

      expect(navigationGuard.handleBeforeUnload).toHaveBeenCalled()
      expect(page().onBeforeUnload(new Event('beforeunload') as BeforeUnloadEvent)).toBe('stay')
    })

    it('says nothing before the tab closes without one', async () => {
      await open({ layout: [widget('CpuWidgetComponent')] })

      expect(page().onBeforeUnload(new Event('beforeunload') as BeforeUnloadEvent)).toBeUndefined()
      expect(navigationGuard.handleBeforeUnload).not.toHaveBeenCalled()
    })
  })

  /**
   * Naming a widget for a screen reader.
   *
   * ⚠️ **The reorder controls announce widgets by name.** Without a name a blind
   * user hears "move up, move up, move up" with nothing to tell the rows apart, so
   * every widget in the registry needs one — and a widget added later has to fall
   * back to something readable rather than its class name.
   */
  describe('naming the widgets', () => {
    it.each([
      ['UpdateInfoWidgetComponent', 'status.services.updates'],
      ['WeatherWidgetComponent', 'status.widget.weather.title_weather'],
      ['AccessoriesWidgetComponent', 'menu.label_accessories'],
      ['BridgesWidgetComponent', 'child_bridge.bridges'],
      ['CpuWidgetComponent', 'status.cpu.title_cpu'],
      ['MemoryWidgetComponent', 'status.memory.title_memory'],
      ['NetworkWidgetComponent', 'status.network.title_network'],
      ['UptimeWidgetComponent', 'status.uptime.title_uptime'],
      ['SystemInfoWidgetComponent', 'status.widget.info'],
      ['HapQrcodeWidgetComponent', 'status.widget.add.label_pairing_code'],
      ['MatterQrcodeWidgetComponent', 'status.widget.add.matter_pairing_code'],
      ['HomebridgeLogsWidgetComponent', 'status.widget.homebridge_logs'],
      ['ClockWidgetComponent', 'status.widget.clock'],
    ])('names %s', async (component, expected) => {
      await open()

      expect(page().getWidgetDisplayName(component)).toBe(expected)
    })

    it('names the terminal widget after homebridge', async () => {
      await open()

      expect(page().getWidgetDisplayName('TerminalWidgetComponent')).toBe('Homebridge menu.docker.terminal')
    })

    it('gives every widget in the registry a name of its own', async () => {
      // ⚠️ The check that matters: a widget added to the registry without a case
      // here falls through to the class-name fallback, which reads badly
      await open()

      const fallbacks = AVAILABLE_WIDGETS.filter(component =>
        page().getWidgetDisplayName(component).includes(' Widget')
        || page().getWidgetDisplayName(component) === component,
      )

      expect(fallbacks).toEqual([])
    })

    it('makes a readable name out of an unknown widget', async () => {
      // A layout saved by a newer version can name a widget this one lacks
      await open()

      expect(page().getWidgetDisplayName('SomeNewThingWidgetComponent')).toBe('Some New Thing')
    })

    it('falls back to the raw name when there is nothing to split', async () => {
      await open()

      expect(page().getWidgetDisplayName('WidgetComponent')).toBe('WidgetComponent')
    })

    it('names the settings button after the widget it belongs to', async () => {
      await open()

      expect(page().getWidgetSettingsAriaLabel({ component: 'CpuWidgetComponent' })).toBe('status.reorder.widget_settings')
    })

    it('copes with a settings button for nothing in particular', async () => {
      await open()

      expect(() => page().getWidgetSettingsAriaLabel({})).not.toThrow()
    })
  })

  /**
   * Loading a saved dashboard.
   *
   * ⚠️ **Old layouts name widgets that have been renamed since.** They are migrated
   * on load and the layout is saved back, or the migration runs on every page load
   * for ever. Widgets the user may not have — the terminal for a non-admin, the
   * matter code on a homebridge without matter — are dropped instead.
   */
  describe('applying a saved layout', () => {
    const item = (component: string) => ({ component, x: 0, y: 0, cols: 2, rows: 2 })

    it('renames a widget that was renamed in an update', async () => {
      await open({ layout: [item('HomebridgeStatusWidgetComponent')] })

      expect(components()).toEqual(['UpdateInfoWidgetComponent'])
    })

    it('renames the old child bridge widget too', async () => {
      await open({ layout: [item('ChildBridgeWidgetComponent')] })

      expect(components()).toEqual(['BridgesWidgetComponent'])
    })

    it.each([
      ['the terminal widget from a non-admin', 'TerminalWidgetComponent', { admin: false }],
      ['the matter qr code when matter is off', 'MatterQrcodeWidgetComponent', { matterSupport: false }],
      ['the accessories widget when accessory control is off', 'AccessoriesWidgetComponent', { enableAccessories: false }],
    ])('hides %s', async (_case, component, options) => {
      // ⚠️ A widget the user is not allowed to use must not be built at all. It
      // would render an error, or in the terminal's case put a shell on the
      // dashboard of someone with no terminal permission
      await open({ layout: [widget(component), widget('CpuWidgetComponent')], ...options })

      expect(components()).toEqual(['CpuWidgetComponent'])
      expect(screen.queryByTestId(`widget-${component}`)).toBeNull()
    })

    it.each([
      ['the terminal widget for an admin', 'TerminalWidgetComponent', { admin: true }],
      ['the matter qr code when matter is on', 'MatterQrcodeWidgetComponent', { matterSupport: true }],
      ['the accessories widget when accessory control is on', 'AccessoriesWidgetComponent', { enableAccessories: true }],
    ])('keeps %s', async (_case, component, options) => {
      await open({ layout: [widget(component)], ...options })

      expect(components()).toEqual([component])
    })

    it('saves the layout back after migrating it', async () => {
      // ⚠️ Otherwise the rename runs again on every single page load
      await open({ layout: [item('HomebridgeStatusWidgetComponent')] })

      expect(savedLayout()?.map((w: any) => w.component)).toEqual(['UpdateInfoWidgetComponent'])
    })

    it('does not save a layout that needed no migration', async () => {
      await open({ layout: [item('CpuWidgetComponent')] })

      expect(savedLayout()).toBeUndefined()
    })

    it('drops a widget this version does not have', async () => {
      await open({ layout: [item('CpuWidgetComponent'), item('SomeWidgetFromTheFuture')] })

      expect(components()).toEqual(['CpuWidgetComponent'])
    })

    it('hands every widget its events and the saved item', async () => {
      await open({ layout: [item('CpuWidgetComponent')] })

      const props = holder.widgetProps.get('CpuWidgetComponent')!
      expect(props.widget).toMatchObject(item('CpuWidgetComponent'))
      expect(props.resizeEvent.subscribe).toBeTypeOf('function')
      expect(props.configureEvent.subscribe).toBeTypeOf('function')
    })

    it('falls back to the default layout when the server has none', async () => {
      await open({ layout: [] })

      expect(page().dashboard.length).toBeGreaterThan(0)
      // ...and stores it, so the next visit loads it from the server
      expect(savedLayout()).toHaveLength(defaultLayout.length)
    })

    it('fits the matter card into the left column of the default layout', async () => {
      await open({ layout: [], matterSupport: true })

      const byName = Object.fromEntries(page().dashboard.map(w => [w.component, w]))
      expect(byName.UpdateInfoWidgetComponent).toMatchObject({ y: 0, rows: 6 })
      expect(byName.BridgesWidgetComponent).toMatchObject({ y: 6, rows: 4 })
      expect(byName.MatterQrcodeWidgetComponent).toMatchObject({ y: 10, rows: 5 })
    })

    it('leaves the matter card out of the default layout without matter', async () => {
      await open({ layout: [], matterSupport: false })

      expect(components()).not.toContain('MatterQrcodeWidgetComponent')
      // The shared default is not mutated by the reset
      expect(defaultLayout.map(w => w.component)).toContain('MatterQrcodeWidgetComponent')
    })
  })

  /** `WidgetHost` (Angular `WidgetsComponent`, `widget-host-and-uptime.spec.ts`): puts one saved item's widget in its tile. */
  describe('the dashboard widget host', () => {
    const tile = (component: string) => document.getElementById(component)!

    /**
     * Put an item on the dashboard the load would have dropped (a name this version does not know).
     * @param component - the widget name
     */
    function place(component: string) {
      act(() => {
        store.setState({ dashboard: [...page().dashboard, { ...widget(component), hideOnDesktop: false, hideOnMobile: false } as any] })
      })
    }

    /**
     * Take an item off the dashboard, unmounting its tile.
     * @param component - the widget name
     */
    function remove(component: string) {
      act(() => {
        store.setState({ dashboard: page().dashboard.filter(item => item.component !== component) })
      })
    }

    it('builds the widget it was asked for', async () => {
      await open({ layout: [widget('ClockWidgetComponent')] })

      expect(tile('ClockWidgetComponent').querySelectorAll('[data-testid^="widget-"]')).toHaveLength(1)
      expect(screen.getByTestId('widget-ClockWidgetComponent')).toBeInTheDocument()
    })

    it('makes it fill the tile it was given', async () => {
      // The dashboard sizes the tile; the widget has to stretch into it or it sits
      // in the corner of an empty box
      await open({ layout: [widget('ClockWidgetComponent')] })

      const wrapper = screen.getByTestId('widget-ClockWidgetComponent').parentElement!
      expect(wrapper.style.height).toBe('100%')
      expect(wrapper.style.width).toBe('100%')
      expect(wrapper.style.display).toBe('flex')
    })

    it('hands the widget its own resize and configure streams and its own config', async () => {
      await open({ layout: [widget('ClockWidgetComponent')] })

      const props = holder.widgetProps.get('ClockWidgetComponent')!
      expect(props.resizeEvent).toBe(page().eventsFor('ClockWidgetComponent').resizeEvent)
      expect(props.configureEvent).toBe(page().eventsFor('ClockWidgetComponent').configureEvent)
      expect(props.widget).toBe(page().dashboard[0])
    })

    it('builds nothing for a widget name it does not know', async () => {
      // A layout saved by a newer version can name a widget this one does not have
      await open({ layout: [widget('ClockWidgetComponent')] })
      place('SomeWidgetFromTheFuture')

      expect(tile('SomeWidgetFromTheFuture').querySelector('[data-testid^="widget-"]')).toBeNull()
    })

    it('closes the widget streams when the tile goes', async () => {
      // They are per-tile, so leaving them open leaks a subscription per widget the
      // user removes
      await open({ layout: [widget('ClockWidgetComponent'), widget('CpuWidgetComponent')] })
      const { resizeEvent, configureEvent } = page().eventsFor('ClockWidgetComponent')
      const heard = vi.fn()
      resizeEvent.subscribe(heard)
      configureEvent.subscribe(heard)

      remove('ClockWidgetComponent')
      resizeEvent.next()
      configureEvent.next()

      expect(heard).not.toHaveBeenCalled()
    })

    it('leaves the streams alone when there was no widget to build', async () => {
      await open({ layout: [widget('ClockWidgetComponent')] })
      place('SomeWidgetFromTheFuture')
      const { resizeEvent } = page().eventsFor('SomeWidgetFromTheFuture')
      const heard = vi.fn()
      resizeEvent.subscribe(heard)

      remove('SomeWidgetFromTheFuture')
      resizeEvent.next()

      expect(heard).toHaveBeenCalledOnce()
    })
  })

  /**
   * ⚠️ **The saved layout is shared with the Angular UI.** A layout written by
   * either must load in the other exactly as it was: same keys, same values,
   * nothing added or lost — widget settings and keys this version does not know
   * included.
   */
  describe('layout compatibility with the Angular UI', () => {
    // As the Angular UI saves it: gridster's draggable flag and widget settings ride along
    const angularLayout = [
      { component: 'UpdateInfoWidgetComponent', x: 0, y: 0, cols: 5, rows: 7, mobileOrder: 10, hidePort: true, hideOnMobile: false, draggable: false, showNpmVersion: true },
      { component: 'CpuWidgetComponent', x: 5, y: 0, cols: 5, rows: 4, mobileOrder: 40, hideOnMobile: false, hideOnDesktop: false, draggable: false, refreshInterval: 10, historyItems: 60 },
      { component: 'WeatherWidgetComponent', x: 10, y: 0, cols: 3, rows: 5, mobileOrder: 20, hideOnMobile: true, draggable: false, location: { id: 2643743, name: 'London', country: 'GB', coord: { lat: 51.5, lon: -0.13 } } },
      { component: 'AccessoriesWidgetComponent', x: 13, y: 0, cols: 7, rows: 9, mobileOrder: 30, draggable: false, accessoryOrder: ['abc', 'def'] },
    ]

    it('loads every key of a saved layout unchanged', async () => {
      await open({ layout: structuredClone(angularLayout) })

      expect(page().dashboard).toEqual(angularLayout)
    })

    it('writes the layout back key for key', async () => {
      await open({ layout: structuredClone(angularLayout) })

      await act(async () => page().saveWidgets())

      // Sorted by mobile order, as the Angular UI saved it
      expect(savedLayout()).toEqual([...angularLayout].sort((a, b) => a.mobileOrder - b.mobileOrder))
    })

    it('places each widget on the same cells', async () => {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1280 })
      try {
        const { container } = await open({ layout: structuredClone(angularLayout), glassMode: false })

        // 20 columns over 1280px with 8px gutters and an 8px outer margin
        // left and right: a column every (1280 - 8) / 20 = 63.6px, rows every 36 + 8px
        const cpu = container.querySelector<HTMLElement>('#CpuWidgetComponent')!
        expect(cpu.tagName.toLowerCase()).toBe('gridster-item')
        expect(cpu.style.width).toBe(`${Math.round(63.6 * 5 - 8)}px`)
        expect(cpu.style.height).toBe(`${4 * 36 + 3 * 8}px`)
        expect(cpu.style.transform).toBe(`translate(${Math.round(5 * 63.6 + 8)}px,0px)`)
        expect(container.querySelector('.gridster')).not.toHaveClass('mobile')
      } finally {
        delete (HTMLElement.prototype as any).clientWidth
      }
    })

    it('offers the bottom, right and corner resize handles only while editing', async () => {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1280 })
      try {
        const { container } = await open({ layout: structuredClone(angularLayout) })
        const cpu = () => container.querySelector('#CpuWidgetComponent')!
        const handles = () => [...cpu().querySelectorAll('.gridster-item-resizable-handler')]
          .map(el => [...el.classList].find(c => c.startsWith('handle-')))
        expect(handles()).toEqual(['handle-s', 'handle-e', 'handle-se'])
        // Rendered either way; this class hides them (status.scss) while locked
        expect(cpu()).toHaveClass('react-resizable-hide')

        act(() => page().unlockLayout())

        expect(cpu()).not.toHaveClass('react-resizable-hide')
      } finally {
        delete (HTMLElement.prototype as any).clientWidth
      }
    })

    it('keeps every widget of the default layout where it was saved', async () => {
      // The default layout is what most installs still run: the grid's
      // compaction must not move a single widget of a layout gridster wrote
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1440 })
      try {
        const saved = defaultLayout.filter(w => w.component !== 'MatterQrcodeWidgetComponent')
        await open({ layout: structuredClone(saved), matterSupport: false })

        const positions = (list: any[]) => Object.fromEntries(list.map(w => [w.component, [w.x, w.y, w.cols, w.rows]]))
        expect(positions(page().dashboard)).toEqual(positions(saved))
        expect(savedLayout()).toBeUndefined()
      } finally {
        delete (HTMLElement.prototype as any).clientWidth
      }
    })

    it('stacks the widgets below the mobile breakpoint', async () => {
      // jsdom lays nothing out, so the grid measures 0px wide: the phone layout
      const { container } = await open({ layout: structuredClone(angularLayout) })

      expect(container.querySelector('.gridster')).toHaveClass('mobile')
      expect([...container.querySelectorAll('gridster-item')].map(el => el.id))
        .toEqual(['UpdateInfoWidgetComponent', 'CpuWidgetComponent', 'WeatherWidgetComponent', 'AccessoriesWidgetComponent'])
    })
  })
})
