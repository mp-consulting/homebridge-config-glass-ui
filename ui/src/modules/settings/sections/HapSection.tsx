import { useTranslation } from 'react-i18next'

import { INNER_FLEX, SectionShell, SettingRow, SwitchControl } from '@/modules/settings/sections/rows'
import { useField, useSettingsPageState } from '@/modules/settings/settings-page.context'

/** HAP SETTINGS: whether the main bridge publishes over HomeKit, and how. */
export function HapSection() {
  const { t } = useTranslation()
  const allowMatterDisableInPlace = useSettingsPageState(state => state.flags.allowMatterDisableInPlace)
  const allowDisableAllProtocols = useSettingsPageState(state => state.flags.allowDisableAllProtocols)
  const isProtocolExternalsOnlyEnabled = useSettingsPageState(state => state.flags.isProtocolExternalsOnlyEnabled)
  const isHapDisableIdentifyingMaterialEnabled = useSettingsPageState(state => state.flags.isHapDisableIdentifyingMaterialEnabled)
  const [hapEnabled] = useField('hapEnabled')
  const [matterEnabled] = useField('matterEnabled')

  return (
    <SectionShell section="hap" fieldsId="fieldsHap" title="settings.hap.title" description="settings.hap.desc">
      <SettingRow item="setting-hap-enabled">
        <div className={INNER_FLEX}>
          <span>
            {t('common.labels.enabled')}
            <br />
            <small className="grey-text pe-2">
              {t(allowMatterDisableInPlace ? 'settings.hap.enabled_desc_in_place' : 'settings.hap.enabled_desc')}
            </small>
          </span>
          <SwitchControl
            field="hapEnabled"
            id="hapEnabled"
            label={t('common.labels.enabled')}
            title={!allowDisableAllProtocols && !matterEnabled && hapEnabled ? t('settings.hap.requires_matter') : ''}
          />
        </div>
      </SettingRow>
      {/*
        HAP disableIdentifyingMaterial toggle — only shown when the
        running Homebridge supports the option (>= 2.2.2-beta.0).
        The option is independent of HAP enablement so it remains
        configurable while a bridge is temporarily disabled.
      */}
      {isHapDisableIdentifyingMaterialEnabled && (
        <SettingRow item="setting-hap-disable-identifying-material">
          <div className={INNER_FLEX}>
            <span>
              {t('settings.hap.disable_identifying_material')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <br />
              <small className="grey-text pe-2">{t('settings.hap.disable_identifying_material_desc')}</small>
            </span>
            <SwitchControl
              field="hapDisableIdentifyingMaterial"
              id="hapDisableIdentifyingMaterial"
              label={t('settings.hap.disable_identifying_material')}
            />
          </div>
        </SettingRow>
      )}
      {/*
        HAP externalsOnly toggle — only shown when:
        - The running Homebridge supports the nested config (>= 2.0.3-beta.26).
        - HAP is currently disabled (validation rule: externalsOnly requires enabled: false).
        Toggling externalsOnly back to true is hidden when HAP is re-enabled; the value
        is reset programmatically so the saved value cannot leak back in.
      */}
      {isProtocolExternalsOnlyEnabled && hapEnabled === false && (
        <SettingRow>
          <div className={INNER_FLEX}>
            <span>
              {t('settings.hap.externals_only')}
              {' '}
              <span className="badge badge-primary ms-1">{t('common.labels.beta')}</span>
              <br />
              <small className="grey-text pe-2">{t('settings.hap.externals_only_desc')}</small>
            </span>
            <SwitchControl field="hapExternalsOnly" id="hapExternalsOnly" label={t('settings.hap.externals_only')} />
          </div>
        </SettingRow>
      )}
    </SectionShell>
  )
}
