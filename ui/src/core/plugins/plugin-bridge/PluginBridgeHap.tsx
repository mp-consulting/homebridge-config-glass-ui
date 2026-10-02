import type { PluginBridgeStore } from '@/core/plugins/plugin-bridge/plugin-bridge.state'

import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { QrCode } from '@/core/components/qrcode/QrCode'
import { isUnpairingHidden } from '@/core/plugins/plugin-bridge/plugin-bridge.bridge-list'
import { getHapPortValidationError } from '@/core/plugins/plugin-bridge/plugin-bridge.hap'
import { numberValue } from '@/core/plugins/plugin-bridge/plugin-bridge.state'

/** The HomeKit (HAP) section of the selected child bridge: toggles, QR code and port. */
export function PluginBridgeHap({ store }: { store: PluginBridgeStore }) {
  const { t } = useTranslation()
  const actions = store.getState()
  const sel = useStore(store, s => s.selectedBlock)
  const idx = Number(sel)
  const block = useStore(store, s => s.configBlocks)[idx]
  const username: string | undefined = block._bridge?.username
  const hapEnabled = useStore(store, s => s.hapEnabledBlocks[idx])
  const hapExternalsOnly = useStore(store, s => !!s.hapExternalsOnlyBlocks[idx])
  const hapDisableIdentifyingMaterial = useStore(store, s => !!s.hapDisableIdentifyingMaterialBlocks[idx])
  const justInstalled = useStore(store, s => s.justInstalled)
  const isProtocolExternalsOnlyEnabled = useStore(store, s => s.isProtocolExternalsOnlyEnabled)
  const isHapDisableIdentifyingMaterialEnabled = useStore(store, s => s.isHapDisableIdentifyingMaterialEnabled)
  const unpairingHidden = useStore(store, s => !!username && isUnpairingHidden(s, username, 'hap'))
  const isAccessory = !!block.accessory
  const info = useStore(store, s => (username ? s.deviceInfo.get(username) : undefined))
  const pairing = info || undefined
  const portError = useStore(store, s => getHapPortValidationError(s, sel))

  return (
    <ul className="list-group list-group-box mt-3 mb-0">
      {/* HAP Header with Toggle */}
      <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
        <span className="text-start d-flex align-items-center flex-grow-1 me-3">
          <i
            aria-hidden="true"
            className={`fas fa-xl fa-hap protocol-icon my-2${hapEnabled ? ' green-text' : ' grey-text'}`}
          >
          </i>
          <span>{t('child_bridge.config.enable_hap')}</span>
        </span>
        <div
          className={`text-end grey-text d-flex align-items-center${isAccessory ? ' hap-toggle-disabled' : ''}`}
          title={isAccessory ? t('child_bridge.config.hap_disabled_for_accessory') : ''}
        >
          <input
            type="checkbox"
            className={`rendux-input${isAccessory ? ' pointer-events-none' : ''}`}
            id={`toggleHapInput_${sel}`}
            checked={!!hapEnabled}
            disabled={isAccessory}
            onChange={event => void actions.toggleHapBridge(block, !hapEnabled, sel, event)}
          />
          <label
            className={`rendux-label${isAccessory ? ' cursor-not-allowed' : ''}`}
            aria-hidden="true"
            htmlFor={`toggleHapInput_${sel}`}
          >
          </label>
        </div>
      </li>

      {/*
        HAP externalsOnly toggle — visible only on Homebridge >= 2.0.3-beta.26,
        when HAP is disabled, and this is not an accessory plugin (externals are
        not supported via the accessory plugin API). Hidden during first-install
        setup — externals-only is an advanced post-setup tweak, not a step in
        the initial pairing flow.
      */}
      {!justInstalled && isProtocolExternalsOnlyEnabled && !hapEnabled && !isAccessory && (
        <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
          <span className="text-start d-flex align-items-center flex-grow-1 me-3">
            <i
              aria-hidden="true"
              className={`fas fa-xl fa-hap protocol-icon my-2${hapExternalsOnly ? ' text-info' : ' grey-text'}`}
            >
            </i>
            <span>
              {t('child_bridge.config.hap_externals_only')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <span className="d-block small grey-text">
                {t('child_bridge.config.hap_externals_only_desc')}
              </span>
            </span>
          </span>
          <div className="text-end grey-text d-flex align-items-center">
            <input
              type="checkbox"
              className="rendux-input"
              id={`toggleHapExternalsOnlyInput_${sel}`}
              checked={hapExternalsOnly}
              onChange={event => actions.toggleHapExternalsOnly(event, idx)}
            />
            <label className="rendux-label" aria-hidden="true" htmlFor={`toggleHapExternalsOnlyInput_${sel}`}></label>
          </div>
        </li>
      )}

      {/*
        HAP disableIdentifyingMaterial toggle — visible on Homebridge
        >= 2.2.2-beta.0 for both platform and accessory child bridges.
        It remains available while HAP is disabled so the preference is
        preserved independently of protocol enablement.
      */}
      {isHapDisableIdentifyingMaterialEnabled && (
        <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
          <span className="text-start d-flex align-items-center flex-grow-1 me-3">
            <i
              aria-hidden="true"
              className={`fas fa-xl fa-hap protocol-icon my-2${hapDisableIdentifyingMaterial ? ' text-warning' : ' grey-text'}`}
            >
            </i>
            <span>
              {t('settings.hap.disable_identifying_material')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <span className="d-block small grey-text">
                {t('settings.hap.disable_identifying_material_desc')}
              </span>
            </span>
          </span>
          <div className="text-end grey-text d-flex align-items-center">
            <input
              type="checkbox"
              className="rendux-input"
              id={`toggleHapDisableIdentifyingMaterialInput_${sel}`}
              checked={hapDisableIdentifyingMaterial}
              aria-label={t('settings.hap.disable_identifying_material')}
              onChange={event => actions.toggleHapDisableIdentifyingMaterial(event, idx)}
            />
            <label className="rendux-label" aria-hidden="true" htmlFor={`toggleHapDisableIdentifyingMaterialInput_${sel}`}></label>
          </div>
        </li>
      )}

      {hapEnabled && (
        <>
          {/* HAP QR Code */}
          {username && info === false && (
            <li className="list-group-item text-center">
              <div className="w-100 d-flex flex-column text-center">
                <div className="mx-auto d-flex align-items-center justify-content-center qr-code-placeholder primary-text p-3">
                  <div>
                    <div className="text-center grey-text">
                      <i aria-hidden="true" className="fas fa-qrcode fa-2x mb-2 primary-text"></i>
                    </div>
                    <div className="text-center small grey-text">{t('child_bridge.return_to_pair')}</div>
                  </div>
                </div>
              </div>
            </li>
          )}
          {info && (
            <>
              <li className="list-group-item text-center">
                <div className="w-100 d-flex flex-column text-center">
                  <div className="mx-auto qr-code-size"><QrCode data={pairing?._setupCode ?? ''} /></div>
                  <p className="mx-auto mt-3 mb-1 font-monospace">{pairing?.pincode}</p>
                  <p className="grey-text mx-auto small mb-1 qr-code-info">
                    <i aria-hidden="true" className={`fas fa-link${pairing?._isPaired ? ' green-text' : ' grey-text'}`}></i>
                    {' '}
                    {t(pairing?._isPaired ? 'status.widget.qr_paired' : 'status.widget.qr_unpaired')}
                    {!pairing?._isPaired && (
                      <span>
                        {' · '}
                        {t('status.code_scan')}
                      </span>
                    )}
                  </p>
                </div>
              </li>
              {!pairing?._isPaired && (
                <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
                  <span className="text-start">{t('child_bridge.config.hide_pairing_alert')}</span>
                  <div className="text-end grey-text d-flex align-items-center">
                    <input
                      type="checkbox"
                      className="rendux-input"
                      id={`toggleHideHapUnpairing_${sel}`}
                      checked={unpairingHidden}
                      aria-label={t('child_bridge.config.hide_pairing_alert')}
                      onChange={() => actions.toggleHideUnpairing(username!, 'hap')}
                    />
                    <label className="rendux-label" aria-hidden="true" htmlFor={`toggleHideHapUnpairing_${sel}`}></label>
                  </div>
                </li>
              )}
            </>
          )}

          {/* HAP Configuration Fields */}
          <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
            <label htmlFor="bridge-hap-port" className="mb-2 mb-md-0 w-100 w-md-50">
              {t('child_bridge.config.port')}
              <br />
              <small className="grey-text">{t('child_bridge.config.hap_port_desc')}</small>
            </label>
            <div className="text-start text-md-end w-100 w-md-50">
              <input
                id="bridge-hap-port"
                type="number"
                className={`form-control custom-input font-monospace${portError ? ' is-invalid' : ''}`}
                min="1025"
                max="65533"
                value={block._bridge.port ?? ''}
                onChange={(event) => {
                  block._bridge.port = numberValue(event.target.value)
                  actions.touch()
                }}
              />
              {portError && (
                <div className="invalid-feedback d-block">
                  {t('settings.matter.port_desc')}
                </div>
              )}
            </div>
          </li>
        </>
      )}
    </ul>
  )
}
