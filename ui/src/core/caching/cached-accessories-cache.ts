import { api } from '@/core/api'
import { ttlCache } from '@/core/caching/ttl-cache'

const HAP_KEY = 'cached-hap-accessories'
const MATTER_KEY = 'cached-matter-accessories'

export const cachedAccessoriesCache = {
  getHap<T = any>(): Promise<T> {
    return ttlCache.get<T>(HAP_KEY, () => api.get<T>('/server/cached-accessories'))
  },

  getMatter<T = any>(): Promise<T> {
    return ttlCache.get<T>(MATTER_KEY, () => api.get<T>('/server/matter-accessories'))
  },

  invalidate(): void {
    ttlCache.invalidate(HAP_KEY)
    ttlCache.invalidate(MATTER_KEY)
  },

  invalidateHap(): void {
    ttlCache.invalidate(HAP_KEY)
  },

  invalidateMatter(): void {
    ttlCache.invalidate(MATTER_KEY)
  },
}
