import type { SettingsPage } from '@/modules/settings/settings-page.store'
import type { FieldKey, SettingsFieldValues } from '@/modules/settings/settings-page/types'

interface FieldSpec<K extends FieldKey> {
  /** How long the field waits to settle before it saves (its `debounceTime`); 0 saves at once. */
  debounce: number
  /** What a settled change runs; a field without one is never saved from here. */
  save?: (page: SettingsPage, value: SettingsFieldValues[K]) => unknown
}

/**
 * Every field's debounce and save: the Angular `valueChanges.pipe(debounceTime(n))
 * .subscribe(save)` lines, as one table. `page.save(field, value)` reads it.
 */
export const FIELDS: { [K in FieldKey]: FieldSpec<K> } = {
  hbName: { debounce: 1500, save: (page, value) => page.hbNameSave(value!) },
  uiLang: { debounce: 750, save: (page, value) => page.uiLangSave(value!) },
  uiTheme: { debounce: 750, save: (page, value) => page.uiThemeSave(value!) },
  uiLight: { debounce: 750, save: (page, value) => page.uiLightSave(value as 'auto' | 'light' | 'dark') },
  uiGlass: { debounce: 750, save: (page, value) => page.uiGlassSave(Boolean(value)) },
  uiMenu: { debounce: 750, save: (page, value) => page.uiMenuSave(value as 'default' | 'freeze') },
  uiTemp: { debounce: 750, save: (page, value) => page.uiTempSave(value!) },
  uiTerminalPersistence: { debounce: 750, save: (page, value) => page.uiTerminalPersistenceSave(value!) },
  uiTerminalHideWarning: { debounce: 750, save: (page, value) => page.uiTerminalHideWarningSave(value!) },
  uiTerminalBufferSize: { debounce: 1500, save: (page, value) => page.uiTerminalBufferSizeSave(value!) },
  uiTerminalFontSize: { debounce: 750, save: (page, value) => page.uiTerminalFontSizeSave(value!) },
  uiTerminalFontWeight: { debounce: 750, save: (page, value) => page.uiTerminalFontWeightSave(value!) },
  uiTerminalLightingMode: { debounce: 750, save: (page, value) => page.uiTerminalLightingModeSave(value!) },
  hbDebug: { debounce: 750, save: (page, value) => page.hbDebugSave(value!) },
  hbInsecure: { debounce: 750, save: (page, value) => page.hbInsecureSave(value!) },
  hbKeep: { debounce: 750, save: (page, value) => page.hbKeepSave(value!) },
  hbEnvDebug: { debounce: 1500, save: (page, value) => page.hbEnvDebugSave(value!) },
  hbEnvNode: { debounce: 1500, save: (page, value) => page.hbEnvNodeSave(value!) },
  hbLogSize: { debounce: 1500, save: (page, value) => page.hbLogSizeSave(value!) },
  hbLogTruncate: { debounce: 1500, save: (page, value) => page.hbLogTruncateSave(value!) },
  hbMDns: { debounce: 750, save: (page, value) => page.hbMDnsSave(value!) },
  enableMdnsAdvertise: { debounce: 750, save: (page, value) => page.enableMdnsAdvertiseSave(value!) },
  hbPort: { debounce: 1500, save: (page, value) => page.hbPortSave(value!) },
  uiPort: { debounce: 1500, save: (page, value) => page.uiPortSave(value!) },
  hbStartPort: { debounce: 1500, save: (page, value) => page.hbStartPortSave(value!) },
  hbEndPort: { debounce: 1500, save: (page, value) => page.hbEndPortSave(value!) },
  uiHost: { debounce: 1500, save: (page, value) => page.uiHostSave(value!) },
  uiProxyHost: { debounce: 1500, save: (page, value) => page.uiProxyHostSave(value!) },
  uiAuth: { debounce: 750, save: (page, value) => page.uiAuthSave(value!) },
  // The three parts of the session timeout save together
  uiSessionTimeoutDays: { debounce: 750, save: page => page.uiSessionTimeoutSaveFromFields() },
  uiSessionTimeoutHours: { debounce: 750, save: page => page.uiSessionTimeoutSaveFromFields() },
  uiSessionTimeoutMinutes: { debounce: 750, save: page => page.uiSessionTimeoutSaveFromFields() },
  uiSessionTimeoutInactivityBased: { debounce: 750, save: (page, value) => page.uiSessionTimeoutInactivityBasedSave(value!) },
  // Managed by the SSL settings modal
  uiSslType: { debounce: 0 },
  hbPackage: { debounce: 1500, save: (page, value) => page.hbPackageSave(value!) },
  uiMetrics: { debounce: 750, save: (page, value) => page.uiMetricsSave(value!) },
  uiAccDebug: { debounce: 750, save: (page, value) => page.uiAccDebugSave(value!) },
  uiTempFile: { debounce: 1500, save: (page, value) => page.uiTempFileSave(value!) },
  hbLinuxShutdown: { debounce: 1500, save: (page, value) => page.hbLinuxShutdownSave(value!) },
  hbLinuxRestart: { debounce: 1500, save: (page, value) => page.hbLinuxRestartSave(value!) },
  scheduledRestartCron: { debounce: 1500, save: (page, value) => page.scheduledRestartCronSave(value!) },
  hapEnabled: { debounce: 0, save: (page, value) => page.hapEnabledSave(value!) },
  hapExternalsOnly: { debounce: 0, save: (page, value) => page.hapExternalsOnlySave(value === true) },
  hapDisableIdentifyingMaterial: { debounce: 0, save: (page, value) => page.hapDisableIdentifyingMaterialSave(value === true) },
  matterEnabled: { debounce: 0, save: (page, value) => page.matterEnabledSave(value!) },
  matterExternalsOnly: { debounce: 0, save: (page, value) => page.matterExternalsOnlySave(value === true) },
  matterPort: { debounce: 1500, save: (page, value) => page.matterPortSave(value!) },
  matterStartPort: { debounce: 1500, save: (page, value) => page.matterStartPortSave(value!) },
  matterEndPort: { debounce: 1500, save: (page, value) => page.matterEndPortSave(value!) },
  matterDisableIpv4: { debounce: 0, save: (page, value) => page.matterDisableIpv4Save(value === true) },
}

