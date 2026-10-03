import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginBridgeModalData } from '@/core/ui/modal-data'

import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { getHapNameValidationError, selectHasValidationErrors, selectValidationErrorBridgeName } from '@/core/plugins/plugin-bridge/plugin-bridge.hap'
import { linkChildBridges } from '@/core/plugins/plugin-bridge/plugin-bridge.state'
import { PluginBridgeAdvanced } from '@/core/plugins/plugin-bridge/PluginBridgeAdvanced'
import { PluginBridgeHap } from '@/core/plugins/plugin-bridge/PluginBridgeHap'
import { PluginBridgeMatter } from '@/core/plugins/plugin-bridge/PluginBridgeMatter'
import { usePluginBridge } from '@/core/plugins/plugin-bridge/usePluginBridge'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { cx } from '@/core/utilities/cx'

import './plugin-bridge.scss'

export type PluginBridgeProps = PluginBridgeModalData & ModalComponentProps

/**
 * The child bridge modal: whether a plugin (or one of its config blocks) runs
 * in its own child bridge, and that bridge's HAP and Matter settings.
 */
export function PluginBridge({ activeModal, ...data }: PluginBridgeProps) {
  const { t } = useTranslation()
  const store = usePluginBridge(data, activeModal)
  const actions = store.getState()

  const plugin = useStore(store, s => s.plugin)
  const justInstalled = useStore(store, s => s.justInstalled)
  const loading = useStore(store, s => s.loading)
  const canConfigure = useStore(store, s => s.canConfigure)
  const saveInProgress = useStore(store, s => s.saveInProgress)
  const configBlocks = useStore(store, s => s.configBlocks)
  const sel = useStore(store, s => s.selectedBlock)
  const idx = Number(sel)
  const block = configBlocks[idx]
  const bridge = block?._bridge
  const enabled = useStore(store, s => s.enabledBlocks[idx])
  const hapEnabled = useStore(store, s => s.hapEnabledBlocks[idx])
  const link = useStore(store, s => s.currentlySelectedLink)
  const hasLinks = useStore(store, s => s.currentBridgeHasLinks)
  const showAdvanced = useStore(store, s => s.showAdvanced)
  const deleteBridges = useStore(store, s => s.deleteBridges)
  const deleteMatterBridges = useStore(store, s => s.deleteMatterBridges)
  const deletingPairedBridge = useStore(store, s => s.deletingPairedBridge)
  const deviceInfo = useStore(store, s => s.deviceInfo)
  const originalBridgesCount = useStore(store, s => s.originalBridges.length)
  const availableForLink = useStore(store, s => s.bridgesAvailableForLink)
  const hideChildBridgeSetup = useStore(store, s => s.hideChildBridgeSetup)
  const isMatterOnlyPlugin = useStore(store, s => s.isMatterOnlyPlugin)
  const isMatterSupported = useStore(store, s => s.isMatterSupported)
  const nameError = useStore(store, s => !!s.configBlocks[Number(s.selectedBlock)]?._bridge?.name && getHapNameValidationError(s, s.selectedBlock))
  const validationErrorBridgeName = useStore(store, selectValidationErrorBridgeName)
  const hasValidationErrors = useStore(store, selectHasValidationErrors)
  const invalidBridge = canConfigure && !justInstalled && validationErrorBridgeName

  const toggleAdvanced = () => actions.toggleAdvanced()
  const setBridgeField = actions.setBridgeField

  return (
    <div className="modal-content hb-plugin-bridge">
      <ModalHeader
        title={plugin.displayName || plugin.name}
        onClose={() => actions.closeModal()}
        closeDisabled={saveInProgress}
        hideClose={justInstalled}
      />
      <div className="modal-body">
        {loading
          ? (
              <div className="text-center primary-text my-5 w-100">
                <InlineSpinner className="icon-xl" />
              </div>
            )
          : (
              <>
                <div className="text-center">
                  <img
                    alt=""
                    aria-hidden="true"
                    className="mb-3 plugin-icon-card"
                    src={plugin.icon}
                    onError={() => actions.handleIconError()}
                  />
                </div>
                <ul className="mb-3">
                  <SafeHtml as="li" html={t('child_bridge.about', { link: linkChildBridges(t('child_bridge.link_wiki')) })} />
                  {!!configBlocks.length && (
                    <>
                      <li>{t('child_bridge.bridges_paired')}</li>
                      {configBlocks.length === 1
                        && !deviceInfo.get(configBlocks[0]._bridge?.username)
                        && originalBridgesCount === 0
                        && <li>{t('child_bridge.bridges_paired_2')}</li>}
                    </>
                  )}
                </ul>
                {canConfigure && !!configBlocks.length && (
                  <>
                    {configBlocks.length > 1 && (
                      <ul className="list-group list-group-box mb-0">
                        <li className="list-group-item text-center grey-text small">{t('form.label.changes_kept')}</li>
                        <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                          <label htmlFor="bridgeSelect" className="mb-2 mb-md-0 w-100 w-md-50">
                            {t('accessories.plugin')}
                          </label>
                          <div className="text-start text-md-end w-100 w-md-50">
                            <select
                              className="custom-select"
                              id="bridgeSelect"
                              value={sel}
                              onChange={(event) => {
                                actions.onBlockChange(event.target.value)
                              }}
                            >
                              {configBlocks.map((b, i) => (
                                // eslint-disable-next-line react/no-array-index-key -- the blocks are identified by position, as `track block` / $index did
                                <option key={i} value={String(i)}>{b.name || b.platform || b.accessory}</option>
                              ))}
                            </select>
                          </div>
                        </li>
                      </ul>
                    )}
                    {/* CHILD BRIDGE SECTION */}
                    <ul className="list-group list-group-box mt-3 mb-0">
                      {/* Link Bridge Option */}
                      {!bridge?.username && !!availableForLink.length && !hasLinks && (
                        <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                          <label htmlFor="bridgeLink" className="mb-2 mb-md-0 w-100 w-md-50">
                            {t('child_bridge.config.or_link')}
                          </label>
                          <div className="text-start text-md-end w-100 w-md-50">
                            <select
                              className="custom-select"
                              id="bridgeLink"
                              defaultValue=""
                              onChange={event => actions.onLinkBridgeChange(event.target.value)}
                            >
                              <option value="">{t('child_bridge.config.select_existing')}</option>
                              {availableForLink.map(available => (
                                <option key={available.username} value={available.username}>
                                  {available.name ? `${available.name} · ${available.username}` : available.username}
                                </option>
                              ))}
                            </select>
                          </div>
                        </li>
                      )}

                      {/* Child Bridge Toggle */}
                      {hasLinks
                        ? (
                            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                              <span className="mb-2 mb-md-0 w-100 w-md-50">{t('child_bridge.config.use')}</span>
                              <div className="text-start text-md-end w-100 w-md-50 grey-text">
                                {t('child_bridge.config.prevent')}
                              </div>
                            </li>
                          )
                        : (
                            <>
                              <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
                                <span className="text-start">
                                  {t(link ? 'child_bridge.config.or_link' : 'child_bridge.config.use')}
                                </span>
                                <div className="text-end grey-text d-flex align-items-center">
                                  <input
                                    type="checkbox"
                                    className="rendux-input"
                                    id={`toggleExternalBridgeInput_${sel}`}
                                    checked={!!enabled}
                                    onChange={() => void actions.toggleExternalBridge(block, !enabled, sel)}
                                  />
                                  <label className="rendux-label" aria-hidden="true" htmlFor={`toggleExternalBridgeInput_${sel}`}></label>
                                </div>
                              </li>
                              {!justInstalled && !enabled && !link && (
                                <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
                                  <span className="text-start">
                                    {t('child_bridge.config.hide_setup_recommendation')}
                                  </span>
                                  <div className="text-end grey-text d-flex align-items-center">
                                    <input
                                      type="checkbox"
                                      className="rendux-input"
                                      id="toggleHideChildBridgeSetupInput"
                                      checked={hideChildBridgeSetup}
                                      onChange={() => actions.toggleHideChildBridgeSetup()}
                                    />
                                    <label className="rendux-label" aria-hidden="true" htmlFor="toggleHideChildBridgeSetupInput"></label>
                                  </div>
                                </li>
                              )}
                            </>
                          )}
                      {link && (
                        <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                          <span className="mb-2 mb-md-0 w-100 w-md-50">{t('child_bridge.config.name')}</span>
                          <div className="text-start text-md-end w-100 w-md-50 grey-text font-monospace">
                            {link.name}
                          </div>
                        </li>
                      )}

                      {/* Username Display (shown for both linked and enabled bridges) */}
                      {(link || bridge?.username) && (link || !hasLinks) && (
                        <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                          <span className="mb-2 mb-md-0 w-100 w-md-50">{t('users.label_username')}</span>
                          <div className="text-start text-md-end w-100 w-md-50 grey-text font-monospace">
                            {link?.username || bridge?.username}
                          </div>
                        </li>
                      )}
                      {link && (
                        <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                          <span className="mb-2 mb-md-0 w-100 w-md-50">{t('child_bridge.config.port')}</span>
                          <div className="text-start text-md-end w-100 w-md-50 grey-text font-monospace">
                            {link.port}
                          </div>
                        </li>
                      )}

                      {/* Name Field (shown only for enabled bridges, not linked) */}
                      {!link && bridge?.username && (
                        <>
                          <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                            <label htmlFor="bridge-name" className="mb-2 mb-md-0 w-100 w-md-50">
                              {t('child_bridge.config.name')}
                            </label>
                            <div className="text-start text-md-end w-100 w-md-50">
                              <input
                                id="bridge-name"
                                type="text"
                                className={cx('form-control custom-input', nameError && 'is-invalid')}
                                value={bridge.name ?? ''}
                                onChange={event => setBridgeField('name', event.target.value)}
                              />
                              {nameError && (
                                <div className="invalid-feedback d-block">
                                  {t('child_bridge.config.name_invalid')}
                                </div>
                              )}
                            </div>
                          </li>
                          <li
                            role="button"
                            tabIndex={0}
                            className="list-group-item d-flex justify-content-between align-items-center flex-row cursor-pointer"
                            aria-expanded={showAdvanced ? 'true' : 'false'}
                            onClick={toggleAdvanced}
                            onKeyUp={(event) => {
                              if (event.key === 'Enter') {
                                toggleAdvanced()
                              }
                            }}
                          >
                            <span className="text-start">{t('common.labels.advanced')}</span>
                            <i aria-hidden="true" className={cx('fa grey-text', showAdvanced ? 'fa-chevron-down' : 'fa-chevron-left')}></i>
                          </li>
                          {showAdvanced && <PluginBridgeAdvanced store={store} />}
                        </>
                      )}
                    </ul>

                    {/* HOMEKIT (HAP) SECTION - Only shown when child bridge is enabled */}
                    {!link && bridge?.username && (
                      <>
                        {/*
                          The HAP options are hidden entirely for a matter-only plugin (#3975): it
                          publishes nothing over HAP, so they have no meaning. Still shown if HAP
                          somehow ended up enabled on such a bridge, so it can always be turned off.
                          This condition must wrap only the HAP section — the matter section is a
                          sibling inside the same block, and putting it on the outer condition hid that too.
                        */}
                        {(!isMatterOnlyPlugin || hapEnabled) && <PluginBridgeHap store={store} />}

                        {/* MATTER SECTION - Only shown when child bridge is enabled and plugin is platform-based */}
                        {isMatterSupported && !block.accessory && <PluginBridgeMatter store={store} />}
                      </>
                    )}
                  </>
                )}
                {(!!deleteBridges.length || !!deleteMatterBridges.length) && (
                  // <ngb-alert type="error" [dismissible]="false">
                  <div role="alert" className="mt-3 mb-0 alert show alert-error fade">
                    <p>
                      {t('child_bridge.confirm_delete_1')}
                      {deletingPairedBridge && (
                        <>
                          {' '}
                          {t('child_bridge.confirm_delete_2')}
                        </>
                      )}
                    </p>
                    <div className="text-center">
                      <ul className="d-inline-block text-start mb-0">
                        {deleteBridges.map(deleted => (
                          <li key={`hap-${deleted.id}`}>
                            <i aria-hidden="true" className="fas fa-lg fa-hap me-1"></i>
                            {' '}
                            {deleted.bridgeName || (deviceInfo.get(deleted.id) || undefined)?.displayName}
                            <span className="grey-text"> · </span>
                            <span className="grey-text font-monospace">{deleted.id}</span>
                          </li>
                        ))}
                        {deleteMatterBridges.map(matterBridge => (
                          <li key={`matter-${matterBridge.identifier}`}>
                            <i aria-hidden="true" className="fas fa-lg fa-matter me-1"></i>
                            {' '}
                            {matterBridge.name}
                            <span className="grey-text"> · </span>
                            <span className="grey-text font-monospace">{matterBridge.username}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {!configBlocks.length && canConfigure && (
                  <div role="alert" className="alert show alert-info fade">{t('child_bridge.must_configure_plugin')}</div>
                )}
                {!canConfigure && (
                  <div role="alert" className="mb-0 alert show alert-info fade">
                    <div className="mb-3">
                      {t('plugins.settings.message_manual_config_required')}
                      {' '}
                      {t('plugins.settings.message_consult_documentation')}
                    </div>
                    <button className="btn btn-primary mb-0" type="button" onClick={() => actions.openFullConfigEditor()}>
                      {t('plugins.settings.label_open_config_editor')}
                    </button>
                  </div>
                )}
              </>
            )}
      </div>
      <ModalFooter>
        {invalidBridge && (
          <div className="w-100 text-center small text-danger mb-1">
            <i aria-hidden="true" className="fas fa-fw fa-triangle-exclamation me-1"></i>
            {t('child_bridge.config.validation_blocking', { name: invalidBridge })}
          </div>
        )}
        <div className="text-start">
          {canConfigure && !justInstalled && (
            <button
              type="button"
              className="btn btn-elegant"
              data-bs-dismiss="modal"
              disabled={saveInProgress}
              onClick={() => actions.closeModal()}
            >
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {justInstalled && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveInProgress || hasValidationErrors}
              onClick={() => void actions.save()}
            >
              {t('form.button_save')}
              {saveInProgress && (
                <>
                  {' '}
                  <i aria-hidden="true" className="fas fa-circle-notch fa-spin"></i>
                </>
              )}
            </button>
          )}
          {!canConfigure && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={() => actions.closeModal()}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {canConfigure && !justInstalled && (
            configBlocks.length
              ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saveInProgress || loading || hasValidationErrors}
                    onClick={() => void actions.save()}
                  >
                    {!saveInProgress
                      ? t('form.button_save')
                      : <InlineSpinner />}
                  </button>
                )
              : (
                  <button type="button" className="btn btn-primary" data-bs-dismiss="modal" onClick={() => actions.openPluginConfig()}>
                    {t('plugins.button_settings')}
                  </button>
                )
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
