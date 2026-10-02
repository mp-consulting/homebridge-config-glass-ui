import type { BridgeConfig } from '@/core/interfaces/settings.interfaces'

import type { PluginBridgeState, SliceContext } from './plugin-bridge.state'

import { api } from '@/core/api'
import { settingsActions, useSettingsStore } from '@/core/settings'

/**
 * The saved bridge list (`env.bridges`): per-bridge UI preferences such as the
 * hidden unpairing alerts. The editor works on a copy, loaded on open; nothing
 * reaches the server or the settings store until the modal is saved, and then
 * only what changed.
 */
export interface BridgeListActions {
  /** Toggle hiding of unpairing alert for a specific bridge protocol (will be saved when modal is saved) */
  toggleHideUnpairing: (username: string, protocol: 'hap' | 'matter') => void
  /**
   * Toggle hiding of the "set up child bridge" recommendation for this plugin
   * (will be saved when modal is saved).
   */
  toggleHideChildBridgeSetup: () => void
}

/** Check if a specific bridge protocol alert is hidden */
export function isUnpairingHidden(state: PluginBridgeState, username: string, protocol: 'hap' | 'matter'): boolean {
  const bridge = state.bridgeConfigs.get(username.toUpperCase())
  if (!bridge) {
    return false
  }
  return protocol === 'hap' ? !!bridge.hideHapAlert : !!bridge.hideMatterAlert
}

/** The copy of the saved bridge list, and the values it was loaded with (for change detection). */
export function loadBridgeConfigs(): Pick<PluginBridgeState, 'bridgeConfigs' | 'originalScheduledRestartCrons' | 'originalHideAlerts'> {
  // Load from settings env which is already populated from the server
  const bridges = useSettingsStore.getState().env.bridges || []
  const bridgeConfigs = new Map<string, BridgeConfig>()
  const originalScheduledRestartCrons = new Map<string, string | null>()
  const originalHideAlerts = new Map<string, { hideHapAlert?: boolean, hideMatterAlert?: boolean }>()
  for (const bridge of bridges) {
    const normalizedUsername = bridge.username.toUpperCase()
    // A copy: the edits are local until saved, and the store's env is not ours to mutate
    bridgeConfigs.set(normalizedUsername, { ...bridge })
    originalScheduledRestartCrons.set(normalizedUsername, bridge.scheduledRestartCron || null)
    originalHideAlerts.set(normalizedUsername, {
      hideHapAlert: bridge.hideHapAlert,
      hideMatterAlert: bridge.hideMatterAlert,
    })
  }
  return { bridgeConfigs, originalScheduledRestartCrons, originalHideAlerts }
}

/**
 * Edit one bridge in the local copy (adding it if the saved list has none),
 * as a new entry in a new map.
 */
export function editBridgeConfig(ctx: SliceContext, username: string, edit: (bridge: BridgeConfig) => void): void {
  const normalizedUsername = username.toUpperCase()
  ctx.set((state) => {
    const bridge: BridgeConfig = { ...(state.bridgeConfigs.get(normalizedUsername) ?? { username: normalizedUsername }) }
    edit(bridge)
    return { bridgeConfigs: new Map(state.bridgeConfigs).set(normalizedUsername, bridge) }
  })
}

/** Check if hide alerts have changed for any bridge */
export function hasHideAlertsChanged(state: PluginBridgeState): boolean {
  for (const [username, bridge] of state.bridgeConfigs.entries()) {
    if (hideAlertChanges(state, username, bridge).length) {
      return true
    }
  }
  return false
}

export function hasHideChildBridgeSetupChanged(state: PluginBridgeState): boolean {
  return state.hideChildBridgeSetup !== state.originalHideChildBridgeSetup
}

/** The protocols whose hidden-alert flag differs from the saved one. */
function hideAlertChanges(state: PluginBridgeState, username: string, bridge: BridgeConfig): Array<['hap' | 'matter', boolean]> {
  const original = state.originalHideAlerts.get(username)
  // If no original, treat as false (default for new bridges)
  const changes: Array<['hap' | 'matter', boolean]> = []
  if (!!bridge.hideHapAlert !== (original ? !!original.hideHapAlert : false)) {
    changes.push(['hap', !!bridge.hideHapAlert])
  }
  if (!!bridge.hideMatterAlert !== (original ? !!original.hideMatterAlert : false)) {
    changes.push(['matter', !!bridge.hideMatterAlert])
  }
  return changes
}

