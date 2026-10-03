import type { PluginBridgeState, SliceContext } from './plugin-bridge.state'

import { api } from '@/core/api'
import { settingsActions, useSettingsStore } from '@/core/settings'

import { editBridgeConfig, isBeingDeleted, updateLocalBridgeConfig } from './plugin-bridge.bridge-list'

/**
 * The per-bridge scheduled restart (a cron expression). It lives in the saved
 * bridge list, so it is edited on the same local copy and saved with the modal.
 */
export interface ScheduleActions {
  /** Update scheduled restart cron locally (will be saved when modal is saved) */
  onScheduledRestartCronChange: (value: string, username: string | undefined) => void
}

/** Get the scheduled restart cron for a specific bridge */
export function getScheduledRestartCron(state: PluginBridgeState, username: string | undefined): string {
  if (!username) {
    return ''
  }
  return state.bridgeConfigs.get(username.toUpperCase())?.scheduledRestartCron || ''
}

/** The cron as edited and as saved, both with empty normalised to null. */
function cronValues(state: PluginBridgeState, username: string): { current: string | null, original: string | null } {
  const currentValue = state.bridgeConfigs.get(username)?.scheduledRestartCron || null
  const originalValue = state.originalScheduledRestartCrons.get(username) || null
  return {
    current: currentValue === '' ? null : currentValue,
    original: originalValue === '' ? null : originalValue,
  }
}

/** Check if scheduled restart cron has changed for any bridge */
export function hasScheduledRestartCronChanged(state: PluginBridgeState): boolean {
  for (const username of state.bridgeConfigs.keys()) {
    const { current, original } = cronValues(state, username)
    if (current !== original) {
      return true
    }
  }
  return false
}

/** Save scheduled restart cron for a specific bridge */
async function saveScheduledRestartCron(username: string, value: string | null): Promise<void> {
  const normalizedUsername = username.toUpperCase()

  try {
    await api.put(
      `/config-editor/ui/bridges/${encodeURIComponent(normalizedUsername)}/scheduled-restart-cron`,
      { value: value || null },
    )

    if (value) {
      updateLocalBridgeConfig(normalizedUsername, { scheduledRestartCron: value })
    } else {
      // Remove the property if value is null
      const bridges = [...(useSettingsStore.getState().env.bridges || [])]
      const bridgeIndex = bridges.findIndex(b => b.username.toUpperCase() === normalizedUsername)
      if (bridgeIndex !== -1) {
        const rest = { ...bridges[bridgeIndex] }
        delete rest.scheduledRestartCron
        bridges[bridgeIndex] = rest
        settingsActions.setEnvItem('bridges', bridges)
      }
    }
  } catch (error) {
    console.error('Failed to update scheduled restart cron:', error)
    throw error
  }
}

/**
 * Save the scheduled restart cron only for bridges that changed and are not
 * being deleted, then (when `cronHasChanged`) ask hb-service for a full
 * service restart, which is what picks up a new schedule.
 */
export async function saveScheduledRestartCrons(state: PluginBridgeState, cronHasChanged: boolean): Promise<void> {
  for (const username of state.bridgeConfigs.keys()) {
    if (isBeingDeleted(state, username)) {
      continue
    }
    const { current, original } = cronValues(state, username)
    if (current !== original) {
      try {
        await saveScheduledRestartCron(username, current)
      } catch (error) {
        console.error(error)
      }
    }
  }

  if (cronHasChanged) {
    try {
      await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
    } catch (error) {
      console.error(error)
    }
  }
}

export function createScheduleSlice(ctx: SliceContext): ScheduleActions {
  return {
    onScheduledRestartCronChange: (value, username) => {
      if (!username) {
        return
      }
      const trimmedValue = value?.trim()
      editBridgeConfig(ctx, username, (bridge) => {
        if (trimmedValue) {
          bridge.scheduledRestartCron = trimmedValue
        } else {
          delete bridge.scheduledRestartCron
        }
      })
    },
  }
}
