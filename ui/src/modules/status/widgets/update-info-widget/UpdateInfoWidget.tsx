import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { KeyboardEvent, SyntheticEvent } from 'react'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useStore } from 'zustand'

import { useAuthStore } from '@/core/auth'
import { HbV2Modal } from '@/core/components/hb-v2-modal/HbV2Modal'
import { Information } from '@/core/components/information/Information'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { openModal } from '@/core/ui/modal'
import { cx } from '@/core/utilities/cx'
import { useNamespace } from '@/core/ws'
import { environment } from '@/environments/environment'

import { NodeVersionModal } from './node-version-modal/NodeVersionModal'
import {
  createUpdateInfoStore,
  getHomebridgeIconClass,
  getHomebridgeUiIconClass,
  getNodejsIconClass,
  getPluginsIconClass,
  selectUpdateAllCount,
} from './update-info.store'

import './update-info-widget.scss'

const MIDDOT = ' · '

/** Keep a press on a toolbar button from starting a grid drag. */
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

/**
 * The plugin manager (and the schema-form engine, ajv and lodash behind it) is
 * only needed once a button is clicked, so it is not part of the dashboard.
 */
async function loadManagePlugins() {
  return (await import('@/core/plugins/manage-plugins')).managePlugins
}

export function UpdateInfoWidget({ widget, saveWidgets }: WidgetProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => state.user.admin)
  const io = useNamespace('status')

  const [store] = useState(() => createUpdateInfoStore({
    getEnv: () => useSettingsStore.getState().env,
    setEnvItem: (key, value) => settingsActions.setEnvItem(key, value),
    isAdmin: !!isAdmin,
    isProduction: () => environment.production,
  }))
  const info = useStore(store)

  useEffect(() => {
    if (!io) {
      return undefined
    }
    return store.getState().connect(io)
  }, [store, io])

  const nodeVersionModal = (compareVersion: string): void => {
    openModal(NodeVersionModal, {
      nodeVersion: info.serverInfo!.nodeVersion,
      latestVersion: compareVersion,
      showNodeUnsupportedWarning: info.nodejsInfo!.showNodeUnsupportedWarning,
      homebridgeRunningInSynologyPackage: info.serverInfo!.homebridgeRunningInSynologyPackage,
      homebridgeRunningInDocker: info.serverInfo!.homebridgeRunningInDocker,
      homebridgePkg: info.homebridgePkg,
      architecture: info.nodejsInfo!.architecture,
      supportsNodeJs24: info.nodejsInfo!.supportsNodeJs24,
      statusIo: info.io,
      onUpdate: async () => {
        // Reload to refresh the widget display
        await info.getNodeInfo()
      },
    }, { size: 'lg', backdrop: 'static' })
  }

  const readyForV2Modal = (): void => {
    openModal(HbV2Modal, { isUpdating: false, skipIfCompatible: false }, { size: 'lg', backdrop: 'static' })
  }

  const installAlternateVersion = async (pkg: Plugin): Promise<void> => {
    const managePlugins = await loadManagePlugins()
    // A callback to refresh the widget when the version changes
    void managePlugins.installAlternateVersion(pkg, () => info.refreshAfterVersionChange(pkg))
  }

  const updatePackage = async (pkg: Plugin): Promise<void> => {
    const managePlugins = await loadManagePlugins()
    void managePlugins.upgradeHomebridge(pkg, pkg.latestVersion)
  }

  const toggleDockerExpand = (): void => {
    saveWidgets({ dockerExpanded: !widget.dockerExpanded })
  }

  const updateAllModal = async (): Promise<void> => {
    const managePlugins = await loadManagePlugins()
    const ref = await managePlugins.openUpdateAllModal()

    // A run that only restarts child bridges never disconnects the status
    // socket, so nothing else refreshes this widget - reload once the modal
    // is closed so completed updates stop showing as available.
    // On close only (not dismiss), and with the destroy guard: the 'handover'
    // close is followed by the server going down and this widget being
    // destroyed, and a reload taken then hangs on a socket whose ack never comes
    ref.result.then((reason) => {
      if (reason === 'handover' || info.isDestroyed()) {
        return
      }
      void info.loadAllData()
    }, () => {})
  }

  const dockerUpdateModal = (): void => {
    const dockerInfo = info.dockerInfo
    openModal(Information, {
      title: t('status.widget.info.docker_update_title'),
      message: t('status.widget.info.docker_update_message'),
      markdownMessage2: dockerInfo.latestReleaseBody,
      subtitle: (dockerInfo.currentVersion && dockerInfo.latestVersion)
        ? `${dockerInfo.currentVersion} &rarr; ${dockerInfo.latestVersion}`
        : t('accessories.control.unknown'),
      ctaButtonLabel: t('form.button_more_info'),
      faIconClass: 'fab fa-docker primary-text',
      ctaButtonLink: 'https://github.com/homebridge/docker-homebridge/wiki/How-To-Update-Docker-Homebridge',
    }, { size: 'lg', backdrop: 'static' })
  }

  const checking = <span className="grey-text small">{t('status.homebridge.checking')}</span>
  const updateButton = (onClick: () => void, label = t('plugins.button_update')) => (
    <button type="button" className="btn btn-link p-0 text-decoration-none primary-text small" onClick={onClick}>
      {label}
    </button>
  )

  const { homebridgePkg, homebridgeUiPkg, nodejsInfo, serverInfo } = info

  const homebridgeTile = (className: string) => (
    <div className={className}>
      <div className="d-flex ps-3 py-1">
        <div className="mb-0 d-flex align-items-center">
          <i aria-hidden="true" className={`fas fa-lg ${getHomebridgeIconClass(info)}`}></i>
        </div>
        <div className="align-self-center px-3">
          {homebridgePkg.installedVersion
            ? (
                <>
                  {isAdmin
                    ? (
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none card-link card-link-title"
                          onClick={() => void installAlternateVersion(homebridgePkg)}
                        >
                          Homebridge
                        </button>
                      )
                    : 'Homebridge'}
                  {info.isHbV2Loaded
                    && !info.isRunningHbV2
                    && isAdmin
                    && info.homebridgeUpdatePolicy !== 'none'
                    && info.homebridgeUpdatePolicy !== 'major'
                    && (
                      <HoverTooltip text={t('status.readiness.title', { app: 'Homebridge v2' })} placement="top">
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none ms-1"
                          aria-label={t('status.readiness.title', { app: 'Homebridge v2' })}
                          onClick={readyForV2Modal}
                        >
                          <i
                            className={cx('fas fa-info-circle', info.isHbV2Ready ? 'green-text' : 'orange-text')}
                            aria-hidden="true"
                          >
                          </i>
                        </button>
                      </HoverTooltip>
                    )}
                </>
              )
            : <span>Homebridge</span>}
          <br />
          {!homebridgePkg.installedVersion
            ? checking
            : (
                <>
                  <span className="grey-text small">{`v${info.homebridgeVersion}`}</span>
                  {homebridgePkg.multipleInstances && (
                    <>
                      {MIDDOT}
                      <a
                        className="orange-text small text-decoration-none"
                        href="https://homebridge.io/w/JJSgm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('status.homebridge.multiple_installs')}
                      </a>
                    </>
                  )}
                  {homebridgePkg.updateAvailable && isAdmin && (
                    <>
                      {MIDDOT}
                      {updateButton(() => void updatePackage(homebridgePkg))}
                    </>
                  )}
                </>
              )}
        </div>
      </div>
    </div>
  )

  const homebridgeUiTile = (className: string) => (
    <div className={className}>
      <div className="d-flex ps-3 py-1">
        <div className="mb-0 d-flex align-items-center">
          <i aria-hidden="true" className={`fas fa-lg ${getHomebridgeUiIconClass(info)}`}></i>
        </div>
        <div className="align-self-center px-3">
          {homebridgeUiPkg.installedVersion && isAdmin
            ? (
                <button
                  type="button"
                  className="btn btn-link p-0 text-decoration-none card-link card-link-title"
                  onClick={() => void installAlternateVersion(homebridgeUiPkg)}
                >
                  Homebridge Glass UI
                </button>
              )
            : <span>Homebridge Glass UI</span>}
          <br />
          {!homebridgeUiPkg.installedVersion
            ? checking
            : (
                <>
                  <span className="grey-text small">{`v${info.packageVersion}`}</span>
                  {homebridgeUiPkg.updateAvailable && isAdmin && (
                    <>
                      {MIDDOT}
                      {updateButton(() => void updatePackage(homebridgeUiPkg))}
                    </>
                  )}
                </>
              )}
        </div>
      </div>
    </div>
  )

  const nodeReady = info.nodejsStatusDone && !!serverInfo
  const nodeTile = (className: string) => (
    <div className={className}>
      <div className="d-flex ps-3 py-1">
        <div className="mb-0 d-flex align-items-center">
          <i aria-hidden="true" className={`fas fa-lg ${getNodejsIconClass(info)}`}></i>
        </div>
        <div className="align-self-center px-3">
          {nodeReady
            ? (
                <>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-decoration-none card-link card-link-title"
                    onClick={() => nodeVersionModal(serverInfo!.nodeVersion)}
                  >
                    Node.js
                  </button>
                  {widget.showNpmVersion && nodejsInfo?.npmVersion && `${MIDDOT}npm`}
                </>
              )
            : <span>Node.js</span>}
          <br />
          {!nodeReady
            ? checking
            : (
                <>
                  <span className="grey-text small">
                    {serverInfo!.nodeVersion}
                    {widget.showNpmVersion && nodejsInfo!.npmVersion && `${MIDDOT}${nodejsInfo!.npmVersion}`}
                  </span>
                  {nodejsInfo?.updateAvailable && isAdmin && (
                    <>
                      {MIDDOT}
                      {updateButton(() => nodeVersionModal(nodejsInfo.latestVersion))}
                    </>
                  )}
                  {nodejsInfo!.showNodeUnsupportedWarning && !nodejsInfo!.updateAvailable && (
                    <>
                      {MIDDOT}
                      {updateButton(() => nodeVersionModal(serverInfo!.nodeVersion), t('status.widget.info.node_unsupp'))}
                    </>
                  )}
                </>
              )}
        </div>
      </div>
    </div>
  )

  const onDockerKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      toggleDockerExpand()
    } else if (event.key === ' ') {
      event.preventDefault()
      toggleDockerExpand()
    }
  }

  const dockerChild = 'hb-status-item hb-status-item-docker-child d-flex flex-row py-1'
  const quarter = 'hb-status-item hb-status-item-quarter d-flex flex-row mb-1'

  return (
    <div className="hb-update-info-widget flex-column d-flex align-items-stretch h-100 w-100 pb-2">
      <div className="drag-handler p-2 d-flex align-items-center justify-content-between">
        <span>{t('status.services.updates')}</span>
        {isAdmin && selectUpdateAllCount(info) >= 2 && (
          <div className={cx('d-flex gap-1 widget-toolbar', widget.draggable && 'with-gear')}>
            <HoverTooltip text={t('update_all.title')} placement="bottom">
              <button
                type="button"
                className="widget-toolbar-button"
                aria-label={t('update_all.title')}
                onMouseDown={stopPropagation}
                onTouchStart={stopPropagation}
                onClick={() => void updateAllModal()}
              >
                <i className="fas fa-arrow-alt-circle-up" aria-hidden="true"></i>
              </button>
            </HoverTooltip>
          </div>
        )}
      </div>
      <div className="d-flex flex-wrap w-100 mt-1 justify-content-start gridster-item-content overflow-auto no-scrollbars align-items-start">
        {info.runningInDocker
          ? (
              <div className="hb-status-item hb-status-item-docker d-flex flex-column mb-1">
                <div
                  className="d-flex ps-3 py-1 align-items-center cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={widget.dockerExpanded ? 'true' : 'false'}
                  aria-controls="dockerExpandPanel"
                  onClick={toggleDockerExpand}
                  onKeyDown={onDockerKeyDown}
                >
                  <div className="mb-0 d-flex align-items-center">
                    {!info.dockerStatusDone
                      ? <i className="fas fa-lg fa-circle-notch fa-spin primary-text" aria-hidden="true"></i>
                      : info.dockerInfo.updateAvailable
                        ? <i className="fas fa-lg fa-arrow-alt-circle-up orange-text" aria-hidden="true"></i>
                        : <i className="fas fa-lg fa-check-circle green-text" aria-hidden="true"></i>}
                  </div>
                  <div className="align-self-center px-3">
                    Docker-Homebridge
                    {' '}
                    <i className={cx('fas fa-chevron-down ms-2', !widget.dockerExpanded && 'fa-rotate-180')} aria-hidden="true"></i>
                    <br />
                    {!info.dockerStatusDone
                      ? checking
                      : (
                          <>
                            <span className="grey-text small">{info.dockerInfo.currentVersion}</span>
                            {info.dockerInfo.updateAvailable && isAdmin && (
                              <>
                                {MIDDOT}
                                <button
                                  type="button"
                                  className="btn btn-link p-0 text-decoration-none primary-text small"
                                  onClick={dockerUpdateModal}
                                >
                                  {t('plugins.button_update')}
                                </button>
                              </>
                            )}
                          </>
                        )}
                  </div>
                </div>
                {widget.dockerExpanded && (
                  <div id="dockerExpandPanel" className="ps-5 pe-3 d-flex flex-wrap">
                    {homebridgeTile(dockerChild)}
                    {homebridgeUiTile(dockerChild)}
                    {nodeTile(dockerChild)}
                  </div>
                )}
              </div>
            )
          : (
              <>
                {homebridgeTile(quarter)}
                {homebridgeUiTile(quarter)}
              </>
            )}
        {/* Plugins */}
        <div className={quarter}>
          <div className="d-flex ps-3 py-1">
            <div className="mb-0 d-flex align-items-center">
              <i aria-hidden="true" className={`fas fa-lg ${getPluginsIconClass(info)}`}></i>
            </div>
            <div className="align-self-center px-3">
              <Link to="/plugins" className="card-link card-link-title">
                {t('menu.label_plugins')}
              </Link>
              <br />
              {!info.homebridgePluginStatusDone
                ? checking
                : !info.homebridgePluginStatus.length
                    ? <span className="grey-text small">{t('status.homebridge.up_to_date')}</span>
                    : isAdmin
                      ? <Link to="/plugins" className="primary-text small">{t('plugins.button_update')}</Link>
                      : <span className="grey-text small">{t('plugins.button_update')}</span>}
            </div>
          </div>
        </div>
        {!info.runningInDocker && nodeTile(quarter)}
      </div>
    </div>
  )
}
