import { api } from '@/core/api'
import { ttlCache } from '@/core/caching/ttl-cache'

const KEY = 'server-pairings'

export const serverPairingsCache = {
  get<T = any>(): Promise<T> {
    return ttlCache.get<T>(KEY, () => api.get<T>('/server/pairings'))
  },

  invalidate(): void {
    ttlCache.invalidate(KEY)
  },
}
