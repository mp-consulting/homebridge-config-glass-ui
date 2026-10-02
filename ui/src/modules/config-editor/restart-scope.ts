import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'

import type { AccessoryConfig, ChildBridgeToRestart, HomebridgeConfig, PlatformConfig, PluginChildBridge } from './config-editor.interfaces'

import { isEqual } from 'lodash-es'

/**
 * Deciding which restart a save needs: none, the child bridges of the plugins
 * that changed, or all of Homebridge.
 *
 * ⚠️ This is the difference between reloading one plugin and dropping every
 * accessory in the house off the network for a minute. Anything that could
 * affect Homebridge itself must restart the lot.
 */

export type RestartType = 'none' | 'child' | 'full'

/** What the page remembers between saves in one visit. */
export interface RestartState {
  /** The config as last saved. */
  latestSavedConfig: HomebridgeConfig
  /** A full restart was declined earlier and is still owed. */
  hbPendingRestart: boolean
  /** Child bridges queued for a restart (added to by `determineRestartType`). */
  childBridgesToRestart: ChildBridgeToRestart[]
}

function validateArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const sortedA = a.toSorted()
  const sortedB = b.toSorted()
  return sortedA.every((val, idx) => val === sortedB[idx])
}

function removePlatformsAndAccessories(config: HomebridgeConfig): Omit<HomebridgeConfig, 'platforms' | 'accessories'> {
  // eslint-disable-next-line unused-imports/no-unused-vars
  const { accessories, platforms, ...rest } = config
  return rest
}

function removeEmptyBridges(entries: (PlatformConfig | AccessoryConfig)[]): PluginChildBridge[] {
  return entries
    .filter((p: PlatformConfig | AccessoryConfig) => p._bridge && Object.keys(p._bridge).length > 0)
    .map((p: PlatformConfig | AccessoryConfig) => p._bridge!)
}

