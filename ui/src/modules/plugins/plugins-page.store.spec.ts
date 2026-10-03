import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { PluginsPageHost, PluginsPageStoreApi } from '@/modules/plugins/plugins-page.store'
import type { FakeApi, FakeIoNamespace, FakeOpenModal } from '@/testing'
import type { Mock } from 'vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth/auth.store'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { serverPairingsCache } from '@/core/caching/server-pairings-cache'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { managePlugins as realManagePlugins } from '@/core/plugins/manage-plugins'
import { useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { PluginSupport } from '@/modules/plugins/plugin-support/PluginSupport'
import {
  availableUpdateCount,
  createPluginsPageStore,
  groupChildBridgesByPlugin,
  sortPlugins,
} from '@/modules/plugins/plugins-page.store'
import { fakeApi, fakeIoNamespace, makeAuthState, makePlugin, makeSettingsState, toastStub } from '@/testing'

const toast = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

/** Stands in for the Update All modal component, which the opener would open */
const UpdateAllModal = vi.hoisted(() => 'UpdateAllModal')

vi.mock('@/core/plugins/manage-plugins', async () => {
  const modal = await import('@/core/ui/modal')
  const listeners = new Set<() => void>()
  return {
    managePlugins: {
      onPluginListRefresh: {
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        next: () => [...listeners].forEach(listener => listener()),
      },
      settings: vi.fn(),
      // routes through the fake modal so the specs can reach the ref
      openUpdateAllModal: vi.fn(() => modal.openModal(UpdateAllModal as any, {}, {})),
    },
  }
})

const managePlugins = realManagePlugins as unknown as {
  onPluginListRefresh: { next: () => void }
  settings: Mock
  openUpdateAllModal: Mock
}
const modal = modalModule as unknown as FakeOpenModal

/**
 * The plugins page.
 *
 * `sortPlugins` is covered on its own first — then everything around it, and
 * three parts of it are easy to break quietly:
 *
 * ⚠️ **the metadata is filled in before the grid is published.** Every card reads
 * `isConfigured`, `hasChildBridges` and friends, which are derived here rather than
 * sent by the server. Publishing the list first makes every card flash its "needs
 * setup" icon on each page load.
 *
 * ⚠️ **concurrent loads are deduped.** On a fresh mount the websocket-connected
 * subscriber and the router's navigation both trigger a load; without sharing
 * the in-flight promise the page does the work twice.
 *
 * ⚠️ **search results hide one of each scoped/unscoped pair.** A plugin that has
 * moved to `@homebridge-plugins/…` appears twice in a search, and which one to show
 * depends on which the user has installed. Showing both offers an install that
 * would clash with what is already there.
 */

describe('sortPlugins', () => {
  /**
   * A plugin whose name says what makes it interesting, so a failed assertion
   * reads as an order of concepts rather than an order of strings.
   * @param name - the plugin name
   * @param traits - the sort-relevant flags
   */
  function plugin(name: string, traits: Partial<Plugin> = {}): Plugin {
    return makePlugin({ name, isConfigured: false, ...traits })
  }

  const sort = (plugins: Plugin[], env: Record<string, any> = {}) => sortPlugins(plugins, env)

  it('puts an available update above everything else', () => {
    const sorted = sort([
      plugin('plain'),
      plugin('scoped', { newHbScope: { from: 'a', switch: 'b', to: 'c' } }),
      plugin('updatable', { updateAvailable: true }),
    ])

    expect(sorted.map(x => x.name)).toEqual(['updatable', 'scoped', 'plain'])
  })

  it('sinks disabled and configured plugins', () => {
    const sorted = sort([
      plugin('configured', { isConfigured: true }),
      plugin('disabled', { disabled: true }),
      plugin('plain'),
    ])

    expect(sorted.map(x => x.name)).toEqual(['plain', 'disabled', 'configured'])
  })

  it('lifts a plugin whose child bridges are unpaired', () => {
    const sorted = sort([
      plugin('paired'),
      plugin('unpaired', { hasChildBridgesUnpaired: true }),
    ])

    expect(sorted.map(x => x.name)).toEqual(['unpaired', 'paired'])
  })

  it('falls back to the name when two plugins score the same', () => {
    const sorted = sort([plugin('zebra'), plugin('apple'), plugin('mango')])

    expect(sorted.map(x => x.name)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('leaves the original array alone', () => {
    const plugins = [plugin('zebra'), plugin('apple')]

    sort(plugins)

    expect(plugins.map(x => x.name)).toEqual(['zebra', 'apple'])
  })

  it('reads the settings store when no env is given', () => {
    useSettingsStore.setState(makeSettingsState({ env: { recommendChildBridges: true } }))

    const sorted = sortPlugins([plugin('a-on-bridge', { hasChildBridges: true }), plugin('b-needs-bridge')])

    expect(sorted.map(x => x.name)).toEqual(['b-needs-bridge', 'a-on-bridge'])
  })

  describe('the child bridge nudge', () => {
    it('sinks a plugin that already runs on a child bridge', () => {
      const sorted = sort(
        [plugin('a-on-bridge', { hasChildBridges: true }), plugin('b-needs-bridge')],
        { recommendChildBridges: true },
      )

      expect(sorted.map(x => x.name)).toEqual(['b-needs-bridge', 'a-on-bridge'])
    })

    it('sinks a plugin the user opted out of the nudge', () => {
      const sorted = sort(
        [plugin('a-opted-out'), plugin('b-needs-bridge')],
        { recommendChildBridges: true, plugins: { hideChildBridgeSetupFor: ['a-opted-out'] } },
      )

      expect(sorted.map(x => x.name)).toEqual(['b-needs-bridge', 'a-opted-out'])
    })

    it('stops nudging entirely when recommendations are switched off', () => {
      const sorted = sort(
        [plugin('a-on-bridge', { hasChildBridges: true }), plugin('b-needs-bridge')],
        { recommendChildBridges: false },
      )

      expect(sorted.map(x => x.name)).toEqual(['a-on-bridge', 'b-needs-bridge'])
    })
  })

  describe('the scoring quirks', () => {
    it('lets an update outweigh every negative combined', () => {
      const sorted = sort([
        plugin('clean'),
        plugin('awful-but-updatable', {
          updateAvailable: true,
          disabled: true,
          isConfigured: true,
          hasChildBridges: true,
        }),
      ], { recommendChildBridges: true })

      expect(sorted[0].name).toBe('awful-but-updatable')
    })

    it('ranks a configured plugin below a disabled one', () => {
      // -20 for configured against -10 for disabled. A working, set-up plugin
      // sinking below a switched-off one reads oddly, but it is deliberate:
      // the list is ordered by what still needs attention
      const sorted = sort([plugin('a-configured', { isConfigured: true }), plugin('b-disabled', { disabled: true })])

      expect(sorted.map(x => x.name)).toEqual(['b-disabled', 'a-configured'])
    })
  })
})

describe('the plugins page', () => {
  let api: FakeApi
  let io: FakeIoNamespace
  let host: PluginsPageHost & { clearQueryParams: Mock, focusSearchInput: Mock }
  let installed: Plugin[]
  let pairings: any[]
  let pluginsGet: Mock
  let pairingsGet: Mock
  let store: PluginsPageStoreApi
  let stop: () => void

  /**
   * A plugin as the server reports it.
   * @param name - the plugin name
   * @param overrides - fields to change
   */
  function plugin(name: string, overrides: Partial<Plugin> = {}): Plugin {
    return {
      name,
      displayName: name,
      installedVersion: '1.0.0',
      latestVersion: '1.0.0',
      config: [],
      ...overrides,
    } as Plugin
  }

  /**
   * Build the page: what ngOnInit did, against a fresh store.
   * @param options - how to set it up
   * @param options.installed - what the plugins cache holds
   * @param options.env - settings env overrides
   * @param options.admin - whether the signed-in user is an admin
   * @param options.pairings - what the pairings cache holds
   * @param options.url - the current url, for the query-parameter actions
   * @param options.connected - whether the child-bridges socket starts connected
   */
  function create(options: {
    installed?: Plugin[]
    env?: Record<string, any>
    admin?: boolean
    pairings?: any[]
    url?: string
    connected?: boolean
  } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: { recommendChildBridges: true, ...options.env } as any }))
    useAuthStore.setState(makeAuthState({ user: { username: 'admin', admin: options.admin ?? true } }) as any)
    installed = options.installed ?? []
    pairings = options.pairings ?? []

    io = fakeIoNamespace({ connected: options.connected ?? true })
    io.socket.respondTo('get-homebridge-child-bridge-status', [])

    const search = new URL(options.url ?? '/plugins', 'http://localhost').searchParams
    host = {
      getQueryParams: () => ({ action: search.get('action'), plugin: search.get('plugin') }),
      clearQueryParams: vi.fn(),
      focusSearchInput: vi.fn(),
    }

    store = createPluginsPageStore()
    stop = store.getState().start(io as any, host)
    return store
  }

  const page = () => store.getState()

  /** Let the page's loads settle. */
  async function settle() {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve()
    }
  }

  beforeEach(() => {
    api = fakeApi()
    toast.current = toastStub()
    modal.opened.length = 0
    modal.openModal.mockClear()
    managePlugins.settings.mockClear()
    managePlugins.openUpdateAllModal.mockClear()
    pluginsGet = vi.spyOn(pluginsCache, 'get').mockImplementation(async () => installed) as unknown as Mock
    vi.spyOn(pluginsCache, 'invalidate').mockImplementation(() => {})
    pairingsGet = vi.spyOn(serverPairingsCache, 'get').mockImplementation(async () => pairings as any) as unknown as Mock
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.className = ''
  })

  afterEach(() => {
    stop?.()
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.className = ''
  })

  describe('loading the installed plugins', () => {
    it('shows what is installed', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()

      expect(page().installedPlugins.map(p => p.name)).toEqual(['homebridge-example'])
      expect(page().loading).toBe(false)
    })

    it('never lists itself', async () => {
      // The UI cannot be managed from its own plugin card
      create({ installed: [plugin('@mp-consulting/homebridge-config-glass-ui'), plugin('homebridge-example')] })
      await settle()

      expect(page().installedPlugins.map(p => p.name)).toEqual(['homebridge-example'])
    })

    it('does the work once when both triggers fire on a fresh mount', async () => {
      // ⚠️ The websocket-connected subscriber and the router both ask for a load
      create({ installed: [plugin('homebridge-example')] })
      // Let the mount's own load finish first, or these two just join that one
      // and the test passes without proving anything
      await settle()
      pluginsGet.mockClear()

      void page().loadInstalledPlugins()
      void page().loadInstalledPlugins()
      await settle()

      expect(pluginsGet).toHaveBeenCalledTimes(1)
    })

    it('loads again once the first load has finished', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()
      pluginsGet.mockClear()

      await page().loadInstalledPlugins()
      await page().loadInstalledPlugins()

      expect(pluginsGet).toHaveBeenCalledTimes(2)
    })

    it('reloads when the plugin service says the list changed', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()
      pluginsGet.mockClear()

      managePlugins.onPluginListRefresh.next()
      await settle()

      expect(pluginsGet).toHaveBeenCalled()
    })

    it('stops listening for list changes once the page is left', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()
      pluginsGet.mockClear()

      stop()
      managePlugins.onPluginListRefresh.next()
      await settle()

      expect(pluginsGet).not.toHaveBeenCalled()
    })

    it('says so when the list cannot be loaded', async () => {
      // The page is otherwise an empty grid that looks like "no plugins"
      create()
      await settle()
      pluginsGet.mockRejectedValue(new Error('server unavailable'))

      await page().loadInstalledPlugins()

      expect(page().mainError).toBe(true)
      expect(page().loading).toBe(false)
      expect(toast.current.error).toHaveBeenCalled()
    })

    it('clears the error on a load that works', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()
      store.setState({ mainError: true })

      await page().loadInstalledPlugins()

      expect(page().mainError).toBe(false)
    })

    it('leaves search mode when the installed list is loaded', async () => {
      // The router and websocket subscribers do not clear the flag themselves
      create({ installed: [plugin('homebridge-example')] })
      await settle()
      store.setState({ isSearchMode: true })

      await page().loadInstalledPlugins()

      expect(page().isSearchMode).toBe(false)
      expect(page().showExitButton).toBe(false)
    })
  })

  describe('the metadata each card reads', () => {
    /**
     * Load one plugin and hand back what the page derived about it.
     * @param overrides - the plugin as the server reports it
     * @param options - page setup
     * @param options.env - settings env overrides
     * @param options.admin - whether the user is an admin
     * @param options.pairings - the pairings cache contents
     * @param options.bridges - the child bridges the socket reports
     */
    async function metaFor(
      overrides: Partial<Plugin>,
      options: { env?: Record<string, any>, admin?: boolean, pairings?: any[], bridges?: any[] } = {},
    ): Promise<Plugin> {
      create({ installed: [plugin('homebridge-example', overrides)], ...options })
      if (options.bridges) {
        await settle()
        store.setState({ childBridges: options.bridges })
        await page().loadInstalledPlugins()
      }
      await settle()
      return page().installedPlugins[0]
    }

    /**
     * Every non-empty list the page published, as the `isConfigured` of each
     * plugin in it stood at that moment.
     *
     * ⚠️ This is the only way to catch the ordering: by the time a test can read
     * the state, the metadata is there either way. The mistake it guards against
     * is publishing the list *first* and filling the metadata in afterwards,
     * which flashes the "needs setup" icon on every card on every page load.
     */
    function publishedStates(): boolean[][] {
      const snapshots: boolean[][] = []
      store.subscribe((state, previous) => {
        if (state.installedPlugins !== previous.installedPlugins && state.installedPlugins.length) {
          snapshots.push(state.installedPlugins.map(p => p.isConfigured))
        }
      })
      return snapshots
    }

    it('fills in the metadata before it publishes the grid', async () => {
      create({ installed: [plugin('homebridge-example', { config: [{ platform: 'Example' }] })] })
      await settle()
      // ⚠️ A fresh object for the second load. The metadata is derived onto the
      // plugin objects themselves, so re-using the ones the mount already
      // annotated makes this pass whatever the ordering is
      installed = [plugin('homebridge-example', { config: [{ platform: 'Example' }] })]
      const published = publishedStates()

      await page().loadInstalledPlugins()

      expect(published.length).toBeGreaterThan(0)
      for (const states of published) {
        expect(states).not.toContain(undefined)
      }
    })

    it('does the same for search results', async () => {
      // Same trap, second code path
      create()
      await settle()
      api.respond('get', /plugins\/search/, [plugin('homebridge-hue', { config: [{ platform: 'Hue' }] })])
      const published = publishedStates()

      await page().search()

      expect(published.length).toBeGreaterThan(0)
      for (const states of published) {
        expect(states).not.toContain(undefined)
      }
    })

    it('calls a plugin with a config block configured', async () => {
      expect((await metaFor({ config: [{ platform: 'Example' }] })).isConfigured).toBe(true)
    })

    it('calls a plugin with no config block unconfigured', async () => {
      expect((await metaFor({ config: [] })).isConfigured).toBe(false)
    })

    it('notices a configured dynamic platform', async () => {
      // Which decides whether uninstalling has to offer to remove accessories
      expect((await metaFor({ config: [{ platform: 'Example' }] })).isConfiguredDynamicPlatform).toBe(true)
    })

    it('does not call an accessory block a dynamic platform', async () => {
      expect((await metaFor({ config: [{ accessory: 'Example' }] })).isConfiguredDynamicPlatform).toBe(false)
    })

    it('sees the child bridge a config block runs on', async () => {
      const config = [{ platform: 'Example', _bridge: { username: '0E:11:22:33:44:55' } }]

      expect((await metaFor({ config })).hasChildBridges).toBe(true)
    })

    it('does not count a bridge block with no username', async () => {
      // Half-written config, and it would suppress the setup nudge for nothing
      expect((await metaFor({ config: [{ platform: 'Example', _bridge: {} }] })).hasChildBridges).toBe(false)
    })

    it('nudges a configured plugin towards a child bridge', async () => {
      expect((await metaFor({ config: [{ platform: 'Example' }] })).recommendChildBridge).toBe(true)
    })

    it('does not nudge an unconfigured plugin', async () => {
      expect((await metaFor({ config: [] })).recommendChildBridge).toBe(false)
    })

    it('does not nudge when the user switched recommendations off', async () => {
      const meta = await metaFor({ config: [{ platform: 'Example' }] }, { env: { recommendChildBridges: false } })

      expect(meta.recommendChildBridge).toBe(false)
    })

    it('does not nudge a plugin the user opted out of', async () => {
      const meta = await metaFor(
        { config: [{ platform: 'Example' }] },
        { env: { plugins: { hideChildBridgeSetupFor: ['homebridge-example'] } } },
      )

      expect(meta.recommendChildBridge).toBe(false)
    })

    it('hides an update the user asked not to see', async () => {
      const meta = await metaFor(
        { updateAvailable: true },
        { env: { plugins: { hideUpdatesFor: ['homebridge-example'] } } },
      )

      expect(meta.updateAvailable).toBe(false)
    })

    it('leaves an update alone for a plugin not on that list', async () => {
      const meta = await metaFor({ updateAvailable: true }, { env: { plugins: { hideUpdatesFor: ['homebridge-other'] } } })

      expect(meta.updateAvailable).toBe(true)
    })

    it('derives nothing for a plugin that is not installed', async () => {
      // Search results include plugins the user does not have
      const meta = await metaFor({ installedVersion: undefined as any })

      expect(meta.isConfigured).toBeUndefined()
    })

    it('derives nothing at all for a non-admin', async () => {
      // A non-admin cannot read the config, so the calls would 403
      const meta = await metaFor({ config: [{ platform: 'Example' }] }, { admin: false })

      expect(meta.isConfigured).toBeUndefined()
    })

    it('assumes the safe answers when deriving throws', async () => {
      // A malformed config block would otherwise leave the whole grid unrendered
      const meta = await metaFor({ config: [null as any] })

      expect(meta.isConfigured).toBe(true)
      expect(meta.hasChildBridges).toBe(true)
      expect(console.error).toHaveBeenCalled()
    })

    it('looks up the config of an installed search result in the cache', async () => {
      // /plugins/search does not attach config blocks
      create({ installed: [plugin('homebridge-hue', { config: [{ platform: 'Hue' }] })] })
      await settle()
      api.respond('get', /plugins\/search/, [plugin('homebridge-hue', { config: undefined })])

      await page().search()

      expect(page().installedPlugins[0].isConfigured).toBe(true)
    })

    describe('the unpaired bridge warning', () => {
      const bridge = (overrides: Record<string, any> = {}) => ({
        plugin: 'homebridge-example',
        username: '0E:11:22:33:44:55',
        paired: true,
        ...overrides,
      })

      it('flags an unpaired hap bridge', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, { bridges: [bridge({ paired: false })] })

        expect(meta.hasChildBridgesUnpaired).toBe(true)
      })

      it('flags an uncommissioned matter bridge', async () => {
        const meta = await metaFor(
          { config: [{ platform: 'Example' }] },
          { bridges: [bridge({ matterConfig: {}, matterCommissioned: false })] },
        )

        expect(meta.hasChildBridgesUnpaired).toBe(true)
      })

      it('says nothing about a bridge that is paired', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, { bridges: [bridge()] })

        expect(meta.hasChildBridgesUnpaired).toBe(false)
      })

      it('respects a hidden hap warning', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          bridges: [bridge({ paired: false })],
          env: { bridges: [{ username: '0E:11:22:33:44:55', hideHapAlert: true }] },
        })

        expect(meta.hasChildBridgesUnpaired).toBe(false)
      })

      it('respects a hidden matter warning', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          bridges: [bridge({ matterConfig: {}, matterCommissioned: false })],
          env: { bridges: [{ username: '0E:11:22:33:44:55', hideMatterAlert: true }] },
        })

        expect(meta.hasChildBridgesUnpaired).toBe(false)
      })

      it('matches the bridge whatever case its username is written in', async () => {
        // The config file and the running bridge do not always agree
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          bridges: [bridge({ paired: false })],
          env: { bridges: [{ username: '0e:11:22:33:44:55', hideHapAlert: true }] },
        })

        expect(meta.hasChildBridgesUnpaired).toBe(false)
      })

      it('does not silence the hap warning with a hidden matter one', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          bridges: [bridge({ paired: false })],
          env: { bridges: [{ username: '0E:11:22:33:44:55', hideMatterAlert: true }] },
        })

        expect(meta.hasChildBridgesUnpaired).toBe(true)
      })

      it('ignores the bridges of other plugins', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          bridges: [bridge({ plugin: 'homebridge-other', paired: false })],
        })

        expect(meta.hasChildBridgesUnpaired).toBe(false)
      })
    })

    describe('external accessories', () => {
      it('flags a plugin publishing its own accessories', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          env: { featureFlags: { externalAccessoriesAttribution: true } },
          pairings: [{ _plugin: 'homebridge-example', _isExternal: true }],
        })

        expect(meta.hasExternalAccessories).toBe(true)
      })

      it('flags a matter-only pairing the same way', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          env: { featureFlags: { externalAccessoriesAttribution: true } },
          pairings: [{ _plugin: 'homebridge-example', _matterOnly: true }],
        })

        expect(meta.hasExternalAccessories).toBe(true)
      })

      it('ignores an ordinary bridged pairing', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          env: { featureFlags: { externalAccessoriesAttribution: true } },
          pairings: [{ _plugin: 'homebridge-example' }],
        })

        expect(meta.hasExternalAccessories).toBe(false)
      })

      it('does not ask for the pairings while the feature is off', async () => {
        const meta = await metaFor({ config: [{ platform: 'Example' }] }, {
          pairings: [{ _plugin: 'homebridge-example', _isExternal: true }],
        })

        expect(meta.hasExternalAccessories).toBe(false)
        expect(pairingsGet).not.toHaveBeenCalled()
      })

      it('carries on when the pairings cannot be read', async () => {
        create({
          installed: [plugin('homebridge-example', { config: [{ platform: 'Example' }] })],
          env: { featureFlags: { externalAccessoriesAttribution: true } },
        })
        pairingsGet.mockRejectedValue(new Error('server unavailable'))

        await page().loadInstalledPlugins()

        expect(page().installedPlugins[0].hasExternalAccessories).toBe(false)
        expect(page().mainError).toBe(false)
      })
    })
  })

  describe('searching', () => {
    it('asks the server for the query', async () => {
      create()
      api.respond('get', /plugins\/search/, [])
      page().setQuery('hue')

      await page().search()

      expect(api.lastCall('get')?.url).toBe('/plugins/search/hue')
    })

    it('url-encodes a query with a slash in it', async () => {
      // Searching for a scoped plugin by its full name
      create()
      api.respond('get', /plugins\/search/, [])
      page().setQuery('@homebridge-plugins/homebridge-hue')

      await page().search()

      expect(api.lastCall('get')?.url).toBe('/plugins/search/%40homebridge-plugins%2Fhomebridge-hue')
    })

    it('shows what came back', async () => {
      create()
      api.respond('get', /plugins\/search/, [plugin('homebridge-hue', { installedVersion: undefined as any })])
      page().setQuery('hue')

      await page().search()

      expect(page().installedPlugins.map(p => p.name)).toEqual(['homebridge-hue'])
      expect(page().loading).toBe(false)
    })

    it('never offers itself in the results', async () => {
      create()
      api.respond('get', /plugins\/search/, [plugin('@mp-consulting/homebridge-config-glass-ui'), plugin('homebridge-hue')])
      page().setQuery('homebridge')

      await page().search()

      expect(page().installedPlugins.map(p => p.name)).toEqual(['homebridge-hue'])
    })

    it('offers a way back out of the results', async () => {
      create()
      api.respond('get', /plugins\/search/, [])

      await page().search()

      expect(page().showExitButton).toBe(true)
    })

    it('goes back to the installed list when the search fails', async () => {
      create({ installed: [plugin('homebridge-example')] })
      api.fail('get', /plugins\/search/, new Error('npm registry unreachable'))
      page().setQuery('hue')

      await page().search()
      await settle()

      expect(page().isSearchMode).toBe(false)
      expect(toast.current.error).toHaveBeenCalled()
      expect(page().installedPlugins.map(p => p.name)).toEqual(['homebridge-example'])
    })

    describe('a plugin that has moved to the homebridge scope', () => {
      /** The two names the same plugin can go by. */
      const unscoped = (overrides: Partial<Plugin> = {}) => plugin('homebridge-foo', {
        installedVersion: undefined as any,
        newHbScope: { to: '@homebridge-plugins/homebridge-foo' } as any,
        ...overrides,
      })
      const scoped = (overrides: Partial<Plugin> = {}) => plugin('@homebridge-plugins/homebridge-foo', {
        installedVersion: undefined as any,
        ...overrides,
      })

      /**
       * Search and return the names shown.
       * @param results - what the server returns
       */
      async function namesFor(results: Plugin[]) {
        create()
        api.respond('get', /plugins\/search/, results)
        page().setQuery('foo')
        await page().search()
        return page().installedPlugins.map(p => p.name)
      }

      it('shows only the scoped one when neither is installed', async () => {
        // The scoped name is where the plugin lives now
        expect(await namesFor([unscoped(), scoped()])).toEqual(['@homebridge-plugins/homebridge-foo'])
      })

      it('shows the unscoped one when that is what the user has', async () => {
        // Offering the scoped copy would install a second, clashing plugin
        expect(await namesFor([unscoped({ installedVersion: '1.0.0' }), scoped()])).toEqual(['homebridge-foo'])
      })

      it('shows the unscoped one when the scoped name is not in the results', async () => {
        // Nothing better to offer
        expect(await namesFor([unscoped()])).toEqual(['homebridge-foo'])
      })

      it('leaves a plugin that has not moved alone', async () => {
        expect(await namesFor([plugin('homebridge-other', { installedVersion: undefined as any })]))
          .toEqual(['homebridge-other'])
      })
    })
  })

  describe('the search bar', () => {
    it('opens on the search button', async () => {
      vi.useFakeTimers()
      create({ installed: [plugin('homebridge-example')] })

      page().showSearch()

      expect(page().showSearchBar).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(host.focusSearchInput).toHaveBeenCalled()
    })

    it('leaves the stats tab when it opens', () => {
      create({ installed: [plugin('homebridge-example')] })
      page().setTab('stats')

      page().showSearch()

      expect(page().tab).toBe('main')
    })

    it('closes again on a second press', () => {
      create({ installed: [plugin('homebridge-example')] })
      page().showSearch()

      page().showSearch()

      expect(page().showSearchBar).toBe(false)
    })

    it('goes back to the installed list when closed while showing results', async () => {
      create({ installed: [plugin('homebridge-example')] })
      page().showSearch()
      store.setState({ isSearchMode: true, query: 'hue' })

      page().showSearch()
      await settle()

      expect(page().isSearchMode).toBe(false)
      expect(page().query).toBe('')
    })

    it('searches on submit', async () => {
      create()
      api.respond('get', /plugins\/search/, [])

      page().onSubmit({ query: 'hue' })
      await settle()

      expect(page().isSearchMode).toBe(true)
      expect(api.callsTo('get', /plugins\/search/)).toHaveLength(1)
    })

    it('closes the bar on an empty submit', async () => {
      create({ installed: [plugin('homebridge-example')] })
      page().showSearch()

      page().onSubmit({ query: '' })
      await settle()

      expect(page().showSearchBar).toBe(false)
      expect(api.callsTo('get', /plugins\/search/)).toEqual([])
    })

    it('goes back to the installed list on an empty submit while showing results', async () => {
      create({ installed: [plugin('homebridge-example')] })
      store.setState({ isSearchMode: true })

      page().onSubmit({ query: '' })
      await settle()

      expect(page().isSearchMode).toBe(false)
      expect(page().installedPlugins.map(p => p.name)).toEqual(['homebridge-example'])
    })

    it('clears the box and goes back on the clear button', async () => {
      create({ installed: [plugin('homebridge-example')] })
      store.setState({ isSearchMode: true, query: 'hue' })

      page().onClearSearch()
      await settle()

      expect(page().query).toBe('')
      expect(page().showExitButton).toBe(false)
      expect(page().isSearchMode).toBe(false)
    })

    it('does not reload when clearing a box that was not searched', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()
      pluginsGet.mockClear()

      page().onClearSearch()
      await settle()

      expect(pluginsGet).not.toHaveBeenCalled()
    })
  })

  describe('what the child bridge socket reports', () => {
    it('asks to be told about status changes', async () => {
      create()
      await settle()

      expect(io.socket.emitted.map(e => e.event)).toContain('monitor-child-bridge-status')
    })

    it('waits for the socket to connect before it starts', async () => {
      create({ connected: false })
      await settle()
      expect(io.socket.emitted.map(e => e.event)).not.toContain('monitor-child-bridge-status')

      io.markConnected()
      await settle()

      expect(io.socket.emitted.map(e => e.event)).toContain('monitor-child-bridge-status')
    })

    it('takes the bridge list from the server', async () => {
      create()
      io.socket.respondTo('get-homebridge-child-bridge-status', [{ username: 'A', plugin: 'homebridge-example' }])
      page().getChildBridgeMetadata()
      await settle()

      expect(page().childBridges.map(b => b.username)).toEqual(['A'])
    })

    it('adds a bridge it has not seen before', async () => {
      create()
      await settle()

      io.socket.fire('child-bridge-status-update', { username: 'B', plugin: 'homebridge-example' })

      expect(page().childBridges.map(b => b.username)).toEqual(['B'])
    })

    it('updates one it already knows rather than duplicating it', async () => {
      create()
      await settle()
      store.setState({ childBridges: [{ username: 'B', plugin: 'homebridge-example', status: 'up' } as any] })

      io.socket.fire('child-bridge-status-update', { username: 'B', status: 'down' })

      expect(page().childBridges).toHaveLength(1)
      expect(page().childBridges[0].status).toBe('down')
    })

    it('publishes a new array, so the cards re-render', async () => {
      // Mutating the object in place would leave the grid showing the old status
      create()
      await settle()
      store.setState({ childBridges: [{ username: 'B', plugin: 'homebridge-example', status: 'up' } as any] })
      const before = page().childBridges

      io.socket.fire('child-bridge-status-update', { username: 'B', status: 'down' })

      expect(page().childBridges).not.toBe(before)
    })

    it('keeps the other plugins\' bridge lists when one bridge reports, so their cards skip the render', async () => {
      create()
      await settle()
      const a = { username: 'A', plugin: 'homebridge-example', status: 'up' } as any
      const b = { username: 'B', plugin: 'homebridge-other', status: 'up' } as any
      store.setState({ childBridges: [a, b] })
      const before = groupChildBridgesByPlugin(page().childBridges)

      io.socket.fire('child-bridge-status-update', { username: 'B', status: 'down' })
      const after = groupChildBridgesByPlugin(page().childBridges, before)

      expect(page().childBridges[0]).toBe(a)
      expect(after.get('homebridge-example')).toBe(before.get('homebridge-example'))
      expect(after.get('homebridge-other')).not.toBe(before.get('homebridge-other'))
      expect(after.get('homebridge-other')![0].status).toBe('down')
      // The old object is left as it was
      expect(b.status).toBe('up')
    })

    it('gives a plugin only its own bridges', () => {
      create()
      store.setState({
        childBridges: [
          { username: 'A', plugin: 'homebridge-example' } as any,
          { username: 'B', plugin: 'homebridge-other' } as any,
        ],
      })

      expect(page().getPluginChildBridges(plugin('homebridge-example')).map(b => b.username)).toEqual(['A'])
    })

    it('stops listening for status updates when the page is left', () => {
      // The namespace is shared and `end()` keeps listeners
      create()

      stop()

      expect(io.socket.handlers('child-bridge-status-update')).toEqual([])
    })
  })

  describe('arriving straight from an install', () => {
    it('asks for a restart when the new plugin has config', async () => {
      create({
        installed: [plugin('homebridge-example', { config: [{ platform: 'Example' }] })],
        url: '/plugins?action=just-installed&plugin=homebridge-example',
      })
      await settle()

      expect(modal.opened.map(m => m.component)).toContain(RestartHomebridge)
    })

    it('opens the settings when it does not', async () => {
      create({
        installed: [plugin('homebridge-example', { config: [] })],
        url: '/plugins?action=just-installed&plugin=homebridge-example',
      })
      await settle()

      expect(managePlugins.settings).toHaveBeenCalled()
    })

    it('does nothing for a plugin that is not installed after all', async () => {
      create({
        installed: [plugin('homebridge-example')],
        url: '/plugins?action=just-installed&plugin=homebridge-missing',
      })
      await settle()

      expect(modal.opened).toEqual([])
      expect(managePlugins.settings).not.toHaveBeenCalled()
    })

    it('clears the query parameters, so a refresh does not repeat it', async () => {
      create({
        installed: [plugin('homebridge-example', { config: [] })],
        url: '/plugins?action=just-installed&plugin=homebridge-example',
      })
      await settle()

      expect(host.clearQueryParams).toHaveBeenCalled()
    })

    it('does nothing at all without an action', async () => {
      create({ installed: [plugin('homebridge-example')], url: '/plugins' })
      await settle()

      expect(host.clearQueryParams).not.toHaveBeenCalled()
    })

    it('opens the search bar when nothing is installed', async () => {
      // A brand new install: an empty grid with no way forward would be a dead end
      create({ installed: [] })
      await settle()

      expect(page().showSearchBar).toBe(true)
    })

    it('leaves the search bar closed when there is something to show', async () => {
      create({ installed: [plugin('homebridge-example')] })
      await settle()

      expect(page().showSearchBar).toBe(false)
    })
  })

  describe('the stats tab', () => {
    const lighting = (mode: 'light' | 'dark') => useSettingsStore.setState({ actualLightingMode: mode })

    it('paints the page black behind the stats', () => {
      create({ installed: [plugin('homebridge-example')] })

      page().showStats()

      expect(page().tab).toBe('stats')
      expect(document.body.classList.contains('bg-black')).toBe(true)
    })

    it('closes the search bar when it opens', () => {
      create({ installed: [plugin('homebridge-example')] })
      store.setState({ showSearchBar: true })

      page().showStats()

      expect(page().showSearchBar).toBe(false)
    })

    it('goes straight back in dark mode', () => {
      // Nothing to fade: the page is already dark
      create({ installed: [plugin('homebridge-example')] })
      lighting('dark')
      page().showStats()

      page().showStats()

      expect(page().tab).toBe('main')
      expect(document.body.classList.contains('bg-black')).toBe(false)
    })

    it('fades out before going back in light mode', async () => {
      vi.useFakeTimers()
      create({ installed: [plugin('homebridge-example')] })
      lighting('light')
      page().showStats()

      page().showStats()
      expect(page().tab).toBe('stats')

      await vi.advanceTimersByTimeAsync(500)
      expect(page().tab).toBe('main')
      expect(document.body.classList.contains('bg-black')).toBe(false)
    })

    it('cleans the light mode class off the body when the page is left', () => {
      create({ installed: [plugin('homebridge-example')] })
      lighting('light')
      document.body.classList.add('light-mode')

      stop()

      expect(document.body.classList.contains('light-mode')).toBe(false)
    })
  })

  describe('leaving the page', () => {
    const lighting = (mode: 'light' | 'dark') => useSettingsStore.setState({ actualLightingMode: mode })

    it('leaves at once from the plugin grid', () => {
      create({ installed: [plugin('homebridge-example')] })

      expect(page().canDeactivate()).toBe(true)
    })

    it('leaves at once from the stats tab in dark mode', async () => {
      create({ installed: [plugin('homebridge-example')] })
      lighting('dark')
      page().showStats()

      await expect(page().canDeactivate()).resolves.toBe(true)
      expect(document.body.classList.contains('bg-black')).toBe(false)
    })

    it('fades out first in light mode', async () => {
      vi.useFakeTimers()
      create({ installed: [plugin('homebridge-example')] })
      lighting('light')
      page().showStats()

      const leaving = page().canDeactivate('/accessories')
      let left = false
      void Promise.resolve(leaving).then(() => {
        left = true
      })

      await vi.advanceTimersByTimeAsync(250)
      expect(left).toBe(false)

      await vi.advanceTimersByTimeAsync(250)
      expect(left).toBe(true)
    })

    it('keeps the black background when the next page is black too', async () => {
      // The terminal and the log page are both black; flashing white between
      // them looks like a page fault
      vi.useFakeTimers()
      create({ installed: [plugin('homebridge-example')] })
      lighting('light')
      page().showStats()

      void page().canDeactivate('/platform-tools/terminal')
      await vi.advanceTimersByTimeAsync(250)

      expect(document.body.classList.contains('bg-black')).toBe(true)
    })

    it('does the same for the log page', async () => {
      vi.useFakeTimers()
      create({ installed: [plugin('homebridge-example')] })
      lighting('light')
      page().showStats()

      void page().canDeactivate('/logs')
      await vi.advanceTimersByTimeAsync(250)

      expect(document.body.classList.contains('bg-black')).toBe(true)
    })
  })

  describe('the support panel', () => {
    it('opens it', () => {
      create({ installed: [plugin('homebridge-example')] })

      page().openSupport()

      expect(modal.lastOpened()!.component).toBe(PluginSupport)
      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })
  })

  describe('the update all button', () => {
    it('counts only the plugins that have an update', async () => {
      // The count gates the button: with one update the card's own update
      // button is the right tool, so the page offers this from two
      create({
        installed: [
          plugin('homebridge-a', { updateAvailable: true }),
          plugin('homebridge-b', { updateAvailable: true }),
          plugin('homebridge-c'),
        ],
      })
      await settle()

      expect(availableUpdateCount(page())).toBe(2)
    })

    it('counts an update of the ui itself, though the ui is not listed', async () => {
      create({
        installed: [
          plugin('@mp-consulting/homebridge-config-glass-ui', { updateAvailable: true }),
          plugin('homebridge-a', { updateAvailable: true }),
        ],
      })
      await settle()

      expect(availableUpdateCount(page())).toBe(2)
    })

    it('opens the plan modal through the shared opener', async () => {
      // The modal's options (size, static backdrop) are the opener's business
      // and are asserted with managePlugins - both entry points share it
      create({ installed: [plugin('homebridge-a', { updateAvailable: true })] })
      await settle()

      page().updateAllModal()

      expect(managePlugins.openUpdateAllModal).toHaveBeenCalledTimes(1)
      expect(modal.lastOpened()!.component).toBe(UpdateAllModal)
    })

    it('invalidates the cache and reloads the list when the modal is closed', async () => {
      // A run that only restarts child bridges never reloads this page, and
      // the plugin list sits behind a ttl cache - without invalidate + reload
      // the completed updates would keep showing as available
      create({ installed: [plugin('homebridge-a', { updateAvailable: true })] })
      await settle()
      const before = pluginsGet.mock.calls.length

      page().updateAllModal()
      modal.lastOpened()!.ref.close()
      await settle()

      expect(pluginsCache.invalidate).toHaveBeenCalled()
      expect(pluginsGet.mock.calls.length).toBe(before + 1)
    })

    it('does not reload on the handover close - the server is restarting', async () => {
      // The modal closes with 'handover' just before navigating to /restart;
      // a reload taken then would cache pre-update state from a dying server
      create({ installed: [plugin('homebridge-a', { updateAvailable: true })] })
      await settle()
      const before = pluginsGet.mock.calls.length

      page().updateAllModal()
      modal.lastOpened()!.ref.close('handover')
      await settle()

      expect(pluginsGet.mock.calls.length).toBe(before)
    })

    it('does not reload when the plan is dismissed - nothing ran', async () => {
      create({ installed: [plugin('homebridge-a', { updateAvailable: true })] })
      await settle()
      const before = pluginsGet.mock.calls.length

      page().updateAllModal()
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(pluginsGet.mock.calls.length).toBe(before)
    })

    it('does not reload once the page has been left', async () => {
      create({ installed: [plugin('homebridge-a', { updateAvailable: true })] })
      await settle()
      const before = pluginsGet.mock.calls.length

      page().updateAllModal()
      stop()
      modal.lastOpened()!.ref.close()
      await settle()

      expect(pluginsGet.mock.calls.length).toBe(before)
    })
  })
})
