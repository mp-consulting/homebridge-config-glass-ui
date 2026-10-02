import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'

import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth/auth.store'
import { ttlCache } from '@/core/caching/ttl-cache'

const KEY = 'plugins-list'

export const pluginsCache = {
  // Admin sessions opt into `?include=config` so the plugins page can
  // skip the per-plugin /config-editor/plugin/:name fan-out. Non-admin
  // sessions can't read config blocks and would 403 on the param.
  get(): Promise<Plugin[]> {
    const path = useAuthStore.getState().user.admin ? '/plugins?include=config' : '/plugins'
    return ttlCache.get<Plugin[]>(KEY, () => api.get<Plugin[]>(path))
  },

  invalidate(): void {
    ttlCache.invalidate(KEY)
  },
}
