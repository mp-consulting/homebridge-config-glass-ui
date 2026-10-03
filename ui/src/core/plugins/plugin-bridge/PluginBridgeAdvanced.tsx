import type { PluginBridgeStore } from '@/core/plugins/plugin-bridge/plugin-bridge.state'

import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { linkDebug } from '@/core/plugins/plugin-bridge/plugin-bridge.state'
import { PluginBridgeSchedule } from '@/core/plugins/plugin-bridge/PluginBridgeSchedule'
import { SafeHtml } from '@/core/ui/SafeHtml'

/** The selected child bridge's advanced options: accessory information, restart schedule, debug and environment. */
export function PluginBridgeAdvanced({ store }: { store: PluginBridgeStore }) {
  const { t } = useTranslation()
  const { setBridgeField, setBridgeEnv } = store.getState()
  const sel = useStore(store, s => s.selectedBlock)
  const bridge = useStore(store, s => s.configBlocks)[Number(sel)]._bridge
  const justInstalled = useStore(store, s => s.justInstalled)
  const canShowBridgeDebug = useStore(store, s => s.canShowBridgeDebug)
  const globalDebug = useStore(store, s => s.globalDebug)
  const globalNodeOptions = useStore(store, s => s.globalNodeOptions)

  return (
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
          <PluginBridgeSchedule store={store} />
          {canShowBridgeDebug && (
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
              <SafeHtml as="small" className="grey-text" html={t('settings.service.debug_tooltip_child', { link: linkDebug(t('settings.link_debug_values')) })} />
            </label>
            <div className="text-start text-md-end w-100 w-md-50">
              {!!globalDebug && (
                <small className="d-block text-start text-white font-monospace mb-1 global-env-prefix">
                  {globalDebug}
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
              {!!globalNodeOptions && (
                <small className="d-block text-start text-white font-monospace mb-1 global-env-prefix">
                  {globalNodeOptions}
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
  )
}
