import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { PluginsPageHost } from '@/modules/plugins/plugins-page.store'
import type { FormEvent, ReactElement } from 'react'

import { useEffect, useMemo, useRef, useState } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { useStore } from 'zustand'

import { useAuthStore } from '@/core/auth/auth.store'
import { Spinner } from '@/core/components/spinner/Spinner'
import { settingsActions } from '@/core/settings'
import { useCanDeactivate } from '@/core/utilities/terminal/hooks'
import { ws } from '@/core/ws'
import { PluginCard } from '@/modules/plugins/plugin-card/PluginCard'
import {
  availableUpdateCount as countAvailableUpdates,
  createPluginsPageStore,
  groupChildBridgesByPlugin,
  pluginSummary as summarise,
} from '@/modules/plugins/plugins-page.store'

import './plugins.scss'

// Shared empty list for plugins without child bridges, so the card prop
// keeps the same reference instead of receiving a new `[]` every render
const noChildBridges: ChildBridge[] = []

/** The ngbTooltip of the toolbar buttons: on hover, below, after 150ms. */
function ToolbarTooltip({ text, children }: { text: string, children: ReactElement }) {
  return (
    <OverlayTrigger placement="bottom" trigger={['hover', 'focus']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip>{text}</Tooltip>}>
      {children}
    </OverlayTrigger>
  )
}

