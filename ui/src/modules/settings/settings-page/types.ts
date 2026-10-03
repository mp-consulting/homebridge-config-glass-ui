import type { useSettingsStore } from '@/core/settings'
import type { SettingsPage } from '@/modules/settings/settings-page.store'
import type { SettingsSection } from '@/modules/settings/settings-search'
import type { NetworkAdapterAvailable, NetworkAdapterSelected } from '@/modules/settings/settings.interfaces'
import type { StoreApi } from 'zustand/vanilla'

/** The types of the settings page, shared by the core and its section slices. */

export interface SettingsFieldValues {
  hbName: string | null
  uiLang: string | null
  uiTheme: string | null
  uiLight: string | null
  uiGlass: boolean | null
  uiMenu: string | null
  uiTemp: string | null
  uiTerminalPersistence: boolean | null
  uiTerminalHideWarning: boolean | null
  uiTerminalBufferSize: number | null
  uiTerminalFontSize: number | null
  uiTerminalFontWeight: string | null
  uiTerminalLightingMode: string | null
  hbDebug: boolean | null
  hbInsecure: boolean | null
  hbKeep: boolean | null
  hbEnvDebug: string | null
  hbEnvNode: string | null
  hbLogSize: number | null
  hbLogTruncate: number | null
  hbMDns: string | null
  enableMdnsAdvertise: boolean | null
  hbPort: number | null
  uiPort: number | null
  hbStartPort: number | null
  hbEndPort: number | null
  uiHost: string | null
  uiProxyHost: string | null
  uiAuth: boolean | null
  uiSessionTimeoutDays: number | null
  uiSessionTimeoutHours: number | null
  uiSessionTimeoutMinutes: number | null
  uiSessionTimeoutInactivityBased: boolean | null
  // The SSL certificate details themselves are managed by the SSL settings
  // modal - this only tracks the current mode for display
  uiSslType: string | null
  hbPackage: string | null
  uiMetrics: boolean | null
  uiAccDebug: boolean | null
  uiTempFile: string | null
  hbLinuxShutdown: string | null
  hbLinuxRestart: string | null
  scheduledRestartCron: string | null
  hapEnabled: boolean | null
  // externalsOnly is only meaningful when HAP is disabled. The toggle is
  // hidden in the UI when hapEnabled === true.
  hapExternalsOnly: boolean | null
  hapDisableIdentifyingMaterial: boolean | null
  matterEnabled: boolean | null
  matterExternalsOnly: boolean | null
  matterPort: number | null
  matterStartPort: number | null
  matterEndPort: number | null
  matterDisableIpv4: boolean | null
}

export type FieldKey = keyof SettingsFieldValues
export type SavingKey = FieldKey | 'uiSessionTimeout'

/** Capabilities read once when the page is built, as the Angular class fields were. */
export interface SettingsPageFlags {
  runningInDocker: boolean
  runningOnRaspberryPi: boolean
  runningOnRaspbianImage: boolean
  platform: string
  enableTerminalAccess: boolean
  isMatterSupported: boolean
  // When false (older Homebridge), at least one of HAP/Matter must stay enabled.
  allowDisableAllProtocols: boolean
  // When true (Homebridge >= 2.0.3-beta.22), disabling Matter is non-destructive
  // (matter.enabled=false, storage kept) rather than a teardown.
  allowMatterDisableInPlace: boolean
  // When true (Homebridge >= 2.0.3-beta.26), HAP config uses the nested object
  // form and both HAP and Matter expose an externalsOnly toggle.
  isProtocolExternalsOnlyEnabled: boolean
  // When true (Homebridge >= 2.2.0), Matter exposes a disableIpv4 toggle that
  // makes the Matter mDNS responder IPv6-only.
  isMatterDisableIpv4Enabled: boolean
  // When true (Homebridge >= 2.2.2-beta.0), HAP exposes a toggle that disables
  // username-derived identifying material in bridge and mDNS service names.
  isHapDisableIdentifyingMaterialEnabled: boolean
  isPwa: boolean
}

