import type { HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { IoNamespace } from '@/core/ws'

import type { WidgetVisibilityEntry } from './widget-visibility/widget-visibility.entries'
import type { Widget, WidgetEvent } from './widgets/widget.types'

import { createStore } from 'zustand/vanilla'

import { useAuthStore } from '@/core/auth'
import { notifications } from '@/core/notifications'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { terminalNavigationGuard } from '@/core/utilities/terminal'

import { Credits } from './credits/Credits'
import defaultDashboardLayout from './default-dashboard-layout.json'
import { WidgetControl } from './widget-control/WidgetControl'
import { WidgetVisibility } from './widget-visibility/WidgetVisibility'
import { AVAILABLE_WIDGETS, createWidgetEvent } from './widgets/widget.types'

/** A grid position as react-grid-layout reports it (`i` is the widget's `component`). */
export interface GridPosition {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export interface StatusPageState {
  dashboard: Widget[]
  consoleStatus: 'up' | 'down'
  isUnlocked: boolean
  page: { mobile: boolean, showWidgetConfigure: boolean }
  // Keyboard-driven widget reorder mode for screen-reader / keyboard-only users.
  // Drag-and-drop on the grid is mouse-only; this provides a parallel
  // listbox-based path: arrow keys move the selected widget, escape exits.
  reorderMode: boolean
  selectedReorderComponent: string | null
  actionLiveMessage: string
  // True only between entering reorder mode and the first keystroke — drives the
  // aria-describedby that reads the keyboard instructions once on entry.
  showReorderHelp: boolean
}

export interface StatusPageActions {
  /** Wire the `status` namespace; returns the teardown. */
  connect: (io: IoNamespace) => () => void
  /** The resize / configure events of a widget (created on first use, kept while it stays on the dashboard). */
  eventsFor: (component: string) => { resizeEvent: WidgetEvent, configureEvent: WidgetEvent }
  /** Drop a widget's events (its host unmounted). */
  releaseEvents: (component: string) => void
  reorderComponents: () => string[]
  lockLayout: () => void
  unlockLayout: () => void
  toggleLayoutEditing: () => void
  cancelLayoutEditing: () => void
  onEscapeKey: () => void
  addWidget: () => Promise<void>
  manageWidget: (item: Widget) => Promise<void>
  manageWidgetByComponent: (component: string) => void
  openCreditsModal: () => void
  toggleReorderMode: () => void
  setSelectedReorderComponent: (component: string) => void
  onReorderKeydown: (event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault' | 'stopPropagation'>) => void
  moveComponent: (component: string, delta: number) => boolean
  focusReorderItem: (component: string) => void
  getWidgetDisplayName: (component: string) => string
  getReorderItemAriaLabel: (component: string) => string
  getWidgetSettingsAriaLabel: (item: { component?: string }) => string
  /** Merge fields into one widget, without saving. */
  updateWidget: (component: string, patch: Partial<Widget>) => void
  /** Merge fields (optional) into one widget and save the layout (`$saveWidgetsEvent`). */
  saveWidgets: (component?: string, patch?: Partial<Widget>) => void
  /**
   * Take positions from the grid. With `commit` (a drag or resize ended), the
   * layout is saved — gridster's `itemChangeCallback`.
   */
  applyGridLayout: (layout: readonly GridPosition[], commit: boolean) => void
  /** A widget changed size (gridster's `itemResizeCallback`). */
  gridResizeEvent: (component?: string) => void
  gridChangedEvent: () => Promise<void>
  resetLayout: () => void
  canDeactivate: () => Promise<boolean> | boolean
  onBeforeUnload: (event: BeforeUnloadEvent) => string | undefined
}

export type StatusStore = StatusPageState & StatusPageActions

export interface StatusStoreOptions {
  /** For specs; defaults to the app-wide terminal navigation guard. */
  navigationGuard?: Pick<typeof terminalNavigationGuard, 'canDeactivate' | 'handleBeforeUnload'>
}

const t = (key: string, params?: Record<string, unknown>) => i18n.t(key, params)

function currentPage() {
  return {
    mobile: window.innerWidth < 1024,
    showWidgetConfigure: window.innerWidth < 576,
  }
}

/**
 * The status dashboard's state and behaviour (`StatusComponent`), one store per
 * page visit. The layout is the shared, saved one: every item keeps the keys
 * the Angular UI wrote (component, x, y, cols, rows, mobileOrder, hideOnDesktop,
 * hideOnMobile, draggable and the widget settings), so a layout round-trips
 * between the two UIs unchanged.
 */
export function createStatusStore(options: StatusStoreOptions = {}) {
  const navigationGuard = options.navigationGuard ?? terminalNavigationGuard
  const isAdmin = !!useAuthStore.getState().user?.admin
  const isMatterSupported = settingsActions.isFeatureEnabled('matterSupport')

  let io: IoNamespace | null = null
  // Flipped to true only once the layout has actually been applied (see
  // loadDashboardInit). While false, every (re)connect retries the load; once
  // true, reconnects skip the reapply so a network blip mid-drag doesn't
  // revert the user's edits.
  let initialLayoutLoaded = false
  // Widget positions when editing began, so Cancel can put everything back
  let layoutSnapshot: Array<Pick<Widget, 'component' | 'x' | 'y' | 'cols' | 'rows'>> | null = null
  let actionTick = 0
  const events = new Map<string, { resizeEvent: WidgetEvent, configureEvent: WidgetEvent }>()

  return createStore<StatusStore>()((set, get) => {
    const setLayout = (layout: Widget[]) => {
      // New objects, so every widget whose fields changed re-renders
      set({ dashboard: layout.map(item => ({ ...item, draggable: get().isUnlocked })) })
    }

    const speakAction = (message: string) => {
      // Zero-width-space trick to force the live region to re-announce when the
      // same message is set twice in a row
      actionTick = (actionTick + 1) % 10
      set({ actionLiveMessage: `${message}${'​'.repeat(actionTick)}` })
    }

    const reorderTo = (component: string, targetIdx: number) => {
      const current = [...get().dashboard]
      const fromIdx = current.findIndex(x => x?.component === component)
      if (fromIdx < 0) {
        return
      }
      const [item] = current.splice(fromIdx, 1)
      current.splice(targetIdx, 0, item)
      // Keep mobileOrder in sync so the rendered grid matches the list order
      set({ dashboard: current.map((w, i) => (w.mobileOrder === i ? w : { ...w, mobileOrder: i })) })
    }

    const enterReorderMode = () => {
      const list = get().reorderComponents()
      // Surface the keyboard instructions as the first widget's accessible
      // description (see #reorder-instructions in the page). The screen reader
      // reads them right after the widget name + position, so we can move focus
      // immediately instead of racing a live-region announcement.
      set({ reorderMode: true, selectedReorderComponent: list[0] || null, showReorderHelp: true })
      const selected = get().selectedReorderComponent
      if (selected) {
        // Defer one tick so the listbox has rendered before we focus into it.
        setTimeout(() => {
          if (get().reorderMode) {
            get().focusReorderItem(selected)
          }
        }, 0)
      }
    }

    const exitReorderMode = (apply: boolean, announce: boolean) => {
      if (apply) {
        void get().gridChangedEvent()
      }
      set({ reorderMode: false, selectedReorderComponent: null, showReorderHelp: false })
      if (announce) {
        speakAction(t('status.reorder.disabled'))
      }
      // Return focus to the toggle button so keyboard users don't lose their place
      setTimeout(() => document.getElementById('reorder-toggle-button')?.focus(), 0)
    }

    const selectNext = (prev: boolean) => {
      const list = get().reorderComponents()
      if (!list.length) {
        return
      }
      const current = get().selectedReorderComponent
      const idx = current && list.includes(current) ? list.indexOf(current) : 0
      const nextIdx = prev ? (idx - 1 + list.length) % list.length : (idx + 1) % list.length
      const next = list[nextIdx]
      set({ selectedReorderComponent: next })
      setTimeout(() => get().focusReorderItem(next), 0)
    }

    const moveSelectedBy = (delta: number) => {
      const selected = get().selectedReorderComponent
      if (selected && get().moveComponent(selected, delta)) {
        setTimeout(() => get().focusReorderItem(selected), 0)
      }
    }

    const moveSelectedToEdge = (edge: 'top' | 'bottom') => {
      const list = get().reorderComponents()
      const selected = get().selectedReorderComponent
      if (!selected || !list.includes(selected)) {
        return
      }
      const target = edge === 'top' ? 0 : list.length - 1
      reorderTo(selected, target)

      const name = get().getWidgetDisplayName(selected)
      const edgeLabel = t(edge === 'top' ? 'status.reorder.edge_top' : 'status.reorder.edge_bottom')
      speakAction(t('status.reorder.moved_to_edge', { name, edge: edgeLabel, position: target + 1, total: list.length }))
      setTimeout(() => get().focusReorderItem(selected), 0)
    }

    const refreshRpiThrottledStatus = () => {
      io?.request('get-dashboard-init').then((response: any) => {
        if (response?.rpiThrottled) {
          notifications.set('raspberryPiThrottled', response.rpiThrottled)
        }
      }, () => {})
    }

    const applyDashboardLayout = (layout: any[]) => {
      if (!layout.length) {
        get().resetLayout()
        return
      }

      let saveNeeded = false
      const items = layout.map((saved: Widget): Widget | null => {
        const item = { ...saved }
        // Renamed between v4.68.0 and v4.69.0
        if (item.component === 'HomebridgeStatusWidgetComponent') {
          item.component = 'UpdateInfoWidgetComponent'
          saveNeeded = true
        } else if (item.component === 'ChildBridgeWidgetComponent') {
          item.component = 'BridgesWidgetComponent'
          saveNeeded = true
        }

        // Hide terminal for non-admin users
        if (item.component === 'TerminalWidgetComponent' && !isAdmin) {
          return null
        }

        // Hide matter qr code if not supported
        if (item.component === 'MatterQrcodeWidgetComponent' && !isMatterSupported) {
          return null
        }

        // Hide items not in the list of available widgets
        if (!AVAILABLE_WIDGETS.includes(item.component)) {
          return null
        }

        // If accessory control is disabled (insecure mode is disabled), hide the accessories widget
        if (item.component === 'AccessoriesWidgetComponent' && !useSettingsStore.getState().env.enableAccessories) {
          return null
        }

        return item
      })
      setLayout(items.filter((item): item is Widget => !!item))

      if (saveNeeded) {
        void get().gridChangedEvent()
      }
    }

    /**
     * Dashboard page init — one WS round-trip (`get-dashboard-init`) that
     * returns the saved layout plus, on Raspberry Pi hosts, the throttled status.
     */
    const loadDashboardInit = () => {
      io?.request('get-dashboard-init').then(
        (response: any) => {
          if (response?.rpiThrottled) {
            notifications.set('raspberryPiThrottled', response.rpiThrottled)
          }
          applyDashboardLayout(response?.layout ?? [])
          // Only mark loaded once the layout is actually applied. If the first
          // connect's ack is dropped (socket reconnect) or errors, this stays
          // false so the next (re)connect retries instead of leaving the
          // dashboard empty.
          initialLayoutLoaded = true
        },
        () => {
          // Leave initialLayoutLoaded false so a reconnect re-attempts the load.
          toast.error(t('toast.api_error_generic'), t('toast.title_error'))
        },
      )
    }

    const mergeInto = (component: string, patch: Partial<Widget>) => {
      set({
        dashboard: get().dashboard.map(item => (item.component === component ? { ...item, ...patch } : item)),
      })
    }

    return {
      dashboard: [],
      consoleStatus: 'down',
      isUnlocked: false,
      page: currentPage(),
      reorderMode: false,
      selectedReorderComponent: null,
      actionLiveMessage: '',
      showReorderHelp: false,

      connect(namespace) {
        io = namespace
        // Fires once for cache-hit-while-connected and on every (re)connect
        // thereafter. `consoleStatus` starts as 'down' and is flipped back to
        // 'down' by the 'disconnect' handler below.
        const unsubscribe = namespace.connected.subscribe(() => {
          set({ consoleStatus: 'up' })
          namespace.socket.emit('monitor-server-status')
          if (!initialLayoutLoaded) {
            loadDashboardInit()
          } else {
            // On reconnect we still want to refresh the RPi throttled banner,
            // but skip the layout reapply.
            refreshRpiThrottledStatus()
          }
        })
        const onDisconnect = () => set({ consoleStatus: 'down' })
        const onStatus = (data: HomebridgeStatusResponse) => {
          // Check if client is up-to-date
          if (data.packageVersion && data.packageVersion !== useSettingsStore.getState().uiVersion) {
            window.location.reload()
          }
        }
        namespace.socket.on('disconnect', onDisconnect)
        namespace.socket.on('homebridge-status', onStatus)
        return () => {
          unsubscribe()
          namespace.socket.off('disconnect', onDisconnect)
          namespace.socket.off('homebridge-status', onStatus)
          if (io === namespace) {
            io = null
          }
        }
      },

      eventsFor(component) {
        let entry = events.get(component)
        if (!entry) {
          entry = { resizeEvent: createWidgetEvent(), configureEvent: createWidgetEvent() }
          events.set(component, entry)
        }
        return entry
      },

      releaseEvents(component) {
        const entry = events.get(component)
        if (entry) {
          entry.resizeEvent.complete()
          entry.configureEvent.complete()
          events.delete(component)
        }
      },

      reorderComponents() {
        return get().dashboard.map(x => x?.component).filter((c): c is string => typeof c === 'string' && c.length > 0)
      },

      lockLayout() {
        // Locking means "I'm done editing": if the user is mid-reorder, save the
        // new order and return to the grid before locking.
        if (get().reorderMode) {
          exitReorderMode(true, false)
        }
        set({ isUnlocked: false })
        layoutSnapshot = null
        setLayout(get().dashboard)
      },

      unlockLayout() {
        layoutSnapshot = get().dashboard.map(({ component, x, y, cols, rows }) => ({ component, x, y, cols, rows }))
        set({ isUnlocked: true })
        setLayout(get().dashboard)
      },

      // One button enters and leaves layout editing
      toggleLayoutEditing() {
        if (get().isUnlocked) {
          get().lockLayout()
        } else {
          get().unlockLayout()
        }
      },

      // Leave layout editing and put every widget back where it was when editing began
      cancelLayoutEditing() {
        const snapshot = layoutSnapshot
        if (snapshot) {
          const restored = get().dashboard.map((item) => {
            const saved = snapshot.find(entry => entry.component === item.component)
            return saved ? { ...item, x: saved.x, y: saved.y, cols: saved.cols, rows: saved.rows } : item
          })
          setLayout(restored)
          void get().gridChangedEvent()
        }
        get().lockLayout()
      },

      // Escape finishes editing, unless a dialog or the keyboard reorder list has it
      onEscapeKey() {
        if (get().isUnlocked && !get().reorderMode && !document.querySelector('.modal.show')) {
          get().lockLayout()
        }
      },

      async addWidget() {
        const ref = openModal(WidgetVisibility, {
          dashboard: get().dashboard,
          resetLayout: () => get().resetLayout(),
        }, {
          size: 'lg',
          backdrop: 'static',
        })

        let entries: WidgetVisibilityEntry[]
        try {
          entries = await ref.result
        } catch {
          // Modal dismissed, do nothing
          return
        }
        const currentDashboard = [...get().dashboard]

        for (const entry of entries) {
          const existingIndex = currentDashboard.findIndex(x => x.component === entry.component)
          const visibleAnywhere = entry.showOnDesktop || entry.showOnMobile

          if (visibleAnywhere && existingIndex === -1) {
            // Widget needs to be in dashboard but isn't — add it
            // Place at the bottom of the grid so it doesn't disrupt existing layout
            const maxY = currentDashboard.reduce((max, item) => Math.max(max, (item.y ?? 0) + (item.rows ?? 0)), 0)
            currentDashboard.push({
              x: 0,
              y: maxY,
              component: entry.component,
              cols: entry.cols,
              rows: entry.rows,
              mobileOrder: entry.mobileOrder,
              hideOnDesktop: entry.hideOnDesktop,
              hideOnMobile: entry.hideOnMobile,
              draggable: get().isUnlocked,
            })
          } else if (!visibleAnywhere && existingIndex > -1) {
            // Widget hidden on both desktop and mobile — remove it
            currentDashboard.splice(existingIndex, 1)
          } else if (visibleAnywhere && existingIndex > -1) {
            // Widget exists — update visibility flags
            currentDashboard[existingIndex] = {
              ...currentDashboard[existingIndex],
              hideOnDesktop: entry.hideOnDesktop,
              hideOnMobile: entry.hideOnMobile,
            }
          }
        }

        set({ dashboard: currentDashboard })
        void get().gridChangedEvent()
      },

      async manageWidget(item) {
        const ref = openModal(WidgetControl, { widget: item }, {
          size: 'lg',
          backdrop: 'static',
        })
        let updated: Widget | undefined
        try {
          updated = await ref.result
        } catch {
          // Modal dismissed, do nothing
          return
        }
        if (get().dashboard.some(w => w.component === item.component)) {
          // The modal edits a copy and hands it back; merge it into the layout item
          mergeInto(item.component, { ...updated })
          // Let the widget re-render with its new settings before it re-reads them
          queueMicrotask(() => get().eventsFor(item.component).configureEvent.next())
        }
        void get().gridChangedEvent()
      },

      manageWidgetByComponent(component) {
        const item = get().dashboard.find(x => x?.component === component)
        if (item) {
          void get().manageWidget(item)
        }
      },

      openCreditsModal() {
        openModal(Credits, {}, {
          size: 'lg',
          backdrop: 'static',
        }).result.catch(() => {})
      },

      toggleReorderMode() {
        if (!get().reorderMode) {
          enterReorderMode()
        } else {
          exitReorderMode(true, true)
        }
      },

      setSelectedReorderComponent(component) {
        if (!get().reorderMode || !get().reorderComponents().includes(component)) {
          return
        }
        set({ selectedReorderComponent: component })
      },

      onReorderKeydown(event) {
        if (!get().reorderMode) {
          return
        }

        // The instructions only need to be read once, on entry.
        if (get().showReorderHelp) {
          set({ showReorderHelp: false })
        }

        let handled = true
        switch (event.key) {
          case 'Tab':
            selectNext(event.shiftKey)
            break
          case 'ArrowUp':
            moveSelectedBy(-1)
            break
          case 'ArrowDown':
            moveSelectedBy(1)
            break
          case 'Home':
          case 'ArrowLeft':
            moveSelectedToEdge('top')
            break
          case 'End':
          case 'ArrowRight':
            moveSelectedToEdge('bottom')
            break
          case 'Escape':
            exitReorderMode(true, true)
            break
          default:
            handled = false
        }

        if (handled) {
          event.preventDefault()
          event.stopPropagation()
        }
      },

      /**
       * Move a widget up (delta -1) or down (delta +1) in the order. Shared by
       * the arrow-key handler and the per-row Up/Down buttons, so pointer and
       * touch users can reorder too — not just keyboard. Returns true if a move
       * happened.
       */
      moveComponent(component, delta) {
        const list = get().reorderComponents()
        if (!list.includes(component)) {
          return false
        }
        const target = list.indexOf(component) + delta
        if (target < 0 || target >= list.length) {
          return false
        }

        set({ selectedReorderComponent: component })
        reorderTo(component, target)
        speakAction(t('status.reorder.moved', {
          name: get().getWidgetDisplayName(component),
          position: target + 1,
          total: list.length,
        }))
        return true
      },

      focusReorderItem(component) {
        document.getElementById(`reorder-item-${component}`)?.focus()
      },

      getWidgetDisplayName(component) {
        switch (component) {
          case 'UpdateInfoWidgetComponent':
            return t('status.services.updates')
          case 'WeatherWidgetComponent':
            return t('status.widget.weather.title_weather')
          case 'AccessoriesWidgetComponent':
            return t('menu.label_accessories')
          case 'BridgesWidgetComponent':
            return t('child_bridge.bridges')
          case 'CpuWidgetComponent':
            return t('status.cpu.title_cpu')
          case 'MemoryWidgetComponent':
            return t('status.memory.title_memory')
          case 'NetworkWidgetComponent':
            return t('status.network.title_network')
          case 'UptimeWidgetComponent':
            return t('status.uptime.title_uptime')
          case 'SystemInfoWidgetComponent':
            return t('status.widget.info')
          case 'HapQrcodeWidgetComponent':
            return t('status.widget.add.label_pairing_code')
          case 'MatterQrcodeWidgetComponent':
            return t('status.widget.add.matter_pairing_code')
          case 'HomebridgeLogsWidgetComponent':
            return t('status.widget.homebridge_logs')
          case 'TerminalWidgetComponent':
            return `Homebridge ${t('menu.docker.terminal')}`
          case 'ClockWidgetComponent':
            return t('status.widget.clock')
          default: {
            const base = component
              .replace(/WidgetComponent$/, '')
              .replace(/Component$/, '')
              .replace(/Widget$/, '')
            return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || component
          }
        }
      },

      getReorderItemAriaLabel(component) {
        const name = get().getWidgetDisplayName(component)
        const list = get().reorderComponents()
        const position = list.indexOf(component) + 1
        const total = list.length || 1
        return t('status.reorder.item_label', { name, position, total })
      },

      getWidgetSettingsAriaLabel(item) {
        const name = get().getWidgetDisplayName(item?.component || '')
        return t('status.reorder.widget_settings', { name })
      },

      updateWidget(component, patch) {
        mergeInto(component, patch)
      },

      // This allows widgets to trigger a save to the grid layout
      // E.g. when the order of the accessories in the accessories widget changes
      saveWidgets(component, patch) {
        if (component && patch) {
          mergeInto(component, patch)
        }
        void get().gridChangedEvent()
      },

      applyGridLayout(layout, commit) {
        let changed = false
        const dashboard = get().dashboard.map((item) => {
          const pos = layout.find(p => p.i === item.component)
          if (!pos || (pos.x === item.x && pos.y === item.y && pos.w === item.cols && pos.h === item.rows)) {
            return item
          }
          changed = true
          return { ...item, x: pos.x, y: pos.y, cols: pos.w, rows: pos.h }
        })
        if (changed) {
          set({ dashboard })
        }
        if (commit && changed) {
          void get().gridChangedEvent()
        }
      },

      gridResizeEvent(component) {
        if (component) {
          get().eventsFor(component).resizeEvent.next()
        } else {
          for (const item of get().dashboard) {
            get().eventsFor(item.component).resizeEvent.next()
          }
        }
        set({ page: currentPage() })
      },

      async gridChangedEvent() {
        // Sort the array to ensure mobile displays correctly
        const currentDashboard = [...get().dashboard]
        currentDashboard.sort((a, b) => a.mobileOrder - b.mobileOrder)
        set({ dashboard: currentDashboard })

        // Nothing private lives on the items any more, but a layout saved by an
        // older UI could still carry `$`-prefixed keys; never send those
        const layout = currentDashboard.map(item =>
          Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith('$'))))

        // The dashboard layout is shared by every user and the server only accepts
        // `set-dashboard-layout` from an admin. A non-admin's local rearrangement
        // (e.g. a widget reordering its own contents) is simply not persisted.
        if (!isAdmin || !io) {
          return
        }

        try {
          await io.request('set-dashboard-layout', layout)
        } catch (e) {
          console.error('Failed to save dashboard layout')
          console.error(e)
        }
      },

      resetLayout() {
        // Fresh copies: the imported JSON is a shared module value
        let layout = (defaultDashboardLayout as Widget[]).map(item => ({ ...item }))

        if (!isMatterSupported) {
          // If matter is not supported, remove the Matter QR code widget
          layout = layout.filter(item => item.component !== 'MatterQrcodeWidgetComponent')
        } else {
          // With Matter the left column also holds its QR card, the same height as the
          // HomeKit one on the right, so the whole dashboard still fits on one screen
          const leftColumn: Record<string, { y: number, rows: number }> = {
            UpdateInfoWidgetComponent: { y: 0, rows: 6 },
            BridgesWidgetComponent: { y: 6, rows: 4 },
            MatterQrcodeWidgetComponent: { y: 10, rows: 5 },
          }
          layout = layout.map(item => (leftColumn[item.component] ? { ...item, ...leftColumn[item.component] } : item))
        }

        setLayout(layout)
        void get().gridChangedEvent()
      },

      canDeactivate() {
        // A terminal widget may have a command running, which navigating away would kill
        if (!get().dashboard.some(item => item.component === 'TerminalWidgetComponent')) {
          return true
        }
        return navigationGuard.canDeactivate()
      },

      onBeforeUnload(event) {
        if (get().dashboard.some(item => item.component === 'TerminalWidgetComponent')) {
          return navigationGuard.handleBeforeUnload(event)
        }
        return undefined
      },
    }
  })
}

export type StatusStoreApi = ReturnType<typeof createStatusStore>
