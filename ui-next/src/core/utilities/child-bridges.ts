import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { ComponentType } from 'react'

import { api } from '@/core/api'
import { ttlCache } from '@/core/caching/ttl-cache'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { toToastMessage } from '@/core/utilities/http-error'

const CACHE_KEY = 'status-child-bridges'

/** What the child bridge restart modal is opened with (RESTART_CHILD_BRIDGES_MODAL_DATA). */
export interface RestartChildBridgesModalData {
  bridges: { name: string, username: string, matterSerialNumber?: string }[]
}

export type RestartChildBridgesModal = ComponentType<ModalComponentProps & RestartChildBridgesModalData>
export type RestartHomebridgeModal = ComponentType<ModalComponentProps>

/**
 * The two restart prompts. Registered by the components that implement them
 * (RestartChildBridgesComponent / RestartHomebridgeComponent) rather than
 * imported here, so this module does not pull the component layer in.
 */
const modals: { childBridges?: RestartChildBridgesModal, homebridge?: RestartHomebridgeModal } = {}

const RESTART_MODAL_OPTIONS = { size: 'lg', backdrop: 'static', keyboard: false } as const

export const childBridges = {
  /**
   * Tell the service which components are the restart prompts.
   * @param components - the child bridge and the full Homebridge restart modals
   * @param components.childBridges - RestartChildBridgesComponent
   * @param components.homebridge - RestartHomebridgeComponent
   */
  registerRestartModals(components: { childBridges: RestartChildBridgesModal, homebridge: RestartHomebridgeModal }): void {
    modals.childBridges = components.childBridges
    modals.homebridge = components.homebridge
  },

  /**
   * Opens the correct restart modal based on whether the plugin has child bridges
   * @param pluginName - The name of the plugin to get child bridges for
   */
  async openCorrectRestartModalForPlugin(pluginName: string): Promise<void> {
    const bridges = await getChildBridgesForPlugin(pluginName)
    childBridges.openCorrectRestartModalWithBridges(bridges)
  },

  /**
   * Variant of `openCorrectRestartModalForPlugin` that uses a caller-supplied
   * bridge list — the config-editor mutation endpoints return `affectedBridges`
   * inline, so callers no longer need a separate
   * `/status/homebridge/child-bridges` round-trip.
   * @param bridges - the affected child bridges
   */
  openCorrectRestartModalWithBridges(bridges: ChildBridge[] = []): void {
    // Default to [] so callers passing through an absent `affectedBridges`
    // field (e.g. when the wrapped restart-info endpoint failed) fall
    // through to the full-Homebridge restart prompt instead of throwing
    // and silently losing the restart-required notice altogether.
    if (bridges.length) {
      if (!modals.childBridges) {
        throw new Error('childBridges: the restart modals have not been registered')
      }
      openModal(modals.childBridges, {
        bridges: bridges.map(bridge => ({
          name: bridge.name,
          username: bridge.username,
          matterSerialNumber: bridge.matterSerialNumber,
        })),
      }, RESTART_MODAL_OPTIONS)
    } else {
      if (!modals.homebridge) {
        throw new Error('childBridges: the restart modals have not been registered')
      }
      openModal(modals.homebridge, {}, RESTART_MODAL_OPTIONS)
    }
  },

  /** The full list of child bridges, cached. */
  getAll(): Promise<ChildBridge[]> {
    return ttlCache.get<ChildBridge[]>(CACHE_KEY, () => api.get<ChildBridge[]>('/status/homebridge/child-bridges'))
  },

  invalidate(): void {
    ttlCache.invalidate(CACHE_KEY)
  },
}

/**
 * The child bridges of one plugin; an empty list (and a toast) when the list
 * cannot be read, so the caller falls back to the full restart prompt.
 * @param pluginName - the plugin
 */
async function getChildBridgesForPlugin(pluginName: string): Promise<ChildBridge[]> {
  try {
    const data = await childBridges.getAll()
    return data.filter(bridge => pluginName === bridge.plugin)
  } catch (error: any) {
    console.error(error)
    toast.error(toToastMessage(error), i18n.t('toast.title_error'))
    return []
  }
}