/** Is this bridge on its way out? Its settings must not be written on the way past. */
export function isBeingDeleted(state: PluginBridgeState, username: string): boolean {
  return state.deleteBridges.some(b => b.id === username)
}

/** Update or add a bridge configuration in the local settings env */
export function updateLocalBridgeConfig(username: string, updates: Partial<BridgeConfig>): void {
  const normalizedUsername = username.toUpperCase()
  const bridges = [...(useSettingsStore.getState().env.bridges || [])]
  const bridgeIndex = bridges.findIndex(b => b.username.toUpperCase() === normalizedUsername)

  if (bridgeIndex !== -1) {
    bridges[bridgeIndex] = { ...bridges[bridgeIndex], ...updates }
  } else {
    bridges.push({
      username: normalizedUsername,
      ...updates,
    })
  }

  settingsActions.setEnvItem('bridges', bridges)
}

/** Save hide alert setting for a specific bridge protocol */
async function saveHideAlert(username: string, protocol: 'hap' | 'matter', value: boolean): Promise<void> {
  const normalizedUsername = username.toUpperCase()
  const endpoint = protocol === 'hap'
    ? `/config-editor/ui/bridges/${encodeURIComponent(normalizedUsername)}/hide-hap-alert`
    : `/config-editor/ui/bridges/${encodeURIComponent(normalizedUsername)}/hide-matter-alert`

  try {
    await api.put(endpoint, { value })
    updateLocalBridgeConfig(
      normalizedUsername,
      protocol === 'hap' ? { hideHapAlert: value } : { hideMatterAlert: value },
    )
  } catch (error) {
    console.error(`Failed to update hide ${protocol} alert:`, error)
    throw error
  }
}

/** Save hide alert settings only for bridges that changed and are not being deleted. */
export async function saveHideAlerts(state: PluginBridgeState): Promise<void> {
  for (const [username, bridgeConfig] of state.bridgeConfigs.entries()) {
    if (isBeingDeleted(state, username)) {
      continue
    }
    try {
      for (const [protocol, value] of hideAlertChanges(state, username, bridgeConfig)) {
        await saveHideAlert(username, protocol, value)
      }
    } catch (error) {
      console.error(error)
    }
  }
}

export async function saveHideChildBridgeSetup(ctx: SliceContext): Promise<void> {
  const plugin = ctx.get().plugin
  if (!plugin) {
    return
  }

  const wantHidden = ctx.get().hideChildBridgeSetup
  const currentList = useSettingsStore.getState().env.plugins?.hideChildBridgeSetupFor || []
  let nextList = [...currentList]

  if (wantHidden && !nextList.includes(plugin.name)) {
    nextList = [...nextList, plugin.name].sort((a, b) => a.localeCompare(b))
  } else if (!wantHidden) {
    nextList = nextList.filter(x => x !== plugin.name)
  }

  await api.put('/config-editor/ui/plugins/hide-child-bridge-setup-for', { body: nextList })
  settingsActions.setEnvItem('plugins.hideChildBridgeSetupFor', nextList)
  ctx.set({ originalHideChildBridgeSetup: wantHidden })
}

export function createBridgeListSlice(ctx: SliceContext): BridgeListActions {
  return {
    toggleHideUnpairing: (username, protocol) => {
      const newValue = !isUnpairingHidden(ctx.get(), username, protocol)
      editBridgeConfig(ctx, username, (bridge) => {
        const key = protocol === 'hap' ? 'hideHapAlert' : 'hideMatterAlert'
        if (newValue) {
          bridge[key] = true
        } else {
          delete bridge[key]
        }
      })
    },
    toggleHideChildBridgeSetup: () => ctx.set(state => ({ hideChildBridgeSetup: !state.hideChildBridgeSetup })),
  }
}