function validateBridgesEqual(a: PluginChildBridge[], b: PluginChildBridge[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every(itemA => b.some(itemB => isEqual(itemA, itemB)))
}

/**
 * Whether the UI's own `config` platform entry changed, which needs the whole
 * service restarted rather than just Homebridge: the UI runs inside that
 * service, and restarting Homebridge alone leaves it on its old port, settings
 * and certificate.
 * @param latestSavedConfig - the config as last saved
 * @param updatedConfigString - the config being saved, as text
 */
export function detectConfigPlatformChanges(latestSavedConfig: HomebridgeConfig, updatedConfigString: string): boolean {
  try {
    const originalConfigJson = latestSavedConfig
    const updatedConfigJson = JSON.parse(updatedConfigString) as HomebridgeConfig

    // Find config platforms in original config
    const originalConfigPlatform = (originalConfigJson.platforms || [])
      .find(platform => platform.platform === 'config')

    // Find config platforms in updated config
    const updatedConfigPlatform = (updatedConfigJson.platforms || [])
      .find(platform => platform.platform === 'config')

    // If one exists and the other doesn't, that's a change
    if (!originalConfigPlatform && updatedConfigPlatform) {
      return true
    }
    if (originalConfigPlatform && !updatedConfigPlatform) {
      return true
    }
    if (!originalConfigPlatform && !updatedConfigPlatform) {
      return false
    }

    // Both exist - compare all keys (deep equality check)
    return !isEqual(originalConfigPlatform, updatedConfigPlatform)
  } catch (error) {
    console.error('Error detecting config platform changes:', error)
    return false // Default to no service restart if we can't determine
  }
}

export interface DetermineRestartOptions {
  /** The bridges the save response reported, if it did. */
  affectedBridges?: ChildBridge[]
  /** Reads the running child bridges when the save did not report them. */
  getChildBridges: () => Promise<ChildBridge[]>
  /** Called for the "nothing to restart" case, which the user is told about. */
  onNothingChanged: () => void
}

/**
 * Work out the restart a save needs. Queues the child bridges to restart on
 * `state.childBridgesToRestart` when the answer is `child`.
 * @param state - what the page remembers (mutated: see above)
 * @param updatedConfigString - the config just saved, formatted with 4 spaces
 * @param options - see DetermineRestartOptions
 */
export async function determineRestartType(state: RestartState, updatedConfigString: string, options: DetermineRestartOptions): Promise<RestartType> {
  // If homebridge is pending a restart, we don't even need to start with these checks
  if (state.hbPendingRestart) {
    return 'full'
  }

  // We can try to find things that have changed, to offer the best restart option
  const originalConfigJson = state.latestSavedConfig
  const originalConfigString = JSON.stringify(originalConfigJson, null, 4)
  const updatedConfigJson = JSON.parse(updatedConfigString) as HomebridgeConfig

  // Check one: has anything actually changed?
  if (originalConfigString === updatedConfigString && !state.childBridgesToRestart.length) {
    options.onNothingChanged()
    return 'none'
  }

  // Check two: has a new key been added or removed at the top level?
  if (!validateArraysEqual(Object.keys(originalConfigJson), Object.keys(updatedConfigJson))) {
    return 'full'
  }

  // Check three: if the user has no child bridges, then there is no point in checking the rest
  const platformsAndAccessories = [
    ...(updatedConfigJson.platforms || []),
    ...(updatedConfigJson.accessories || []),
  ]
  if (platformsAndAccessories.every((entry: PlatformConfig | AccessoryConfig) => !entry._bridge || !Object.keys(entry._bridge).length)) {
    return 'full'
  }

  // Check four: have any of the top level properties changed (except plugins and accessories)?
  if (!isEqual(removePlatformsAndAccessories(originalConfigJson), removePlatformsAndAccessories(updatedConfigJson))) {
    return 'full'
  }

  // Check five: compare the platforms and accessories on their 'platform' / 'accessory'
  // key. One added, removed or renamed needs a full restart
  const originalPlatforms = originalConfigJson.platforms || []
  const updatedPlatforms = updatedConfigJson.platforms || []
  if (!validateArraysEqual(originalPlatforms.map(p => p.platform), updatedPlatforms.map(p => p.platform))) {
    return 'full'
  }
  const originalAccessories = originalConfigJson.accessories || []
  const updatedAccessories = updatedConfigJson.accessories || []
  if (!validateArraysEqual(originalAccessories.map(a => a.accessory), updatedAccessories.map(a => a.accessory))) {
    return 'full'
  }

  // Check six: a '_bridge' key added, changed or removed on any entry needs a full restart
  if (!validateBridgesEqual(removeEmptyBridges(originalPlatforms), removeEmptyBridges(updatedPlatforms))) {
    return 'full'
  }
  if (!validateBridgesEqual(removeEmptyBridges(originalAccessories), removeEmptyBridges(updatedAccessories))) {
    return 'full'
  }

  // For the rest of the checks, we need to find out which entries have changed
  const changedPlatformEntries = originalPlatforms.filter((p: PlatformConfig) => {
    return !isEqual(p, updatedPlatforms.find((up: PlatformConfig) => up.platform === p.platform))
  })
  const changedAccessoryEntries = originalAccessories.filter((a: AccessoryConfig) => {
    return !isEqual(a, updatedAccessories.find((ua: AccessoryConfig) => ua.accessory === a.accessory))
  })
  const changedEntries = [...changedPlatformEntries, ...changedAccessoryEntries]

  // Check seven: we need a full restart if the homebridge ui config entry has changed
  if (changedPlatformEntries.some((entry: PlatformConfig) => entry.platform === 'config')) {
    return 'full'
  }

  // Check eight: apart from the ui config entry, if any of the changed entries do not have a '_bridge' key
  //   (or it is null or an empty object), we must do a full restart
  const hasChangedEntriesWithoutBridge = changedEntries.some((entry: PlatformConfig | AccessoryConfig) => {
    if (entry.platform === 'config') {
      return false
    }
    return !entry._bridge || Object.keys(entry._bridge).length === 0
  })
  if (hasChangedEntriesWithoutBridge) {
    return 'full'
  }

  // At this point every changed entry has a _bridge key: find the child bridges to restart
  try {
    // The bridges come from the save response when available; the fallback
    // (cached) read keeps callers that run the diff outside of a save working
    const data = options.affectedBridges ?? await options.getChildBridges()

    for (const entry of changedEntries) {
      // Grab the username from the _bridge key, uppercase it, and find the matching child bridge
      const configUsername = entry._bridge?.username?.toUpperCase()
      if (!configUsername) {
        return 'full'
      }
      const childBridge = data.find(({ username }) => username === configUsername)
      if (childBridge) {
        if (!state.childBridgesToRestart.some((b: ChildBridgeToRestart) => b.username === childBridge.username)) {
          state.childBridgesToRestart.push({
            name: childBridge.name,
            username: childBridge.username,
            matterSerialNumber: childBridge.matterSerialNumber!,
          })
        }
      } else {
        return 'full' // child bridge not found, need full restart
      }
    }

    return 'child' // child bridge restart is sufficient
  } catch (error) {
    console.error('Error fetching child bridges:', error)
    return 'full' // api error, fallback to full restart
  }
}
