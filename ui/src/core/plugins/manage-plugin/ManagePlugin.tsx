import type { ModalComponentProps, ModalRef } from '@/core/ui/modal'
import type { ManagePluginModalData } from '@/core/ui/modal-data'

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useStore } from 'zustand'

import { UpdateRiskBriefing } from '@/core/ai/update-risk/UpdateRiskBriefing'
import { createManagePluginStore, isOnlineUpdateOk, pastTenseKey } from '@/core/plugins/manage-plugin/manage-plugin.store'
import { ChangelogPane, ReleaseNotesPane } from '@/core/plugins/manage-plugin/ReleaseNotesPanes'
import { determineSupportMessage, SELF_PACKAGES } from '@/core/plugins/manage-plugin/support-message'
import { useManagePluginTerminal } from '@/core/plugins/manage-plugin/use-manage-plugin-terminal'
import { ManageVersion } from '@/core/plugins/manage-version/ManageVersion'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { cx } from '@/core/utilities/cx'

import './manage-plugin.scss'

const ICONS = {
  iconStar: '<i class="fas fa-star orange-text"></i>',
  iconThumbsUp: '<i class="fas fa-thumbs-up orange-text"></i>',
  iconCoffee: '<i class="fas fa-coffee pink-text"></i>',
  iconHeart: '<i class="fas fa-heart pink-text"></i>',
}

const open = openModal as (component: unknown, props: Record<string, any>, options?: Record<string, any>) => ModalRef

export type ManagePluginProps = ManagePluginModalData & ModalComponentProps

/**
 * The one modal in the app that runs npm: install, uninstall and update, with
 * the live npm output in an xterm (ManagePluginComponent). The state and the
 * npm actions live in `manage-plugin.store.ts`; the terminal in
 * `useManagePluginTerminal`.
 */
