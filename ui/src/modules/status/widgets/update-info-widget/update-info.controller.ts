import type { HomebridgeUiUpdatePolicy, HomebridgeUpdatePolicy, NodeUpdatePolicy } from '@/core/interfaces/settings.interfaces'
import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { IoNamespace } from '@/core/ws'
import type { NodeJsInfo, ServerInfo } from '@/modules/status/widgets/system-info-widget/system-info.interfaces'

import { createEmitter } from '@/core/utilities/emitter'

export interface DockerDetails {
  currentVersion?: string
  latestVersion: string | null
  latestReleaseBody: string
  updateAvailable: boolean
}

/**
 * Aggregated response for the dashboard "Update Info" widget.
 * Returned by the `get-version-overview` WS event. Per-field null when
 * the corresponding upstream call failed server-side.
 */
export interface VersionOverview {
  serverInfo: ServerInfo | null
  node: NodeJsInfo | null
  homebridge: Plugin | null
  homebridgeUi: Plugin | null
  outOfDatePlugins: Plugin[]
  docker: DockerDetails | null
  hbV2Ready: boolean
}

/** The env fields the widget reads (and the two it writes back). */
export interface UpdateInfoEnv {
  packageVersion?: string
  homebridgeVersion?: string
  runningInDocker?: boolean
  nodeUpdatePolicy?: NodeUpdatePolicy
  homebridgeUpdatePolicy?: HomebridgeUpdatePolicy
  homebridgeUiUpdatePolicy?: HomebridgeUiUpdatePolicy
  plugins?: { hideUpdatesFor?: string[] }
}

/** What the controller needs from the outside world (injected in Angular). */
export interface UpdateInfoDeps {
  getEnv: () => UpdateInfoEnv
  setEnvItem: (key: 'homebridgeVersion' | 'homebridgeUiVersion', value: string) => void
  isAdmin: boolean
  /** `environment.production`, read at load time. */
  isProduction: () => boolean
  toastError: (message: string, title: string) => void
  toToastMessage: (error: unknown) => string
  t: (key: string) => string
}

const UI_PACKAGE = '@mp-consulting/homebridge-config-glass-ui'

export interface HomebridgeIconState {
  homebridgePkg: Partial<Plugin>
  homebridgeUpdatePolicy: string
}

export function getHomebridgeIconClass({ homebridgePkg, homebridgeUpdatePolicy }: HomebridgeIconState): string {
  if (!homebridgePkg.installedVersion) {
    return 'fa-circle-notch fa-spin primary-text'
  }

  if (homebridgePkg.multipleInstances) {
    return 'fa-exclamation-circle orange-text'
  }

  if (homebridgeUpdatePolicy === 'none' || (homebridgeUpdatePolicy === 'major' && !homebridgePkg.updateAvailable)) {
    return 'fa-circle green-text'
  }

  return homebridgePkg.updateAvailable
    ? 'fa-arrow-alt-circle-up orange-text'
    : 'fa-check-circle green-text'
}

export function getHomebridgeUiIconClass({ homebridgeUiPkg, homebridgeUiUpdatePolicy }: { homebridgeUiPkg: Partial<Plugin>, homebridgeUiUpdatePolicy: string }): string {
  if (!homebridgeUiPkg.installedVersion) {
    return 'fa-circle-notch fa-spin primary-text'
  }

  if (homebridgeUiUpdatePolicy === 'none' || (homebridgeUiUpdatePolicy === 'major' && !homebridgeUiPkg.updateAvailable)) {
    return 'fa-circle green-text'
  }

  return homebridgeUiPkg.updateAvailable
    ? 'fa-arrow-alt-circle-up orange-text'
    : 'fa-check-circle green-text'
}

export function getPluginsIconClass({ homebridgePluginStatusDone, homebridgePluginStatus }: { homebridgePluginStatusDone: boolean, homebridgePluginStatus: unknown[] }): string {
  if (!homebridgePluginStatusDone) {
    return 'fa-circle-notch fa-spin primary-text'
  }

  return homebridgePluginStatus.length
    ? 'fa-arrow-alt-circle-up orange-text'
    : 'fa-check-circle green-text'
}