export function PluginsPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [store] = useState(createPluginsPageStore)
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const mainError = useStore(store, s => s.mainError)
  const loading = useStore(store, s => s.loading)
  const tab = useStore(store, s => s.tab)
  const installedPlugins = useStore(store, s => s.installedPlugins)
  const childBridges = useStore(store, s => s.childBridges)
  const showSearchBar = useStore(store, s => s.showSearchBar)
  const showExitButton = useStore(store, s => s.showExitButton)
  const isSearchMode = useStore(store, s => s.isSearchMode)
  const query = useStore(store, s => s.query)
  const uiUpdateAvailable = useStore(store, s => s.uiUpdateAvailable)

  const childBridgesByPlugin = useMemo(() => groupChildBridgesByPlugin(childBridges), [childBridges])
  const pluginSummary = useMemo(() => summarise(installedPlugins), [installedPlugins])
  const availableUpdateCount = countAvailableUpdates({ installedPlugins, uiUpdateAvailable })

  // The store reads the url asynchronously (after the first load), so it
  // needs the latest location rather than the one of the first render
  const locationRef = useRef(location)
  useEffect(() => {
    locationRef.current = location
  }, [location])

  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  useEffect(() => {
    // Set page title
    settingsActions.setPageTitle(t('menu.label_plugins'))
  }, [t])

  useEffect(() => {
    const host: PluginsPageHost = {
      getQueryParams: () => {
        const params = new URLSearchParams(locationRef.current.search)
        return { action: params.get('action'), plugin: params.get('plugin') }
      },
      clearQueryParams: () => {
        void navigateRef.current({ pathname: locationRef.current.pathname, search: '' }, { replace: true })
      },
      focusSearchInput: () => searchInputRef.current?.focus(),
    }
    const io = ws.connectToNamespace('child-bridges')
    const stop = store.getState().start(io, host)
    return () => {
      stop()
      io.end?.()
    }
  }, [store])

  // Every navigation that lands on this page reloads the list (the router's
  // NavigationEnd subscriber). The load is deduped against the one the
  // socket's connect starts on a fresh mount.
  useEffect(() => {
    void store.getState().loadInstalledPlugins()
  }, [store, location.key])

  useCanDeactivate(nextPath => store.getState().canDeactivate(nextPath))

  const actions = store.getState()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    actions.onSubmit({ query: store.getState().query })
  }

  return (
    <div className="hb-plugins">
      {loading && <Spinner />}

      <div className="row mb-3">
        <div className="col-6">
          <h3 className="primary-text m-0">{t('menu.label_plugins')}</h3>
        </div>
        <div className="col-6 text-end">
          {isAdmin && (
            <>
              {availableUpdateCount >= 2 && (
                <ToolbarTooltip text={t('update_all.title')}>
                  <button
                    type="button"
                    className="btn btn-elegant my-0 me-2"
                    aria-label={t('update_all.title')}
                    onClick={() => actions.updateAllModal()}
                  >
                    <i aria-hidden="true" className="fas fa-arrow-alt-circle-up"></i>
                  </button>
                </ToolbarTooltip>
              )}
              <ToolbarTooltip text={t('form.search')}>
                <button
                  type="button"
                  className="btn btn-elegant my-0 me-2"
                  aria-controls="plugin-search-region"
                  aria-label={t('form.search')}
                  aria-expanded={showSearchBar}
                  onClick={() => actions.showSearch()}
                >
                  <i aria-hidden="true" className={`fas fa-search${showSearchBar ? ' primary-text' : ''}`}></i>
                </button>
              </ToolbarTooltip>
              <ToolbarTooltip text={t('plugins.stats')}>
                <button
                  type="button"
                  className="btn btn-elegant my-0 me-2 d-none d-md-inline-block"
                  aria-controls="stats-header stats-iframe"
                  aria-label={t('plugins.stats')}
                  aria-expanded={tab === 'stats'}
                  onClick={() => actions.showStats()}
                >
                  <i aria-hidden="true" className={`fas fa-sliders${tab === 'stats' ? ' primary-text' : ''}`}></i>
                </button>
              </ToolbarTooltip>
            </>
          )}
          <button
            type="button"
            className="btn btn-elegant my-0 me-0"
            aria-label={t('support.title')}
            onClick={() => actions.openSupport()}
          >
            <i aria-hidden="true" className="far fa-circle-question"></i>
          </button>
        </div>
      </div>

      {tab === 'main' && (
        <>
          {showSearchBar && (
            <div className="row" id="plugin-search-region">
              <div className="col-md-12">
                <form noValidate onSubmit={onSubmit}>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="search-bar"
                    name="query"
                    value={query}
                    placeholder={t('plugins.placeholder_search_plugin')}
                    aria-label={t('plugins.placeholder_search_plugin')}
                    onChange={event => actions.setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      className="search-bar-clear"
                      aria-label={t('form.button_clear')}
                      onClick={() => actions.onClearSearch()}
                    >
                      <i className="fas fa-square-xmark" aria-hidden="true"></i>
                    </button>
                  )}
                </form>
              </div>
            </div>
          )}
          {!loading && (
            <>
              {!isSearchMode && installedPlugins.length > 0 && (
                <div className="plugin-summary" role="status">
                  <span className="plugin-summary-chip">
                    <i className="fas fa-plug" aria-hidden="true"></i>
                    {' '}
                    {t('plugins.summary.installed', { count: pluginSummary.installed })}
                  </span>
                  {pluginSummary.updates > 0 && (
                    <span className="plugin-summary-chip is-update">
                      <i className="fas fa-arrow-alt-circle-up" aria-hidden="true"></i>
                      {' '}
                      {t('plugins.summary.updates', { count: pluginSummary.updates })}
                    </span>
                  )}
                  {pluginSummary.disabled > 0 && (
                    <span className="plugin-summary-chip is-muted">
                      <i className="fas fa-circle-pause" aria-hidden="true"></i>
                      {' '}
                      {t('plugins.summary.disabled', { count: pluginSummary.disabled })}
                    </span>
                  )}
                </div>
              )}
              <div className="plugin-grid">
                {installedPlugins.map(plugin => (
                  <div className="hb-plugin-space-between" key={plugin.name}>
                    <PluginCard
                      plugin={plugin}
                      childBridges={childBridgesByPlugin.get(plugin.name) ?? noChildBridges}
                      isSearchResult={isSearchMode}
                    />
                  </div>
                ))}
                {installedPlugins.length === 0 && !loading && !mainError && (
                  <div className="alert alert-info mt-4 text-center w-100" role="status" aria-live="polite">
                    <i
                      aria-hidden="true"
                      className={`fas primary-text my-3 icon-xl ${showExitButton ? 'fa-exclamation-circle' : 'fa-magnifying-glass'}`}
                    >
                    </i>
                    <p>
                      {t(showExitButton ? 'plugins.placeholder_search_none' : 'plugins.placeholder_search_first')}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {tab === 'stats' && (
        <>
          <div className="w-100 py-3 hb-stats-header text-white text-center" id="stats-header">
            <div className="mb-2">
              <code>
                https://developers.homebridge.io/analytics
                {' '}
                <a
                  href="https://developers.homebridge.io/analytics"
                  target="_blank"
                  aria-label={t('plugins.stats_open_in_new_tab')}
                >
                  <i aria-hidden="true" className="fas fa-up-right-from-square"></i>
                </a>
              </code>
            </div>
            <div className="small grey-text">{t('plugins.stats_note')}</div>
          </div>
          <iframe
            src="https://developers.homebridge.io/analytics/"
            className="hb-stats"
            id="stats-iframe"
            // eslint-disable-next-line react/dom-no-unsafe-iframe-sandbox -- the sandbox the Angular page gave the analytics site
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
          >
          </iframe>
        </>
      )}
    </div>
  )
}
