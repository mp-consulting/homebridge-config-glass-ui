import type { ChildBridge, Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { IoNamespace } from '@/core/ws'

import { createStore } from 'zustand/vanilla'

import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth/auth.store'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { serverPairingsCache } from '@/core/caching/server-pairings-cache'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { PluginSupport } from '@/modules/plugins/plugin-support/PluginSupport'

const UI_PLUGIN_NAME = '@mp-consulting/homebridge-config-glass-ui'

const t = (key: string, params?: Record<string, unknown>) => i18n.t(key, params as any) as string

const body = () => window.document.querySelector('body')!

export type PluginsTab = 'main' | 'stats'

export interface PluginsPageState {
  mainError: boolean
  loading: boolean
  tab: PluginsTab
  installedPlugins: Plugin[]
  childBridges: ChildBridge[]
  showSearchBar: boolean
  showExitButton: boolean
  // True while the grid is showing search results rather than the installed
  // list. Read by the template to decide what a plugin card may show.
  isSearchMode: boolean
  /** The search box (the Angular form's `query` control). */
  query: string
  /**
   * Whether @mp-consulting/homebridge-config-glass-ui itself has an update, captured before the
   * list filters it out for display
   */
  uiUpdateAvailable: boolean
}

/** What the page component hands the store: the router and the DOM bits a store cannot reach. */
export interface PluginsPageHost {
  /** The `action` and `plugin` query parameters of the current url. */
  getQueryParams: () => { action?: string | null, plugin?: string | null }
  /** Clear the query parameters, replacing the history entry. */
  clearQueryParams: () => void
  /** Focus the search input (it renders after `showSearchBar` turns on). */
  focusSearchInput: () => void
}

export interface PluginsPageActions {
  setQuery: (query: string) => void
  setTab: (tab: PluginsTab) => void
  /**
   * What ngOnInit did: listen for list refreshes and child bridge status,
   * and initialise on every (re)connect. Returns the teardown (ngOnDestroy,
   * apart from `io.end()`, which belongs to whoever opened the namespace).
   */
  start: (io: IoNamespace, host: PluginsPageHost) => () => void
  search: () => Promise<void>
  onClearSearch: () => void
  onSubmit: (value: { query?: string | null }) => void
  updateAllModal: () => void
  showSearch: () => void
  showStats: () => void
  openSupport: () => void
  canDeactivate: (nextUrl?: string) => Promise<boolean> | boolean
  getPluginChildBridges: (plugin: Plugin) => ChildBridge[]
  loadInstalledPlugins: () => Promise<Plugin[] | undefined>
  getChildBridgeMetadata: () => void
  /** The `child-bridge-status-update` handler. */
  onChildBridgeStatusUpdate: (data: ChildBridge) => void
}

export type PluginsPageStore = PluginsPageState & PluginsPageActions

/** Counts for the summary chips under the title (installed view only) */
export function pluginSummary(plugins: Plugin[]) {
  return {
    installed: plugins.length,
    updates: plugins.filter(plugin => plugin.updateAvailable).length,
    disabled: plugins.filter(plugin => plugin.disabled).length,
  }
}

/**
 * How many installed packages show an update, gating the Update All button
 * (≥2 - with one update the card's own update button is the right tool).
 * The UI package is filtered out of the plugin list before display but
 * still counts here - it is an item Update All would offer, and without it
 * this gate disagrees with the status widget's for the same state. This
 * count still cannot see a Homebridge core update (this page never loads
 * it); the widget's gate can, so the two can differ by that one item.
 * The modal fetches the authoritative plan itself.
 */
export function availableUpdateCount(state: Pick<PluginsPageState, 'installedPlugins' | 'uiUpdateAvailable'>): number {
  return state.installedPlugins.filter(x => x.updateAvailable).length + (state.uiUpdateAvailable ? 1 : 0)
}

/**
 * Child bridges grouped by plugin name. Bound into each plugin card, so it
 * has to be a stable reference between renders (memoise it on `childBridges`).
 */
export function groupChildBridgesByPlugin(childBridges: ChildBridge[]): Map<string, ChildBridge[]> {
  const byPlugin = new Map<string, ChildBridge[]>()
  for (const bridge of childBridges) {
    const list = byPlugin.get(bridge.plugin)
    if (list) {
      list.push(bridge)
    } else {
      byPlugin.set(bridge.plugin, [bridge])
    }
  }
  return byPlugin
}

/** The settings env fields the sort depends on. */
export interface SortPluginsEnv {
  recommendChildBridges?: boolean
  plugins?: { hideChildBridgeSetupFor?: string[] }
}

/**
 * The order of the installed list.
 * @param plugins - the list to sort (left unchanged)
 * @param env - the settings env fields the sort depends on
 */
export function sortPlugins(plugins: Plugin[], env: SortPluginsEnv = useSettingsStore.getState().env): Plugin[] {
  const recommendChildBridges = env.recommendChildBridges
  const hideChildBridgeSetupFor = env.plugins?.hideChildBridgeSetupFor ?? []

  // True when a plugin shouldn't be nudged toward a child bridge — either it
  // already runs on one, or the user opted it out via `hideChildBridgeSetupFor`.
  // Such plugins sink below ones that still need setting up, so we only keep a
  // plugin prioritised when it's both not on a child bridge AND not opted out
  // (and only while child-bridge recommendations are enabled at all).
  const deprioritiseChildBridge = (plugin: Plugin): boolean =>
    !!recommendChildBridges
    && (plugin.hasChildBridges || hideChildBridgeSetupFor.includes(plugin.name))

  // Multi-criteria sorting
  // Priority 1: updateAvailable (=true)
  // Priority 2: newHbScope (=true)
  // Priority 3: disabled (=false)
  // Priority 4: isConfigured (=false) - unconfigured plugins need setup
  // Priority 5: hasChildBridgesUnpaired (=true) - unpaired bridges need pairing
  // Priority 6: needs child bridge setup (not on a bridge and not opted out)
  const score = (p: Plugin) => (p.updateAvailable ? 1000 : 0)
    + (p.newHbScope ? 100 : 0)
    + (p.disabled ? -10 : 0)
    + (p.isConfigured ? -20 : 0)
    + (p.hasChildBridgesUnpaired ? 5 : 0)
    + (deprioritiseChildBridge(p) ? -1 : 0)

  return [...plugins].sort((a, b) => {
    const aScore = score(a)
    const bScore = score(b)
    // Compare scores first, then fallback to name
    return aScore !== bScore ? bScore - aScore : a.name.localeCompare(b.name)
  })
}

/**
 * Some filtering in regard to the changeover to scoped plugins.
 * A plugin may have two versions, like homebridge-foo and @homebridge-plugins/homebridge-foo
 * If the user does not have either installed, or has the scoped version installed, then hide the unscoped version
 * If the user has the unscoped version installed, but not the scoped version, then hide the scoped version
 * @param data - the search results
 */
export function filterSearchResults(data: Plugin[]): Plugin[] {
  const hiddenPlugins = new Set<string>()
  const pluginMap = new Map(data.map((plugin: Plugin) => [plugin.name, plugin]))
  return data.reduce((acc: Plugin[], x: Plugin) => {
    if (x.name === UI_PLUGIN_NAME || hiddenPlugins.has(x.name)) {
      return acc
    }
    if (x.newHbScope) {
      const y = x.newHbScope.to
      const yExists = pluginMap.has(y)
      if (x.installedVersion || !yExists) {
        hiddenPlugins.add(y)
        acc.push(x)
      }
    } else {
      acc.push(x)
    }
    return acc
  }, [])
}

/**
 * Check if a specific bridge protocol alert is hidden
 * @param username - the bridge username
 * @param protocol - which alert
 */
function isBridgeAlertHidden(username: string, protocol: 'hap' | 'matter'): boolean {
  const bridge = useSettingsStore.getState().env.bridges?.find(b => b.username.toUpperCase() === username.toUpperCase())
  if (!bridge) {
    return false
  }
  return protocol === 'hap' ? !!bridge.hideHapAlert : !!bridge.hideMatterAlert
}

/**
 * Derive the per-plugin metadata the cards read (onto the plugin objects).
 * @param plugins - the list to annotate
 * @param childBridgesByPlugin - the reported child bridges, by plugin name
 */
export async function appendMetaInfo(plugins: Plugin[], childBridgesByPlugin: Map<string, ChildBridge[]>): Promise<void> {
  if (!useAuthStore.getState().user?.admin) {
    return
  }

  // Config blocks are attached server-side via /plugins?include=config
  // (admin only) — we used to issue one /config-editor/plugin/:name call
  // per installed plugin here, which was an N+1 on every page load.
  //
  // Search results come from /plugins/search/:query which doesn't attach
  // configs, so for any installed plugin that arrives without one we look
  // it up in the installed-plugins cache (already warm during normal use).
  const needsCacheLookup = plugins.some(p => p.installedVersion && p.config === undefined)
  const externalsFeatureEnabled = settingsActions.isFeatureEnabled('externalAccessoriesAttribution')

  const [cachedConfigList, pairings] = await Promise.all([
    needsCacheLookup ? pluginsCache.get() : Promise.resolve(null),
    externalsFeatureEnabled ? serverPairingsCache.get<any[]>().catch(() => []) : Promise.resolve([]),
  ])

  const cachedConfigByName = cachedConfigList
    ? new Map(cachedConfigList.map(p => [p.name, p.config ?? []]))
    : null

  const externalPluginNames = new Set<string>()
  for (const pairing of pairings ?? []) {
    if (typeof pairing?._plugin === 'string' && (pairing._isExternal === true || pairing._matterOnly === true)) {
      externalPluginNames.add(pairing._plugin)
    }
  }

  const env = useSettingsStore.getState().env

  for (const plugin of plugins) {
    if (!plugin.installedVersion) {
      continue
    }

    try {
      const configBlocks = plugin.config ?? cachedConfigByName?.get(plugin.name) ?? []
      plugin.isConfigured = configBlocks.length > 0
      plugin.isConfiguredDynamicPlatform = plugin.isConfigured && Object.hasOwn(configBlocks[0], 'platform')

      plugin.recommendChildBridge = plugin.isConfigured
        && !!env.recommendChildBridges
        && !['homebridge', UI_PLUGIN_NAME].includes(plugin.name)
        && !env.plugins?.hideChildBridgeSetupFor?.includes(plugin.name)

      plugin.hasChildBridges = plugin.isConfigured && configBlocks.some(x => x._bridge && x._bridge.username)
      plugin.hasExternalAccessories = externalsFeatureEnabled && externalPluginNames.has(plugin.name)

      const pluginChildBridges = childBridgesByPlugin.get(plugin.name) ?? []

      // Check for unpaired HAP bridges OR unpaired Matter bridges that are NOT hidden
      plugin.hasChildBridgesUnpaired = pluginChildBridges.some((x) => {
        const hasUnpairedHap = x.paired === false && !isBridgeAlertHidden(x.username, 'hap')
        const hasUnpairedMatter = x.matterConfig && x.matterCommissioned === false && !isBridgeAlertHidden(x.username, 'matter')

        return hasUnpairedHap || !!hasUnpairedMatter
      })

      if (env.plugins?.hideUpdatesFor?.includes(plugin.name)) {
        plugin.updateAvailable = false
      }
    } catch (error) {
      console.error(`Failed to derive metadata for ${plugin.name}:`, error)

      // If something goes wrong, assume it is configured — same fallback
      // the previous per-plugin fetch used.
      plugin.isConfigured = true
      plugin.hasChildBridges = true
      plugin.hasExternalAccessories = false
    }
  }
}

/** The plugins page (PluginsComponent), one store per mounted page. */
export function createPluginsPageStore() {
  let io: IoNamespace | undefined
  let host: PluginsPageHost | undefined
  let destroyed = false
  // Dedupes concurrent loads — without this, the websocket-connected subscriber
  // and the router navigation effect both fire `loadInstalledPlugins()`
  // on a fresh mount, doubling the work and (worse) sometimes leaving the grid
  // briefly rendered with metadata-less plugin objects (#2806-adjacent).
  let inFlightLoad: Promise<Plugin[] | undefined> | undefined

  return createStore<PluginsPageStore>()((set, get) => {
    const runLoadInstalledPlugins = async (): Promise<Plugin[] | undefined> => {
      set({
        query: '',
        showExitButton: false,
        // Loading the installed list is by definition leaving search mode. Most
        // callers already clear the flag first, but the router and websocket
        // subscribers do not, which would leave it set over installed plugins
        isSearchMode: false,
        loading: true,
        installedPlugins: [],
        mainError: false,
      })

      try {
        const installedPlugins = await pluginsCache.get()
        const uiUpdateAvailable = installedPlugins.some((x: Plugin) => x.name === UI_PLUGIN_NAME && x.updateAvailable)
        set({ uiUpdateAvailable })
        const plugins = installedPlugins.filter((x: Plugin) => x.name !== UI_PLUGIN_NAME)

        // Populate per-plugin metadata BEFORE publishing to the state so the
        // grid never renders with `plugin.isConfigured === undefined`, which
        // would flash the "needs setup" icon on every card (#2806-adjacent).
        await appendMetaInfo(plugins, groupChildBridgesByPlugin(get().childBridges))

        const sortedList = sortPlugins(plugins)
        set({ installedPlugins: sortedList })
        return sortedList
      } catch (error) {
        console.error(error)
        const message = error instanceof Error ? error.message : t('plugins.toast_failed_to_load_plugins')
        toast.error(message, t('toast.title_error'))
        set({ mainError: true })
        return undefined
      } finally {
        set({ loading: false })
      }
    }

    const initialize = async (): Promise<void> => {
      get().getChildBridgeMetadata()
      io?.socket.emit('monitor-child-bridge-status')

      // Load list of installed plugins
      await get().loadInstalledPlugins()

      if (!get().installedPlugins.length) {
        get().showSearch()
      }

      // Get any query parameters
      const { action: queryAction, plugin: queryPlugin } = host?.getQueryParams() ?? {}
      if (queryAction) {
        const plugin: Plugin | undefined = get().installedPlugins.find(x => x.name === queryPlugin)
        switch (queryAction) {
          case 'just-installed': {
            if (plugin) {
              if (plugin.isConfigured) {
                openModal(RestartHomebridge, {}, {
                  size: 'lg',
                  backdrop: 'static',
                })
              } else {
                void managePlugins.settings(plugin)
              }
            }
            break
          }
        }

        // Clear the query parameters so that we don't keep showing the same action
        host?.clearQueryParams()
      }
    }

    return {
      mainError: false,
      loading: true,
      tab: 'main',
      installedPlugins: [],
      childBridges: [],
      showSearchBar: false,
      showExitButton: false,
      isSearchMode: false,
      query: '',
      uiUpdateAvailable: false,

      setQuery: query => set({ query }),
      setTab: tab => set({ tab }),

      start(namespace, pageHost) {
        io = namespace
        host = pageHost
        destroyed = false

        // Subscribe to plugin list refresh events
        const unsubscribeRefresh = managePlugins.onPluginListRefresh.subscribe(() => {
          void get().loadInstalledPlugins()
          get().getChildBridgeMetadata()
        })

        // Subscribe to connection events for reconnections
        const unsubscribeConnected = namespace.connected.subscribe(() => {
          void initialize()
        })

        // Kept as a reference so the teardown can `off()` exactly this handler:
        // the namespace is cached and shared, and `end()` keeps listeners
        const childStatusHandler = (data: ChildBridge) => get().onChildBridgeStatusUpdate(data)
        namespace.socket.on('child-bridge-status-update', childStatusHandler)

        return () => {
          destroyed = true
          // Clean up light-mode class
          body().classList.remove('light-mode')
          unsubscribeRefresh()
          unsubscribeConnected()
          namespace.socket.off('child-bridge-status-update', childStatusHandler)
        }
      },

      onChildBridgeStatusUpdate(data) {
        const bridges = get().childBridges
        const existingBridge = bridges.find(x => x.username === data.username)
        if (existingBridge) {
          Object.assign(existingBridge, data)
          // A new array, so the cards re-render
          set({ childBridges: [...bridges] })
        } else {
          set({ childBridges: [...bridges, data] })
        }
      },

      async search() {
        set({ loading: true, installedPlugins: [], showExitButton: true })

        try {
          const data = await api.get<Plugin[]>(`/plugins/search/${encodeURIComponent(get().query)}`)
          const filtered = filterSearchResults(data)

          // Populate metadata before publishing so cards render fully-formed.
          await appendMetaInfo(filtered, groupChildBridgesByPlugin(get().childBridges))
          set({ installedPlugins: filtered })
        } catch (error) {
          set({ isSearchMode: false })
          console.error(error)
          const message = error instanceof Error ? error.message : t('plugins.toast_failed_to_search_plugins')
          toast.error(message, t('toast.title_error'))
          void get().loadInstalledPlugins()
        } finally {
          set({ loading: false })
        }
      },

      onClearSearch() {
        set({ query: '', showExitButton: false })
        if (get().isSearchMode) {
          set({ isSearchMode: false })
          void get().loadInstalledPlugins()
        }
      },

      onSubmit(value) {
        if (!value.query?.length) {
          // Close search mode if in search mode
          if (get().isSearchMode) {
            set({ isSearchMode: false })
            void get().loadInstalledPlugins()
          }
          // Close search bar if empty
          set({ showSearchBar: false })
        } else {
          set({ isSearchMode: true, query: value.query })
          void get().search()
        }
      },

      updateAllModal() {
        const ref = managePlugins.openUpdateAllModal()

        // A run that only restarts child bridges never reloads this page, so
        // refresh the list once the modal is closed - completed updates should
        // stop showing as available. The cache must be invalidated first or the
        // reload would serve the same stale list back.
        // On close only (not dismiss): a plan-phase dismiss ran nothing, and the
        // 'handover' close means the server is restarting RIGHT NOW - reloading
        // then would cache pre-update state fetched from a dying process. The
        // destroy guard matters for the same reason: by the time the modal has
        // closed, the hand-over may have navigated away from this page
        ref.result.then((reason) => {
          if (destroyed || reason === 'handover') {
            return
          }
          pluginsCache.invalidate()
          void get().loadInstalledPlugins()
        }, () => {})
      },

      showSearch() {
        if (get().showSearchBar) {
          set({ showSearchBar: false })
          if (get().isSearchMode) {
            set({ isSearchMode: false, query: '' })
            void get().loadInstalledPlugins()
          }
        } else {
          body().classList.remove('bg-black')
          set({ tab: 'main', showSearchBar: true })
          setTimeout(() => host?.focusSearchInput(), 0)
        }
      },

      showStats() {
        const lightingMode = useSettingsStore.getState().actualLightingMode
        if (get().tab === 'stats') {
          // In dark mode, no animations needed
          if (lightingMode !== 'light') {
            body().classList.remove('bg-black')
            set({ tab: 'main' })
            return
          }

          // Remove light-mode class from body
          body().classList.remove('light-mode')

          // Fade out stats before switching to main
          const statsHeader = document.getElementById('stats-header')
          const statsIframe = document.getElementById('stats-iframe')

          if (statsHeader && statsIframe) {
            statsHeader.classList.add('fade-out')
            statsIframe.classList.add('fade-out')
          }

          // Wait for fade-out animation (250ms)
          setTimeout(() => {
            // Remove body bg color to trigger background transition
            body().classList.remove('bg-black')

            // Wait for background transition before switching tab
            setTimeout(() => {
              set({ tab: 'main' })
            }, 250)
          }, 250)
        } else {
          // Set body bg color
          body().classList.add('bg-black')
          set({ tab: 'stats', showSearchBar: false })

          // Add light-mode class for animations (only in light mode)
          if (lightingMode === 'light') {
            body().classList.add('light-mode')
            setTimeout(() => {
              const statsHeader = document.getElementById('stats-header')
              const statsIframe = document.getElementById('stats-iframe')
              if (statsHeader && statsIframe) {
                statsHeader.classList.add('light-mode')
                statsIframe.classList.add('light-mode')
              }
            }, 0)
          }
        }
      },

      openSupport() {
        openModal(PluginSupport, {}, {
          size: 'lg',
          backdrop: 'static',
        })
      },

      canDeactivate(nextUrl) {
        // Only animate if we're on the stats tab
        if (get().tab !== 'stats') {
          return true
        }

        // If in dark mode, no animations needed - navigate immediately
        if (useSettingsStore.getState().actualLightingMode !== 'light') {
          body().classList.remove('bg-black')
          return Promise.resolve(true)
        }

        // Remove light-mode class from body
        body().classList.remove('light-mode')

        // Check if we're navigating to another black-background page
        const stayingBlack = nextUrl && (
          nextUrl.includes('/platform-tools/terminal')
          || nextUrl.includes('/logs')
        )

        return new Promise((resolve) => {
          // Fade out stats before leaving
          const statsHeader = document.getElementById('stats-header')
          const statsIframe = document.getElementById('stats-iframe')

          if (statsHeader && statsIframe) {
            statsHeader.classList.add('fade-out')
            statsIframe.classList.add('fade-out')
          }

          if (stayingBlack) {
            // Just fade out the stats, keep background black
            setTimeout(() => {
              resolve(true)
            }, 250)
          } else {
            // Wait for fade-out animation (250ms) and body background transition (250ms)
            setTimeout(() => {
              // Remove body bg color to trigger background transition
              body().classList.remove('bg-black')
            }, 250)

            // Wait for both animations to complete before allowing navigation
            setTimeout(() => {
              resolve(true)
            }, 500)
          }
        })
      },

      getPluginChildBridges(plugin) {
        return groupChildBridgesByPlugin(get().childBridges).get(plugin.name) ?? []
      },

      loadInstalledPlugins() {
        // Share a single in-flight load across concurrent triggers (ws-connected
        // subscribe + the navigation effect both fire on a fresh mount).
        if (inFlightLoad) {
          return inFlightLoad
        }
        inFlightLoad = runLoadInstalledPlugins()
          .finally(() => {
            inFlightLoad = undefined
          })
        return inFlightLoad
      },

      getChildBridgeMetadata() {
        io?.request<ChildBridge[]>('get-homebridge-child-bridge-status').then((data) => {
          set({ childBridges: data })
        }, (error) => {
          console.error(error)
        })
      },
    }
  })
}

export type PluginsPageStoreApi = ReturnType<typeof createPluginsPageStore>