export function getNodejsIconClass({ nodejsStatusDone, nodejsInfo, nodeUpdatePolicy }: { nodejsStatusDone: boolean, nodejsInfo: Partial<NodeJsInfo> | null, nodeUpdatePolicy: string }): string {
  if (!nodejsStatusDone) {
    return 'fa-circle-notch fa-spin primary-text'
  }

  if (nodeUpdatePolicy === 'none' || (nodeUpdatePolicy === 'major' && !nodejsInfo?.updateAvailable)) {
    return 'fa-circle green-text'
  }

  if (nodejsInfo?.showNodeUnsupportedWarning) {
    return 'fa-exclamation-circle orange-text'
  }

  return nodejsInfo?.updateAvailable
    ? 'fa-arrow-alt-circle-up orange-text'
    : 'fa-check-circle green-text'
}

/**
 * The state and data loading of the update-info widget, ported from the
 * Angular component class. `UpdateInfoWidget.tsx` renders it, opens the
 * modals, and re-renders on `subscribe`.
 */
export class UpdateInfoController {
  public homebridgePkg = {} as Plugin
  public homebridgeUiPkg = {} as Plugin
  public homebridgePluginStatus: Plugin[] = []
  public homebridgePluginStatusDone = false
  public nodejsInfo: NodeJsInfo | null = null
  public nodejsStatusDone = false
  public serverInfo: ServerInfo | null = null
  public isRunningHbV2 = false
  public isHbV2Loaded = false
  public isHbV2Ready = false
  public dockerStatusDone = false
  public dockerInfo: DockerDetails = {
    latestVersion: null,
    latestReleaseBody: '',
    updateAvailable: false,
  }

  public packageVersion: string | undefined
  public homebridgeVersion: string | undefined
  public runningInDocker: boolean | undefined
  public nodeUpdatePolicy: NodeUpdatePolicy = 'all'
  public homebridgeUpdatePolicy: HomebridgeUpdatePolicy = 'all'
  public homebridgeUiUpdatePolicy: HomebridgeUiUpdatePolicy = 'all'

  public io: IoNamespace | null = null
  private offConnected: (() => void) | null = null
  public destroyed = false

  private readonly changes = createEmitter()
  private version = 0

  constructor(private readonly deps: UpdateInfoDeps) {
    const env = deps.getEnv()
    this.packageVersion = env.packageVersion
    this.homebridgeVersion = env.homebridgeVersion
    this.runningInDocker = env.runningInDocker
  }

  public subscribe = (listener: () => void): (() => void) => this.changes.subscribe(listener)

  public getVersion = (): number => this.version

  private changed(): void {
    this.version += 1
    this.changes.emit()
  }

  /**
   * How many items Update All would offer, from what this widget already
   * loaded. Gates the title-bar button (≥2 - with one update the existing
   * single-update flow is the right tool); the modal fetches the
   * authoritative plan itself.
   */
  public updateAllCount(): number {
    return this.homebridgePluginStatus.length
      + (this.homebridgePkg.updateAvailable ? 1 : 0)
      + (this.homebridgeUiPkg.updateAvailable ? 1 : 0)
  }

  public init(io: IoNamespace): void {
    this.destroyed = false
    this.io = io
    const env = this.deps.getEnv()
    this.nodeUpdatePolicy = env.nodeUpdatePolicy || 'all'
    this.homebridgeUiUpdatePolicy = env.homebridgeUiUpdatePolicy || 'all'
    this.homebridgeUpdatePolicy = env.homebridgeUpdatePolicy || 'all'

    // Set up reconnection handler
    this.offConnected = io.connected.subscribe(() => {
      queueMicrotask(() => {
        if (!this.destroyed) {
          void this.loadAllData()
        }
      })
    })
    this.changed()
  }

  public destroy(): void {
    this.destroyed = true
    this.offConnected?.()
    this.offConnected = null
  }

  private toastError(error: unknown): void {
    console.error(error)
    this.deps.toastError(this.deps.toToastMessage(error), this.deps.t('toast.title_error'))
  }

