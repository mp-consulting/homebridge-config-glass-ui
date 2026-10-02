import type { ChildBridgeIconSource } from '@/core/components/child-bridge-status-icons/ChildBridgeStatusIcons'
import type { ChildBridgeStatusResponse, HomebridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { IoNamespace } from '@/core/ws'

import { HomebridgeStatus } from '@/core/interfaces/server.interfaces'

/** Extends ChildBridgeStatusResponse with UI-only state */
export interface ChildBridgeWithUIState extends ChildBridgeStatusResponse {
  restarting?: boolean
}

export type MainBridgeStatus = Partial<HomebridgeStatusResponse & { name?: string }>

/** What the controller needs from the outside world (injected in Angular). */
export interface BridgesDeps {
  ws: { connectToNamespace: (namespace: string) => IoNamespace }
  api: { put: (path: string, body?: unknown) => Promise<unknown> }
  cache: { invalidateAll: () => void }
  toastError: (message: string, title: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
  isAdmin: boolean
  isMatterSupported: boolean
}

/**
 * The state and logic of the bridges widget, ported from the Angular
 * component class nearly line for line. `BridgesWidget.tsx` renders it and
 * re-renders on `subscribe`.
 */
export class BridgesController {
  public homebridgeStatus: MainBridgeStatus | null = null
  public childBridges: ChildBridgeWithUIState[] = []
  public isRestarting = false

  // Live-region state — only set when a user-initiated restart has settled
  // (transitioned from pending back to a stable status). Cleared after 3s.
  public homebridgeLiveMessage = ''
  public childBridgeLiveMessages: Record<string, string> = {}

  private ioMain?: IoNamespace
  private ioChild?: IoNamespace
  // Kept so destroy() can `off()` exactly these: both namespaces are cached
  // and shared, and `end()` keeps listeners
  private teardowns: Array<() => void> = []
  private destroyed = false

  // Track the last seen status so we can detect "pending -> stable" transitions.
  private lastHomebridgeStatus: string | undefined
  private lastChildStatuses: Record<string, string | undefined> = {}

  // Track whether the user explicitly asked for a restart; we only announce on user-initiated restarts.
  private homebridgeRestartRequested = false
  private homebridgeAnnouncementPending = false
  private homebridgeAnnouncementTimeout: ReturnType<typeof setTimeout> | null = null
  private childRestartRequested: Record<string, boolean> = {}
  private childAnnouncementPending: Record<string, boolean> = {}
  private childAnnouncementTimeouts: Record<string, ReturnType<typeof setTimeout>> = {}
  // Every other timer, so none fires into a destroyed widget
  private timers = new Set<ReturnType<typeof setTimeout>>()

  private listeners = new Set<() => void>()
  private version = 0

  constructor(private readonly deps: BridgesDeps) {}

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getVersion = (): number => this.version

  private changed(): void {
    this.version += 1
    for (const listener of Array.from(this.listeners)) {
      listener()
    }
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, ms)
    this.timers.add(timer)
    return timer
  }

  /**
   * The main bridge mapped into the shared status-icon source shape, so its
   * icons come from the same component (and the same colour/tooltip rules) as
   * every child bridge row. The status payload's `matter` block matches the
   * matterConfig shape the icons read (enabled + externalsOnly).
   */
  public mainBridgeIconSource(): ChildBridgeIconSource {
    return {
      status: this.homebridgeStatus?.status as ChildBridgeIconSource['status'],
      hap: this.homebridgeStatus?.hap,
      matterConfig: this.homebridgeStatus?.matter as ChildBridgeIconSource['matterConfig'],
    }
  }

  /**
   * Compose a single aria-label that the screen reader reads as the whole row
   * is one button: "<name>, <Running|Not Running|Restarting>[, Matter
   * Running|Matter Not Running][, Restart]". The trailing "Restart" only
   * appears when the user can actually trigger a restart.
   */
  public mainBridgeAriaLabel(): string {
    const status = this.homebridgeStatus
    const name = status?.name || 'Homebridge'
    const inTransition = status?.status === 'pending' || this.isRestarting
    const statusLabel = this.bridgeStatusLabel(status?.status, inTransition)
    const matter = this.matterStatusLabel(!!status?.matter?.enabled, status?.status, inTransition)
    const restart = !inTransition && this.deps.isAdmin ? `, ${this.deps.t('menu.tooltip_restart')}` : ''
    return `${name}, ${statusLabel}${matter}${restart}`
  }

  public childBridgeAriaLabel(bridge: ChildBridgeWithUIState): string {
    const inTransition = bridge.status === 'pending' || !!bridge.restarting || this.isRestarting
    const statusLabel = this.bridgeStatusLabel(bridge.status, inTransition)
    const matter = this.matterStatusLabel(this.isChildMatterEnabled(bridge), bridge.status, inTransition)
    const restart = !inTransition && this.deps.isAdmin ? `, ${this.deps.t('menu.tooltip_restart')}` : ''
    return `${bridge.name}, ${statusLabel}${matter}${restart}`
  }

  /**
   * Whether Matter is actively enabled for a child bridge: configured and not
   * turned off in place (`matterConfig.enabled === false`). Mirrors the visible
   * Matter icon so it greys out for a configured-but-disabled bridge.
   */
  public isChildMatterEnabled(bridge: ChildBridgeWithUIState): boolean {
    return !!bridge.matterConfig && bridge.matterConfig.enabled !== false
  }

  private bridgeStatusLabel(status: string | undefined, inTransition: boolean): string {
    if (inTransition) {
      return this.deps.t('status.services.label_restarting')
    }
    return this.deps.t(status === 'down' ? 'status.services.label_not_running' : 'status.services.label_running')
  }

  /**
   * Mirror the visible matter icon: when Matter support is enabled in the
   * server, the icon is always rendered with one of three tooltips
   * (not_enabled / not_running / running). Announce the same state so screen
   * reader users know whether matter is configured per-bridge. Skip during
   * transition — the row label already says "Restarting".
   */
  private matterStatusLabel(matterEnabledForBridge: boolean, status: string | undefined, inTransition: boolean): string {
    if (!this.deps.isMatterSupported || inTransition) {
      return ''
    }
    if (!matterEnabledForBridge) {
      return `, ${this.deps.t('status.services.matter_not_enabled')}`
    }
    return `, ${this.deps.t(status === 'down' ? 'status.services.matter_not_running' : 'status.services.matter_running')}`
  }

  public init(): void {
    // A remount (StrictMode) starts a fresh session on the same controller
    this.destroyed = false
    const ioMain = this.deps.ws.connectToNamespace('status')
    this.ioMain = ioMain

    const statusHandler = (data: HomebridgeStatusResponse) => {
      const prevStatus = this.lastHomebridgeStatus
      this.homebridgeStatus = data
      this.lastHomebridgeStatus = data.status
      if (data.status === 'ok') {
        this.isRestarting = false
      }
      this.maybeAnnounceHomebridgeRestart(prevStatus)
      this.changed()
    }
    ioMain.socket.on('homebridge-status', statusHandler)
    this.teardowns.push(() => ioMain.socket.off('homebridge-status', statusHandler))

    this.teardowns.push(ioMain.connected.subscribe(async () => {
      const prevStatus = this.lastHomebridgeStatus
      await this.getHomebridgeStatus()
      if (this.destroyed) {
        return
      }
      this.lastHomebridgeStatus = this.homebridgeStatus?.status
      this.maybeAnnounceHomebridgeRestart(prevStatus)
      this.changed()
    }))

    const disconnectHandler = () => {
      const prevStatus = this.lastHomebridgeStatus
      this.homebridgeStatus = { ...this.homebridgeStatus, status: HomebridgeStatus.DOWN }
      this.lastHomebridgeStatus = HomebridgeStatus.DOWN
      this.maybeAnnounceHomebridgeRestart(prevStatus)
      this.changed()
    }
    ioMain.socket.on('disconnect', disconnectHandler)
    this.teardowns.push(() => ioMain.socket.off('disconnect', disconnectHandler))

    const ioChild = this.deps.ws.connectToNamespace('child-bridges')
    this.ioChild = ioChild

    this.teardowns.push(ioChild.connected.subscribe(() => {
      this.getChildBridgeMetadata()
      ioChild.socket.emit('monitor-child-bridge-status')
    }))

    const childStatusHandler = (data: ChildBridgeStatusResponse) => {
      const key = data.username || data.name
      const prevStatus = this.lastChildStatuses[key]
      this.lastChildStatuses[key] = data.status
      const bridges = this.childBridges
      const existingIndex = bridges.findIndex(x => x.username === data.username)
      if (existingIndex !== -1) {
        const updated = [...bridges]
        updated[existingIndex] = {
          ...updated[existingIndex],
          ...data,
          restarting: data.status === 'ok' ? false : updated[existingIndex].restarting,
        }
        this.childBridges = updated
      } else {
        this.childBridges = [...bridges, { ...data, restarting: false }].sort((a, b) => a.name.localeCompare(b.name))
      }
      this.maybeAnnounceChildRestart(data.name || key, key, prevStatus)
      this.changed()
    }
    ioChild.socket.on('child-bridge-status-update', childStatusHandler)
    this.teardowns.push(() => ioChild.socket.off('child-bridge-status-update', childStatusHandler))
  }

  private setChildRestarting(username: string, restarting: boolean): void {
    const updated = [...this.childBridges]
    const index = updated.findIndex(x => x.username === username)
    if (index !== -1) {
      updated[index] = { ...updated[index], restarting }
    }
    this.childBridges = updated
    this.changed()
  }

  public async restartChildBridge(bridge: ChildBridgeWithUIState): Promise<void> {
    const key = bridge.username || bridge.name
    this.childRestartRequested[key] = true
    this.childAnnouncementPending[key] = false
    try {
      this.setChildRestarting(bridge.username, true)
      await this.ioChild!.request('restart-child-bridge', bridge.username)
    } catch (error) {
      console.error(error)
      this.deps.toastError(this.deps.t('status.widget.bridge.restart_error'), this.deps.t('toast.title_error'))
    } finally {
      this.later(() => {
        this.setChildRestarting(bridge.username, false)
        this.childRestartRequested[key] = false
        this.childAnnouncementPending[key] = false
      }, 15000)
    }
  }

  public async restartHomebridge(): Promise<void> {
    this.homebridgeRestartRequested = true
    this.homebridgeAnnouncementPending = false
    this.isRestarting = true
    this.changed()
    try {
      await this.deps.api.put('/server/restart', {})
      this.deps.cache.invalidateAll()
    } catch (error) {
      console.error(error)
      this.deps.toastError(this.deps.t('restart.toast_server_restart_error'), this.deps.t('toast.title_error'))
    } finally {
      this.later(() => {
        this.isRestarting = false
        this.homebridgeRestartRequested = false
        this.homebridgeAnnouncementPending = false
        this.changed()
      }, 15000)
    }
  }

  public destroy(): void {
    this.destroyed = true
    // `end()` on these handles only releases this widget's reference: the
    // server-side session is ended by the ws service once the last holder lets go,
    // so the status page's `monitor-server-status` and any other
    // `child-bridges` consumer (e.g. the update-all modal) keep running.
    this.teardowns.forEach(fn => fn())
    this.teardowns = []
    this.ioMain?.end?.()
    this.ioChild?.end?.()
    if (this.homebridgeAnnouncementTimeout) {
      clearTimeout(this.homebridgeAnnouncementTimeout)
    }
    for (const key of Object.keys(this.childAnnouncementTimeouts)) {
      clearTimeout(this.childAnnouncementTimeouts[key])
    }
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  // When a user-initiated restart resolves (status leaves 'pending'), wait 3s
  // for things to fully settle then announce the final state. Only once per
  // restart click.
  private maybeAnnounceHomebridgeRestart(prevStatus: string | undefined): void {
    const currentStatus = this.homebridgeStatus?.status
    if (
      !this.homebridgeRestartRequested
      || this.homebridgeAnnouncementPending
      || prevStatus !== 'pending'
      || !currentStatus
      || currentStatus === 'pending'
    ) {
      return
    }

    this.homebridgeAnnouncementPending = true
    if (this.homebridgeAnnouncementTimeout) {
      clearTimeout(this.homebridgeAnnouncementTimeout)
    }
    this.homebridgeAnnouncementTimeout = setTimeout(() => {
      const latestStatus = this.homebridgeStatus?.status
      if (!latestStatus || latestStatus === 'pending') {
        this.homebridgeRestartRequested = false
        this.homebridgeAnnouncementPending = false
        return
      }

      const name = this.homebridgeStatus?.name || 'Homebridge'
      const msg = this.formatRestartCompleteMessage(name, latestStatus)
      this.homebridgeLiveMessage = msg
      this.homebridgeRestartRequested = false
      this.homebridgeAnnouncementPending = false
      this.changed()

      this.later(() => {
        if (this.homebridgeLiveMessage === msg) {
          this.homebridgeLiveMessage = ''
          this.changed()
        }
      }, 3000)
    }, 3000)
  }

  private maybeAnnounceChildRestart(name: string, key: string, prevStatus: string | undefined): void {
    const bridge = this.childBridges.find(b => (b.username || b.name) === key)
    const currentStatus = bridge?.status
    if (
      !this.childRestartRequested[key]
      || this.childAnnouncementPending[key]
      || prevStatus !== 'pending'
      || !currentStatus
      || currentStatus === 'pending'
    ) {
      return
    }

    this.childAnnouncementPending[key] = true
    if (this.childAnnouncementTimeouts[key]) {
      clearTimeout(this.childAnnouncementTimeouts[key])
    }
    this.childAnnouncementTimeouts[key] = setTimeout(() => {
      const latest = this.childBridges.find(b => (b.username || b.name) === key)
      const latestStatus = latest?.status
      if (!latestStatus || latestStatus === 'pending') {
        this.childRestartRequested[key] = false
        this.childAnnouncementPending[key] = false
        return
      }

      const msg = this.formatRestartCompleteMessage(latest?.name || name, latestStatus)
      this.childBridgeLiveMessages = { ...this.childBridgeLiveMessages, [key]: msg }
      this.childRestartRequested[key] = false
      this.childAnnouncementPending[key] = false
      this.changed()

      this.later(() => {
        if (this.childBridgeLiveMessages[key] === msg) {
          this.childBridgeLiveMessages = { ...this.childBridgeLiveMessages, [key]: '' }
          this.changed()
        }
      }, 3000)
    }, 3000)
  }

  private formatRestartCompleteMessage(name: string, status: string): string {
    let statusLabel: string | undefined
    if (status === 'down') {
      statusLabel = this.deps.t('status.services.label_not_running')
    } else if (status === 'ok') {
      statusLabel = this.deps.t('status.services.label_running')
    } else {
      statusLabel = status
    }
    return statusLabel
      ? this.deps.t('status.widget.bridge.restart_complete_with_status', { name, status: statusLabel })
      : this.deps.t('status.widget.bridge.restart_complete', { name })
  }

  private async getHomebridgeStatus(): Promise<void> {
    const data = await this.ioMain!.request<MainBridgeStatus>('get-homebridge-status')
    this.homebridgeStatus = data
  }

  private getChildBridgeMetadata(): void {
    void this.ioChild!.request<ChildBridgeStatusResponse[]>('get-homebridge-child-bridge-status').then((data) => {
      if (this.destroyed) {
        return
      }
      this.childBridges = data.map(bridge => ({ ...bridge, restarting: false })).sort((a, b) => a.name.localeCompare(b.name))
      for (const bridge of data) {
        const key = bridge.username || bridge.name
        this.lastChildStatuses[key] = bridge.status
      }
      this.changed()
    })
  }
}
