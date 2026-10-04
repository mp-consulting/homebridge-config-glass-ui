import type { FieldKey, PageContext, SavingKey, SettingsFieldValues, SettingsPageDeps, SettingsPageInternals, SettingsPageState } from '@/modules/settings/settings-page/types'
import type { StoreApi } from 'zustand/vanilla'

import { createStore } from 'zustand/vanilla'

import { api } from '@/core/api'
import { formatLocale } from '@/core/pipes/date'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { toastApiError } from '@/core/utilities/http-error'
import { terminalService } from '@/core/utilities/terminal/instances'
import { FIELDS, initialValues } from '@/modules/settings/settings-page/fields'
import { createGeneralSlice } from '@/modules/settings/settings-page/general'
import { createHapSlice } from '@/modules/settings/settings-page/hap'
import { createLoadingSlice } from '@/modules/settings/settings-page/loading'
import { createMatterSlice } from '@/modules/settings/settings-page/matter'
import { createModalsSlice } from '@/modules/settings/settings-page/modals'
import { createNetworkSlice } from '@/modules/settings/settings-page/network'
import { createSearchSlice } from '@/modules/settings/settings-page/search'
import { createSecuritySlice } from '@/modules/settings/settings-page/security'
import { SAVED_SPINNER_MS } from '@/modules/settings/settings-page/shared'
import { createStartupSlice } from '@/modules/settings/settings-page/startup'
import { createTerminalSlice } from '@/modules/settings/settings-page/terminal'

export { fontSizes, fontWeights } from '@/modules/settings/settings-page/shared'
export type { FieldKey, SavingKey, SettingsFieldValues, SettingsPageDeps, SettingsPageFlags, SettingsPageState } from '@/modules/settings/settings-page/types'

/**
 * The state and behaviour of the settings page: the Angular SettingsComponent
 * class, with its template split into one component per section
 * (`sections/*`). The page has no save button - every control writes as soon
 * as it settles - so each field has a value, a debounce and a save
 * (`settings-page/fields.ts`), and `save(field, value)` runs it.
 *
 * This file is the core: the store, the debounce timers and the coalesced
 * PATCH /config-editor/ui writer. Each section's loads and saves are a slice
 * in `settings-page/*.ts`.
 *
 * Field names are the Angular form controls' without `FormControl`
 * (`hbNameFormControl` → `hbName`); `saving.x` / `invalid.x` are its
 * `xIsSaving` / `xIsInvalid` signals.
 */

const UI_FLUSH_COALESCE_MS = 150

function defaultBrowserLang(): { lang?: string, culture?: string } {
  if (typeof navigator === 'undefined') {
    return {}
  }
  const culture = navigator.languages?.[0] ?? navigator.language
  return { lang: culture?.split('-')[0].split('_')[0], culture }
}

function createPageStore(deps: SettingsPageDeps, isFeatureEnabled: (key: string) => boolean): StoreApi<SettingsPageState> {
  const env = useSettingsStore.getState().env
  return createStore<SettingsPageState>()(() => ({
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
      assistant: true,
      reset: true,
      cache: true,
    },
    activeSection: 'general',
    hiddenItems: {},
  }))
}

/**
 * The coalesced UI config writer. When several fields settle around the same
 * time their saves go out as one PATCH /config-editor/ui (one disk write)
 * instead of one PUT per field. The promise returned to each caller resolves
 * when the next flush completes so per-field "isSaving" indicators stay
 * accurate.
 *
 * ⚠️ **The promise rejects when the write fails, and every caller has to let
 * it.** The caller's catch is what reports the failure and stops its spinner;
 * a helper that reported the error and then resolved anyway left every caller
 * running its success path over a write that never landed — clearing the
 * "invalid" marker, asking for a restart that would apply nothing, and in the
 * case of the menu mode reloading the page over the top of its own error toast.
 */
