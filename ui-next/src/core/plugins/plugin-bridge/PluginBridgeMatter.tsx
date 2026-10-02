import type { MatterFabric, PluginBridgeController } from '@/core/plugins/plugin-bridge/plugin-bridge.controller'

import { useTranslation } from 'react-i18next'

import { QrCode } from '@/core/components/qrcode/QrCode'
import { numberValue } from '@/core/plugins/plugin-bridge/plugin-bridge.controller'

/** The Matter section of the selected child bridge (platform plugins only). */
export function PluginBridgeMatter({ ctrl }: { ctrl: PluginBridgeController }) {
  const { t } = useTranslation()
  const sel = ctrl.selectedBlock()
  const idx = Number(sel)
  const block = ctrl.configBlocks()[idx]
  const username: string | undefined = block._bridge?.username
  const matterEnabled = ctrl.matterEnabledBlocks()[idx]
  const isAccessory = !!block.accessory
  const info = username ? ctrl.matterDeviceInfo().get(username) : undefined

  return (
    <ul className="list-group list-group-box mt-3 mb-0">
      {/* Matter Header with Toggle */}
      <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
        <span className="text-start d-flex align-items-center flex-grow-1 me-3">
          <i
            aria-hidden="true"
            className={`fas fa-xl fa-matter protocol-icon my-2${matterEnabled ? ' green-text' : ' grey-text'}`}
          >
          </i>
          <span>
            {t('matter_bridge.config.use')}
            {' '}
            <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
          </span>
        </span>
        <div className="text-end grey-text d-flex align-items-center">
          <input
            type="checkbox"
            className="rendux-input"
            id={`toggleMatterBridgeInput_${sel}`}
            checked={!!matterEnabled}
            onChange={event => void ctrl.toggleMatterBridge(block, !matterEnabled, sel, event)}
          />
          <label className="rendux-label" aria-hidden="true" htmlFor={`toggleMatterBridgeInput_${sel}`}></label>
        </div>
      </li>

      {/*
        Matter externalsOnly toggle — visible only on Homebridge >= 2.0.3-beta.26,
        when Matter is disabled for this bridge, and this is not an accessory
        plugin (matter is platform-only). When toggled on without an existing
        matter block, toggleMatterExternalsOnly() auto-allocates a port and
        writes `{ port, enabled: false, externalsOnly: true }`. Hidden during
        first-install setup — externals-only is an advanced post-setup tweak,
        not a step in the initial pairing flow.
      */}
      {!ctrl.justInstalled && ctrl.isProtocolExternalsOnlyEnabled && !matterEnabled && !isAccessory && (
        <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
          <span className="text-start d-flex align-items-center flex-grow-1 me-3">
            <i
              aria-hidden="true"
              className={`fas fa-xl fa-matter protocol-icon my-2${ctrl.matterExternalsOnlyBlocks()[idx] ? ' text-info' : ' grey-text'}`}
            >
            </i>
            <span>
              {t('child_bridge.config.matter_externals_only')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <span className="d-block small grey-text">
                {t('child_bridge.config.matter_externals_only_desc')}
              </span>
            </span>
          </span>
          <div className="text-end grey-text d-flex align-items-center">
            <input
              type="checkbox"
              className="rendux-input"
              id={`toggleMatterExternalsOnlyInput_${sel}`}
              checked={!!ctrl.matterExternalsOnlyBlocks()[idx]}
              onChange={event => void ctrl.toggleMatterExternalsOnly(event, idx)}
            />
            <label className="rendux-label" aria-hidden="true" htmlFor={`toggleMatterExternalsOnlyInput_${sel}`}></label>
          </div>
        </li>
      )}

      {/* Matter Content (only when enabled) */}
      {matterEnabled && block._bridge?.matter && username && (
        <>
          <li className="list-group-item">
            <ul className="grey-text small">
              <li>{t('child_bridge.config.matter_note_1')}</li>
              <li>{t('child_bridge.config.matter_note_2')}</li>
            </ul>
          </li>
          {/* Matter QR Code */}
          {info?.setupUri && (
            <>
              <li className="list-group-item text-center">
                <div className="w-100 d-flex flex-column text-center">
                  <div className="mx-auto qr-code-size"><QrCode data={info.setupUri} /></div>
                  <p className="mx-auto mt-3 mb-1 font-monospace">{info.pin}</p>
                  <p className="grey-text mx-auto small mb-1 qr-code-info">
                    <i aria-hidden="true" className={`fas fa-link${info.commissioned ? ' green-text' : ' grey-text'}`}></i>
                    {' '}
                    {t(info.commissioned ? 'status.widget.qr_paired' : 'status.widget.qr_unpaired')}
                    {!info.commissioned && (
                      <span>
                        {' · '}
                        {t('status.code_scan')}
                      </span>
                    )}
                  </p>
                  {/* Commissioned fabric list: which controllers hold a pairing (Homebridge >= 2.2.2-beta.8) */}
                  {ctrl.isMatterFabricInfoEnabled && !!info.fabrics?.length && (
                    <div className="mx-auto small grey-text">
                      {(info.fabrics as MatterFabric[]).map(fabric => (
                        <div key={String(fabric.fabricIndex)}>
                          <i aria-hidden="true" className="fas fa-fw fa-user"></i>
                          {' '}
                          {ctrl.getMatterFabricLabel(fabric)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </li>
              {!info.commissioned && (
                <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
                  <span className="text-start">{t('child_bridge.config.hide_pairing_alert')}</span>
                  <div className="text-end grey-text d-flex align-items-center">
                    <input
                      type="checkbox"
                      className="rendux-input"
                      id={`toggleHideMatterUnpairing_${sel}`}
                      checked={ctrl.isUnpairingHidden(username, 'matter')}
                      aria-label={t('child_bridge.config.hide_pairing_alert')}
                      onChange={() => ctrl.toggleHideUnpairing(username, 'matter')}
                    />
                    <label className="rendux-label" aria-hidden="true" htmlFor={`toggleHideMatterUnpairing_${sel}`}></label>
                  </div>
                </li>
              )}
            </>
          )}
          {info && !info.setupUri && (
            <li className="list-group-item text-center">
              <div className="w-100 d-flex flex-column text-center">
                <div className="mx-auto d-flex align-items-center justify-content-center qr-code-placeholder primary-text">
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

          {/* Matter Configuration Fields */}
          <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
            <label htmlFor="bridge-matter-port" className="mb-2 mb-md-0 w-100 w-md-50">
              {t('child_bridge.config.port')}
              <br />
              <small className="grey-text">{t('child_bridge.config.matter_port_desc')}</small>
            </label>
            <div className="text-start text-md-end w-100 w-md-50">
              <input
                id="bridge-matter-port"
                type="number"
                className={`form-control custom-input font-monospace${ctrl.getMatterPortValidationError(sel) ? ' is-invalid' : ''}`}
                min="1024"
                max="65535"
                placeholder="e.g. 5540"
                value={block._bridge.matter.port ?? ''}
                onChange={(event) => {
                  block._bridge.matter.port = numberValue(event.target.value)
                  ctrl.notify()
                }}
              />
            </div>
          </li>

          {/*
            Matter disableIpv4 toggle — visible only on Homebridge >= 2.2.0,
            when Matter is enabled for this bridge (guaranteed by the
            enclosing Matter-content block). When on, the Matter mDNS
            responder runs IPv6-only. Shown during first-install setup too,
            consistent with the Matter port field above.
          */}
          {ctrl.isMatterDisableIpv4Enabled && (
            <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
              <span className="text-start d-flex align-items-center flex-grow-1 me-3">
                <span>
                  {t('settings.matter.disable_ipv4')}
                  {' '}
                  <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
                  <span className="d-block small grey-text">
                    {t('settings.matter.disable_ipv4_desc')}
                  </span>
                </span>
              </span>
              <div className="text-end grey-text d-flex align-items-center">
                <input
                  type="checkbox"
                  className="rendux-input"
                  id={`toggleMatterDisableIpv4Input_${sel}`}
                  checked={!!ctrl.matterDisableIpv4Blocks()[idx]}
                  aria-label={t('settings.matter.disable_ipv4')}
                  onChange={event => ctrl.toggleMatterDisableIpv4(event, idx)}
                />
                <label className="rendux-label" aria-hidden="true" htmlFor={`toggleMatterDisableIpv4Input_${sel}`}></label>
              </div>
            </li>
          )}
        </>
      )}
    </ul>
  )
}
