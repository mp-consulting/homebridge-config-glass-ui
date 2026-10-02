import type { EnvInterface } from '@/core/interfaces/settings.interfaces'

import { TEST_INSTANCE_ID } from '../constants'

/**
 * A plausible `env` block. Every flag defaults to the plain, non-container,
 * everything-enabled case, so a spec only states what it is actually about.
 * @param overrides - fields to change
 */
export function makeEnv(overrides: Partial<EnvInterface> = {}): EnvInterface {
  return {
    platform: 'linux',
    enableAccessories: true,
    enableTerminalAccess: true,
    restrictLogsToAdmins: false,
    featureFlags: {},
    homebridgeInstanceName: 'Homebridge Test',
    homebridgeVersion: '2.0.0',
    homebridgeUiVersion: '5.0.0',
    nodeVersion: '22.0.0',
    packageName: '@mp-consulting/homebridge-config-glass-ui',
    packageVersion: '5.0.0',
    runningInDocker: false,
    runningInLinux: true,
    runningInFreeBSD: false,
    runningInSynologyPackage: false,
    runningInPackageMode: false,
    runningOnRaspberryPi: false,
    runningOnRaspbianImage: false,
    canShutdownRestartHost: false,
    dockerOfflineUpdate: false,
    lang: 'en',
    temperatureUnits: 'c',
    port: 8581,
    instanceId: TEST_INSTANCE_ID,
    customWallpaperHash: '',
    setupWizardComplete: true,
    recommendChildBridges: true,
    scheduledBackupDisable: false,
    scheduledBackupPath: '/var/lib/homebridge/backups',
    ...overrides,
  } as EnvInterface
}

export interface MakeSettingsStateOverrides extends Record<string, unknown> {
  env?: Partial<EnvInterface>
}

/**
 * The data half of the settings store, loaded: seed it with
 * `useSettingsStore.setState(makeSettingsState({ env: { ... } }))`.
 *
 * `settingsLoaded: true` is the default because every route loader waits for
 * the settings, so without it a guard spec hangs until it times out. Field
 * names follow the Angular SettingsService; anything the store names
 * differently can be passed as an override.
 * @param overrides - fields to change; `env` is merged over the defaults
 */
export function makeSettingsState(overrides: MakeSettingsStateOverrides = {}) {
  const { env: envOverrides, ...rest } = overrides

  return {
    env: makeEnv(envOverrides),
    host: 'localhost',
    proxyHost: 'localhost:8581',
    formAuth: true,
    sessionTimeout: 28800,
    sessionTimeoutInactivityBased: false,
    uiVersion: '5.0.0',
    theme: 'deep-purple',
    lightingMode: 'auto',
    currentLightingMode: 'auto',
    actualLightingMode: 'light' as 'dark' | 'light',
    browserLightingMode: 'light' as 'dark' | 'light',
    glassMode: true,
    menuMode: 'default',
    keepOrphans: false,
    wallpaper: '',
    serverTimeOffset: 0,
    rtl: false,
    browserLang: 'en',
    settingsLoaded: true,
    serverUnreachable: false,
    ...rest,
  }
}
