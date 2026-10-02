import type { Pairing } from '@/modules/settings/settings.interfaces'

export type Protocol = 'hap' | 'matter'

export interface BridgeEntry {
  _id: string
  _username: string
  name: string
  _protocol: Protocol
  _displayName: string
  [key: string]: unknown
}

/**
 * The child bridges, one entry per protocol: a bridge with both HAP and Matter
 * appears twice, so each protocol's accessories can be cleared on their own.
 * @param pairings - the pairings the accessory overview reports
 * @param isMatterSupported - whether matter support is on
 */
export function bridgeEntries(pairings: any[], isMatterSupported: boolean): BridgeEntry[] {
  const rawPairings = pairings
    .filter((pairing: any) => pairing._category === 'bridge' && !pairing._main)
    .sort((a: Pairing, b: Pairing) => a.name.localeCompare(b.name))

  // Expand bridges with both HAP and Matter into separate entries
  const pairingsList: BridgeEntry[] = []
  for (const pairing of rawPairings) {
    // Always add HAP entry
    pairingsList.push({
      ...pairing,
      _protocol: 'hap',
      _displayName: pairing.name,
    })

    // Add Matter entry if Matter is enabled on this bridge AND the feature is supported
    if (isMatterSupported && pairing._matter) {
      pairingsList.push({
        ...pairing,
        _protocol: 'matter',
        _displayName: pairing.name,
      })
    }
  }
  return pairingsList
}
