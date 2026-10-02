import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginBridgeModalData } from '@/core/ui/modal-data'

import { useTranslation } from 'react-i18next'

import { PluginBridgeHap } from '@/core/plugins/plugin-bridge/PluginBridgeHap'
import { PluginBridgeMatter } from '@/core/plugins/plugin-bridge/PluginBridgeMatter'
import { PluginBridgeSchedule } from '@/core/plugins/plugin-bridge/PluginBridgeSchedule'
import { usePluginBridge } from '@/core/plugins/plugin-bridge/usePluginBridge'
import { SafeHtml } from '@/core/ui/SafeHtml'

import './plugin-bridge.scss'

export type PluginBridgeProps = PluginBridgeModalData & ModalComponentProps

/**
 * The child bridge modal: whether a plugin (or one of its config blocks) runs
 * in its own child bridge, and that bridge's HAP and Matter settings.
 */
export function PluginBridge({ activeModal, ...data }: PluginBridgeProps) {
  const { t } = useTranslation()
  const ctrl = usePluginBridge(data, activeModal)

  const plugin = ctrl.plugin
  const justInstalled = ctrl.justInstalled
  const loading = ctrl.loading()
  const canConfigure = ctrl.canConfigure()
  const saveInProgress = ctrl.saveInProgress()
  const configBlocks = ctrl.configBlocks()
  const sel = ctrl.selectedBlock()
  const idx = Number(sel)
  const block = configBlocks[idx]
  const bridge = block?._bridge
  const enabled = ctrl.enabledBlocks()[idx]
  const link = ctrl.currentlySelectedLink()
  const hasLinks = ctrl.currentBridgeHasLinks()
  const showAdvanced = ctrl.showAdvanced()
  const deleteBridges = ctrl.deleteBridges()
  const deleteMatterBridges = ctrl.deleteMatterBridges()
  const invalidBridge = canConfigure && !justInstalled && ctrl.validationErrorBridgeName
  const hasValidationErrors = ctrl.hasValidationErrors

  const toggleAdvanced = () => ctrl.showAdvanced.set(!showAdvanced)

  /** Write one field of the selected block's bridge, as `[(ngModel)]` did. */
  const setBridgeField = (field: string, value: unknown) => {
    bridge[field] = value
    ctrl.notify()
  }
  const setBridgeEnv = (field: 'DEBUG' | 'NODE_OPTIONS', value: string) => {
    bridge.env ??= {}
    bridge.env[field] = value
    ctrl.notify()
  }

  return (
    <div className="modal-content hb-plugin-bridge">
      <div className="modal-header">
        <h5 className="modal-title">{plugin.displayName || plugin.name}</h5>
        {!justInstalled && (
          <button
            type="button"
            className="btn-close"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            disabled={saveInProgress}
            onClick={() => ctrl.closeModal()}
          >
          </button>
        )}
      </div>
      <div className="modal-body">
        {loading
          ? (
              <div className="text-center primary-text my-5 w-100">
                <i aria-hidden="true" className="fas fa-circle-notch fa-spin icon-xl"></i>
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
                    onError={() => ctrl.handleIconError()}
                  />
                </div>
                <ul className="mb-3">
                  <SafeHtml as="li" html={t('child_bridge.about', { link: ctrl.linkChildBridges(t('child_bridge.link_wiki')) })} />
                  {!!configBlocks.length && (
                    <>
                      <li>{t('child_bridge.bridges_paired')}</li>
                      {configBlocks.length === 1
                        && !ctrl.deviceInfo().get(configBlocks[0]._bridge?.username)
                        && ctrl.originalBridges().length === 0
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
                                ctrl.selectedBlock.set(event.target.value)
                                ctrl.onBlockChange(event.target.value)
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
                      {!bridge?.username && !!ctrl.bridgesAvailableForLink().length && !hasLinks && (
                        <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                          <label htmlFor="bridgeLink" className="mb-2 mb-md-0 w-100 w-md-50">
                            {t('child_bridge.config.or_link')}
                          </label>
                          <div className="text-start text-md-end w-100 w-md-50">
                            <select
                              className="custom-select"
                              id="bridgeLink"
                              defaultValue=""
                              onChange={event => ctrl.onLinkBridgeChange(event.target.value)}
                            >
                              <option value="">{t('child_bridge.config.select_existing')}</option>
                              {ctrl.bridgesAvailableForLink().map(available => (
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
                                    onChange={() => void ctrl.toggleExternalBridge(block, !enabled, sel)}
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
                                      checked={ctrl.hideChildBridgeSetup()}
                                      onChange={() => ctrl.toggleHideChildBridgeSetup()}
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
                                className={`form-control custom-input${ctrl.getHapNameValidationError(sel) ? ' is-invalid' : ''}`}
                                value={bridge.name ?? ''}
                                onChange={event => setBridgeField('name', event.target.value)}
                              />
                              {ctrl.getHapNameValidationError(sel) && (
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
                            <i aria-hidden="true" className={`fa grey-text${showAdvanced ? ' fa-chevron-down' : ' fa-chevron-left'}`}></i>
                          </li>
                          {showAdvanced && (
                            <>
                              <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                                <label htmlFor="bridge-manufacturer" className="mb-2 mb-md-0 w-100 w-md-50">
                                  {t('child_bridge.config.manufacturer')}
                                </label>
                                <div className="text-start text-md-end w-100 w-md-50">
                                  <input
                                    id="bridge-manufacturer"
                                    type="text"
                                    className="form-control custom-input"
                                    placeholder={t('form.optional')}
                                    value={bridge.manufacturer ?? ''}
                                    onChange={event => setBridgeField('manufacturer', event.target.value)}
                                  />
                                </div>
                              </li>
                              <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                                <label htmlFor="bridge-model" className="mb-2 mb-md-0 w-100 w-md-50">
                                  {t('child_bridge.config.model')}
                                </label>
                                <div className="text-start text-md-end w-100 w-md-50">
                                  <input
                                    id="bridge-model"
                                    type="text"
                                    className="form-control custom-input"
                                    placeholder={t('form.optional')}
                                    value={bridge.model ?? ''}
                                    onChange={event => setBridgeField('model', event.target.value)}
                                  />
                                </div>
                              </li>
                              <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                                <label htmlFor="bridge-firmware" className="mb-2 mb-md-0 w-100 w-md-50">
                                  {t('child_bridge.config.firmware')}
                                </label>
                                <div className="text-start text-md-end w-100 w-md-50">
                                  <input
                                    id="bridge-firmware"
                                    type="text"
                                    className={`form-control custom-input${bridge.firmwareRevision ? ' font-monospace' : ''}`}
                                    placeholder={t('form.optional')}
                                    value={bridge.firmwareRevision ?? ''}
                                    onChange={event => setBridgeField('firmwareRevision', event.target.value)}
                                  />
                                </div>
                              </li>
                              {!justInstalled && (
                                <>
                                  <PluginBridgeSchedule ctrl={ctrl} />
                                  {ctrl.canShowBridgeDebug() && (
                                    <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
                                      <span className="text-start">
                                        {t('child_bridge.config.debug')}
                                        {' '}
                                        <code>-D</code>
                                        <br />
                                        <small className="grey-text">{t('child_bridge.config.debug_desc')}</small>
                                      </span>
                                      <div className="text-end grey-text d-flex align-items-center">
                                        <input
                                          type="checkbox"
                                          className="rendux-input"
                                          id={`homebridgeDebugMode_${sel}`}
                                          aria-label={t('settings.startup.debug')}
                                          checked={!!bridge.debugModeEnabled}
                                          onChange={event => setBridgeField('debugModeEnabled', event.target.checked)}
                                        />
                                        <label className="rendux-label" aria-hidden="true" htmlFor={`homebridgeDebugMode_${sel}`}></label>
                                      </div>
                                    </li>
                                  )}
                                  <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                                    <label htmlFor="bridge-debug" className="mb-2 mb-md-0 w-100 w-md-50">
                                      <span className="font-monospace">DEBUG</span>
                                      <br />
                                      <SafeHtml as="small" className="grey-text" html={t('settings.service.debug_tooltip_child', { link: ctrl.linkDebug(t('settings.link_debug_values')) })} />
                                    </label>
                                    <div className="text-start text-md-end w-100 w-md-50">
                                      {!!ctrl.globalDebug() && (
                                        <small className="d-block text-start text-white font-monospace mb-1 global-env-prefix">
                                          {ctrl.globalDebug()}
                                          ,
                                        </small>
                                      )}
                                      <input
                                        id="bridge-debug"
                                        type="text"
                                        className="form-control custom-input font-monospace"
                                        placeholder="HAP-NodeJS:Advertiser,HAP-NodeJS:Service"
                                        value={bridge.env?.DEBUG ?? ''}
                                        onChange={event => setBridgeEnv('DEBUG', event.target.value)}
                                      />
                                    </div>
                                  </li>
                                  <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                                    <label htmlFor="bridge-node-options" className="mb-2 mb-md-0 w-100 w-md-50">
                                      <span className="font-monospace">NODE_OPTIONS</span>
                                      <br />
                                      <small className="grey-text">{t('settings.service.node_tooltip_child')}</small>
                                    </label>
                                    <div className="text-start text-md-end w-100 w-md-50">
                                      {!!ctrl.globalNodeOptions() && (
                                        <small className="d-block text-start text-white font-monospace mb-1 global-env-prefix">
                                          {ctrl.globalNodeOptions()}
                                        </small>
                                      )}
                                      <input
                                        id="bridge-node-options"
                                        type="text"
                                        className="form-control custom-input font-monospace"
                                        placeholder="--max-old-space-size=512 --max-http-header-size=8192"
                                        value={bridge.env?.NODE_OPTIONS ?? ''}
                                        onChange={event => setBridgeEnv('NODE_OPTIONS', event.target.value)}
                                      />
                                    </div>
                                  </li>
                                </>
                              )}
                            </>
                          )}
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
                        {(!ctrl.isMatterOnlyPlugin || ctrl.hapEnabledBlocks()[idx]) && <PluginBridgeHap ctrl={ctrl} />}

                        {/* MATTER SECTION - Only shown when child bridge is enabled and plugin is platform-based */}
                        {ctrl.isMatterSupported && !block.accessory && <PluginBridgeMatter ctrl={ctrl} />}
                      </>
                    )}
                  </>
                )}
                {(!!deleteBridges.length || !!deleteMatterBridges.length) && (
                  // <ngb-alert type="error" [dismissible]="false">
                  <div role="alert" className="mt-3 mb-0 alert show alert-error fade">
                    <p>
                      {t('child_bridge.confirm_delete_1')}
                      {ctrl.deletingPairedBridge() && (
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
                            {deleted.bridgeName || (ctrl.deviceInfo().get(deleted.id) || undefined)?.displayName}
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
                    <button className="btn btn-primary mb-0" type="button" onClick={() => ctrl.openFullConfigEditor()}>
                      {t('plugins.settings.label_open_config_editor')}
                    </button>
                  </div>
                )}
              </>
            )}
      </div>
      <div className="modal-footer justify-content-between">
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
              onClick={() => ctrl.closeModal()}
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
              onClick={() => void ctrl.save()}
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
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={() => ctrl.closeModal()}>
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
                    onClick={() => void ctrl.save()}
                  >
                    {!saveInProgress
                      ? t('form.button_save')
                      : <i aria-hidden="true" className="fas fa-circle-notch fa-spin"></i>}
                  </button>
                )
              : (
                  <button type="button" className="btn btn-primary" data-bs-dismiss="modal" onClick={() => ctrl.openPluginConfig()}>
                    {t('plugins.button_settings')}
                  </button>
                )
          )}
        </div>
      </div>
    </div>
  )
}
