import type { SettingsSection } from '@/modules/settings/settings-search'
import type { NetworkAdapterAvailable, NetworkAdapterSelected } from '@/modules/settings/settings.interfaces'
import type { StoreApi } from 'zustand/vanilla'

import { createStore } from 'zustand/vanilla'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { chooseStartupLanguage, localeIdFor } from '@/core/locales'
import { notifications } from '@/core/notifications'
import { formatLocale } from '@/core/pipes/date'
import { RE_CRON_FIELD, RE_HAP_NAME_PATTERN, RE_WHITESPACE_SINGLE } from '@/core/regex.constants'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { toToastMessage } from '@/core/utilities/http-error'
import { terminalService } from '@/core/utilities/terminal'
import { AccessoryControlLists } from '@/modules/settings/accessory-control-lists/AccessoryControlLists'
import { Backup } from '@/modules/settings/backup/Backup'
import { PortOverviewModal } from '@/modules/settings/port-overview-modal/PortOverviewModal'
import { RemoveAllAccessories } from '@/modules/settings/remove-all-accessories/RemoveAllAccessories'
import { RemoveBridgeAccessories } from '@/modules/settings/remove-bridge-accessories/RemoveBridgeAccessories'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'
import { ResetAllBridges } from '@/modules/settings/reset-all-bridges/ResetAllBridges'
import { ResetIndividualBridges } from '@/modules/settings/reset-individual-bridges/ResetIndividualBridges'
import { SelectNetworkInterfaces } from '@/modules/settings/select-network-interfaces/SelectNetworkInterfaces'
import { allSections, filterSettings, getUnavailableItems, isSectionVisible } from '@/modules/settings/settings-search'
import { SslSettingsModal } from '@/modules/settings/ssl-settings-modal/SslSettingsModal'
import { Wallpaper } from '@/modules/settings/wallpaper/Wallpaper'

/**
 * The state and behaviour of the settings page: the Angular SettingsComponent
 * class, with its template split into one component per section
 * (`sections/*`). The page has no save button - every control writes as soon
 * as it settles - so each field here has a value, a debounce and a save, wired
 * the way the Angular `valueChanges` subscriptions were.
 *
 * Field names are the Angular form controls' without `FormControl`
 * (`hbNameFormControl` → `hbName`); `saving.x` / `invalid.x` are its
 * `xIsSaving` / `xIsInvalid` signals.
 */

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

export const fontSizes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
export const fontWeights = ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'bold', 'normal']

export const linkDebug = '<a href="https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Debug-Common-Values" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square primary-text"></i></a>'
export const linkRaspbianSsl = '<a href="https://github.com/homebridge/homebridge-raspbian-image/wiki/SSL-HTTPS-Access" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square primary-text"></i></a>'
export const linkCron = '<a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer"><i class="fas fa-up-right-from-square primary-text"></i></a>'

const UI_FLUSH_COALESCE_MS = 150

/** How long each field waits to settle before it saves (its `debounceTime`); 0 saves at once. */
const DEBOUNCE: Partial<Record<FieldKey, number>> = {
  hbName: 1500,
  uiLang: 750,
  uiTheme: 750,
  uiLight: 750,
  uiGlass: 750,
  uiMenu: 750,
  uiTemp: 750,
  uiTerminalPersistence: 750,
  uiTerminalHideWarning: 750,
  uiTerminalBufferSize: 1500,
  uiTerminalFontSize: 750,
  uiTerminalFontWeight: 750,
  uiTerminalLightingMode: 750,
  hbDebug: 750,
  hbInsecure: 750,
  hbKeep: 750,
  hbEnvDebug: 1500,
  hbEnvNode: 1500,
  hbLogSize: 1500,
  hbLogTruncate: 1500,
  hbMDns: 750,
  enableMdnsAdvertise: 750,
  hbPort: 1500,
  uiPort: 1500,
  hbStartPort: 1500,
  hbEndPort: 1500,
  uiHost: 1500,
  uiProxyHost: 1500,
  uiAuth: 750,
  uiSessionTimeoutDays: 750,
  uiSessionTimeoutHours: 750,
  uiSessionTimeoutMinutes: 750,
  uiSessionTimeoutInactivityBased: 750,
  hbPackage: 1500,
  uiMetrics: 750,
  uiAccDebug: 750,
  uiTempFile: 1500,
  hbLinuxShutdown: 1500,
  hbLinuxRestart: 1500,
  scheduledRestartCron: 1500,
  hapEnabled: 0,
  hapExternalsOnly: 0,
  hapDisableIdentifyingMaterial: 0,
  matterEnabled: 0,
  matterExternalsOnly: 0,
  matterPort: 1500,
  matterStartPort: 1500,
  matterEndPort: 1500,
  matterDisableIpv4: 0,
}

