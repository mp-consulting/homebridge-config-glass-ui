import { useTranslation } from 'react-i18next'

import { SafeHtml } from '@/core/ui/SafeHtml'
import { cx } from '@/core/utilities/cx'
import { CONTROL_WRAP, FieldSaveIndicator, INNER_BLOCK, INNER_FLEX, NumberInput, PwaWarning, SaveIndicator, SectionShell, SettingRow, SwitchControl, TextInput } from '@/modules/settings/sections/rows'
import { useDisabled, useField, useInvalid, useItemHidden, useSaving, useSettingsPage, useSettingsPageState } from '@/modules/settings/settings-page.context'

const MONO_INPUT = 'form-control custom-input resp-input order-1 order-md-2 font-monospace'
const HOST_PATTERN = '^[^{}/:\\\\s]+(?::\\d+)?$'

/** NETWORK SETTINGS: interfaces, mDNS, ports, host and proxy. */
export function NetworkSection() {
  const { t } = useTranslation()
  const page = useSettingsPage()
  const adaptersSelected = useSettingsPageState(state => state.adaptersSelected)
  const adaptersAvailable = useSettingsPageState(state => state.adaptersAvailable)
  const showAvahiMdnsOption = useSettingsPageState(state => state.showAvahiMdnsOption)
  const showResolvedMdnsOption = useSettingsPageState(state => state.showResolvedMdnsOption)
  const isMatterSupported = useSettingsPageState(state => state.flags.isMatterSupported)
  const [hbMDns, changeHbMDns] = useField('hbMDns')
  const hbPortIsInvalid = useInvalid('hbPort')
  const hbStartPortIsInvalid = useInvalid('hbStartPort')
  const hbEndPortIsInvalid = useInvalid('hbEndPort')
  const uiPortIsInvalid = useInvalid('uiPort')
  const rangeSaving = useSaving('hbStartPort')
  const rangeEndSaving = useSaving('hbEndPort')
  const uiHostDisabled = useDisabled('uiHost')
  const uiProxyHostDisabled = useDisabled('uiProxyHost')
  const uiPortDisabled = useDisabled('uiPort')
  const portOverviewHidden = useItemHidden('setting-port-overview')
  const recommended = t('settings.mdns_advertiser_rec')

  return (
    <SectionShell section="network" fieldsId="fieldsNetwork" title="settings.network.title_network">
      <SettingRow item="setting-interfaces">
        <div className={INNER_FLEX}>
          <span className="pe-2">
            {t('settings.network.title_network_interfaces')}
            <br />
            <div className="small grey-text pe-2">
              {t('settings.network.message_network_interface')}
            </div>
            {adaptersSelected.map(adapter => (
              <span key={adapter.iface} className={cx('badge badge-primary me-1', adapter.missing ? 'badge-danger' : 'badge-info')}>
                {adapter.missing && <i aria-hidden="true" className="fas fa-exclamation-triangle"></i>}
                {' '}
                {adapter.iface}
                :
                {' '}
                <span className="fw-normal">
                  {adapter.missing ? t('settings.mdns_advertiser_not_connected') : adapter.ip4 || adapter.ip6}
                </span>
              </span>
            ))}
          </span>
          <button
            type="button"
            className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
            disabled={!adaptersAvailable.length}
            aria-label={t('settings.network.title_network_interfaces')}
            onClick={() => void page.selectNetworkInterfaces()}
          >
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </button>
        </div>
      </SettingRow>
      <SettingRow item="setting-mdns">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.mdns_advertiser')}
            <br />
            <small className="grey-text pe-2">{t('settings.mdns_advertiser_help')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <select
              className="custom-select resp-select order-1 order-md-2"
              value={hbMDns ?? ''}
              aria-label={t('settings.mdns_advertiser')}
              onChange={event => changeHbMDns(event.target.value)}
            >
              {showAvahiMdnsOption && (
                <option value="avahi">{`Avahi (${recommended})`}</option>
              )}
              {/* ciao is recommended if avahi is not available */}
              <option value="ciao">
                {`Ciao ${showAvahiMdnsOption ? '' : `(${recommended})`}`}
              </option>
              <option value="bonjour-hap">Bonjour HAP</option>
              {showResolvedMdnsOption && (
                <option value="resolved">{`systemd-resolved (${t('settings.mdns_advertiser_exp')})`}</option>
              )}
            </select>
            <FieldSaveIndicator saving="hbMDns" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-mdns-advertise">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.network.mdns_advertise')}
            <br />
            <small className="grey-text pe-2">{t('settings.network.mdns_advertise_help')}</small>
          </span>
          <SwitchControl field="enableMdnsAdvertise" id="enableMdnsAdvertise" label={t('settings.network.mdns_advertise')} />
        </div>
      </SettingRow>
      <SettingRow item="setting-port-hb">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.network.port_hb')}
            <br />
            <small className="grey-text pe-2">{t('settings.network.port_hb_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <NumberInput
              field="hbPort"
              className={cx(MONO_INPUT, hbPortIsInvalid && 'is-invalid')}
              min="1025"
              max="65533"
              aria-label={t('settings.network.port_hb')}
            />
            <FieldSaveIndicator saving="hbPort" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-port-range">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.network.port_range')}
            <br />
            <small className="grey-text pe-2">{t('settings.network.port_range_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <SaveIndicator show={rangeSaving || rangeEndSaving} />
            <div className="d-flex gap-2 order-1 order-md-2 resp-select-width">
              <NumberInput
                field="hbStartPort"
                className={cx('form-control custom-input font-monospace flex-fill', hbStartPortIsInvalid && 'is-invalid')}
                min="1025"
                max="65533"
                placeholder="1025"
                aria-label={t('settings.network.port_range')}
              />
              <NumberInput
                field="hbEndPort"
                className={cx('form-control custom-input font-monospace flex-fill', hbEndPortIsInvalid && 'is-invalid')}
                min="1025"
                max="65533"
                placeholder="65533"
                aria-label={t('settings.network.port_end')}
              />
            </div>
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-network-host">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.network.host')}
            <br />
            <SafeHtml as="small" className="grey-text pe-2" html={t('settings.network.host_desc')} />
            <PwaWarning />
          </span>
          <div className={CONTROL_WRAP}>
            <TextInput
              field="uiHost"
              className={MONO_INPUT}
              pattern={HOST_PATTERN}
              placeholder="0.0.0.0"
              disabled={uiHostDisabled}
              aria-label={t('settings.network.host')}
            />
            <FieldSaveIndicator saving="uiHost" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-network-proxy">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.network.proxy')}
            <br />
            <small className="grey-text pe-2">{t('settings.network.proxy_desc')}</small>
            <PwaWarning />
          </span>
          <div className={CONTROL_WRAP}>
            <TextInput
              field="uiProxyHost"
              className={MONO_INPUT}
              pattern={HOST_PATTERN}
              placeholder="example.com:8443"
              disabled={uiProxyHostDisabled}
              aria-label={t('settings.network.proxy')}
            />
            <FieldSaveIndicator saving="uiProxyHost" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ui-port-network">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.network.port_ui')}
            <br />
            <small className="grey-text pe-2">{t('settings.network.port_ui_desc')}</small>
            <PwaWarning />
          </span>
          <div className={CONTROL_WRAP}>
            <NumberInput
              field="uiPort"
              className={cx(MONO_INPUT, uiPortIsInvalid && 'is-invalid')}
              min="1025"
              max="65533"
              placeholder="8581"
              disabled={uiPortDisabled}
              aria-label={t('settings.network.port_ui')}
            />
            <FieldSaveIndicator saving="uiPort" />
          </div>
        </div>
      </SettingRow>
      <SettingRow hidden={!(isMatterSupported && !portOverviewHidden)}>
        <div className={INNER_FLEX}>
          <span>
            {t('settings.ports.title')}
          </span>
          <button type="button" className="btn btn-primary waves-effect" aria-label={t('settings.ports.title')} onClick={() => page.openPortOverview()}>
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </button>
        </div>
      </SettingRow>
    </SectionShell>
  )
}
