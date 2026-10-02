import type { FakeApi } from '@/core/api/api.fake'
import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi } from '@/core/api/api.fake'
import { ttlCache } from '@/core/caching/ttl-cache'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'

vi.mock('@/core/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key) },
}))

vi.mock('@/core/ui/modal', () => ({
  openModal: vi.fn(() => ({ result: new Promise(() => {}), hidden: new Promise(() => {}), close: vi.fn(), dismiss: vi.fn(), update: vi.fn() })),
}))

function RestartChildBridgesComponent() {
  return null
}

function RestartHomebridgeComponent() {
  return null
}

/** Deciding what to restart when something has changed. */
describe('deciding what to restart', () => {
  let api: FakeApi

  /** The last modal opened: component, props, options. */
  function lastOpened() {
    const call = vi.mocked(openModal).mock.calls.at(-1)
    return call ? { content: call[0], props: call[1] as any, options: call[2] } : undefined
  }

  function bridge(overrides: Partial<ChildBridge> = {}): ChildBridge {
    return {
      name: 'Example Bridge',
      username: '0E:11:22:33:44:55',
      plugin: 'homebridge-example',
      ...overrides,
    } as ChildBridge
  }

  beforeEach(() => {
    api = fakeApi()
    ttlCache.invalidateAll()
    vi.mocked(openModal).mockClear()
    vi.mocked(toast.error).mockClear()
    childBridges.registerRestartModals({ childBridges: RestartChildBridgesComponent, homebridge: RestartHomebridgeComponent })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('which restart to offer', () => {
    it('restarts only the affected child bridges when there are some', () => {
      // ⚠️ The whole point: restarting all of Homebridge for a change that only
      // touched one bridge drops every other accessory off the network for a
      // minute or two
      childBridges.openCorrectRestartModalWithBridges([bridge()])

      expect(lastOpened()!.content).toBe(RestartChildBridgesComponent)
      expect(lastOpened()!.props.bridges).toEqual([
        { name: 'Example Bridge', username: '0E:11:22:33:44:55', matterSerialNumber: undefined },
      ])
    })

    it('carries the matter serial number through, so a matter bridge can be found', () => {
      childBridges.openCorrectRestartModalWithBridges([bridge({ matterSerialNumber: 'MTR-123' })])

      expect(lastOpened()!.props.bridges[0].matterSerialNumber).toBe('MTR-123')
    })

    it('restarts the whole of homebridge when no bridge is named', () => {
      childBridges.openCorrectRestartModalWithBridges([])

      expect(lastOpened()!.content).toBe(RestartHomebridgeComponent)
    })

    it('restarts the whole of homebridge when the caller knows nothing', () => {
      // ⚠️ Called with nothing at all when the endpoint that reports the affected
      // bridges failed. Falling through to the full restart is deliberate
      childBridges.openCorrectRestartModalWithBridges()

      expect(lastOpened()!.content).toBe(RestartHomebridgeComponent)
    })

    it('cannot be clicked away from either prompt', () => {
      // Homebridge is mid-restart
      childBridges.openCorrectRestartModalWithBridges([])

      expect(lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static', keyboard: false })
    })
  })

  describe('looking up the bridges of one plugin', () => {
    it('offers a child bridge restart for a plugin that has one', async () => {
      api.respond('get', '/status/homebridge/child-bridges', [bridge()])

      await childBridges.openCorrectRestartModalForPlugin('homebridge-example')

      expect(lastOpened()!.content).toBe(RestartChildBridgesComponent)
    })

    it('ignores the bridges of other plugins', async () => {
      api.respond('get', '/status/homebridge/child-bridges', [bridge({ plugin: 'homebridge-other' })])

      await childBridges.openCorrectRestartModalForPlugin('homebridge-example')

      expect(lastOpened()!.content).toBe(RestartHomebridgeComponent)
    })

    it('falls back to a full restart when the list cannot be read', async () => {
      // A restart prompt the user can act on beats no prompt at all
      api.fail('get', '/status/homebridge/child-bridges', new Error('server unavailable'))

      await childBridges.openCorrectRestartModalForPlugin('homebridge-example')

      expect(lastOpened()!.content).toBe(RestartHomebridgeComponent)
      expect(toast.error).toHaveBeenCalledWith('toast.api_error_generic', 'toast.title_error')
      expect(console.error).toHaveBeenCalled()
    })

    it('reads the list through the cache', async () => {
      api.respond('get', '/status/homebridge/child-bridges', [bridge()])

      await childBridges.getAll()
      await childBridges.getAll()

      expect(api.callsTo('get', '/status/homebridge/child-bridges')).toHaveLength(1)
    })

    it('can be told to forget what it cached', async () => {
      const invalidate = vi.spyOn(ttlCache, 'invalidate')

      childBridges.invalidate()

      expect(invalidate).toHaveBeenCalledWith('status-child-bridges')
    })
  })
})
