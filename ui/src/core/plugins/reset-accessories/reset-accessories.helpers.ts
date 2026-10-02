import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ResetAccessoriesPairing } from '@/core/plugins/reset-accessories/reset-accessories.interfaces'

/**
 * Build the list of resettable pairings of a plugin: its child bridges (one
 * row per protocol), then its Matter-only external accessories.
 */
export function buildResetPairings(allPairings: any[], childBridges: ChildBridge[], isMatterSupported: boolean): ResetAccessoriesPairing[] {
  // Get the plugin name from the first child bridge (all child bridges should have the same plugin)
  const pluginName = childBridges.length > 0 ? childBridges[0].plugin : null

  // Filter HAP child bridges that belong to this plugin
  const rawPairings = allPairings
    .filter((pairing: any) => {
      return pairing._category === 'bridge'
        && !pairing._main
        && childBridges.find(childBridge => childBridge.username === pairing._username)
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // Filter Matter-only external accessories that belong to this plugin
  const matterOnlyPairings = allPairings
    .filter((pairing: any) => {
      return pairing._matterOnly && pairing._plugin === pluginName
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // Expand bridges with both HAP and Matter into separate entries
  const newPairings: ResetAccessoriesPairing[] = []
  for (const pairing of rawPairings) {
    // Always add HAP entry
    newPairings.push({ ...pairing, _protocol: 'hap', _displayName: pairing.name })

    // Add Matter entry if Matter is enabled on this bridge AND the feature is supported
    if (isMatterSupported && pairing._matter) {
      newPairings.push({ ...pairing, _protocol: 'matter', _displayName: pairing.name })
    }
  }

  // Add Matter-only external accessories
  if (isMatterSupported) {
    for (const pairing of matterOnlyPairings) {
      newPairings.push({ ...pairing, _protocol: 'matter', _displayName: pairing.name })
    }
  }

  return newPairings
}
