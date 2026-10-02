import { useTranslation } from 'react-i18next'

import { CONTROL_WRAP, FieldSaveIndicator, INNER_BLOCK, INNER_FLEX, NumberInput, SaveIndicator, SectionShell, SettingRow, SwitchControl } from '@/modules/settings/sections/rows'
import { useField, useInvalid, useSaving, useSettingsPageState } from '@/modules/settings/settings-page.context'

/** MATTER SETTINGS: the main bridge's Matter server, its port and range. */
export function MatterSection() {
  const { t } = useTranslation()
  const allowMatterDisableInPlace = useSettingsPageState(state => state.flags.allowMatterDisableInPlace)
  const allowDisableAllProtocols = useSettingsPageState(state => state.flags.allowDisableAllProtocols)
  const isProtocolExternalsOnlyEnabled = useSettingsPageState(state => state.flags.isProtocolExternalsOnlyEnabled)
  const isMatterDisableIpv4Enabled = useSettingsPageState(state => state.flags.isMatterDisableIpv4Enabled)
  const [hapEnabled] = useField('hapEnabled')
  const [matterEnabled] = useField('matterEnabled')
  const matterPortIsInvalid = useInvalid('matterPort')
  const matterStartPortIsInvalid = useInvalid('matterStartPort')
  const matterEndPortIsInvalid = useInvalid('matterEndPort')
  const startSaving = useSaving('matterStartPort')
  const endSaving = useSaving('matterEndPort')

  return (
    <SectionShell section="matter" fieldsId="fieldsMatter" title="settings.matter.title" description="settings.matter.desc">
      <SettingRow item="setting-matter-enabled">
        <div className={INNER_FLEX}>
          <span>
            {t('common.labels.enabled')}
            {' '}
            <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
            <br />
            <small className="grey-text pe-2">
              {t(allowMatterDisableInPlace ? 'settings.matter.enabled_desc_in_place' : 'settings.matter.enabled_desc')}
            </small>
          </span>
          <SwitchControl
            field="matterEnabled"
            id="matterEnabled"
            label={t('common.labels.enabled')}
            title={!allowDisableAllProtocols && !hapEnabled && matterEnabled ? t('settings.matter.requires_hap') : ''}
          />
        </div>
      </SettingRow>
      {/*
        Matter externalsOnly toggle — only shown when:
        - The running Homebridge supports the nested config (>= 2.0.3-beta.26).
        - Matter is currently disabled in place (validation requires matter.enabled: false).
      */}
      {isProtocolExternalsOnlyEnabled && matterEnabled === false && (
        <SettingRow>
          <div className={INNER_FLEX}>
            <span>
              {t('settings.matter.externals_only')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <br />
              <small className="grey-text pe-2">{t('settings.matter.externals_only_desc')}</small>
            </span>
            <SwitchControl field="matterExternalsOnly" id="matterExternalsOnly" label={t('settings.matter.externals_only')} />
          </div>
        </SettingRow>
      )}
      {matterEnabled && (
        <SettingRow item="setting-matter-port">
          <div className={INNER_BLOCK}>
            <span>
              {t('settings.matter.port')}
              <br />
              <small className="grey-text pe-2">{t('settings.matter.port_desc')}</small>
            </span>
            <div className={CONTROL_WRAP}>
              <NumberInput
                field="matterPort"
                className={`form-control custom-input resp-input order-1 order-md-2 font-monospace${matterPortIsInvalid ? ' is-invalid' : ''}`}
                min="1024"
                max="65535"
                placeholder="5540"
                aria-label={t('settings.matter.port')}
              />
              <FieldSaveIndicator saving="matterPort" />
            </div>
          </div>
        </SettingRow>
      )}
      <SettingRow item="setting-matter-port-range">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.network.port_range')}
            <br />
            <small className="grey-text pe-2">{t('settings.matter.port_range_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <SaveIndicator show={startSaving || endSaving} />
            <div className="d-flex gap-2 order-1 order-md-2 resp-select-width">
              <NumberInput
                field="matterStartPort"
                className={`form-control custom-input font-monospace flex-fill${matterStartPortIsInvalid ? ' is-invalid' : ''}`}
                min="1025"
                max="65533"
                placeholder="5530"
                aria-label={t('settings.network.port_range')}
              />
              <NumberInput
                field="matterEndPort"
                className={`form-control custom-input font-monospace flex-fill${matterEndPortIsInvalid ? ' is-invalid' : ''}`}
                min="1025"
                max="65533"
                placeholder="5541"
                aria-label={t('settings.network.port_range')}
              />
            </div>
          </div>
        </div>
      </SettingRow>
      {/*
        Matter disableIpv4 toggle — only shown when the running Homebridge
        supports the option (>= 2.2.0) and Matter is enabled. When on, the
        Matter mDNS responder runs IPv6-only.
      */}
      {isMatterDisableIpv4Enabled && matterEnabled && (
        <SettingRow item="setting-matter-disable-ipv4">
          <div className={INNER_FLEX}>
            <span>
              {t('settings.matter.disable_ipv4')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <br />
              <small className="grey-text pe-2">{t('settings.matter.disable_ipv4_desc')}</small>
            </span>
            <SwitchControl field="matterDisableIpv4" id="matterDisableIpv4" label={t('settings.matter.disable_ipv4')} />
          </div>
        </SettingRow>
      )}
    </SectionShell>
  )
}
