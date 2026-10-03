import type { HomebridgeUiUpdatePolicy, HomebridgeUpdatePolicy, NodeUpdatePolicy } from '@/core/interfaces/settings.interfaces'
import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { IoNamespace } from '@/core/ws'
import type { NodeJsInfo, ServerInfo } from '@/modules/status/widgets/system-info-widget/system-info.interfaces'

import { createStore } from 'zustand/vanilla'

import { toastApiError } from '@/core/utilities/http-error'

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

/** What the store needs from the outside world. */
export interface UpdateInfoDeps {
  getEnv: () => UpdateInfoEnv
  setEnvItem: (key: 'homebridgeVersion' | 'homebridgeUiVersion', value: string) => void
  isAdmin: boolean
  /** `environment.production`, read at load time. */
  isProduction: () => boolean
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

export interface UpdateInfoState {
  homebridgePkg: Plugin
  homebridgeUiPkg: Plugin
  homebridgePluginStatus: Plugin[]
  homebridgePluginStatusDone: boolean
  nodejsInfo: NodeJsInfo | null
  nodejsStatusDone: boolean
  serverInfo: ServerInfo | null
  isRunningHbV2: boolean
  isHbV2Loaded: boolean
  isHbV2Ready: boolean
  dockerStatusDone: boolean
  dockerInfo: DockerDetails
  packageVersion: string | undefined
  homebridgeVersion: string | undefined
  runningInDocker: boolean | undefined
  nodeUpdatePolicy: NodeUpdatePolicy
  homebridgeUpdatePolicy: HomebridgeUpdatePolicy
  homebridgeUiUpdatePolicy: HomebridgeUiUpdatePolicy
  /** The `status` namespace, once connected. */
  io: IoNamespace | null
}

export interface UpdateInfoActions {
  /** Wire the `status` namespace (reload on every (re)connect); returns the teardown. */
  connect: (io: IoNamespace) => () => void
  /** Whether the widget was torn down (a late reply is dropped). */
  isDestroyed: () => boolean
  loadAllData: () => Promise<void>
  /** What `installAlternateVersion` re-reads once the version picker changed something. */
  refreshAfterVersionChange: (pkg: Plugin) => Promise<void>
  checkHomebridgeVersion: () => Promise<void>
  getNodeInfo: () => Promise<void>
  checkHomebridgeUiVersion: () => Promise<void>
}

export type UpdateInfoStore = UpdateInfoState & UpdateInfoActions

/**
 * How many items Update All would offer, from what this widget already
 * loaded. Gates the title-bar button (≥2 - with one update the existing
 * single-update flow is the right tool); the modal fetches the
 * authoritative plan itself.
 */
export function selectUpdateAllCount(s: Pick<UpdateInfoState, 'homebridgePluginStatus' | 'homebridgePkg' | 'homebridgeUiPkg'>): number {
  return s.homebridgePluginStatus.length
    + (s.homebridgePkg.updateAvailable ? 1 : 0)
    + (s.homebridgeUiPkg.updateAvailable ? 1 : 0)
}

function toastError(error: unknown): void {
  console.error(error)
  toastApiError(error)
}

/**
 * The state and data loading of the update-info widget (the Angular
 * component class), one store per mounted widget. `UpdateInfoWidget.tsx`
 * renders it and opens the modals.
 */
export function createUpdateInfoStore(deps: UpdateInfoDeps) {
  const env = deps.getEnv()
  let destroyed = false

  return createStore<UpdateInfoStore>()((set, get) => {
    const applyHomebridge = (hb: Plugin): Partial<UpdateInfoState> => {
      hb.displayName = 'Homebridge'
      deps.setEnvItem('homebridgeVersion', hb.installedVersion)
      return {
        homebridgePkg: hb,
        homebridgeVersion: hb.installedVersion,
        homebridgeUpdatePolicy: deps.getEnv().homebridgeUpdatePolicy || 'all',
        isRunningHbV2: Number(hb.installedVersion.split('.')[0]) >= 2,
      }
    }

    const applyHomebridgeUi = (hbUi: Plugin): Partial<UpdateInfoState> => {
      deps.setEnvItem('homebridgeUiVersion', hbUi.installedVersion)
      const homebridgeUiUpdatePolicy = deps.getEnv().homebridgeUiUpdatePolicy || 'all'
      if (!deps.isProduction()) {
        hbUi.updateAvailable = false
      }
      return { homebridgeUiUpdatePolicy, homebridgeUiPkg: hbUi }
    }

    return {
      homebridgePkg: {} as Plugin,
      homebridgeUiPkg: {} as Plugin,
      homebridgePluginStatus: [],
      homebridgePluginStatusDone: false,
      nodejsInfo: null,
      nodejsStatusDone: false,
      serverInfo: null,
      isRunningHbV2: false,
      isHbV2Loaded: false,
      isHbV2Ready: false,
      dockerStatusDone: false,
      dockerInfo: {
        latestVersion: null,
        latestReleaseBody: '',
        updateAvailable: false,
      },
      packageVersion: env.packageVersion,
      homebridgeVersion: env.homebridgeVersion,
      runningInDocker: env.runningInDocker,
      nodeUpdatePolicy: 'all',
      homebridgeUpdatePolicy: 'all',
      homebridgeUiUpdatePolicy: 'all',
      io: null,

      connect: (io) => {
        destroyed = false
        const current = deps.getEnv()
        set({
          io,
          nodeUpdatePolicy: current.nodeUpdatePolicy || 'all',
          homebridgeUiUpdatePolicy: current.homebridgeUiUpdatePolicy || 'all',
          homebridgeUpdatePolicy: current.homebridgeUpdatePolicy || 'all',
        })

        // Set up reconnection handler
        const offConnected = io.connected.subscribe(() => {
          queueMicrotask(() => {
            if (!destroyed) {
              void get().loadAllData()
            }
          })
        })
        return () => {
          destroyed = true
          offConnected()
        }
      },

      isDestroyed: () => destroyed,

      loadAllData: async () => {
        let overview: VersionOverview
        try {
          overview = await get().io!.request<VersionOverview>('get-version-overview')
        } catch (error) {
          toastError(error)
          return
        }
        if (destroyed) {
          return
        }

        const next: Partial<UpdateInfoState> = {}

        // Distribute the aggregated payload. Per-field null means the upstream
        // call rejected on the server — leave the corresponding tile in its
        // loading state (mirrors pre-aggregation behaviour where each failed
        // call left its own *StatusDone flag false).
        if (overview.serverInfo) {
          next.serverInfo = overview.serverInfo
        }

        if (overview.node) {
          next.nodeUpdatePolicy = deps.getEnv().nodeUpdatePolicy || 'all'
          next.nodejsInfo = overview.node
          next.nodejsStatusDone = true
        }

        if (overview.homebridge) {
          Object.assign(next, applyHomebridge(overview.homebridge))
        }

        if (overview.homebridgeUi) {
          Object.assign(next, applyHomebridgeUi(overview.homebridgeUi))
        }

        const hidden = deps.getEnv().plugins?.hideUpdatesFor
        next.homebridgePluginStatus = overview.outOfDatePlugins
          .filter(x => x.name !== UI_PACKAGE && !hidden?.includes(x.name))
        next.homebridgePluginStatusDone = true

        if (overview.serverInfo?.homebridgeRunningInDocker) {
          if (overview.docker) {
            next.dockerInfo = overview.docker
            next.dockerStatusDone = true
          }
        } else {
          next.dockerStatusDone = true
        }

        // Hb v2 readiness is computed server-side from the installed plugin list.
        // Display is gated on admin + not-currently-running-v2 to match prior behaviour.
        const isRunningHbV2 = next.isRunningHbV2 ?? get().isRunningHbV2
        if (!isRunningHbV2 && deps.isAdmin) {
          next.isHbV2Ready = overview.hbV2Ready
          next.isHbV2Loaded = true
        } else {
          next.isHbV2Ready = true
        }
        set(next)
      },

      refreshAfterVersionChange: async (pkg) => {
        if (pkg.name === 'homebridge') {
          await get().checkHomebridgeVersion()
        } else if (pkg.name === UI_PACKAGE) {
          await get().checkHomebridgeUiVersion()
        }
      },

      checkHomebridgeVersion: async () => {
        try {
          const response = await get().io!.request<Plugin>('homebridge-version-check')
          set(applyHomebridge(response))
        } catch (error) {
          toastError(error)
        }
      },

      getNodeInfo: async () => {
        let serverInfo: ServerInfo | undefined
        try {
          serverInfo = await get().io!.request<ServerInfo>('get-homebridge-server-info')
          const nodejsInfo = await get().io!.request<NodeJsInfo>('nodejs-version-check')

          // Backend handles the policy logic and returns the appropriate
          // version; refresh the policy from settings to have the latest value
          set({
            serverInfo,
            nodeUpdatePolicy: deps.getEnv().nodeUpdatePolicy || 'all',
            nodejsInfo,
            nodejsStatusDone: true,
          })
        } catch (error) {
          if (serverInfo) {
            set({ serverInfo })
          }
          toastError(error)
        }
      },

      checkHomebridgeUiVersion: async () => {
        try {
          const response = await get().io!.request<Plugin>('homebridge-ui-version-check')
          set(applyHomebridgeUi(response))
        } catch (error) {
          toastError(error)
        }
      },
    }
  })
}