function createUiConfigWriter(): (key: string, value: unknown) => Promise<void> {
  let pendingUiChanges = new Map<string, unknown>()
  let pendingUiFlushTimer: ReturnType<typeof setTimeout> | null = null
  let pendingUiFlush: { promise: Promise<void>, resolve: () => void, reject: (error: any) => void } | null = null

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

  return (key, value) => {
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
}

/**
 * Build one settings page (one Angular component instance). `init()` loads it,
 * `destroy()` drops whatever is still waiting to settle.
 * @param deps - what the page needs from outside
 */
export function createSettingsPage(deps: SettingsPageDeps) {
  const isFeatureEnabled = (key: string) => settingsActions.isFeatureEnabled(key)
  const store = createPageStore(deps, isFeatureEnabled)
  const get = store.getState
  const internals: SettingsPageInternals = { matterConfigCache: {} }
  // The assembled page, for the saves and the slices (set once it is built)
  const self = {} as { page: SettingsPage }

  // ===== Debounced saves (the valueChanges subscriptions) =====

  let destroyed = false
  // Fields whose saved value has been read: changes before that do not save
  const armed = new Set<FieldKey>()
  const timers = new Map<FieldKey, ReturnType<typeof setTimeout>>()

  function patch<K extends FieldKey>(field: K, value: SettingsFieldValues[K]): void {
    store.setState(state => ({ values: { ...state.values, [field]: value } }))
  }

  function arm(...fields: FieldKey[]): void {
    if (destroyed) {
      return
    }
    for (const field of fields) {
      armed.add(field)
    }
  }

  function setSaving(key: SavingKey, value: boolean): void {
    store.setState(state => ({ saving: { ...state.saving, [key]: value } }))
  }

  function setInvalid(key: FieldKey, value: boolean): void {
    store.setState(state => ({ invalid: { ...state.invalid, [key]: value } }))
  }

  /**
   * Save a field's value once it has settled (its debounce in `FIELDS`); a
   * newer save of the same field replaces one still waiting.
   * @param field - the field
   * @param value - the value to save
   */
  function save<K extends FieldKey>(field: K, value: SettingsFieldValues[K]): void {
    const run = FIELDS[field].save as ((p: SettingsPage, value: SettingsFieldValues[K]) => unknown) | undefined
    if (destroyed || !armed.has(field) || !run) {
      return
    }
    const delay = FIELDS[field].debounce
    if (!delay) {
      void run(self.page, value)
      return
    }
    clearTimeout(timers.get(field))
    timers.set(field, setTimeout(() => {
      timers.delete(field)
      void run(self.page, value)
    }, delay))
  }

  /**
   * A change made by the user (`control.setValue(value)`): it is shown at once
   * and saved once it has settled.
   * @param field - the field
   * @param value - the new value
   */
  function change<K extends FieldKey>(field: K, value: SettingsFieldValues[K]): void {
    patch(field, value)
    save(field, value)
  }

  /** Drop what is still waiting to settle (takeUntilDestroyed). */
  function destroy(): void {
    destroyed = true
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
    armed.clear()
  }

  /**
   * Flag the next restart as a full service restart — enabling/disabling HAP
   * or Matter changes how the homebridge process starts, so it needs the whole
   * service to restart — then surface the normal restart toast (deferred, the
   * user restarts when ready).
   */
  async function requestFullServiceRestart(): Promise<void> {
    try {
      await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
    } catch (error) {
      console.error(error)
    } finally {
      settingsActions.showRestartToast()
    }
  }

  const ctx: PageContext = {
    store,
    deps,
    terminal: deps.terminal ?? terminalService,
    bootLocale: deps.bootLocale ?? formatLocale(),
    browserLang: deps.browserLang ?? defaultBrowserLang,
    internals,
    get page() {
      return self.page
    },
    get,
    v: () => get().values,
    flags: () => get().flags,
    settingsEnv: () => useSettingsStore.getState().env,
    isFeatureEnabled,
    patch,
    load(field, value) {
      patch(field, value)
      arm(field)
    },
    arm,
    setSaving,
    setInvalid,
    disable(field) {
      store.setState(state => ({ disabled: { ...state.disabled, [field]: true } }))
    },
    reportError(error) {
      console.error(error)
      toastApiError(error)
    },
    fullServiceRestartThenToast() {
      api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
        .catch(error => console.error(error))
        .finally(() => settingsActions.showRestartToast())
    },
    queueUiSettingChange: createUiConfigWriter(),
    resume() {
      // A remount (StrictMode runs effects twice) starts over
      destroyed = false
    },
    finishSaving(key, after) {
      setTimeout(() => {
        setSaving(key, false)
        after?.()
      }, SAVED_SPINNER_MS)
    },
  }

  const page = {
    store,
    internals,
    change,
    save,
    patch,
    setInvalid,
    destroy,
    requestFullServiceRestart,
    ...createSearchSlice(ctx),
    ...createLoadingSlice(ctx),
    ...createModalsSlice(ctx),
    ...createGeneralSlice(ctx),
    ...createTerminalSlice(ctx),
    ...createStartupSlice(ctx),
    ...createNetworkSlice(ctx),
    ...createSecuritySlice(ctx),
    ...createMatterSlice(ctx),
    ...createHapSlice(ctx),
  }

  self.page = page
  return page
}

export type SettingsPage = ReturnType<typeof createSettingsPage>
