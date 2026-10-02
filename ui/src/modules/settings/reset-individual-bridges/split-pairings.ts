import type { Pairing } from '@/modules/settings/settings.interfaces'

export interface SplitPairings {
  pairingsChildActive: any[]
  pairingsNonChild: any[]
  pairingsChildStale: any[]
}

/**
 * Sort the pairings into the three lists the modal shows: running child
 * bridges, child bridges that look stale (the plugin is gone but the pairing is
 * still there), and everything that is not a child bridge. The main bridge is
 * never offered.
 * @param rawPairings - what the accessory overview reports
 */
export function splitPairings(rawPairings: any[]): SplitPairings {
  const pairings = rawPairings
    .filter((pairing: any) => !pairing._main)
    .sort((a: Pairing, b: Pairing) => a.name.localeCompare(b.name))

  return {
    pairingsChildActive: pairings.filter((pairing: any) => pairing._category === 'bridge' && !pairing._couldBeStale),
    pairingsNonChild: pairings.filter((pairing: any) => pairing._category !== 'bridge'),
    pairingsChildStale: pairings.filter((pairing: any) => pairing._category === 'bridge' && pairing._couldBeStale),
  }
}
