import { api } from '@/core/api'
import { cachedAccessoriesCache } from '@/core/caching/cached-accessories-cache'
import { serverPairingsCache } from '@/core/caching/server-pairings-cache'
import { ttlCache } from '@/core/caching/ttl-cache'

const KEY = 'accessory-overview'

export interface AccessoryOverview<HapAccessory = any, MatterAccessory = any, Pairing = any> {
  hapAccessories: HapAccessory[]
  matterAccessories: MatterAccessory[]
  pairings: Pairing[]
}

/**
 * Wraps GET /server/accessory-overview — the aggregator that replaces
 * the 2-3 separate cached-accessories / matter-accessories / pairings
 * fetches the accessory-management modals used to issue per open.
 *
 * `invalidate()` also clears the per-piece caches so any non-aggregator
 * consumer (e.g. the accessories store) re-reads after a mutation here.
 */
export const accessoryOverviewCache = {
  get<H = any, M = any, P = any>(): Promise<AccessoryOverview<H, M, P>> {
    return ttlCache.get<AccessoryOverview<H, M, P>>(
      KEY,
      () => api.get<AccessoryOverview<H, M, P>>('/server/accessory-overview'),
    )
  },

  invalidate(): void {
    ttlCache.invalidate(KEY)
    cachedAccessoriesCache.invalidate()
    serverPairingsCache.invalidate()
  },
}
