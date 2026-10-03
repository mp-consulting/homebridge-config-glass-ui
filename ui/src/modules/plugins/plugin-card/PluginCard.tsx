import type { ChildBridge, Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { ReactElement } from 'react'

import { memo, useMemo, useReducer, useState } from 'react'
import { Dropdown, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth/auth.store'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { Confirm } from '@/core/components/confirm/Confirm'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { escapeHtml } from '@/core/helpers/html.helper'
import { formatDatePattern } from '@/core/pipes/date-pattern'
import { DisablePlugin } from '@/core/plugins/disable-plugin/DisablePlugin'
import { Donate } from '@/core/plugins/donate/Donate'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { PluginInfo } from '@/core/plugins/plugin-info/PluginInfo'
import { PluginLogs } from '@/core/plugins/plugin-logs/PluginLogs'
import { RE_HOMEBRIDGE_PREFIX } from '@/core/regex.constants'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { mobileDetect } from '@/core/utilities/mobile-detect'
import { ws } from '@/core/ws'

import './plugin-card.scss'

export const defaultIcon = 'assets/hb-icon.png'

const UI_PLUGIN_NAME = '@mp-consulting/homebridge-config-glass-ui'

export type ChildBridgeAction = 'stop' | 'start' | 'restart'

export interface PluginCardProps {
  plugin: Plugin
  childBridges: ChildBridge[]
  // The transport icons help someone choosing a plugin to install decide
  // between two that do the same job, so they only appear on search results.
  // On an already-installed plugin the question is settled, and the child
  // bridge rows below already say which transports it is actually using.
  isSearchResult?: boolean
}

/** The ngbTooltip the card had: on hover, appended to body, after 150ms. */
function WithTooltip({ text, placement = 'top', children }: { text: string, placement?: 'top' | 'bottom', children: ReactElement }) {
  return (
    <OverlayTrigger placement={placement} trigger={['hover', 'focus']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip>{text}</Tooltip>}>
      {children}
    </OverlayTrigger>
  )
}

/**
 * The "worse" status of all child bridges, used for the colour of the icon.
 * @param childBridges - the plugin's bridges
 */
function worstStatus(childBridges: ChildBridge[]): string {
  if (childBridges.some(x => x.status === 'down')) {
    return 'down'
  }
  if (childBridges.some(x => x.status === 'pending')) {
    return 'pending'
  }
  if (childBridges.some(x => x.status === 'ok')) {
    return 'ok'
  }
  return 'pending'
}

function PluginCardComponent({ plugin, childBridges, isSearchResult = false }: PluginCardProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const [isMobile] = useState<string>(() => mobileDetect.detect.mobile() || '')
  const [childBridgeRestartInProgress, setChildBridgeRestartInProgress] = useState(false)
  // The icon that failed to load, so a fresh plugin object with a new icon gets its own chance
  const [brokenIcon, setBrokenIcon] = useState<string | undefined>(undefined)
  // `disabled` is flipped on the plugin object itself (the page holds the same
  // object), which React cannot see - this re-renders the card after it
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  const hasChildBridges = childBridges.length > 0
  const allChildBridgesStopped = childBridges.every(x => x.manuallyStopped === true)
  const childBridgeStatus = useMemo(() => worstStatus(childBridges), [childBridges])

  // Tidy the plugin for display: "Homebridge Example" wraps on a phone
  const displayName = isMobile && plugin.displayName.toLowerCase().startsWith('homebridge ')
    ? plugin.displayName.replace(RE_HOMEBRIDGE_PREFIX, '')
    : plugin.displayName
  const icon = !plugin.icon || plugin.icon === brokenIcon ? defaultIcon : plugin.icon

  // A plugin with neither supports-* keyword predates the convention and can
  // only be a HAP plugin, so the hap icon stays enabled as the fallback.
  const supportsHap = plugin.supportsHap === true || plugin.supportsMatter !== true
  const supportsMatter = plugin.supportsMatter === true

  // With a single transport the plugin definitely exposes over it ("exposes"),
  // with both it depends on the bridge config ("can expose"). The tooltip keys
  // are shared between the icons; the protocol name is interpolated in from
  // the label keys.
  const hapTooltip = !supportsHap ? 'plugins.tooltip_not' : supportsMatter ? 'plugins.tooltip_can' : 'plugins.tooltip_yes'
  const matterTooltip = !supportsMatter ? 'plugins.tooltip_not' : supportsHap ? 'plugins.tooltip_can' : 'plugins.tooltip_yes'

  const openFundingModal = (p: Plugin) => {
    openModal(Donate, { plugin: p }, {
      size: 'lg',
      backdrop: 'static',
    })
  }

  const pluginInfoModal = (p: Plugin) => {
    openModal(PluginInfo, { plugin: p }, {
      size: 'lg',
      backdrop: 'static',
    })
  }

  const doChildBridgeAction = async (action: ChildBridgeAction): Promise<void> => {
    setChildBridgeRestartInProgress(true)
    try {
      const io = ws.getExistingNamespace('child-bridges')
      for (const bridge of childBridges) {
        await io!.request(`${action}-child-bridge`, bridge.username)
      }
    } catch (error) {
      console.error(error)
      toast.error(i18n.t('plugins.bridge.action_error', { action }), i18n.t('toast.title_error'))
      setChildBridgeRestartInProgress(false)
    } finally {
      setTimeout(() => {
        setChildBridgeRestartInProgress(false)
      }, action === 'restart' ? 12000 : action === 'stop' ? 6000 : 1000)
    }
  }

  const disablePlugin = async (p: Plugin): Promise<void> => {
    const ref = openModal(DisablePlugin, {
      pluginName: (p === plugin ? displayName : p.displayName) || p.name,
      isConfigured: p.isConfigured,
      isConfiguredDynamicPlatform: p.isConfiguredDynamicPlatform,
      keepOrphans: useSettingsStore.getState().keepOrphans,
    }, {
      size: 'lg',
      backdrop: 'static',
    })

    try {
      await ref.result
      try {
        // Mark as disabled
        await api.put(`/config-editor/plugin/${encodeURIComponent(p.name)}/disable`, {})
        pluginsCache.invalidate()
        p.disabled = true
        rerender()

        // Stop all child bridges
        if (hasChildBridges) {
          void doChildBridgeAction('stop')
        }
        openModal(RestartHomebridge, {}, {
          size: 'lg',
          backdrop: 'static',
        })
      } catch (error) {
        console.error(error)
        toast.error(i18n.t('plugins.disable.error'), i18n.t('toast.title_error'))
      }
    } catch {
      // Modal dismissed, do nothing
    }
  }

  const enablePlugin = async (p: Plugin): Promise<void> => {
    const ref = openModal(Confirm, {
      title: p.name,
      // The confirm dialog renders its message as HTML, and the display
      // name comes from the plugin's own package.json
      message: i18n.t('plugins.manage.confirm_enable', { pluginName: escapeHtml(p.displayName) }),
      confirmButtonLabel: i18n.t('plugins.manage.enable'),
      faIconClass: 'fa-circle-play primary-text',
    }, {
      size: 'lg',
      backdrop: 'static',
    })

    try {
      await ref.result
      try {
        await api.put(`/config-editor/plugin/${encodeURIComponent(p.name)}/enable`, {})
        pluginsCache.invalidate()

        // Mark as enabled
        p.disabled = false
        rerender()

        // Start all child bridges
        if (hasChildBridges) {
          await doChildBridgeAction('start')
        }
        openModal(RestartHomebridge, {}, {
          size: 'lg',
          backdrop: 'static',
        })
      } catch (error) {
        console.error(error)
        toast.error(i18n.t('plugins.enable.error'), i18n.t('toast.title_error'))
      }
    } catch {
      // Modal dismissed, do nothing
    }
  }

  const viewPluginLog = () => {
    openModal(PluginLogs, {
      plugin,
      childBridges,
    }, {
      size: 'xl',
      backdrop: 'static',
    })
  }

  const handleIconError = () => setBrokenIcon(plugin.icon)
  const checkAndUpdatePlugin = () => void managePlugins.checkAndUpdatePlugin(plugin, plugin.latestVersion)
  const openSettings = () => void managePlugins.settings(plugin)
  const openBridgeSettings = () => void managePlugins.bridgeSettings(plugin)
  const openExternalAccessories = () => void managePlugins.externalAccessories(plugin)
  const switchToScoped = () => void managePlugins.switchToScoped(plugin)
  const installAlternateVersion = () => void managePlugins.installAlternateVersion(plugin)
  const openJsonEditor = () => void managePlugins.jsonEditor(plugin)
  const uninstallPlugin = () => void managePlugins.uninstallPlugin(plugin, childBridges)
  const resetChildBridges = () => void managePlugins.resetChildBridges(childBridges)

  const notSwitchable = !plugin.newHbScope || plugin.newHbScope?.switch !== plugin.installedVersion
  const verified = plugin.verifiedPlugin || plugin.verifiedPlusPlugin
  const restartKey = childBridges.length > 1 ? 'child_bridge.restart_plural' : 'child_bridge.restart'
  const isUi = plugin.name === UI_PLUGIN_NAME

  const shieldClass = cx(
    'fas fa-shield-alt fa-lg me-1',
    plugin.isHbScoped && 'purple-text',
    !plugin.isHbScoped && verified && 'green-text',
    !plugin.isHbScoped && !plugin.verifiedPlugin && !plugin.verifiedPlusPlugin && 'orange-text',
  )

  const bridgeStatusClass = cx(
    'fas fa-lg ms-3',
    childBridgeStatus === 'pending' && 'fa-bridge-circle-exclamation orange-text',
    childBridgeStatus === 'down' && 'fa-bridge-circle-xmark red-text',
  )

  return (
    <div className="hb-plugin-card">
      <div className="card card-body mb-3">
        <div className="d-flex flex-row justify-content-between">
          <div className="d-flex flex-column me-3 align-items-center justify-content-between">
            <img alt="" aria-hidden="true" className="plugin-icon-card mb-3" src={icon} onError={handleIconError} />
            {/* supported transport icons: hap + matter, when choosing a plugin to install */}
            {isSearchResult && (
              <div className="transport-icons flex-grow-1 d-flex align-items-center justify-content-center">
                <WithTooltip text={t(hapTooltip, { protocol: t('plugins.label_hap') })}>
                  <span className={`transport-icon${supportsHap ? ' enabled' : ''}`}>
                    <i className="fas fa-hap" aria-hidden="true"></i>
                    <span className="visually-hidden">{t('plugins.label_hap')}</span>
                  </span>
                </WithTooltip>
                <WithTooltip text={t(matterTooltip, { protocol: t('plugins.label_matter') })}>
                  <span className={`transport-icon${supportsMatter ? ' enabled' : ''}`}>
                    <i className="fas fa-matter" aria-hidden="true"></i>
                    <span className="visually-hidden">{t('plugins.label_matter')}</span>
                  </span>
                </WithTooltip>
              </div>
            )}
          </div>
          <div className="d-flex flex-column justify-content-between plugin-content">
            <div className="d-flex flex-row align-items-end">
              <div className="d-flex flex-column w-100">
                {/* plugin name and right 'action' icon */}
                <div className="d-flex flex-row">
                  <h5 className="card-title mb-2 text-truncate">{displayName}</h5>
                  {isAdmin && (
                    <div className="ms-auto">
                      {/* update available */}
                      {plugin.installedVersion && plugin.updateAvailable && !childBridgeRestartInProgress && (
                        <WithTooltip text={t('plugins.button_update')}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('plugins.button_update')}
                            onClick={checkAndUpdatePlugin}
                          >
                            <i
                              className="far fa-arrow-alt-circle-up primary-text fa-lg fa-fade fa-spin-slow ms-3"
                              aria-hidden="true"
                            >
                            </i>
                          </button>
                        </WithTooltip>
                      )}
                      {/* switch to scoped available */}
                      {plugin.installedVersion
                        && plugin.newHbScope?.switch === plugin.installedVersion
                        && !childBridgeRestartInProgress && (
                        <WithTooltip text={t('plugins.manage.scoped.switch')}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('plugins.manage.scoped.switch')}
                            onClick={switchToScoped}
                          >
                            <i
                              className="fas fa-arrow-right-arrow-left primary-text fa-lg fa-fade fa-spin-slow ms-3"
                              aria-hidden="true"
                            >
                            </i>
                          </button>
                        </WithTooltip>
                      )}
                      {/* installed, not configured */}
                      {plugin.installedVersion
                        && notSwitchable
                        && !plugin.updateAvailable
                        && !plugin.isConfigured
                        && !childBridgeRestartInProgress
                        && !plugin.disabled && (
                        <WithTooltip text={t('plugins.button_set_up')}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('plugins.button_set_up')}
                            onClick={openSettings}
                          >
                            <i className="fas fa-sliders primary-text fa-lg fa-fade fa-spin-slow ms-3" aria-hidden="true"></i>
                          </button>
                        </WithTooltip>
                      )}
                      {/* installed, configured, not setup as child bridge although recommended */}
                      {plugin.installedVersion
                        && notSwitchable
                        && !plugin.updateAvailable
                        && plugin.isConfigured
                        && !plugin.hasChildBridges
                        && !plugin.disabled
                        && plugin.recommendChildBridge
                        && !childBridgeRestartInProgress && (
                        <WithTooltip text={t('child_bridge.setup')}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('child_bridge.setup')}
                            onClick={openBridgeSettings}
                          >
                            <i
                              className="icon-button fas fa-bridge primary-text fa-lg fa-fade fa-spin-slow ms-3"
                              aria-hidden="true"
                            >
                            </i>
                          </button>
                        </WithTooltip>
                      )}
                      {/* installed, configured, setup as child bridge, not paired with homekit */}
                      {plugin.installedVersion
                        && notSwitchable
                        && !plugin.updateAvailable
                        && plugin.isConfigured
                        && plugin.hasChildBridges
                        && !childBridgeRestartInProgress
                        && plugin.hasChildBridgesUnpaired
                        && childBridgeStatus === 'ok'
                        && !plugin.disabled && (
                        <WithTooltip text={t('child_bridge.bridge_connect')}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('child_bridge.bridge_connect')}
                            onClick={openBridgeSettings}
                          >
                            <i
                              className="icon-button fas fa-qrcode primary-text fa-lg fa-fade fa-spin-slow ms-3"
                              aria-hidden="true"
                            >
                            </i>
                          </button>
                        </WithTooltip>
                      )}
                      {/* restart in progress spinner */}
                      <i
                        className="fas fa-circle-notch fa-spin fa-lg grey-text ms-3"
                        aria-hidden="true"
                        hidden={!childBridgeRestartInProgress}
                      >
                      </i>
                      {/* child bridge status (good status is not shown) */}
                      {plugin.installedVersion
                        && notSwitchable
                        && !plugin.updateAvailable
                        && plugin.isConfigured
                        && plugin.hasChildBridges
                        && !childBridgeRestartInProgress
                        && !plugin.hasChildBridgesUnpaired
                        && childBridgeStatus !== 'ok'
                        && !plugin.disabled && (
                        <i className={bridgeStatusClass} aria-hidden="true"></i>
                      )}
                    </div>
                  )}
                </div>
                {/* plugin npm name/info modal */}
                <p className="card-text mb-2 text-truncate">
                  <button
                    type="button"
                    className="card-link btn btn-link p-0 text-decoration-none"
                    aria-label={t('plugins.button_info')}
                    title={plugin.name}
                    onClick={() => pluginInfoModal(plugin)}
                  >
                    <i className={shieldClass} aria-hidden="true"></i>
                    <span className="grey-text" aria-hidden="true">{plugin.name}</span>
                  </button>
                </p>
                {/* plugin author and donate modal; nothing to show without an author */}
                {plugin.author && (
                  <p className="card-text mb-2">
                    {verified && plugin.funding
                      ? (
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('plugins.donate.tile_donate_to', { author: plugin.author })}
                            onClick={() => openFundingModal(plugin)}
                          >
                            <i className="fas fa-heart fa-lg me-1 pink-text" aria-hidden="true"></i>
                            <span className="grey-text">
                              @
                              {plugin.author}
                            </span>
                          </button>
                        )
                      : (
                          <span className="grey-text">
                            <i className="fas fa-heart fa-lg me-1 heart-muted" aria-hidden="true"></i>
                            @
                            {plugin.author}
                          </span>
                        )}
                  </p>
                )}
                {/* plugin versioning and actions dropdown */}
                <div className="d-flex flex-row">
                  <p className="card-text mb-0 grey-text">
                    {/* not installed */}
                    {plugin.publicPackage && !plugin.installedVersion && (
                      <span>
                        <i className="far fa-circle-dot fa-lg me-1" aria-hidden="true"></i>
                        <span className="grey-text">
                          v
                          {plugin.latestVersion}
                          {' '}
                          {plugin.lastUpdated && (
                            <span>
                              (
                              {formatDatePattern(plugin.lastUpdated, 'yyyy-MM-dd')}
                              )
                            </span>
                          )}
                        </span>
                      </span>
                    )}
                    {/* installed */}
                    {plugin.installedVersion && (
                      <>
                        <i className="far fa-circle-check fa-lg me-1" aria-hidden="true"></i>
                        v
                        {plugin.installedVersion}
                      </>
                    )}
                  </p>
                  {isAdmin && (
                    <div className="ms-auto">
                      {/* icon for child bridge restart */}
                      {!plugin.disabled && plugin.hasChildBridges && childBridgeStatus === 'ok' && (
                        <WithTooltip text={t(restartKey)}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t(restartKey)}
                            onClick={() => void doChildBridgeAction('restart')}
                          >
                            <i className="fas fa-lg fa-power-off ms-3" aria-hidden="true"></i>
                          </button>
                        </WithTooltip>
                      )}
                      {/* icon for plugin disabled */}
                      {plugin.installedVersion && plugin.disabled && (
                        <button
                          type="button"
                          className="card-link btn btn-link p-0 text-decoration-none red-text"
                          aria-label={t('common.labels.disabled')}
                          onClick={() => void enablePlugin(plugin)}
                        >
                          <WithTooltip text={t('common.labels.disabled')}>
                            <i className="far fa-pause-circle fa-lg" aria-hidden="true"></i>
                          </WithTooltip>
                        </button>
                      )}
                      {/* icon for plugin not installed, to download */}
                      {plugin.publicPackage && !plugin.installedVersion && (
                        <WithTooltip text={t('plugins.manage.install')}>
                          <button
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none"
                            aria-label={t('plugins.manage.install')}
                            onClick={installAlternateVersion}
                          >
                            <i className="far fa-arrow-alt-circle-down fa-lg" aria-hidden="true"></i>
                          </button>
                        </WithTooltip>
                      )}
                      {plugin.installedVersion && (
                        <Dropdown as="span" drop="start" className="d-inline-block ms-3 mt-auto">
                          {/* icon to expand dropdown */}
                          <Dropdown.Toggle
                            as="button"
                            type="button"
                            className="card-link btn btn-link p-0 text-decoration-none mt-auto dropdown-toggle-no-outline"
                            aria-label={t('plugins.button_actions')}
                          >
                            <i className="fa-solid fa-ellipsis-v fa-lg" aria-hidden="true"></i>
                          </Dropdown.Toggle>
                          <Dropdown.Menu renderOnMount>
                            {/* plugin config */}
                            <Dropdown.Item as="button" type="button" onClick={openSettings}>
                              <i className="fas fa-sliders" aria-hidden="true"></i>
                              {' '}
                              {t('plugins.button_settings')}
                            </Dropdown.Item>
                            {/* plugin logs */}
                            {plugin.isConfigured && !plugin.disabled && (
                              <Dropdown.Item as="button" type="button" onClick={viewPluginLog}>
                                <i className="fas fa-wave-square" aria-hidden="true"></i>
                                {' '}
                                {t('plugins.manage.plugin_logs')}
                              </Dropdown.Item>
                            )}
                            {/* plugin manage version */}
                            {plugin.publicPackage && (
                              <Dropdown.Item as="button" type="button" onClick={installAlternateVersion}>
                                <i className="fas fa-code-compare" aria-hidden="true"></i>
                                {' '}
                                {t('plugins.manage.manage_version')}
                              </Dropdown.Item>
                            )}
                            {/* plugin manage config json */}
                            {!isUi && (
                              <Dropdown.Item as="button" type="button" onClick={openJsonEditor}>
                                <i className="fas fa-code" aria-hidden="true"></i>
                                {' '}
                                {t('plugins.manage.json_config')}
                              </Dropdown.Item>
                            )}
                            {/* plugin disable, when enabled */}
                            {!isUi && !plugin.disabled && (
                              <Dropdown.Item as="button" type="button" onClick={() => void disablePlugin(plugin)}>
                                <i className="far fa-circle-pause" aria-hidden="true"></i>
                                {' '}
                                {t('plugins.manage.disable')}
                              </Dropdown.Item>
                            )}
                            {/* plugin enable, when disabled */}
                            {!isUi && plugin.disabled && (
                              <Dropdown.Item as="button" type="button" onClick={() => void enablePlugin(plugin)}>
                                <i className="far fa-circle-play" aria-hidden="true"></i>
                                {' '}
                                {t('plugins.manage.enable')}
                              </Dropdown.Item>
                            )}
                            {/* plugin uninstall */}
                            {!isUi && (
                              <Dropdown.Item as="button" type="button" onClick={uninstallPlugin}>
                                <i className="fas fa-trash" aria-hidden="true"></i>
                                {' '}
                                {t('plugins.button_uninstall')}
                              </Dropdown.Item>
                            )}
                            {!plugin.disabled
                              && plugin.isConfigured
                              && plugin.hasChildBridges
                              && plugin.installedVersion
                              && !isUi && (
                              <div className="dropdown-divider"></div>
                            )}
                            {plugin.hasChildBridges && !plugin.disabled && (
                              <>
                                {/* child bridge settings */}
                                <Dropdown.Item as="button" type="button" onClick={openBridgeSettings}>
                                  <i className="fas fa-bridge" aria-hidden="true"></i>
                                  {' '}
                                  {t('child_bridge.bridge_settings')}
                                </Dropdown.Item>
                                {/* child bridge restart */}
                                {!childBridgeRestartInProgress && (
                                  <Dropdown.Item as="button" type="button" onClick={() => void doChildBridgeAction('restart')}>
                                    <i className="icon-button fas fa-power-off" aria-hidden="true"></i>
                                    {' '}
                                    {t(restartKey)}
                                  </Dropdown.Item>
                                )}
                                {/* child bridge stop / start */}
                                {!allChildBridgesStopped
                                  ? (
                                      <Dropdown.Item as="button" type="button" onClick={() => void doChildBridgeAction('stop')}>
                                        <i className="fas fa-stop" aria-hidden="true"></i>
                                        {' '}
                                        {t(childBridges.length > 1 ? 'child_bridge.stop_plural' : 'child_bridge.stop')}
                                      </Dropdown.Item>
                                    )
                                  : (
                                      <Dropdown.Item as="button" type="button" onClick={() => void doChildBridgeAction('start')}>
                                        <i className="fas fa-play" aria-hidden="true"></i>
                                        {' '}
                                        {t(childBridges.length > 1 ? 'child_bridge.start_plural' : 'child_bridge.start')}
                                      </Dropdown.Item>
                                    )}
                                {/* child bridge reset */}
                                <Dropdown.Item as="button" type="button" onClick={resetChildBridges}>
                                  <i className="fas fa-broom" aria-hidden="true"></i>
                                  {' '}
                                  {t('child_bridge.reset_accessories')}
                                </Dropdown.Item>
                              </>
                            )}
                            {/* external accessories */}
                            {plugin.hasExternalAccessories && !plugin.disabled && (
                              <>
                                {!plugin.hasChildBridges && <div className="dropdown-divider"></div>}
                                <Dropdown.Item as="button" type="button" onClick={openExternalAccessories}>
                                  <i className="fas fa-qrcode" aria-hidden="true"></i>
                                  {' '}
                                  {t('external_accessories.menu_label')}
                                </Dropdown.Item>
                              </>
                            )}
                            {/* child bridge setup, when not recommended */}
                            {plugin.isConfigured
                              && !plugin.hasChildBridges
                              && !plugin.disabled
                              && !plugin.recommendChildBridge && (
                              <>
                                <div className="dropdown-divider"></div>
                                <Dropdown.Item as="button" type="button" onClick={openBridgeSettings}>
                                  <i className="icon-button fas fa-bridge" aria-hidden="true"></i>
                                  {' '}
                                  {t('child_bridge.setup')}
                                </Dropdown.Item>
                              </>
                            )}
                            {/* child bridge setup, edge case, when not configured, recommended, but update icon blocks setup */}
                            {plugin.isConfigured
                              && !plugin.hasChildBridges
                              && !plugin.disabled
                              && plugin.recommendChildBridge
                              && plugin.updateAvailable && (
                              <>
                                <div className="dropdown-divider"></div>
                                <Dropdown.Item as="button" type="button" onClick={openBridgeSettings}>
                                  <i className="icon-button fas fa-bridge" aria-hidden="true"></i>
                                  {' '}
                                  {t('child_bridge.setup')}
                                </Dropdown.Item>
                              </>
                            )}
                            {/* report an issue link */}
                            {plugin.links.bugs && (
                              <>
                                <div className="dropdown-divider"></div>
                                <Dropdown.Item rel="noopener noreferrer" target="_blank" href={plugin.links.bugs}>
                                  <i className="icon-button far fa-circle-question" aria-hidden="true"></i>
                                  {' '}
                                  {t('support.links.issue')}
                                </Dropdown.Item>
                              </>
                            )}
                          </Dropdown.Menu>
                        </Dropdown>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * One plugin's card. Memoised: the plugins page passes the same plugin and
 * child bridge objects until they change, so a card re-renders only for its own
 * plugin.
 */
export const PluginCard = memo(PluginCardComponent)