  private applyHomebridge(hb: Plugin): void {
    hb.displayName = 'Homebridge'
    this.homebridgePkg = hb
    this.deps.setEnvItem('homebridgeVersion', hb.installedVersion)
    this.homebridgeVersion = hb.installedVersion
    this.homebridgeUpdatePolicy = this.deps.getEnv().homebridgeUpdatePolicy || 'all'
    this.isRunningHbV2 = Number(hb.installedVersion.split('.')[0]) >= 2
  }

  private applyHomebridgeUi(hbUi: Plugin): void {
    this.deps.setEnvItem('homebridgeUiVersion', hbUi.installedVersion)
    this.homebridgeUiUpdatePolicy = this.deps.getEnv().homebridgeUiUpdatePolicy || 'all'
    if (!this.deps.isProduction()) {
      hbUi.updateAvailable = false
    }
    this.homebridgeUiPkg = hbUi
  }

  public async loadAllData(): Promise<void> {
    let overview: VersionOverview
    try {
      overview = await this.io!.request<VersionOverview>('get-version-overview')
    } catch (error) {
      this.toastError(error)
      return
    }
    if (this.destroyed) {
      return
    }

    // Distribute the aggregated payload. Per-field null means the upstream
    // call rejected on the server — leave the corresponding tile in its
    // loading state (mirrors pre-aggregation behaviour where each failed
    // call left its own *StatusDone flag false).
    if (overview.serverInfo) {
      this.serverInfo = overview.serverInfo
    }

    if (overview.node) {
      this.nodeUpdatePolicy = this.deps.getEnv().nodeUpdatePolicy || 'all'
      this.nodejsInfo = overview.node
      this.nodejsStatusDone = true
    }

    if (overview.homebridge) {
      this.applyHomebridge(overview.homebridge)
    }

    if (overview.homebridgeUi) {
      this.applyHomebridgeUi(overview.homebridgeUi)
    }

    const hidden = this.deps.getEnv().plugins?.hideUpdatesFor
    this.homebridgePluginStatus = overview.outOfDatePlugins
      .filter(x => x.name !== UI_PACKAGE && !hidden?.includes(x.name))
    this.homebridgePluginStatusDone = true

    if (overview.serverInfo?.homebridgeRunningInDocker) {
      if (overview.docker) {
        this.dockerInfo = overview.docker
        this.dockerStatusDone = true
      }
    } else {
      this.dockerStatusDone = true
    }

    // Hb v2 readiness is computed server-side from the installed plugin list.
    // Display is gated on admin + not-currently-running-v2 to match prior behaviour.
    if (!this.isRunningHbV2 && this.deps.isAdmin) {
      this.isHbV2Ready = overview.hbV2Ready
      this.isHbV2Loaded = true
    } else {
      this.isHbV2Ready = true
    }
    this.changed()
  }

  /** What `installAlternateVersion` re-reads once the version picker changed something. */
  public async refreshAfterVersionChange(pkg: Plugin): Promise<void> {
    if (pkg.name === 'homebridge') {
      await this.checkHomebridgeVersion()
    } else if (pkg.name === UI_PACKAGE) {
      await this.checkHomebridgeUiVersion()
    }
  }

  public async checkHomebridgeVersion(): Promise<void> {
    try {
      const response = await this.io!.request<Plugin>('homebridge-version-check')
      this.applyHomebridge(response)
      this.changed()
    } catch (error) {
      this.toastError(error)
    }
  }

  public async getNodeInfo(): Promise<void> {
    try {
      this.serverInfo = await this.io!.request<ServerInfo>('get-homebridge-server-info')
      const nodejsInfo = await this.io!.request<NodeJsInfo>('nodejs-version-check')

      // Refresh the policy from settings to ensure we have the latest value
      this.nodeUpdatePolicy = this.deps.getEnv().nodeUpdatePolicy || 'all'

      // Backend handles the policy logic and returns the appropriate version
      // No additional filtering needed here
      this.nodejsInfo = nodejsInfo
      this.nodejsStatusDone = true
      this.changed()
    } catch (error) {
      this.toastError(error)
    }
  }

  public async checkHomebridgeUiVersion(): Promise<void> {
    try {
      const response = await this.io!.request<Plugin>('homebridge-ui-version-check')
      this.applyHomebridgeUi(response)
      this.changed()
    } catch (error) {
      this.toastError(error)
    }
  }
}
