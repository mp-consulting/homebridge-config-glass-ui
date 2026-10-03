import type { ChildBridgeIconSource } from '@/core/components/child-bridge-status-icons/ChildBridgeStatusIcons'
import type { ChildBridgeStatusResponse, HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { IoNamespace } from '@/core/ws'

import { createStore } from 'zustand/vanilla'

import { HomebridgeStatus } from '@/core/interfaces/server.interfaces'

/** Extends ChildBridgeStatusResponse with UI-only state */
export interface ChildBridgeWithUIState extends ChildBridgeStatusResponse {
  restarting?: boolean
}

export type MainBridgeStatus = Partial<HomebridgeStatusResponse & { name?: string }>

/** What the store needs from the outside world. */
export interface BridgesDeps {
  ws: { connectToNamespace: (namespace: string) => IoNamespace }
  api: { put: (path: string, body?: unknown) => Promise<unknown> }
  cache: { invalidateAll: () => void }
  toastError: (message: string, title: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
  isAdmin: boolean
  isMatterSupported: boolean
}

export interface BridgesState {
  homebridgeStatus: MainBridgeStatus | null
  childBridges: ChildBridgeWithUIState[]
  isRestarting: boolean
  // Live-region state — only set when a user-initiated restart has settled
  // (transitioned from pending back to a stable status). Cleared after 3s.
  homebridgeLiveMessage: string
  childBridgeLiveMessages: Record<string, string>
}

export interface BridgesActions {
  /** Open the `status` and `child-bridges` namespaces; returns the teardown. */
  connect: () => () => void
  restartChildBridge: (bridge: ChildBridgeWithUIState) => Promise<void>
  restartHomebridge: () => Promise<void>
  /**
   * The main bridge mapped into the shared status-icon source shape, so its
   * icons come from the same component (and the same colour/tooltip rules) as
   * every child bridge row. The status payload's `matter` block matches the
   * matterConfig shape the icons read (enabled + externalsOnly).
   */
  mainBridgeIconSource: () => ChildBridgeIconSource
  /**
   * Compose a single aria-label that the screen reader reads as the whole row
   * is one button: "<name>, <Running|Not Running|Restarting>[, Matter
   * Running|Matter Not Running][, Restart]". The trailing "Restart" only
   * appears when the user can actually trigger a restart.
   */
  mainBridgeAriaLabel: () => string
  childBridgeAriaLabel: (bridge: ChildBridgeWithUIState) => string
}

export type BridgesStore = BridgesState & BridgesActions

/**
 * Whether Matter is actively enabled for a child bridge: configured and not
 * turned off in place (`matterConfig.enabled === false`). Mirrors the visible
 * Matter icon so it greys out for a configured-but-disabled bridge.
 */
export function isChildMatterEnabled(bridge: ChildBridgeWithUIState): boolean {
  return !!bridge.matterConfig && bridge.matterConfig.enabled !== false
}

/**
 * The state and logic of the bridges widget (the Angular component class),
 * one store per mounted widget. `BridgesWidget.tsx` renders it.
 */
export function createBridgesStore(deps: BridgesDeps) {
  let ioMain: IoNamespace | undefined
  let ioChild: IoNamespace | undefined
  // Kept so the teardown can `off()` exactly these: both namespaces are
  // cached and shared, and `end()` keeps listeners
  let teardowns: Array<() => void> = []
  let destroyed = false

  // Track the last seen status so we can detect "pending -> stable" transitions.
  let lastHomebridgeStatus: string | undefined
  const lastChildStatuses: Record<string, string | undefined> = {}

  // Track whether the user explicitly asked for a restart; we only announce on user-initiated restarts.
  let homebridgeRestartRequested = false
  let homebridgeAnnouncementPending = false
  let homebridgeAnnouncementTimeout: ReturnType<typeof setTimeout> | null = null
  const childRestartRequested: Record<string, boolean> = {}
  const childAnnouncementPending: Record<string, boolean> = {}
  const childAnnouncementTimeouts: Record<string, ReturnType<typeof setTimeout>> = {}
  // Every other timer, so none fires into a destroyed widget
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)
    timers.add(timer)
    return timer
  }

  const bridgeStatusLabel = (status: string | undefined, inTransition: boolean): string => {
    if (inTransition) {
      return deps.t('status.services.label_restarting')
    }
    return deps.t(status === 'down' ? 'status.services.label_not_running' : 'status.services.label_running')
  }

  /**
   * Mirror the visible matter icon: when Matter support is enabled in the
   * server, the icon is always rendered with one of three tooltips
   * (not_enabled / not_running / running). Announce the same state so screen
   * reader users know whether matter is configured per-bridge. Skip during
   * transition — the row label already says "Restarting".
   */
  const matterStatusLabel = (matterEnabledForBridge: boolean, status: string | undefined, inTransition: boolean): string => {
    if (!deps.isMatterSupported || inTransition) {
      return ''
    }
    if (!matterEnabledForBridge) {
      return `, ${deps.t('status.services.matter_not_enabled')}`
    }
    return `, ${deps.t(status === 'down' ? 'status.services.matter_not_running' : 'status.services.matter_running')}`
  }

  const formatRestartCompleteMessage = (name: string, status: string): string => {
    let statusLabel: string | undefined
    if (status === 'down') {
      statusLabel = deps.t('status.services.label_not_running')
    } else if (status === 'ok') {
      statusLabel = deps.t('status.services.label_running')
    } else {
      statusLabel = status
    }
    return statusLabel
      ? deps.t('status.widget.bridge.restart_complete_with_status', { name, status: statusLabel })
      : deps.t('status.widget.bridge.restart_complete', { name })
  }

  return createStore<BridgesStore>()((set, get) => {
    // When a user-initiated restart resolves (status leaves 'pending'), wait 3s
    // for things to fully settle then announce the final state. Only once per
    // restart click.
    const maybeAnnounceHomebridgeRestart = (prevStatus: string | undefined): void => {
      const currentStatus = get().homebridgeStatus?.status
      if (
        !homebridgeRestartRequested
        || homebridgeAnnouncementPending
        || prevStatus !== 'pending'
        || !currentStatus
        || currentStatus === 'pending'
      ) {
        return
      }

      homebridgeAnnouncementPending = true
      if (homebridgeAnnouncementTimeout) {
        clearTimeout(homebridgeAnnouncementTimeout)
      }
      homebridgeAnnouncementTimeout = setTimeout(() => {
        const latestStatus = get().homebridgeStatus?.status
        if (!latestStatus || latestStatus === 'pending') {
          homebridgeRestartRequested = false
          homebridgeAnnouncementPending = false
          return
        }

        const name = get().homebridgeStatus?.name || 'Homebridge'
        const msg = formatRestartCompleteMessage(name, latestStatus)
        homebridgeRestartRequested = false
        homebridgeAnnouncementPending = false
        set({ homebridgeLiveMessage: msg })

        later(() => {
          if (get().homebridgeLiveMessage === msg) {
            set({ homebridgeLiveMessage: '' })
          }
        }, 3000)
      }, 3000)
    }

    const maybeAnnounceChildRestart = (name: string, key: string, prevStatus: string | undefined): void => {
      const bridge = get().childBridges.find(b => (b.username || b.name) === key)
      const currentStatus = bridge?.status
      if (
        !childRestartRequested[key]
        || childAnnouncementPending[key]
        || prevStatus !== 'pending'
        || !currentStatus
        || currentStatus === 'pending'
      ) {
        return
      }

      childAnnouncementPending[key] = true
      if (childAnnouncementTimeouts[key]) {
        clearTimeout(childAnnouncementTimeouts[key])
      }
      childAnnouncementTimeouts[key] = setTimeout(() => {
        const latest = get().childBridges.find(b => (b.username || b.name) === key)
        const latestStatus = latest?.status
        if (!latestStatus || latestStatus === 'pending') {
          childRestartRequested[key] = false
          childAnnouncementPending[key] = false
          return
        }

        const msg = formatRestartCompleteMessage(latest?.name || name, latestStatus)
        childRestartRequested[key] = false
        childAnnouncementPending[key] = false
        set({ childBridgeLiveMessages: { ...get().childBridgeLiveMessages, [key]: msg } })

        later(() => {
          if (get().childBridgeLiveMessages[key] === msg) {
            set({ childBridgeLiveMessages: { ...get().childBridgeLiveMessages, [key]: '' } })
          }
        }, 3000)
      }, 3000)
    }

    const setChildRestarting = (username: string, restarting: boolean): void => {
      const updated = [...get().childBridges]
      const index = updated.findIndex(x => x.username === username)
      if (index !== -1) {
        updated[index] = { ...updated[index], restarting }
      }
      set({ childBridges: updated })
    }

    const getChildBridgeMetadata = (): void => {
      void ioChild!.request<ChildBridgeStatusResponse[]>('get-homebridge-child-bridge-status').then((data) => {
        if (destroyed) {
          return
        }
        for (const bridge of data) {
          const key = bridge.username || bridge.name
          lastChildStatuses[key] = bridge.status
        }
        set({ childBridges: data.map(bridge => ({ ...bridge, restarting: false })).sort((a, b) => a.name.localeCompare(b.name)) })
      })
    }

    return {
      homebridgeStatus: null,
      childBridges: [],
      isRestarting: false,
      homebridgeLiveMessage: '',
      childBridgeLiveMessages: {},

      mainBridgeIconSource: () => {
        const status = get().homebridgeStatus
        return {
          status: status?.status as ChildBridgeIconSource['status'],
          hap: status?.hap,
          matterConfig: status?.matter as ChildBridgeIconSource['matterConfig'],
        }
      },

      mainBridgeAriaLabel: () => {
        const status = get().homebridgeStatus
        const name = status?.name || 'Homebridge'
        const inTransition = status?.status === 'pending' || get().isRestarting
        const statusLabel = bridgeStatusLabel(status?.status, inTransition)
        const matter = matterStatusLabel(!!status?.matter?.enabled, status?.status, inTransition)
        const restart = !inTransition && deps.isAdmin ? `, ${deps.t('menu.tooltip_restart')}` : ''
        return `${name}, ${statusLabel}${matter}${restart}`
      },

      childBridgeAriaLabel: (bridge) => {
        const inTransition = bridge.status === 'pending' || !!bridge.restarting || get().isRestarting
        const statusLabel = bridgeStatusLabel(bridge.status, inTransition)
        const matter = matterStatusLabel(isChildMatterEnabled(bridge), bridge.status, inTransition)
        const restart = !inTransition && deps.isAdmin ? `, ${deps.t('menu.tooltip_restart')}` : ''
        return `${bridge.name}, ${statusLabel}${matter}${restart}`
      },

      connect: () => {
        // A remount (StrictMode) starts a fresh session on the same store
        destroyed = false
        const main = deps.ws.connectToNamespace('status')
        ioMain = main

        const statusHandler = (data: HomebridgeStatusResponse) => {
          const prevStatus = lastHomebridgeStatus
          lastHomebridgeStatus = data.status
          set(data.status === 'ok' ? { homebridgeStatus: data, isRestarting: false } : { homebridgeStatus: data })
          maybeAnnounceHomebridgeRestart(prevStatus)
        }
        main.socket.on('homebridge-status', statusHandler)
        teardowns.push(() => main.socket.off('homebridge-status', statusHandler))

        teardowns.push(main.connected.subscribe(async () => {
          const prevStatus = lastHomebridgeStatus
          const data = await main.request<MainBridgeStatus>('get-homebridge-status')
          if (destroyed) {
            return
          }
          lastHomebridgeStatus = data?.status
          set({ homebridgeStatus: data })
          maybeAnnounceHomebridgeRestart(prevStatus)
        }))

        const disconnectHandler = () => {
          const prevStatus = lastHomebridgeStatus
          lastHomebridgeStatus = HomebridgeStatus.DOWN
          set({ homebridgeStatus: { ...get().homebridgeStatus, status: HomebridgeStatus.DOWN } })
          maybeAnnounceHomebridgeRestart(prevStatus)
        }
        main.socket.on('disconnect', disconnectHandler)
        teardowns.push(() => main.socket.off('disconnect', disconnectHandler))

        const child = deps.ws.connectToNamespace('child-bridges')
        ioChild = child

        teardowns.push(child.connected.subscribe(() => {
          getChildBridgeMetadata()
          child.socket.emit('monitor-child-bridge-status')
        }))

        const childStatusHandler = (data: ChildBridgeStatusResponse) => {
          const key = data.username || data.name
          const prevStatus = lastChildStatuses[key]
          lastChildStatuses[key] = data.status
          const bridges = get().childBridges
          const existingIndex = bridges.findIndex(x => x.username === data.username)
          if (existingIndex !== -1) {
            const updated = [...bridges]
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...data,
              restarting: data.status === 'ok' ? false : updated[existingIndex].restarting,
            }
            set({ childBridges: updated })
          } else {
            set({ childBridges: [...bridges, { ...data, restarting: false }].sort((a, b) => a.name.localeCompare(b.name)) })
          }
          maybeAnnounceChildRestart(data.name || key, key, prevStatus)
        }
        child.socket.on('child-bridge-status-update', childStatusHandler)
        teardowns.push(() => child.socket.off('child-bridge-status-update', childStatusHandler))

        return () => {
          destroyed = true
          // `end()` on these handles only releases this widget's reference: the
          // server-side session is ended by the ws service once the last holder lets go,
          // so the status page's `monitor-server-status` and any other
          // `child-bridges` consumer (e.g. the update-all modal) keep running.
          teardowns.forEach(fn => fn())
          teardowns = []
          ioMain?.end?.()
          ioChild?.end?.()
          if (homebridgeAnnouncementTimeout) {
            clearTimeout(homebridgeAnnouncementTimeout)
          }
          for (const key of Object.keys(childAnnouncementTimeouts)) {
            clearTimeout(childAnnouncementTimeouts[key])
          }
          timers.forEach(clearTimeout)
          timers.clear()
        }
      },

      restartChildBridge: async (bridge) => {
        const key = bridge.username || bridge.name
        childRestartRequested[key] = true
        childAnnouncementPending[key] = false
        try {
          setChildRestarting(bridge.username, true)
          await ioChild!.request('restart-child-bridge', bridge.username)
        } catch (error) {
          console.error(error)
          deps.toastError(deps.t('status.widget.bridge.restart_error'), deps.t('toast.title_error'))
        } finally {
          later(() => {
            setChildRestarting(bridge.username, false)
            childRestartRequested[key] = false
            childAnnouncementPending[key] = false
          }, 15000)
        }
      },

      restartHomebridge: async () => {
        homebridgeRestartRequested = true
        homebridgeAnnouncementPending = false
        set({ isRestarting: true })
        try {
          await deps.api.put('/server/restart', {})
          deps.cache.invalidateAll()
        } catch (error) {
          console.error(error)
          deps.toastError(deps.t('restart.toast_server_restart_error'), deps.t('toast.title_error'))
        } finally {
          later(() => {
            homebridgeRestartRequested = false
            homebridgeAnnouncementPending = false
            set({ isRestarting: false })
          }, 15000)
        }
      },
    }
  })
}