/** The form controls' values before the page has read anything. */
function initialValues(): SettingsFieldValues {
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

function defaultBrowserLang(): { lang?: string, culture?: string } {
  if (typeof navigator === 'undefined') {
    return {}
  }
  const culture = navigator.languages?.[0] ?? navigator.language
  return { lang: culture?.split('-')[0].split('_')[0], culture }
}

const t = (key: string, params?: Record<string, unknown>) => i18n.t(key, params)

const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

export type SettingsPage = ReturnType<typeof createSettingsPage>

/**
 * Build one settings page (one Angular component instance). `init()` loads it,
 * `destroy()` drops whatever is still waiting to settle.
 * @param deps - what the page needs from outside
 */
export function createSettingsPage(deps: SettingsPageDeps) {
  const terminal = deps.terminal ?? terminalService
  const bootLocale = deps.bootLocale ?? formatLocale()
  const browserLang = deps.browserLang ?? defaultBrowserLang
  const isFeatureEnabled = (key: string) => settingsActions.isFeatureEnabled(key)
  const settingsEnv = () => useSettingsStore.getState().env

  const env = settingsEnv()
  const store: StoreApi<SettingsPageState> = createStore<SettingsPageState>()(() => ({
    loading: true,
    values: initialValues(),
    saving: {},
    invalid: {},
    disabled: {},
    flags: {
      runningInDocker: env.runningInDocker,
      runningOnRaspberryPi: env.runningOnRaspberryPi,
      runningOnRaspbianImage: env.runningOnRaspbianImage,
      platform: env.platform,
      enableTerminalAccess: env.enableTerminalAccess,
      isMatterSupported: isFeatureEnabled('matterSupport'),
      allowDisableAllProtocols: isFeatureEnabled('disableAllProtocols'),
      allowMatterDisableInPlace: isFeatureEnabled('matterDisableInPlace'),
      isProtocolExternalsOnlyEnabled: isFeatureEnabled('protocolExternalsOnly'),
      isMatterDisableIpv4Enabled: isFeatureEnabled('matterDisableIpv4'),
      isHapDisableIdentifyingMaterialEnabled: isFeatureEnabled('hapDisableIdentifyingMaterial'),
      isPwa: Boolean(deps.isPwa),
    },
    debugFieldDesc: 'settings.startup.debug_desc_v1', // default, may be changed in init
    showAvahiMdnsOption: false,
    showResolvedMdnsOption: false,
    adaptersAvailable: [],
    adaptersSelected: [],
    showSearchBar: false,
    searchQuery: '',
    isThemeTransitioning: false,
    showFields: {
      general: true,
      display: true,
      startup: true,
      network: true,
      hap: true,
      matter: true,
      security: true,
      terminal: true,
      reset: true,
      cache: true,
    },
    activeSection: 'general',
    hiddenItems: {},
  }))

  const get = store.getState
  const v = () => get().values
  const flags = () => get().flags

  /** `control.patchValue(value, { emitEvent: false })`: change a value without saving it. */
  function patch<K extends FieldKey>(field: K, value: SettingsFieldValues[K]): void {
    store.setState(state => ({ values: { ...state.values, [field]: value } }))
  }

  function setSaving(key: SavingKey, value: boolean): void {
    store.setState(state => ({ saving: { ...state.saving, [key]: value } }))
  }

  function setInvalid(key: FieldKey, value: boolean): void {
    store.setState(state => ({ invalid: { ...state.invalid, [key]: value } }))
  }

  function disable(field: FieldKey): void {
    store.setState(state => ({ disabled: { ...state.disabled, [field]: true } }))
  }

  /** The error toast every failed save shows. */
  function reportError(error: unknown): void {
    console.error(error)
    toast.error(toToastMessage(error), t('toast.title_error'))
  }

  /** Flag a full service restart, then show the restart toast whatever happened. */
  function fullServiceRestartThenToast(): void {
    api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
      .catch(error => console.error(error))
      .finally(() => settingsActions.showRestartToast())
  }

  // ===== Wiring (the valueChanges subscriptions) =====

  let destroyed = false
  const wired = new Set<FieldKey>()
  const timers = new Map<FieldKey, ReturnType<typeof setTimeout>>()
  const savers: Partial<Record<FieldKey, (value: any) => unknown>> = {}

  function wire<K extends FieldKey>(field: K, save: (value: SettingsFieldValues[K]) => unknown): void {
    if (destroyed) {
      return
    }
    savers[field] = save
    wired.add(field)
  }

  /**
   * A change made by the user (`control.setValue(value)`): it is shown at once
   * and saved once it has settled.
   * @param field - the field
   * @param value - the new value
   */
  function change<K extends FieldKey>(field: K, value: SettingsFieldValues[K]): void {
    patch(field, value)
    if (destroyed || !wired.has(field)) {
      return
    }
    const save = savers[field]!
    const delay = DEBOUNCE[field] ?? 0
    if (!delay) {
      void save(value)
      return
    }
    clearTimeout(timers.get(field))
    timers.set(field, setTimeout(() => {
      timers.delete(field)
      void save(value)
    }, delay))
  }

  // ===== Coalesced UI config writes =====

  // Pending-changes buffer for UI config writes — when several form fields
  // settle around the same time we coalesce their saves into one
  // PATCH /config-editor/ui (one disk write) instead of issuing one PUT per
  // field. The promise returned to each caller resolves when the next flush
  // completes so per-field "isSaving" indicators stay accurate.
  let pendingUiChanges = new Map<string, unknown>()
  let pendingUiFlushTimer: ReturnType<typeof setTimeout> | null = null
  let pendingUiFlush: { promise: Promise<void>, resolve: () => void, reject: (error: any) => void } | null = null

  /**
   * Queue one UI config change for the next flush.
   *
   * ⚠️ **This rejects when the write fails, and every caller has to let it.** The
   * caller's catch is what reports the failure and stops its spinner; a helper
   * that reported the error and then resolved anyway left every caller running
   * its success path over a write that never landed — clearing the "invalid"
   * marker, asking for a restart that would apply nothing, and in the case of
   * the menu mode reloading the page over the top of its own error toast.
   * @param key - the UI config key
   * @param value - the value to write
   */
  function queueUiSettingChange(key: string, value: unknown): Promise<void> {
    pendingUiChanges.set(key, value)

    if (!pendingUiFlush) {
      let resolve!: () => void
      let reject!: (error: any) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      pendingUiFlush = { promise, resolve, reject }
    }

    if (pendingUiFlushTimer) {
      clearTimeout(pendingUiFlushTimer)
    }
    pendingUiFlushTimer = setTimeout(() => void flushPendingUiChanges(), UI_FLUSH_COALESCE_MS)

    return pendingUiFlush.promise
  }

  async function flushPendingUiChanges(): Promise<void> {
    if (pendingUiFlushTimer) {
      clearTimeout(pendingUiFlushTimer)
      pendingUiFlushTimer = null
    }
    if (pendingUiChanges.size === 0 || !pendingUiFlush) {
      return
    }

    const payload = Object.fromEntries(pendingUiChanges)
    const flush = pendingUiFlush
    pendingUiChanges = new Map()
    pendingUiFlush = null

    try {
      await api.patch('/config-editor/ui', payload)
      flush.resolve()
    } catch (error) {
      flush.reject(error)
    }
  }

  // Cache for Matter config values (in-memory only, for restoring after accidental disable)
  const internals: { matterConfigCache: { port?: number, disableIpv4?: boolean } } = {
    matterConfigCache: {},
  }

  const page = {
    store,
    internals,
    change,
    patch,
    setInvalid,

    // ===== Search =====

    toggleSearch(): void {
      const show = !get().showSearchBar
      store.setState({ showSearchBar: show })
      if (!show) {
        // Clear search when hiding
        page.clearSearch()
      }
    },

    onSearchChange(value: string): void {
      store.setState({ searchQuery: value })
      page.filterSettings()
    },

    clearSearch(): void {
      store.setState({ searchQuery: '' })
      page.filterSettings()
    },

    filterSettings(): void {
      store.setState({ hiddenItems: filterSettings(get().searchQuery, page.getUnavailableItems()) })
    },

    getUnavailableItems(): string[] {
      const { platform, runningOnRaspberryPi, runningInDocker, isMatterDisableIpv4Enabled, isHapDisableIdentifyingMaterialEnabled, enableTerminalAccess } = flags()
      return getUnavailableItems({
        platform,
        runningOnRaspberryPi,
        runningInDocker,
        isMatterDisableIpv4Enabled,
        isHapDisableIdentifyingMaterialEnabled,
        enableTerminalAccess,
        matterEnabled: v().matterEnabled,
        hbLogSize: v().hbLogSize,
        uiTerminalPersistence: v().uiTerminalPersistence,
        uiAuth: v().uiAuth,
      })
    },

    isItemHidden(itemId: string): boolean {
      return !!get().hiddenItems[itemId]
    },

    isSectionVisible(sectionName: string): boolean {
      return isSectionVisible(sectionName, get().searchQuery, get().hiddenItems)
    },

    sectionNav() {
      return allSections.filter(section =>
        (flags().isMatterSupported || !['hap', 'matter'].includes(section.key)) && page.isSectionVisible(section.key),
      )
    },

    toggleSection(section: SettingsSection): void {
      store.setState(state => ({ showFields: { ...state.showFields, [section]: !state.showFields[section] } }))
    },

    /** Jump to a section from the index, opening it first if it was collapsed. */
    scrollToSection(key: SettingsSection): void {
      if (!get().showFields[key]) {
        store.setState(state => ({ showFields: { ...state.showFields, [key]: true } }))
      }
      store.setState({ activeSection: key })
      requestAnimationFrame(() => {
        document.getElementById(`settings-section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },

    /**
     * Highlight the section being read: the last one whose heading has scrolled
     * past the top quarter of the window.
     */
    updateActiveSection(): void {
      const nav = page.sectionNav()
      const threshold = window.innerHeight * 0.25
      let current: SettingsSection | undefined = nav[0]?.key
      for (const section of nav) {
        const element = document.getElementById(`settings-section-${section.key}`)
        if (element && element.getBoundingClientRect().top <= threshold) {
          current = section.key
        }
      }
      // At the very bottom the last sections can never reach the threshold
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = nav.at(-1)?.key
      }
      if (current && current !== get().activeSection) {
        store.setState({ activeSection: current })
      }
    },

    // ===== Loading =====

    async init(): Promise<void> {
      // A remount (StrictMode runs effects twice) starts over
      destroyed = false

      // Set page title
      settingsActions.setPageTitle(t('menu.label_settings'))

      if (isFeatureEnabled('childBridgeDebugMode')) {
        store.setState({ debugFieldDesc: 'settings.startup.debug_desc_v2' })
      }

      await page.initNetworkingOptions()
      await page.initStartupSettings()

      // (2) Disable some settings that can modify the URL from being changed from a PWA
      //     This is to stop users from getting stuck if they change the host or port
      if (flags().isPwa) {
        disable('uiPort')
        disable('uiHost')
        disable('uiProxyHost')
        disable('uiSslType')
      }

      // (2) Disable the SSL select box if running in raspbian image (externally managed)
      if (flags().runningOnRaspbianImage) {
        disable('uiSslType')
      }

      const settings = useSettingsStore.getState()
      const env = settings.env

      patch('hbName', env.homebridgeInstanceName)
      wire('hbName', value => page.hbNameSave(value!))

      patch('uiLang', env.lang ?? null)
      wire('uiLang', value => page.uiLangSave(value!))

      patch('uiTheme', settings.theme)
      wire('uiTheme', value => page.uiThemeSave(value!))

      patch('uiLight', settings.lightingMode)
      wire('uiLight', value => page.uiLightSave(value as 'auto' | 'light' | 'dark'))

      patch('uiGlass', settings.glassMode)
      wire('uiGlass', value => page.uiGlassSave(Boolean(value)))

      patch('uiMenu', settings.menuMode)
      wire('uiMenu', value => page.uiMenuSave(value as 'default' | 'freeze'))

      patch('uiTemp', env.temperatureUnits)
      wire('uiTemp', value => page.uiTempSave(value!))

      patch('uiTerminalPersistence', env.terminal?.persistence ?? null)
      wire('uiTerminalPersistence', value => page.uiTerminalPersistenceSave(value!))

      patch('uiTerminalHideWarning', env.terminal?.hideWarning ?? null)
      wire('uiTerminalHideWarning', value => page.uiTerminalHideWarningSave(value!))

      patch('uiTerminalBufferSize', env.terminal?.bufferSize ?? null)
      wire('uiTerminalBufferSize', value => page.uiTerminalBufferSizeSave(value!))

      // Validate and set terminal fontSize
      const savedFontSize = env.terminal?.fontSize
      if (savedFontSize !== undefined && (savedFontSize < 10 || savedFontSize > 20)) {
        // Invalid value, delete it from config
        void page.deleteInvalidSetting('terminal.fontSize')
        patch('uiTerminalFontSize', 13)
      } else {
        patch('uiTerminalFontSize', savedFontSize || 13)
      }
      wire('uiTerminalFontSize', value => page.uiTerminalFontSizeSave(value!))

      // Validate and set terminal fontWeight
      const savedFontWeight = env.terminal?.fontWeight
      if (savedFontWeight !== undefined && !fontWeights.includes(String(savedFontWeight))) {
        // Invalid value, delete it from config
        void page.deleteInvalidSetting('terminal.fontWeight')
        patch('uiTerminalFontWeight', '400')
      } else {
        patch('uiTerminalFontWeight', (savedFontWeight as string) || '400')
      }
      wire('uiTerminalFontWeight', value => page.uiTerminalFontWeightSave(value!))

      // Terminal lighting mode - default to dark, but allow light if main theme is light
      const savedTerminalTheme = env.terminal?.lightingMode
      const lightMode = useSettingsStore.getState().actualLightingMode === 'light'
      patch('uiTerminalLightingMode', lightMode ? (savedTerminalTheme || 'dark') : 'dark')
      // A light terminal inside a dark page is the one combination not offered
      if (useSettingsStore.getState().actualLightingMode === 'dark') {
        disable('uiTerminalLightingMode')
      }
      wire('uiTerminalLightingMode', value => page.uiTerminalLightingModeSave(value!))

      patch('hbLogSize', env.log?.maxSize ?? null)
      wire('hbLogSize', value => page.hbLogSizeSave(value!))

      patch('hbLogTruncate', env.log?.truncateSize ?? null)
      wire('hbLogTruncate', value => page.hbLogTruncateSave(value!))

      patch('uiPort', env.port)
      wire('uiPort', value => page.uiPortSave(value!))

      patch('uiAuth', settings.formAuth)
      wire('uiAuth', value => page.uiAuthSave(value!))

      // Convert seconds to days, hours, minutes
      const sessionTimeoutSeconds = settings.sessionTimeout
      patch('uiSessionTimeoutDays', Math.floor(sessionTimeoutSeconds / 86400))
      patch('uiSessionTimeoutHours', Math.floor((sessionTimeoutSeconds % 86400) / 3600))
      patch('uiSessionTimeoutMinutes', Math.floor((sessionTimeoutSeconds % 3600) / 60))
      wire('uiSessionTimeoutDays', () => page.uiSessionTimeoutSaveFromFields())
      wire('uiSessionTimeoutHours', () => page.uiSessionTimeoutSaveFromFields())
      wire('uiSessionTimeoutMinutes', () => page.uiSessionTimeoutSaveFromFields())

      patch('uiSessionTimeoutInactivityBased', settings.sessionTimeoutInactivityBased || false)
      wire('uiSessionTimeoutInactivityBased', value => page.uiSessionTimeoutInactivityBasedSave(value!))

      patch(
        'uiSslType',
        env.ssl?.selfSigned
          ? 'selfsigned'
          : env.ssl?.key || env.ssl?.cert
            ? 'keycert'
            : (env.ssl?.pfx || env.ssl?.hasPassphrase) ? 'pfx' : 'off',
      )

      patch('uiHost', settings.host || '')
      wire('uiHost', value => page.uiHostSave(value!))

      patch('uiProxyHost', settings.proxyHost || '')
      wire('uiProxyHost', value => page.uiProxyHostSave(value!))

      patch('hbPackage', env.homebridgePackagePath || '')
      wire('hbPackage', value => page.hbPackageSave(value!))

      patch('uiMetrics', !env.disableServerMetricsMonitoring)
      wire('uiMetrics', value => page.uiMetricsSave(value!))

      patch('enableMdnsAdvertise', env.enableMdnsAdvertise || false)
      wire('enableMdnsAdvertise', value => page.enableMdnsAdvertiseSave(value!))

      patch('uiAccDebug', env.accessoryControl?.debug ?? null)
      wire('uiAccDebug', value => page.uiAccDebugSave(value!))

      patch('uiTempFile', env.temp ?? null)
      wire('uiTempFile', value => page.uiTempFileSave(value!))

      patch('hbLinuxShutdown', env.linux?.shutdown ?? null)
      wire('hbLinuxShutdown', value => page.hbLinuxShutdownSave(value!))

      patch('hbLinuxRestart', env.linux?.restart ?? null)
      wire('hbLinuxRestart', value => page.hbLinuxRestartSave(value!))

      patch('scheduledRestartCron', env.scheduledRestartCron || '')
      wire('scheduledRestartCron', value => page.scheduledRestartCronSave(value!))

      await page.initMatterSettings()
      await page.initHapSettings()

      store.setState({ loading: false })
    },

    /** Drop what is still waiting to settle (takeUntilDestroyed). */
    destroy(): void {
      destroyed = true
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      wired.clear()
    },

    async initStartupSettings(): Promise<void> {
      try {
        const startupSettingsData = await api.get('/platform-tools/hb-service/homebridge-startup-settings')

        patch('hbDebug', startupSettingsData.HOMEBRIDGE_DEBUG)
        wire('hbDebug', value => page.hbDebugSave(value!))

        patch('hbInsecure', startupSettingsData.HOMEBRIDGE_INSECURE)
        wire('hbInsecure', value => page.hbInsecureSave(value!))

        patch('hbKeep', startupSettingsData.HOMEBRIDGE_KEEP_ORPHANS)
        wire('hbKeep', value => page.hbKeepSave(value!))

        patch('hbEnvDebug', startupSettingsData.ENV_DEBUG)
        wire('hbEnvDebug', value => page.hbEnvDebugSave(value!))

        patch('hbEnvNode', startupSettingsData.ENV_NODE_OPTIONS)
        wire('hbEnvNode', value => page.hbEnvNodeSave(value!))
      } catch (error) {
        reportError(error)
      }
    },

    async initNetworkingOptions(): Promise<void> {
      try {
        await page.getNetworkSettings()
        const env = settingsEnv()
        const onLinux = (
          env.runningInLinux
          || env.runningInDocker
          || env.runningInSynologyPackage
          || env.runningInPackageMode
        )
        if (onLinux) {
          store.setState({ showAvahiMdnsOption: true, showResolvedMdnsOption: true })
        }
      } catch (error) {
        reportError(error)
      }
    },

    async getNetworkSettings(): Promise<void> {
      const [system, adapters, mdnsAdvertiser, port, ports] = await Promise.all([
        api.get<NetworkAdapterAvailable[]>('/server/network-interfaces/system'),
        api.get<string[]>('/server/network-interfaces/bridge'),
        api.get<{ advertiser: string }>('/server/mdns-advertiser'),
        api.get<{ port: number }>('/server/port'),
        api.get<{ start?: number, end?: number }>('/server/ports'),
      ])

      store.setState({ adaptersAvailable: system })
      page.buildBridgeNetworkAdapterList(adapters)

      patch('hbMDns', mdnsAdvertiser.advertiser)
      wire('hbMDns', value => page.hbMDnsSave(value!))

      patch('hbPort', port.port)
      wire('hbPort', value => page.hbPortSave(value!))

      patch('hbStartPort', ports.start ?? null)
      wire('hbStartPort', value => page.hbStartPortSave(value!))

      patch('hbEndPort', ports.end ?? null)
      wire('hbEndPort', value => page.hbEndPortSave(value!))
    },

    async deleteInvalidSetting(key: string): Promise<void> {
      try {
        await api.delete(`/config-editor/ui/${key}`)
      } catch (error) {
        console.error(`Failed to delete invalid setting ${key}:`, error)
      }
    },

    // ===== Modals =====

    openBackupModal(): void {
      openModal(Backup, {}, MODAL_OPTIONS)
    },

    openConfigBackup(): void {
      // Go to /config?action=restore
      deps.navigate('/config?action=restore')
    },

    openWallpaperModal(): void {
      openModal(Wallpaper, {}, MODAL_OPTIONS)
    },

    async openSslModal(): Promise<void> {
      const modalRef = openModal(SslSettingsModal, {}, MODAL_OPTIONS)

      try {
        // Modal returns the selected mode when saved successfully
        const newSslType = await modalRef.result
        patch('uiSslType', newSslType)
        // Show the global restart toast since SSL changes require a restart
        settingsActions.showRestartToast()
      } catch {
        // Modal was dismissed without saving, do nothing
      }
    },

    resetHomebridgeState(): void {
      openModal(ResetAllBridges, {}, MODAL_OPTIONS)
    },

    unpairAccessory(): void {
      openModal(ResetIndividualBridges, {}, MODAL_OPTIONS)
    },

    removeAllCachedAccessories(): void {
      openModal(RemoveAllAccessories, {}, MODAL_OPTIONS)
    },

    async accessoryUiControl(): Promise<void> {
      try {
        const ref = openModal(AccessoryControlLists, {
          existingBlacklist: settingsEnv().accessoryControl?.instanceBlacklist || [],
        }, MODAL_OPTIONS)

        await ref.result
        settingsActions.showRestartToast()
      } catch (error) {
        if (error !== 'Dismiss') {
          reportError(error)
        }
      }
    },

    removeSingleCachedAccessories(): void {
      openModal(RemoveIndividualAccessories, { selectedBridge: '' }, MODAL_OPTIONS)
    },

    removeBridgeAccessories(): void {
      openModal(RemoveBridgeAccessories, {}, MODAL_OPTIONS)
    },

    async selectNetworkInterfaces(): Promise<void> {
      const ref = openModal(SelectNetworkInterfaces, {
        adaptersAvailable: get().adaptersAvailable,
        adaptersSelected: get().adaptersSelected,
      }, MODAL_OPTIONS)

      try {
        const adapters: string[] = await ref.result
        page.buildBridgeNetworkAdapterList(adapters)
        await api.put('/server/network-interfaces/bridge', { adapters })
        settingsActions.showRestartToast()
      } catch (error) {
        if (error !== 'Dismiss') {
          reportError(error)
        }
      }
    },

    openPortOverview(): void {
      openModal(PortOverviewModal, {}, MODAL_OPTIONS)
    },

    buildBridgeNetworkAdapterList(adapters: string[]): void {
      if (!adapters.length) {
        store.setState({ adaptersSelected: [] })
        return
      }

      store.setState({
        adaptersSelected: adapters.map((interfaceName) => {
          const i = get().adaptersAvailable.find(x => x.iface === interfaceName)
          if (i) {
            return {
              iface: i.iface,
              selected: true,
              missing: false,
              ip4: i.ip4,
              ip6: i.ip6,
            }
          }
          return {
            iface: interfaceName,
            selected: true,
            missing: true,
          }
        }),
      })
    },

    // ===== Saves: general and display =====

    async hbNameSave(value: string): Promise<void> {
      if (!value || !RE_HAP_NAME_PATTERN.test(value)) {
        setInvalid('hbName', true)
        return
      }

      try {
        setSaving('hbName', true)
        await api.put('/server/name', { name: value })
        settingsActions.setEnvItem('homebridgeInstanceName', value)
        setInvalid('hbName', false)
        setTimeout(setSaving, 1000, 'hbName', false)
      } catch (error) {
        reportError(error)
        setSaving('hbName', false)
      }
    },

    async uiLangSave(value: string): Promise<void> {
      try {
        setSaving('uiLang', true)
        settingsActions.setLang(value)
        await queueUiSettingChange('lang', value)

        // Reload once the choice is safely saved, if the new language formats its
        // dates and numbers differently.
        //
        // Translated text switches straight away, but the formatting locale - which
        // every date, time and number formatter reads - is decided once when the
        // app loads. Without this the page would go on formatting for the previous
        // language until the user happened to reload.
        //
        // Only when the locale actually differs: switching between two languages
        // that share one (pt and pt-BR), or picking 'auto' when the browser is
        // already set to the same language, should not throw the page away.
        if (page.localeAfterReload() !== bootLocale) {
          window.location.reload()
          return
        }

        setTimeout(setSaving, 1000, 'uiLang', false)
      } catch (error) {
        reportError(error)
        setSaving('uiLang', false)
      }
    },

    /**
     * The locale the UI will format with after the next load.
     *
     * `setLang` has already stored the choice, so this asks the same question the
     * locale is decided by at the next load rather than repeating its rules -
     * 'auto' and a language the app no longer ships included.
     */
    localeAfterReload(): string {
      const { lang, culture } = browserLang()
      return localeIdFor(chooseStartupLanguage(lang, culture))
    },

    async uiThemeSave(value: string): Promise<void> {
      try {
        setSaving('uiTheme', true)

        // Start fade-out animation
        store.setState({ isThemeTransitioning: true })

        // Wait for fade-out to complete
        await new Promise(resolve => setTimeout(resolve, 250))

        // Change the theme (background will transition)
        settingsActions.setTheme(value)
        await queueUiSettingChange('theme', value)

        // Wait for background transition to start, then fade content back in
        await new Promise(resolve => setTimeout(resolve, 100))
        store.setState({ isThemeTransitioning: false })

        setTimeout(setSaving, 1000, 'uiTheme', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTheme', false)
        store.setState({ isThemeTransitioning: false })
      }
    },

    async uiLightSave(value: 'auto' | 'light' | 'dark'): Promise<void> {
      try {
        setSaving('uiLight', true)

        // Start fade-out animation
        store.setState({ isThemeTransitioning: true })

        // Wait for fade-out to complete
        await new Promise(resolve => setTimeout(resolve, 250))

        // Change the lighting mode (background will transition)
        settingsActions.setLightingMode(value, 'user')
        await queueUiSettingChange('lightingMode', value)

        // Wait for background transition to start, then fade content back in
        await new Promise(resolve => setTimeout(resolve, 100))
        store.setState({ isThemeTransitioning: false })

        setTimeout(setSaving, 1000, 'uiLight', false)
      } catch (error) {
        reportError(error)
        setSaving('uiLight', false)
        store.setState({ isThemeTransitioning: false })
      }
    },

    async uiGlassSave(value: boolean): Promise<void> {
      try {
        setSaving('uiGlass', true)
        settingsActions.setGlassMode(value)
        await queueUiSettingChange('glassMode', value)
        setTimeout(setSaving, 1000, 'uiGlass', false)
      } catch (error) {
        reportError(error)
        setSaving('uiGlass', false)
      }
    },

    async uiMenuSave(value: 'default' | 'freeze'): Promise<void> {
      try {
        setSaving('uiMenu', true)
        settingsActions.setMenuMode(value)
        await queueUiSettingChange('menuMode', value)
        window.location.reload()
      } catch (error) {
        reportError(error)
        setSaving('uiMenu', false)
      }
    },

    async uiTempSave(value: string): Promise<void> {
      try {
        setSaving('uiTemp', true)
        settingsActions.setEnvItem('temperatureUnits', value)
        await queueUiSettingChange('tempUnits', value)
        setTimeout(setSaving, 1000, 'uiTemp', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTemp', false)
      }
    },

    // ===== Saves: terminal =====

    async uiTerminalPersistenceSave(value: boolean): Promise<void> {
      // If turning off persistence and there's an active session, show confirmation
      if (!value && terminal.hasActiveSession()) {
        const ref = openModal(Confirm, {
          title: t('settings.terminal.persistence_confirm_title'),
          message: t('settings.terminal.persistence_confirm_message'),
          message2: t('common.phrases.are_you_sure'),
          confirmButtonLabel: t('form.button_continue'),
          confirmButtonClass: 'btn-primary',
          faIconClass: 'fas fa-exclamation-triangle text-warning',
        }, MODAL_OPTIONS)

        try {
          // An error will throw if the user cancels the modal
          await ref.result
        } catch {
          // User canceled, revert the value
          patch('uiTerminalPersistence', true)
          return
        }
      }

      try {
        setSaving('uiTerminalPersistence', true)

        // If persistence is being turned off, clean up any existing session completely
        if (!value) {
          void terminal.destroyPersistentSession()
        }

        settingsActions.setEnvItem('terminal.persistence', value)
        await queueUiSettingChange('terminal.persistence', value)
        setTimeout(setSaving, 1000, 'uiTerminalPersistence', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalPersistence', false)
      }
    },

    async uiTerminalHideWarningSave(value: boolean): Promise<void> {
      try {
        setSaving('uiTerminalHideWarning', true)
        settingsActions.setEnvItem('terminal.hideWarning', value)
        await queueUiSettingChange('terminal.hideWarning', value)
        setTimeout(setSaving, 1000, 'uiTerminalHideWarning', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalHideWarning', false)
      }
    },

    async uiTerminalBufferSizeSave(value: number): Promise<void> {
      if (value && (typeof value !== 'number' || value < 0 || Number.isInteger(value) === false)) {
        setInvalid('uiTerminalBufferSize', true)
        return
      }

      try {
        setSaving('uiTerminalBufferSize', true)
        settingsActions.setEnvItem('terminal.bufferSize', value)
        await queueUiSettingChange('terminal.bufferSize', value)
        setInvalid('uiTerminalBufferSize', false)
        setTimeout(setSaving, 1000, 'uiTerminalBufferSize', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalBufferSize', false)
      }
    },

    async uiTerminalFontSizeSave(value: number): Promise<void> {
      try {
        setSaving('uiTerminalFontSize', true)
        settingsActions.setEnvItem('terminal.fontSize', value)
        await queueUiSettingChange('terminal.fontSize', value)
        setTimeout(setSaving, 1000, 'uiTerminalFontSize', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalFontSize', false)
      }
    },

    async uiTerminalFontWeightSave(value: string): Promise<void> {
      try {
        setSaving('uiTerminalFontWeight', true)
        settingsActions.setEnvItem('terminal.fontWeight', value)
        await queueUiSettingChange('terminal.fontWeight', value)
        setTimeout(setSaving, 1000, 'uiTerminalFontWeight', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalFontWeight', false)
      }
    },

    async uiTerminalLightingModeSave(value: string): Promise<void> {
      try {
        setSaving('uiTerminalLightingMode', true)
        settingsActions.setEnvItem('terminal.lightingMode', value)
        settingsActions.updateTerminalBodyClass()
        await queueUiSettingChange('terminal.lightingMode', value)
        setTimeout(setSaving, 1000, 'uiTerminalLightingMode', false)
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalLightingMode', false)
      }
    },

    async hbLogSizeSave(value: number): Promise<void> {
      if (value && (typeof value !== 'number' || value < -1 || Number.isInteger(value) === false)) {
        setInvalid('hbLogSize', true)
        return
      }

      try {
        setSaving('hbLogSize', true)
        settingsActions.setEnvItem('log.maxSize', value)
        if (!value || value === -1) {
          // If the value is -1, we set the log.maxSize to undefined
          // This will remove the setting from the config file
          await queueUiSettingChange('log.truncateSize', null)
          setInvalid('hbLogTruncate', false)
        }
        await queueUiSettingChange('log.maxSize', value)
        setInvalid('hbLogSize', false)
        setTimeout(() => {
          setSaving('hbLogSize', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('hbLogSize', false)
      }
    },

    async hbLogTruncateSave(value: number): Promise<void> {
      if (value && (typeof value !== 'number' || value < 0 || Number.isInteger(value) === false)) {
        setInvalid('hbLogTruncate', true)
        return
      }

      try {
        setSaving('hbLogTruncate', true)
        settingsActions.setEnvItem('log.truncateSize', value)
        await queueUiSettingChange('log.truncateSize', value)
        setInvalid('hbLogTruncate', false)
        setTimeout(() => {
          setSaving('hbLogTruncate', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('hbLogTruncate', false)
      }
    },

    // ===== Saves: startup =====

    /**
     * The startup settings endpoint replaces the block wholesale, so every
     * field has to be sent or the others are wiped.
     * @param field - the field that changed
     * @param key - its key in the block
     * @param value - its new value
     */
    async startupSave(field: 'hbDebug' | 'hbInsecure' | 'hbKeep' | 'hbEnvDebug' | 'hbEnvNode', key: string, value: unknown): Promise<void> {
      try {
        setSaving(field, true)
        await api.put('/platform-tools/hb-service/homebridge-startup-settings', {
          HOMEBRIDGE_DEBUG: v().hbDebug,
          HOMEBRIDGE_KEEP_ORPHANS: v().hbKeep,
          HOMEBRIDGE_INSECURE: v().hbInsecure,
          ENV_DEBUG: v().hbEnvDebug,
          ENV_NODE_OPTIONS: v().hbEnvNode,
          [key]: value,
        })
        if (field === 'hbKeep') {
          settingsActions.setKeepOrphans(value as boolean)
        }
        setTimeout(() => {
          setSaving(field, false)
          fullServiceRestartThenToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving(field, false)
      }
    },

    hbDebugSave(value: boolean): Promise<void> {
      return page.startupSave('hbDebug', 'HOMEBRIDGE_DEBUG', value)
    },

    hbInsecureSave(value: boolean): Promise<void> {
      return page.startupSave('hbInsecure', 'HOMEBRIDGE_INSECURE', value)
    },

    hbKeepSave(value: boolean): Promise<void> {
      return page.startupSave('hbKeep', 'HOMEBRIDGE_KEEP_ORPHANS', value)
    },

    hbEnvDebugSave(value: string): Promise<void> {
      return page.startupSave('hbEnvDebug', 'ENV_DEBUG', value)
    },

    hbEnvNodeSave(value: string): Promise<void> {
      return page.startupSave('hbEnvNode', 'ENV_NODE_OPTIONS', value)
    },

    /**
     * A UI config value that needs a restart to apply.
     * @param field - the field saved
     * @param envKey - where it lives in `env` (`setEnvItem`), or nothing
     * @param configKey - the UI config key
     * @param value - the value to write
     * @param fullRestart - flag a full service restart before the toast
     */
    async uiConfigSave(field: FieldKey, envKey: string | null, configKey: string, value: unknown, fullRestart: boolean): Promise<void> {
      try {
        setSaving(field, true)
        if (envKey) {
          settingsActions.setEnvItem(envKey, value)
        }
        await queueUiSettingChange(configKey, value)
        setTimeout(() => {
          setSaving(field, false)
          if (fullRestart) {
            fullServiceRestartThenToast()
          } else {
            settingsActions.showRestartToast()
          }
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving(field, false)
      }
    },

    hbPackageSave(value: string): Promise<void> {
      return page.uiConfigSave('hbPackage', 'homebridgePackagePath', 'homebridgePackagePath', value, false)
    },

    uiMetricsSave(value: boolean): Promise<void> {
      return page.uiConfigSave('uiMetrics', 'disableServerMetricsMonitoring', 'disableServerMetricsMonitoring', !value, true)
    },

    enableMdnsAdvertiseSave(value: boolean): Promise<void> {
      return page.uiConfigSave('enableMdnsAdvertise', 'enableMdnsAdvertise', 'enableMdnsAdvertise', value, true)
    },

    uiAccDebugSave(value: boolean): Promise<void> {
      return page.uiConfigSave('uiAccDebug', 'accessoryControl.debug', 'accessoryControl.debug', value, false)
    },

    uiTempFileSave(value: string): Promise<void> {
      return page.uiConfigSave('uiTempFile', 'temp', 'temp', value, true)
    },

    hbLinuxShutdownSave(value: string): Promise<void> {
      return page.uiConfigSave('hbLinuxShutdown', 'linux.shutdown', 'linux.shutdown', value, true)
    },

    hbLinuxRestartSave(value: string): Promise<void> {
      return page.uiConfigSave('hbLinuxRestart', 'linux.restart', 'linux.restart', value, true)
    },

    validateCronExpression(cron: string): boolean {
      // Empty is valid (disables scheduled restart)
      if (!cron || !cron.trim()) {
        return true
      }

      // Must have exactly 5 fields: minute hour day month weekday
      const fields = cron.trim().split(RE_WHITESPACE_SINGLE)
      if (fields.length !== 5) {
        return false
      }

      return fields.every(field => RE_CRON_FIELD.test(field))
    },

    async scheduledRestartCronSave(value: string): Promise<void> {
      // Validate cron expression
      if (!page.validateCronExpression(value)) {
        setInvalid('scheduledRestartCron', true)
        return
      }

      setInvalid('scheduledRestartCron', false)

      // Convert empty string to null
      const cronValue = value?.trim() ? value : null
      await page.uiConfigSave('scheduledRestartCron', 'scheduledRestartCron', 'scheduledRestartCron', cronValue, true)
    },

    // ===== Saves: network =====

    async hbMDnsSave(value: string): Promise<void> {
      try {
        setSaving('hbMDns', true)
        await api.put('/server/mdns-advertiser', { advertiser: value })
        setTimeout(() => {
          setSaving('hbMDns', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('hbMDns', false)
      }
    },

    async hbPortSave(value: number): Promise<void> {
      if (value === v().uiPort) {
        setInvalid('hbPort', true)
        return
      }

      try {
        setSaving('hbPort', true)
        await api.put('/server/port', { port: value })
        setInvalid('hbPort', false)
        setTimeout(() => {
          setSaving('hbPort', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('hbPort', false)
      }
    },

    /**
     * One end of a port range. Both ends are always sent: the endpoint replaces
     * the pair, so sending only the end that changed would wipe the other.
     * @param url - the range endpoint
     * @param field - the end being saved
     * @param value - its new value
     */
    async portRangeSave(url: string, field: 'hbStartPort' | 'hbEndPort' | 'matterStartPort' | 'matterEndPort', value: number): Promise<void> {
      if (value && (typeof value !== 'number' || !Number.isInteger(value) || value < 1025 || value > 65533)) {
        setInvalid(field, true)
        return
      }
      const isStart = field.endsWith('StartPort')
      const otherField = isStart ? field.replace('Start', 'End') as FieldKey : field.replace('End', 'Start') as FieldKey
      const other = v()[otherField] as number | null
      const [start, end] = isStart ? [value, other] : [other, value]
      if (value && other && start! >= end!) {
        setInvalid(field, true)
        return
      }
      try {
        setSaving(field, true)
        setInvalid(field, false)
        await api.put(url, { start: start || undefined, end: end || undefined })
        setTimeout(() => {
          setSaving(field, false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving(field, false)
        setInvalid(field, true)
      }
    },

    hbStartPortSave(value: number): Promise<void> {
      return page.portRangeSave('/server/ports', 'hbStartPort', value)
    },

    hbEndPortSave(value: number): Promise<void> {
      return page.portRangeSave('/server/ports', 'hbEndPort', value)
    },

    async uiPortSave(value: number): Promise<void> {
      if (!value || typeof value !== 'number' || value < 1025 || value > 65533 || Number.isInteger(value) === false || value === v().hbPort) {
        setInvalid('uiPort', true)
        return
      }

      try {
        setSaving('uiPort', true)
        settingsActions.setEnvItem('port', value)
        await queueUiSettingChange('port', value)
        setInvalid('uiPort', false)
        setTimeout(() => {
          setSaving('uiPort', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('uiPort', false)
      }
    },

    async uiHostSave(value: string): Promise<void> {
      try {
        setSaving('uiHost', true)
        settingsActions.setItem('host', value)
        await queueUiSettingChange('host', value)
        setTimeout(() => {
          setSaving('uiHost', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('uiHost', false)
      }
    },

    async uiProxyHostSave(value: string): Promise<void> {
      try {
        setSaving('uiProxyHost', true)
        settingsActions.setItem('proxyHost', value)
        await queueUiSettingChange('proxyHost', value)
        setTimeout(() => {
          setSaving('uiProxyHost', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('uiProxyHost', false)
      }
    },

    // ===== Saves: security =====

    async uiAuthSave(value: boolean): Promise<void> {
      try {
        setSaving('uiAuth', true)
        settingsActions.setItem('formAuth', value)
        await queueUiSettingChange('auth', value ? 'form' : 'none')
        notifications.set('formAuthEnabled', value)
        setTimeout(() => {
          setSaving('uiAuth', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('uiAuth', false)
      }
    },

    async uiSessionTimeoutSaveFromFields(): Promise<void> {
      const days = page.normalizeSessionTimeoutField('uiSessionTimeoutDays', 0, 365)
      const hours = page.normalizeSessionTimeoutField('uiSessionTimeoutHours', 0, 23)
      const minutes = page.normalizeSessionTimeoutField('uiSessionTimeoutMinutes', 0, 59)

      if (days === null || hours === null || minutes === null) {
        return
      }

      // Convert to seconds
      const totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60)

      // Validate total: minimum 10 minutes (600 seconds)
      if (totalSeconds < 600) {
        setInvalid('uiSessionTimeoutMinutes', true)
        return
      }

      try {
        setSaving('uiSessionTimeout', true)
        settingsActions.setItem('sessionTimeout', totalSeconds)
        await queueUiSettingChange('sessionTimeout', totalSeconds)
        setInvalid('uiSessionTimeoutDays', false)
        setInvalid('uiSessionTimeoutHours', false)
        setInvalid('uiSessionTimeoutMinutes', false)
        setTimeout(() => {
          setSaving('uiSessionTimeout', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('uiSessionTimeout', false)
      }
    },

    normalizeSessionTimeoutField(field: 'uiSessionTimeoutDays' | 'uiSessionTimeoutHours' | 'uiSessionTimeoutMinutes', min: number, max: number): number | null {
      const value = v()[field] ?? 0

      if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max || !Number.isInteger(value)) {
        setInvalid(field, true)
        return null
      }

      setInvalid(field, false)
      patch(field, value)
      return value
    },

    async uiSessionTimeoutInactivityBasedSave(value: boolean): Promise<void> {
      try {
        setSaving('uiSessionTimeoutInactivityBased', true)
        settingsActions.setItem('sessionTimeoutInactivityBased', value)
        await queueUiSettingChange('sessionTimeoutInactivityBased', value)
        setTimeout(() => {
          setSaving('uiSessionTimeoutInactivityBased', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('uiSessionTimeoutInactivityBased', false)
      }
    },

    // ===== Matter =====

    async initMatterSettings(): Promise<void> {
      try {
        const [matterConfig, matterPorts] = await Promise.all([
          api.get('/config-editor/matter'),
          api.get<{ start?: number, end?: number }>('/config-editor/matter/ports'),
        ])

        // null = Matter not configured. A block with `enabled: false` is the
        // in-place disabled state (configured but off) — treat it as disabled.
        const isEnabled = matterConfig !== null && matterConfig.enabled !== false

        // Remember the configured port (even when disabled in place) so re-enabling
        // reuses it and keeps the existing commissioning storage.
        if (matterConfig?.port || matterConfig?.disableIpv4) {
          internals.matterConfigCache = { port: matterConfig.port, disableIpv4: matterConfig.disableIpv4 === true || undefined }
        }

        if (isEnabled) {
          // Matter is enabled - populate fields with config values
          patch('matterPort', matterConfig.port || null)
        } else {
          // Matter is disabled - set default values but don't show fields
          patch('matterPort', 0)
        }

        wire('matterPort', value => page.matterPortSave(value!))

        // disableIpv4 toggle (Homebridge >= 2.2.0 only)
        patch('matterDisableIpv4', matterConfig?.disableIpv4 === true)
        if (flags().isMatterDisableIpv4Enabled) {
          wire('matterDisableIpv4', value => page.matterDisableIpv4Save(value === true))
        }

        // Matter port range
        patch('matterStartPort', matterPorts.start ?? null)
        wire('matterStartPort', value => page.matterStartPortSave(value!))

        patch('matterEndPort', matterPorts.end ?? null)
        wire('matterEndPort', value => page.matterEndPortSave(value!))

        // Set enabled state
        patch('matterEnabled', isEnabled)
        // externalsOnly is only meaningful when matter.enabled === false. Read
        // and wire regardless so toggling produces a save.
        patch('matterExternalsOnly', matterConfig?.externalsOnly === true)

        wire('matterEnabled', value => page.matterEnabledSave(value!))
        if (flags().isProtocolExternalsOnlyEnabled) {
          wire('matterExternalsOnly', value => page.matterExternalsOnlySave(value === true))
        }
      } catch (error) {
        console.error(error)
        // Don't show error toast - Matter might not be configured yet
        // Wire the toggle even if config doesn't exist yet
        wire('matterEnabled', value => page.matterEnabledSave(value!))
      }
    },

    /**
     * Save the Matter externalsOnly flag. Only meaningful when Matter is
     * disabled in place. Uses the existing /matter/enabled endpoint with
     * `enabled: false` plus the new `externalsOnly` field.
     * @param value - the flag
     */
    async matterExternalsOnlySave(value: boolean): Promise<void> {
      if (v().matterEnabled !== false) {
        return
      }
      try {
        setSaving('matterExternalsOnly', true)
        await api.put('/config-editor/matter/enabled', { enabled: false, externalsOnly: value, restart: false })
        await page.requestFullServiceRestart()
      } catch (error) {
        reportError(error)
        patch('matterExternalsOnly', !value)
      } finally {
        setSaving('matterExternalsOnly', false)
      }
    },

    /**
     * Save the Matter disableIpv4 flag. PUT /config-editor/matter replaces the
     * whole bridge.matter block, so the current port is sent alongside to
     * preserve it (and vice versa in matterPortSave).
     * @param value - the flag
     */
    async matterDisableIpv4Save(value: boolean): Promise<void> {
      try {
        setSaving('matterDisableIpv4', true)
        const port = v().matterPort
        await api.put('/config-editor/matter', {
          port: port || undefined,
          disableIpv4: value || undefined,
        })
        setTimeout(() => {
          setSaving('matterDisableIpv4', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        patch('matterDisableIpv4', !value)
        setSaving('matterDisableIpv4', false)
      }
    },

    async matterPortSave(value: number | null | undefined | ''): Promise<void> {
      // Port is optional - if empty/null/undefined, just save without validation
      if (!value && value !== 0) {
        // Empty value is valid (optional field)
        try {
          setSaving('matterPort', true)
          setInvalid('matterPort', false)
          await api.put('/config-editor/matter', {
            port: undefined,
            disableIpv4: v().matterDisableIpv4 || undefined,
          })
          setTimeout(() => {
            setSaving('matterPort', false)
            settingsActions.showRestartToast()
          }, 1000)
        } catch (error) {
          reportError(error)
          setSaving('matterPort', false)
        }
        return
      }

      // If a value is provided, validate it
      if (typeof value !== 'number' || value < 1024 || value > 65535 || Number.isInteger(value) === false) {
        setInvalid('matterPort', true)
        return
      }

      // Check for reserved ports
      if ([5353, 8080, 8443].includes(value)) {
        setInvalid('matterPort', true)
        toast.error('Port 5353, 8080, and 8443 are reserved and cannot be used', t('toast.title_error'))
        return
      }

      try {
        setSaving('matterPort', true)
        setInvalid('matterPort', false)
        await api.put('/config-editor/matter', {
          port: value,
          disableIpv4: v().matterDisableIpv4 || undefined,
        })
        setTimeout(() => {
          setSaving('matterPort', false)
          settingsActions.showRestartToast()
        }, 1000)
      } catch (error) {
        reportError(error)
        setSaving('matterPort', false)
        setInvalid('matterPort', true)
      }
    },

    matterStartPortSave(value: number): Promise<void> {
      return page.portRangeSave('/config-editor/matter/ports', 'matterStartPort', value)
    },

    matterEndPortSave(value: number): Promise<void> {
      return page.portRangeSave('/config-editor/matter/ports', 'matterEndPort', value)
    },

    /** A port for matter: the cached one, else one the server picks, else one from the matter range. */
    async matterPortToUse(): Promise<number | undefined> {
      if (internals.matterConfigCache.port) {
        return internals.matterConfigCache.port
      }
      try {
        const portResponse = await api.get('/server/port/new/matter')
        return portResponse!.port
      } catch (error) {
        console.error('Failed to get Matter port, using fallback', error)
        // Fallback to Matter port range if API call fails
        return Math.floor(Math.random() * (5541 - 5530 + 1) + 5530)
      }
    },

    async matterEnabledSave(value: boolean): Promise<void> {
      // Refuse to disable Matter unless HAP is enabled — at least one protocol is
      // required unless the running Homebridge supports disabling all protocols.
      if (!value && !v().hapEnabled && !flags().allowDisableAllProtocols) {
        toast.info(t('settings.matter.requires_hap'), t('toast.title_notice'))
        patch('matterEnabled', true)
        return
      }

      if (flags().allowMatterDisableInPlace) {
        // Non-destructive: Matter commissioning is preserved (matter.enabled=false),
        // so skip the confirm modal and the immediate restart. Write the change,
        // flag a full service restart, and let the user restart via the toast.
        try {
          setSaving('matterEnabled', true)
          if (value) {
            // Enable: reuse the cached/allocated port. Writing the block clears any
            // `enabled: false`, and the preserved storage keeps commissioning.
            const port = await page.matterPortToUse()
            const disableIpv4 = internals.matterConfigCache.disableIpv4 || undefined
            await api.put('/config-editor/matter', { port, disableIpv4 })
            if (port !== undefined) {
              patch('matterPort', port)
            }
            patch('matterDisableIpv4', disableIpv4 === true)
            internals.matterConfigCache = { port, disableIpv4 }
            // Re-enabling clears externalsOnly — validation rejects enabled + externalsOnly.
            if (flags().isProtocolExternalsOnlyEnabled) {
              patch('matterExternalsOnly', false)
            }
          } else {
            // Disable in place: keep the block, port and commissioning storage.
            internals.matterConfigCache = {
              port: v().matterPort || undefined,
              disableIpv4: v().matterDisableIpv4 || undefined,
            }
            const body: { enabled: boolean, restart: boolean, externalsOnly?: boolean } = { enabled: false, restart: false }
            if (flags().isProtocolExternalsOnlyEnabled) {
              body.externalsOnly = v().matterExternalsOnly === true
            }
            await api.put('/config-editor/matter/enabled', body)
          }
          await page.requestFullServiceRestart()
        } catch (error) {
          reportError(error)
          patch('matterEnabled', !value)
        } finally {
          setSaving('matterEnabled', false)
        }
        return
      }

      try {
        setSaving('matterEnabled', true)
        if (value) {
          // When enabling, restore cached port if it exists, otherwise query for available port
          const port = await page.matterPortToUse()

          const disableIpv4 = internals.matterConfigCache.disableIpv4 || undefined
          await api.put('/config-editor/matter', {
            port,
            disableIpv4,
          })

          // Update the form value
          if (port !== undefined) {
            patch('matterPort', port)
          }
          patch('matterDisableIpv4', disableIpv4 === true)

          // Update cache with current value
          internals.matterConfigCache = { port, disableIpv4 }

          setTimeout(() => {
            setSaving('matterEnabled', false)
            settingsActions.showRestartToast()
          }, 1000)
        } else {
          // When disabling, show confirmation modal
          const ref = openModal(Confirm, {
            title: t('settings.matter.disable'),
            message: t(flags().allowMatterDisableInPlace ? 'settings.matter.disable_desc_in_place' : 'settings.matter.disable_desc'),
            message2: t('common.phrases.are_you_sure'),
            confirmButtonLabel: t('form.button_continue'),
            confirmButtonClass: 'btn-danger',
            faIconClass: 'fas fa-exclamation-triangle text-warning',
          }, MODAL_OPTIONS)

          try {
            // Wait for user confirmation
            await ref.result

            // User confirmed - cache the current port value before deleting
            internals.matterConfigCache = {
              port: v().matterPort || undefined,
            }

            // Hide the restart toast if it's shown
            settingsActions.clearRestartToast()

            deps.navigate('/restart?alreadyRestarting=true')
            if (flags().allowMatterDisableInPlace) {
              // Non-destructive disable: keep the config block + commissioning
              // storage, just mark Matter off so re-enabling needs no re-pairing.
              await api.put('/config-editor/matter/enabled', { enabled: false })
            } else {
              // Legacy teardown on older Homebridge: remove the block and its storage.
              await api.delete('/config-editor/matter')
            }
          } catch (error) {
            if (error !== 'Dismiss') {
              // Actual error - show error message
              reportError(error)
            }
            // Revert the toggle (the user cancelled, or it failed)
            patch('matterEnabled', true)
            setSaving('matterEnabled', false)
          }
        }
      } catch (error) {
        reportError(error)
        patch('matterEnabled', value)
        setSaving('matterEnabled', false)
      }
    },

    // ===== HAP =====

    async initHapSettings(): Promise<void> {
      try {
        const { enabled, externalsOnly, disableIdentifyingMaterial } = await api.get<{ enabled: boolean, externalsOnly?: boolean, disableIdentifyingMaterial?: boolean }>('/config-editor/hap')
        patch('hapEnabled', enabled)
        patch('hapExternalsOnly', externalsOnly === true)
        patch('hapDisableIdentifyingMaterial', disableIdentifyingMaterial === true)
      } catch (error) {
        console.error(error)
        // Fall back to enabled (default) — wire regardless so user can change it
        patch('hapEnabled', true)
        patch('hapExternalsOnly', false)
        patch('hapDisableIdentifyingMaterial', false)
      }
      wire('hapEnabled', value => page.hapEnabledSave(value!))
      if (flags().isProtocolExternalsOnlyEnabled) {
        wire('hapExternalsOnly', value => page.hapExternalsOnlySave(value === true))
      }
      if (flags().isHapDisableIdentifyingMaterialEnabled) {
        wire('hapDisableIdentifyingMaterial', value => page.hapDisableIdentifyingMaterialSave(value === true))
      }
    },

    /**
     * Save the HAP externalsOnly flag. Only meaningful when HAP is disabled.
     * Re-uses the existing /hap endpoint with `enabled: false` plus the new
     * `externalsOnly` field, which the backend writes alongside enabled: false.
     * @param value - the flag
     */
    async hapExternalsOnlySave(value: boolean): Promise<void> {
      if (v().hapEnabled !== false) {
        // Defensive: should be hidden in the UI but guard against direct invocation.
        return
      }
      try {
        setSaving('hapExternalsOnly', true)
        await api.put('/config-editor/hap', {
          enabled: false,
          externalsOnly: value,
          disableIdentifyingMaterial: v().hapDisableIdentifyingMaterial === true,
          restart: false,
        })
        await page.requestFullServiceRestart()
      } catch (error) {
        reportError(error)
        patch('hapExternalsOnly', !value)
      } finally {
        setSaving('hapExternalsOnly', false)
      }
    },

    /**
     * Save whether HAP-NodeJS should omit username-derived identifying material
     * from bridge display names and mDNS service instance names.
     * @param value - the flag
     */
    async hapDisableIdentifyingMaterialSave(value: boolean): Promise<void> {
      try {
        setSaving('hapDisableIdentifyingMaterial', true)
        await api.put('/config-editor/hap', {
          enabled: v().hapEnabled !== false,
          externalsOnly: v().hapExternalsOnly === true,
          disableIdentifyingMaterial: value,
          restart: false,
        })
        await page.requestFullServiceRestart()
      } catch (error) {
        reportError(error)
        patch('hapDisableIdentifyingMaterial', !value)
      } finally {
        setSaving('hapDisableIdentifyingMaterial', false)
      }
    },

    async hapEnabledSave(value: boolean): Promise<void> {
      // Refuse to disable HAP unless Matter is enabled — at least one protocol is
      // required unless the running Homebridge supports disabling all protocols.
      if (!value && !v().matterEnabled && !flags().allowDisableAllProtocols) {
        toast.info(t('settings.hap.requires_matter'), t('toast.title_notice'))
        patch('hapEnabled', true)
        return
      }

      const identifyingMaterial = () => flags().isHapDisableIdentifyingMaterialEnabled
        ? v().hapDisableIdentifyingMaterial === true
        : undefined

      if (flags().allowMatterDisableInPlace) {
        // Non-destructive: HAP pairing is always preserved, so skip the confirm
        // modal and the immediate restart. Write the change, flag a full service
        // restart, and let the user restart via the toast when ready.
        try {
          setSaving('hapEnabled', true)
          const body: { enabled: boolean, restart: boolean, externalsOnly?: boolean, disableIdentifyingMaterial?: boolean } = { enabled: value, restart: false }
          // When disabling HAP, propagate the current externalsOnly setting (if the
          // feature is supported). When re-enabling, clear it from the form too;
          // the backend removes externalsOnly while retaining independent options.
          if (flags().isProtocolExternalsOnlyEnabled) {
            if (!value) {
              body.externalsOnly = v().hapExternalsOnly === true
            } else {
              patch('hapExternalsOnly', false)
            }
          }
          if (flags().isHapDisableIdentifyingMaterialEnabled) {
            body.disableIdentifyingMaterial = v().hapDisableIdentifyingMaterial === true
          }
          await api.put('/config-editor/hap', body)
          await page.requestFullServiceRestart()
        } catch (error) {
          reportError(error)
          patch('hapEnabled', !value)
        } finally {
          setSaving('hapEnabled', false)
        }
        return
      }

      try {
        setSaving('hapEnabled', true)
        if (value) {
          await api.put('/config-editor/hap', {
            enabled: true,
            disableIdentifyingMaterial: identifyingMaterial(),
          })
          setTimeout(() => {
            setSaving('hapEnabled', false)
            settingsActions.showRestartToast()
          }, 1000)
        } else {
          // Disabling HAP — confirm first
          const ref = openModal(Confirm, {
            title: t('settings.hap.disable'),
            message: t('settings.hap.disable_desc'),
            message2: t('common.phrases.are_you_sure'),
            confirmButtonLabel: t('form.button_continue'),
            confirmButtonClass: 'btn-danger',
            faIconClass: 'fas fa-exclamation-triangle text-warning',
          }, MODAL_OPTIONS)

          try {
            await ref.result

            settingsActions.clearRestartToast()

            deps.navigate('/restart?alreadyRestarting=true')
            await api.put('/config-editor/hap', {
              enabled: false,
              disableIdentifyingMaterial: identifyingMaterial(),
            })
          } catch (error) {
            if (error !== 'Dismiss') {
              reportError(error)
            }
            patch('hapEnabled', true)
            setSaving('hapEnabled', false)
          }
        }
      } catch (error) {
        reportError(error)
        patch('hapEnabled', !value)
        setSaving('hapEnabled', false)
      }
    },

    // Flag the next restart as a full service restart — enabling/disabling HAP or
    // Matter changes how the homebridge process starts, so it needs the whole
    // service to restart — then surface the normal restart toast (deferred, the
    // user restarts when ready). Mirrors how other restart-requiring settings save.
    async requestFullServiceRestart(): Promise<void> {
      try {
        await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
      } catch (error) {
        console.error(error)
      } finally {
        settingsActions.showRestartToast()
      }
    },
  }

  return page
}