export function ManagePlugin(props: ManagePluginProps) {
  const { activeModal, pluginName, action } = props
  const pluginDisplayName = props.pluginDisplayName ?? ''
  const targetVersion = props.targetVersion ?? ''
  const latestVersion = props.latestVersion ?? ''
  const installedVersion = props.installedVersion ?? ''
  const isDisabled = props.isDisabled ?? false
  const initialIsConfigured = props.isConfigured ?? false
  const onRefreshPluginList = props.onRefreshPluginList ?? (() => {})
  const verifiedPlugin = props.verifiedPlugin ?? false
  const verifiedPlusPlugin = props.verifiedPlusPlugin ?? false
  const funding = props.funding ?? null
  const backToVersionModal = props.backToVersionModal ?? null

  const { t } = useTranslation()
  const navigate = useNavigate()
  const platform = useSettingsStore(state => state.env.platform)
  const isLightTerminalTheme = useSettingsStore(() => settingsActions.getEffectiveTerminalLightingMode()) === 'light'

  const onlineUpdateOk = isOnlineUpdateOk(pluginName, platform)

  const [store] = useState(() => createManagePluginStore({
    action,
    pluginName,
    pluginDisplayName,
    targetVersion,
    latestVersion,
    installedVersion,
    isConfigured: initialIsConfigured,
    onRefreshPluginList,
    close: result => activeModal.close(result),
    navigate: path => void navigate(path),
  }))
  const {
    targetVersionPretty,
    actionComplete,
    actionFailed,
    justUpdatedPlugin,
    childBridges,
    versionNotes,
    versionNotesLoaded,
    versionNotesShow,
    fullChangelog,
    fullChangelogLoaded,
    releaseNotesShow,
    downloadingBackup,
    releaseNotesTab,
    actionLiveMessage,
    terminalAriaHidden,
    setReleaseNotesTab,
    update,
    onRestartHomebridgeClick,
    onRestartChildBridgeClick,
    downloadLogFile,
    downloadBackupFile,
  } = useStore(store)
  const [{ supportMessageKey, donationLink }] = useState(() => determineSupportMessage(pluginName, verifiedPlugin || verifiedPlusPlugin, funding))

  const termTargetRef = useRef<HTMLDivElement>(null)
  useManagePluginTerminal(store, termTargetRef)

  const pastTenseVerbKey = pastTenseKey(action, targetVersion, installedVersion)
  const pastTenseVerb = pastTenseVerbKey ? t(pastTenseVerbKey) : ''

  function dismissModal(): void {
    activeModal.dismiss('Dismiss')
  }

  async function goBack(): Promise<void> {
    // Close current modal and reopen the version picker
    activeModal.dismiss('Back')

    const ref = open(ManageVersion, {
      plugin: backToVersionModal,
      onRefreshPluginList,
    }, { size: 'lg', backdrop: 'static' })

    try {
      const { action: versionAction, version } = await ref.result

      // Reopen the manage plugin modal with the selected version
      open(ManagePlugin, {
        action: versionAction === 'alternate' ? 'Update' : 'Install',
        pluginName,
        pluginDisplayName,
        targetVersion: version,
        latestVersion,
        installedVersion,
        isDisabled,
        isConfigured: initialIsConfigured,
        onRefreshPluginList,
        verifiedPlugin,
        verifiedPlusPlugin,
        funding,
        backToVersionModal,
      }, { size: 'lg', backdrop: 'static' })
    } catch {
      // Modal was dismissed, do nothing
    }
  }

  const showBack = backToVersionModal && !actionComplete
  const closeOrBackLabel = t(showBack ? 'form.button_back' : 'form.button_close')

  const tabs = [
    {
      id: 1,
      label: t('plugins.manage.notes'),
      pane: (
        <ReleaseNotesPane
          loading={action === 'Update' && !versionNotesLoaded}
          notes={versionNotes}
          showNone={versionNotesShow}
          targetVersion={targetVersion}
          pluginDisplayName={pluginDisplayName}
        />
      ),
    },
    {
      id: 2,
      label: t('plugins.manage.changelog'),
      pane: <ChangelogPane loading={action === 'Update' && !fullChangelogLoaded} changelog={fullChangelog} />,
    },
  ]

  return (
    <div className={cx('modal-content hb-manage-plugin', isLightTerminalTheme && 'terminal-light-theme')}>
      <ModalHeader title={pluginDisplayName} onClose={dismissModal} />
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {actionLiveMessage}
      </span>
      <div
        ref={termTargetRef}
        id="plugin-log-output"
        className={cx('modal-body', isLightTerminalTheme ? 'terminal-light-bg' : 'terminal-dark-bg')}
        hidden={!onlineUpdateOk || actionComplete || releaseNotesShow}
        aria-hidden={terminalAriaHidden ? 'true' : undefined}
      >
      </div>
      {actionComplete && (
        <div className="modal-body plugin-modal-body" role="status" aria-live="polite" aria-atomic="true">
          {justUpdatedPlugin && (
            <>
              <div className="mb-3 text-center">
                <i className="far fa-check-circle primary-text icon-xl" aria-hidden="true"></i>
              </div>
              <h5 className="text-center mb-3">
                {pastTenseVerb}
                :
                {' '}
                {pluginDisplayName}
                {' '}
                (
                {targetVersionPretty}
                )
              </h5>
              {!isDisabled && (
                <>
                  <SafeHtml
                    as="p"
                    className="mb-3 text-center grey-text"
                    html={t(supportMessageKey, { ...ICONS, link: donationLink })}
                  />
                  {childBridges.length === 0
                    ? <p className="text-center mb-0">{t('plugins.settings.restart_required')}</p>
                    : <p className="text-center mb-0">{t('restart.child_bridges')}</p>}
                </>
              )}
            </>
          )}
        </div>
      )}
      {!onlineUpdateOk && (
        <div className="modal-body">
          <div className="mb-3 text-center">
            <i
              className={cx(
                'fas primary-text icon-xl',
                action === 'Install' && 'fa-arrow-alt-circle-down',
                action === 'Update' && installedVersion && 'fa-code-compare',
                action === 'Update' && !installedVersion && 'fa-arrow-alt-circle-up',
                action === 'Uninstall' && 'fa-trash',
              )}
              aria-hidden="true"
            >
            </i>
          </div>
          <ul className="mb-3">
            <li>{t('plugins.manage.online_updates')}</li>
            <li>{t('plugins.manage.manual_update_command')}</li>
          </ul>
          <pre className="p-2 mb-0">
            {`hb-service stop
npm install -g ${pluginName}@${targetVersion}
hb-service start`}
          </pre>
        </div>
      )}
      {releaseNotesShow && !actionComplete && onlineUpdateOk && (
        <div className="modal-body plugin-modal-body">
          <div className="mb-3 text-center">
            <i
              className={cx(
                'far primary-text icon-xl',
                action === 'Install' && !installedVersion && 'fa-arrow-alt-circle-down',
                action === 'Install' && installedVersion && 'fa-code-compare',
                action === 'Update' && 'fa-arrow-alt-circle-up',
                action === 'Uninstall' && 'fa-trash',
              )}
              aria-hidden="true"
            >
            </i>
          </div>
          {latestVersion && (
            <h5 className="mb-4 text-center">
              {installedVersion && (
                <span>
                  v
                  {installedVersion}
                  {' '}
                  &rarr;
                  {' '}
                </span>
              )}
              {targetVersionPretty}
            </h5>
          )}
          {action === 'Update' && installedVersion && !SELF_PACKAGES.includes(pluginName) && (
            <UpdateRiskBriefing pluginName={pluginName} currentVersion={installedVersion} targetVersion={targetVersion || undefined} />
          )}
          <ul className="nav-tabs px-0 nav" role="tablist">
            {tabs.map(tab => (
              <li key={tab.id} className="w-50 m-0 nav-item" role="presentation">
                <button
                  type="button"
                  className={cx('w-100 release-tab nav-link', releaseNotesTab === tab.id && 'active')}
                  role="tab"
                  id={`manage-plugin-nav-${tab.id}`}
                  aria-controls={`manage-plugin-nav-${tab.id}-panel`}
                  aria-selected={releaseNotesTab === tab.id}
                  onClick={() => setReleaseNotesTab(tab.id)}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 tab-content">
            {tabs.filter(tab => tab.id === releaseNotesTab).map(tab => (
              <div
                key={tab.id}
                className="tab-pane active"
                role="tabpanel"
                id={`manage-plugin-nav-${tab.id}-panel`}
                aria-labelledby={`manage-plugin-nav-${tab.id}`}
              >
                {tab.pane}
              </div>
            ))}
          </div>

          {SELF_PACKAGES.includes(pluginName) && (
            <div className="mt-4 mb-0">
              <p className="w-100 text-center mb-1 small">
                <span className="grey-text">{t('plugins.manage.backup')}</span>
                {downloadingBackup
                  ? <span className="mx-1"><i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i></span>
                  : (
                      <button
                        type="button"
                        className="btn btn-link p-0 align-baseline text-decoration-none"
                        aria-label={t('form.button_download')}
                        onClick={() => void downloadBackupFile()}
                      >
                        <i className="fas fa-download mx-1" aria-hidden="true"></i>
                      </button>
                    )}
              </p>
              <p className="w-100 text-center mb-0 small grey-text">{t('plugins.manage.hb_restart')}</p>
            </div>
          )}
        </div>
      )}
      {(!onlineUpdateOk || actionComplete || releaseNotesShow || actionFailed) && (
        <ModalFooter>
          <div className="text-start">
            {((!justUpdatedPlugin && onlineUpdateOk) || (justUpdatedPlugin && (!isDisabled || actionFailed))) && (
              <button
                type="button"
                className="btn btn-elegant"
                data-bs-dismiss="modal"
                aria-label={closeOrBackLabel}
                onClick={() => (showBack ? void goBack() : dismissModal())}
              >
                {closeOrBackLabel}
              </button>
            )}
          </div>
          <div className="text-center">
            {((justUpdatedPlugin && isDisabled && !actionFailed) || !onlineUpdateOk) && (
              <button
                type="button"
                className="btn btn-elegant"
                data-bs-dismiss="modal"
                aria-label={t('form.button_close')}
                onClick={dismissModal}
              >
                {t('form.button_close')}
              </button>
            )}
          </div>
          <div className="text-end">
            {onlineUpdateOk && releaseNotesShow && (
              <button type="button" className="btn btn-primary" onClick={update}>
                {t('form.button_continue')}
              </button>
            )}
            {justUpdatedPlugin && !isDisabled && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => (childBridges.length > 0 ? void onRestartChildBridgeClick() : onRestartHomebridgeClick())}
              >
                {t('menu.tooltip_restart')}
              </button>
            )}
            {actionFailed && (
              <button type="button" className="btn btn-primary" onClick={downloadLogFile}>
                {t('form.button_download')}
              </button>
            )}
          </div>
        </ModalFooter>
      )}
    </div>
  )
}