export interface SettingsPageState {
  loading: boolean
  values: SettingsFieldValues
  saving: Partial<Record<SavingKey, boolean>>
  invalid: Partial<Record<FieldKey, boolean>>
  /** Controls Angular had `.disable()`d. */
  disabled: Partial<Record<FieldKey, boolean>>
  flags: SettingsPageFlags
  debugFieldDesc: string
  showAvahiMdnsOption: boolean
  showResolvedMdnsOption: boolean
  adaptersAvailable: NetworkAdapterAvailable[]
  adaptersSelected: NetworkAdapterSelected[]
  showSearchBar: boolean
  searchQuery: string
  isThemeTransitioning: boolean
  showFields: Record<SettingsSection, boolean>
  activeSection: string
  // Track which items are hidden by search
  hiddenItems: Record<string, boolean>
}

export interface SettingsPageDeps {
  /** react-router's navigate, e.g. `navigate('/restart?alreadyRestarting=true')`. */
  navigate: (to: string) => void
  /** Installed as a home-screen app (`isStandalonePWA()`). */
  isPwa?: boolean
  terminal?: { hasActiveSession: () => boolean, destroyPersistentSession: () => Promise<void> }
  /** The locale the app formats with until the next load (Angular's LOCALE_ID). */
  bootLocale?: string
  /** The browser languages (TranslateService.getBrowserLang / getBrowserCultureLang). */
  browserLang?: () => { lang?: string, culture?: string }
}

/** The core settings `env` the page reads (`useSettingsStore.getState().env`). */
export type SettingsEnv = ReturnType<typeof useSettingsStore.getState>['env']

export type TerminalDeps = NonNullable<SettingsPageDeps['terminal']>

/** In-memory values kept between saves. */
export interface SettingsPageInternals {
  // Cache for Matter config values (in-memory only, for restoring after accidental disable)
  matterConfigCache: { port?: number, disableIpv4?: boolean }
}

/**
 * What the core hands each section slice (`settings-page/*.ts`): the store,
 * the helpers every save shares, and the assembled page for calls across
 * sections.
 */
export interface PageContext {
  store: StoreApi<SettingsPageState>
  deps: SettingsPageDeps
  terminal: TerminalDeps
  bootLocale: string
  browserLang: () => { lang?: string, culture?: string }
  internals: SettingsPageInternals
  /** The assembled page (available once every slice is built). */
  readonly page: SettingsPage
  get: () => SettingsPageState
  v: () => SettingsFieldValues
  flags: () => SettingsPageFlags
  settingsEnv: () => SettingsEnv
  isFeatureEnabled: (key: string) => boolean
  /** `control.patchValue(value, { emitEvent: false })`: change a value without saving it. */
  patch: <K extends FieldKey>(field: K, value: SettingsFieldValues[K]) => void
  /** Patch a value read from the server, and let user changes to it save from now on. */
  load: <K extends FieldKey>(field: K, value: SettingsFieldValues[K]) => void
  /** Let user changes to these fields save from now on (they have been read). */
  arm: (...fields: FieldKey[]) => void
  setSaving: (key: SavingKey, value: boolean) => void
  setInvalid: (key: FieldKey, value: boolean) => void
  disable: (field: FieldKey) => void
  /** The error toast every failed save shows. */
  reportError: (error: unknown) => void
  /** Flag a full service restart, then show the restart toast whatever happened. */
  fullServiceRestartThenToast: () => void
  /** Queue one UI config change for the next coalesced PATCH (rejects when the write fails). */
  queueUiSettingChange: (key: string, value: unknown) => Promise<void>
  /** Keep a save's spinner up for a second, then drop it and run `after`. */
  finishSaving: (key: SavingKey, after?: () => void) => void
  /** Start over after a `destroy()` (a remount). */
  resume: () => void
}