/** The form controls' values before the page has read anything. */
export function initialValues(): SettingsFieldValues {
  return {
    hbName: '',
    uiLang: '',
    uiTheme: '',
    uiLight: '',
    uiGlass: true,
    uiMenu: '',
    uiTemp: '',
    uiTerminalPersistence: false,
    uiTerminalHideWarning: false,
    uiTerminalBufferSize: globalThis.terminal?.bufferSize ?? null,
    uiTerminalFontSize: 13,
    uiTerminalFontWeight: '400',
    uiTerminalLightingMode: 'dark',
    hbDebug: false,
    hbInsecure: false,
    hbKeep: false,
    hbEnvDebug: '',
    hbEnvNode: '',
    hbLogSize: -1,
    hbLogTruncate: 0,
    hbMDns: '',
    enableMdnsAdvertise: false,
    hbPort: 0,
    uiPort: 0,
    hbStartPort: 0,
    hbEndPort: 0,
    uiHost: '',
    uiProxyHost: '',
    uiAuth: true,
    uiSessionTimeoutDays: 0,
    uiSessionTimeoutHours: 8,
    uiSessionTimeoutMinutes: 0,
    uiSessionTimeoutInactivityBased: false,
    uiSslType: 'off',
    hbPackage: '',
    uiMetrics: true,
    uiAccDebug: false,
    uiTempFile: '',
    hbLinuxShutdown: '',
    hbLinuxRestart: '',
    scheduledRestartCron: '',
    hapEnabled: true,
    hapExternalsOnly: false,
    hapDisableIdentifyingMaterial: false,
    matterEnabled: false,
    matterExternalsOnly: false,
    matterPort: 0,
    matterStartPort: 0,
    matterEndPort: 0,
    matterDisableIpv4: false,
  }
}
