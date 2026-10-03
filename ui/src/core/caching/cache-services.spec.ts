import type { FakeApi } from '@/testing/fakes/api.fake'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetAuthStore, useAuthStore } from '@/core/auth/auth.store'
import { accessoryOverviewCache } from '@/core/caching/accessory-overview-cache'
import { cachedAccessoriesCache } from '@/core/caching/cached-accessories-cache'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { serverPairingsCache } from '@/core/caching/server-pairings-cache'
import { ttlCache } from '@/core/caching/ttl-cache'
import { fakeApi } from '@/testing/fakes/api.fake'

vi.mock('@/core/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key), changeLanguage: vi.fn(async () => {}) },
}))

/**
 * The four wrappers around the shared TtlCache. These specs use the real cache so
 * they pin what actually matters: which url each one calls, and which keys an
 * invalidation clears.
 */
describe('cache services', () => {
  let api: FakeApi

  afterEach(() => {
    vi.restoreAllMocks()
    ttlCache.invalidateAll()
  })

  function configure(admin = true) {
    api = fakeApi()
      .respond('get', /^\/plugins/, [{ name: 'homebridge-hue' }])
      .respond('get', '/server/pairings', [{ _id: 'main' }])
      .respond('get', '/server/cached-accessories', [{ UUID: 'hap' }])
      .respond('get', '/server/matter-accessories', [{ uuid: 'matter' }])
      .respond('get', '/server/accessory-overview', { hapAccessories: [], matterAccessories: [], pairings: [] })

    ttlCache.invalidateAll()
    resetAuthStore()
    useAuthStore.setState({ token: 'test-access-token', user: { username: 'admin', admin } })
  }

  describe('pluginsCache', () => {
    it('asks for the config blocks when the user is an admin', async () => {
      configure(true)

      await pluginsCache.get()

      // Admins get the config in the same response so the plugins page can
      // skip a fetch per plugin
      expect(api.lastCall('get')?.url).toBe('/plugins?include=config')
    })

    it('leaves the config out for a non-admin', async () => {
      configure(false)

      await pluginsCache.get()

      // A non-admin cannot read config blocks and the request would fail
      expect(api.lastCall('get')?.url).toBe('/plugins')
    })

    it('serves the second read from the cache', async () => {
      configure()
      const service = pluginsCache

      await service.get()
      await service.get()

      expect(api.callsTo('get')).toHaveLength(1)
    })

    it('re-reads after being invalidated', async () => {
      configure()
      const service = pluginsCache

      await service.get()
      service.invalidate()
      await service.get()

      expect(api.callsTo('get')).toHaveLength(2)
    })
  })

  describe('cachedAccessoriesCache', () => {
    it('reads hap and matter accessories from their own endpoints', async () => {
      configure()
      const service = cachedAccessoriesCache

      await service.getHap()
      await service.getMatter()

      expect(api.callsTo('get', '/server/cached-accessories')).toHaveLength(1)
      expect(api.callsTo('get', '/server/matter-accessories')).toHaveLength(1)
    })

    it('caches the two protocols separately', async () => {
      configure()
      const service = cachedAccessoriesCache

      await service.getHap()
      await service.getMatter()
      service.invalidateHap()
      await service.getHap()
      await service.getMatter()

      expect(api.callsTo('get', '/server/cached-accessories')).toHaveLength(2)
      expect(api.callsTo('get', '/server/matter-accessories')).toHaveLength(1)
    })

    it('drops both protocols on a full invalidate', async () => {
      configure()
      const service = cachedAccessoriesCache

      await service.getHap()
      await service.getMatter()
      service.invalidate()
      await service.getHap()
      await service.getMatter()

      expect(api.callsTo('get', '/server/cached-accessories')).toHaveLength(2)
      expect(api.callsTo('get', '/server/matter-accessories')).toHaveLength(2)
    })
  })

  describe('serverPairingsCache', () => {
    it('reads the pairings once and caches them', async () => {
      configure()
      const service = serverPairingsCache

      await service.get()
      await service.get()

      expect(api.callsTo('get', '/server/pairings')).toHaveLength(1)
    })
  })

  describe('accessoryOverviewCache', () => {
    it('reads the aggregated overview', async () => {
      configure()

      await accessoryOverviewCache.get()

      expect(api.callsTo('get', '/server/accessory-overview')).toHaveLength(1)
    })

    it('also clears the accessory and pairing caches when invalidated', async () => {
      configure()
      const overview = accessoryOverviewCache
      const accessories = cachedAccessoriesCache
      const pairings = serverPairingsCache

      await overview.get()
      await accessories.getHap()
      await accessories.getMatter()
      await pairings.get()

      // A destructive action invalidates through the overview, so the
      // per-piece caches have to go too or a consumer reading them directly
      // keeps serving accessories that were just deleted
      overview.invalidate()
      await overview.get()
      await accessories.getHap()
      await accessories.getMatter()
      await pairings.get()

      expect(api.callsTo('get', '/server/accessory-overview')).toHaveLength(2)
      expect(api.callsTo('get', '/server/cached-accessories')).toHaveLength(2)
      expect(api.callsTo('get', '/server/matter-accessories')).toHaveLength(2)
      expect(api.callsTo('get', '/server/pairings')).toHaveLength(2)
    })
  })
})
