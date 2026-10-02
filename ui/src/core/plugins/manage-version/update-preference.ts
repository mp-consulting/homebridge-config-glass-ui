import type { HomebridgeUpdatePolicy } from '@/core/interfaces/settings.interfaces'
import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'

import { useSettingsStore } from '@/core/settings'

/** The update policy the settings hold for a package now. */
export function getCurrentUpdatePreference(plugin: Plugin | null | undefined): HomebridgeUpdatePolicy {
  if (!plugin) {
    return 'all'
  }
  const { env } = useSettingsStore.getState()

  // For Homebridge and UI, use new policy
  if (plugin.name === 'homebridge') {
    return env.homebridgeUpdatePolicy || 'all'
  }

  if (plugin.name === '@mp-consulting/homebridge-config-glass-ui') {
    return env.homebridgeUiUpdatePolicy || 'all'
  }

  // For regular plugins, use the existing 3-option system
  if (env.plugins?.hideUpdatesFor?.includes(plugin.name)) {
    return 'none'
  }

  if (env.plugins?.showBetasFor?.includes(plugin.name)) {
    return 'beta'
  }

  return 'all'
}
