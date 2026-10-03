import type { MatterFabric, PluginBridgeStore } from '@/core/plugins/plugin-bridge/plugin-bridge.state'

import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { QrCode } from '@/core/components/qrcode/QrCode'
import { isUnpairingHidden } from '@/core/plugins/plugin-bridge/plugin-bridge.bridge-list'
import { getMatterFabricLabel, getMatterPortValidationError } from '@/core/plugins/plugin-bridge/plugin-bridge.matter'
import { numberValue } from '@/core/plugins/plugin-bridge/plugin-bridge.state'

/** The Matter section of the selected child bridge (platform plugins only). */
export function PluginBridgeMatter({ store }: { store: PluginBridgeStore }) {
  const { t } = useTranslation()
  const actions = store.getState()
  const sel = useStore(store, s => s.selectedBlock)
  const idx = Number(sel)
  const block = useStore(store, s => s.configBlocks)[idx]
  const username: string | undefined = block._bridge?.username
  const matterEnabled = useStore(store, s => s.matterEnabledBlocks[idx])
  const matterExternalsOnly = useStore(store, s => !!s.matterExternalsOnlyBlocks[idx])
  const matterDisableIpv4 = useStore(store, s => !!s.matterDisableIpv4Blocks[idx])
  const justInstalled = useStore(store, s => s.justInstalled)
  const isProtocolExternalsOnlyEnabled = useStore(store, s => s.isProtocolExternalsOnlyEnabled)
  const isMatterFabricInfoEnabled = useStore(store, s => s.isMatterFabricInfoEnabled)
  const isMatterDisableIpv4Enabled = useStore(store, s => s.isMatterDisableIpv4Enabled)
  const unpairingHidden = useStore(store, s => !!username && isUnpairingHidden(s, username, 'matter'))
  const portError = useStore(store, s => getMatterPortValidationError(s, sel))
  const isAccessory = !!block.accessory
  const info = useStore(store, s => (username ? s.matterDeviceInfo.get(username) : undefined))

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
            onChange={event => void actions.toggleMatterBridge(block, !matterEnabled, sel, event)}
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
      {!justInstalled && isProtocolExternalsOnlyEnabled && !matterEnabled && !isAccessory && (
        <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
          <span className="text-start d-flex align-items-center flex-grow-1 me-3">
            <i
              aria-hidden="true"
              className={`fas fa-xl fa-matter protocol-icon my-2${matterExternalsOnly ? ' text-info' : ' grey-text'}`}
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
              checked={matterExternalsOnly}
              onChange={event => void actions.toggleMatterExternalsOnly(event, idx)}
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
                  {isMatterFabricInfoEnabled && !!info.fabrics?.length && (
                    <div className="mx-auto small grey-text">
                      {(info.fabrics as MatterFabric[]).map(fabric => (
                        <div key={String(fabric.fabricIndex)}>
                          <i aria-hidden="true" className="fas fa-fw fa-user"></i>
                          {' '}
                          {getMatterFabricLabel(fabric)}
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
                      checked={unpairingHidden}
                      aria-label={t('child_bridge.config.hide_pairing_alert')}
                      onChange={() => actions.toggleHideUnpairing(username, 'matter')}
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
                className={`form-control custom-input font-monospace${portError ? ' is-invalid' : ''}`}
                min="1024"
                max="65535"
                placeholder={t('common.labels.example_value', { value: '5540' })}
                value={block._bridge.matter.port ?? ''}
                onChange={(event) => {
                  block._bridge.matter.port = numberValue(event.target.value)
                  actions.touch()
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
          {isMatterDisableIpv4Enabled && (
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
                  checked={matterDisableIpv4}
                  aria-label={t('settings.matter.disable_ipv4')}
                  onChange={event => actions.toggleMatterDisableIpv4(event, idx)}
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
