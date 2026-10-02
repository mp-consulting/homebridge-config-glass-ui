import type { CachedAccessory, Pairing } from '@/modules/settings/settings.interfaces'

import { RE_CHAR_PAIRS } from '@/core/regex.constants'
import { i18n } from '@/core/ui/i18n'

export type Protocol = 'hap' | 'matter'

export interface DeleteEntry {
  cacheFile?: string
  uuid: string
  protocol: Protocol
  deviceId?: string
}

/**
 * Group the cached accessories under the bridge they belong to: HAP ones by
 * the bridge in their cache file name (none means the main bridge), Matter ones
 * by their device. A cache file whose pairing is gone gets an "unknown" entry,
 * since clearing those up is what this modal is for. Bridges with nothing
 * cached are left out; the main bridge comes first, the rest by name.
 * @param overview - the accessory overview
 * @param overview.hapAccessories - the cached HAP accessories
 * @param overview.matterAccessories - the cached Matter accessories
 * @param overview.pairings - the pairings
 * @param selectedBridge - only this bridge, when the caller chose one
 * @param isMatterSupported - whether matter support is on
 */
export function groupAccessories(
  overview: { hapAccessories: CachedAccessory[], matterAccessories: CachedAccessory[], pairings: Pairing[] },
  selectedBridge: string,
  isMatterSupported: boolean,
): Pairing[] {
  const { hapAccessories: cachedAccessories, matterAccessories: rawMatterAccessories, pairings } = overview
  const matterAccessories = isMatterSupported ? rawMatterAccessories : []

  const pairingMap = new Map<string, Pairing>(pairings.map((pairing: Pairing) => [pairing._id, { ...pairing, accessories: [] as CachedAccessory[] }]))
  const unknownBridge = (bridge: string): Pairing => ({
    _id: bridge,
    _username: bridge.match(RE_CHAR_PAIRS)!.join(':'),
    name: i18n.t('reset.accessory_ind.unknown'),
    accessories: [],
  })

  // Process HAP accessories
  ;[...cachedAccessories]
    .sort((a: CachedAccessory, b: CachedAccessory) => a.displayName.localeCompare(b.displayName))
    .forEach((cached: CachedAccessory) => {
      const mainPairing = pairings.find((pairing: Pairing) => pairing._main)
      const bridge = cached.$cacheFile?.split('.')?.[1] || mainPairing!._id
      if (!selectedBridge || selectedBridge === bridge) {
        if (!pairingMap.has(bridge)) {
          pairingMap.set(bridge, unknownBridge(bridge))
        }
        pairingMap.get(bridge)!.accessories.push({ ...cached, $protocol: 'hap' })
      }
    })

  // Process Matter accessories (only if feature is enabled)
  if (isMatterSupported) {
    ;[...matterAccessories]
      .sort((a: CachedAccessory, b: CachedAccessory) => a.displayName.localeCompare(b.displayName))
      .forEach((cached: CachedAccessory) => {
        const bridge = cached.$deviceId!
        if (!selectedBridge || selectedBridge === bridge) {
          if (!pairingMap.has(bridge)) {
            pairingMap.set(bridge, unknownBridge(bridge))
          }
          // $cacheFile set for compatibility with the template
          pairingMap.get(bridge)!.accessories.push({ ...cached, $protocol: 'matter', $cacheFile: bridge })
        }
      })
  }

  return [...pairingMap.values()]
    .filter((pairing: Pairing) => pairing.accessories.length > 0)
    .sort((a, b) => {
      if (a._main && !b._main) {
        return -1
      }
      if (!a._main && b._main) {
        return 1
      }
      return a.name.localeCompare(b.name)
    })
}

/** Split what was ticked into the HAP and the Matter deletions, which go to different endpoints. */
export function splitDeletions(toDelete: DeleteEntry[]) {
  return {
    hapAccessories: toDelete
      .filter(item => item.protocol === 'hap')
      .map(item => ({ uuid: item.uuid, cacheFile: item.cacheFile })),
    matterAccessories: toDelete
      .filter(item => item.protocol === 'matter')
      .map(item => ({ uuid: item.uuid, deviceId: item.deviceId })),
  }
}
