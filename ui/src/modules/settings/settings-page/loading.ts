import type { PageContext } from '@/modules/settings/settings-page/types'
import type { NetworkAdapterAvailable } from '@/modules/settings/settings.interfaces'

import { api } from '@/core/api'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { fontWeights, t } from '@/modules/settings/settings-page/shared'

/** Loading the page: reading every saved value, then letting its changes save. */
export function createLoadingSlice(ctx: PageContext) {
  const { store, flags, patch, load, arm, disable, reportError, settingsEnv, isFeatureEnabled } = ctx

  const slice = {
    async init(): Promise<void> {
      ctx.resume()

      // Set page title
      settingsActions.setPageTitle(t('menu.label_settings'))

      if (isFeatureEnabled('childBridgeDebugMode')) {
        store.setState({ debugFieldDesc: 'settings.startup.debug_desc_v2' })
      }

      await slice.initNetworkingOptions()
      await slice.initStartupSettings()

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

      load('hbName', env.homebridgeInstanceName)
      load('uiLang', env.lang ?? null)
      load('uiTheme', settings.theme ?? null)
      load('uiLight', settings.lightingMode)
      load('uiGlass', settings.glassMode)
      load('uiMenu', settings.menuMode)
      load('uiTemp', env.temperatureUnits)
      load('uiTerminalPersistence', env.terminal?.persistence ?? null)
      load('uiTerminalHideWarning', env.terminal?.hideWarning ?? null)
      load('uiTerminalBufferSize', env.terminal?.bufferSize ?? null)

      // Validate and set terminal fontSize
      const savedFontSize = env.terminal?.fontSize
      if (savedFontSize !== undefined && (savedFontSize < 10 || savedFontSize > 20)) {
        // Invalid value, delete it from config
        void slice.deleteInvalidSetting('terminal.fontSize')
        patch('uiTerminalFontSize', 13)
      } else {
        patch('uiTerminalFontSize', savedFontSize || 13)
      }
      arm('uiTerminalFontSize')

      // Validate and set terminal fontWeight
      const savedFontWeight = env.terminal?.fontWeight
      if (savedFontWeight !== undefined && !fontWeights.includes(String(savedFontWeight))) {
        // Invalid value, delete it from config
        void slice.deleteInvalidSetting('terminal.fontWeight')
        patch('uiTerminalFontWeight', '400')
      } else {
        patch('uiTerminalFontWeight', (savedFontWeight as string) || '400')
      }
      arm('uiTerminalFontWeight')

      // Terminal lighting mode - default to dark, but allow light if main theme is light
      const savedTerminalTheme = env.terminal?.lightingMode
      const lightMode = useSettingsStore.getState().actualLightingMode === 'light'
      patch('uiTerminalLightingMode', lightMode ? (savedTerminalTheme || 'dark') : 'dark')
      // A light terminal inside a dark page is the one combination not offered
      if (useSettingsStore.getState().actualLightingMode === 'dark') {
        disable('uiTerminalLightingMode')
      }
      arm('uiTerminalLightingMode')

      load('hbLogSize', env.log?.maxSize ?? null)
      load('hbLogTruncate', env.log?.truncateSize ?? null)
      load('uiPort', env.port)
      load('uiAuth', settings.formAuth)

      // Convert seconds to days, hours, minutes
      const sessionTimeoutSeconds = settings.sessionTimeout
      patch('uiSessionTimeoutDays', Math.floor(sessionTimeoutSeconds / 86400))
      patch('uiSessionTimeoutHours', Math.floor((sessionTimeoutSeconds % 86400) / 3600))
      patch('uiSessionTimeoutMinutes', Math.floor((sessionTimeoutSeconds % 3600) / 60))
      arm('uiSessionTimeoutDays', 'uiSessionTimeoutHours', 'uiSessionTimeoutMinutes')

      load('uiSessionTimeoutInactivityBased', settings.sessionTimeoutInactivityBased || false)

      patch(
        'uiSslType',
        env.ssl?.selfSigned
          ? 'selfsigned'
          : env.ssl?.key || env.ssl?.cert
            ? 'keycert'
            : (env.ssl?.pfx || env.ssl?.hasPassphrase) ? 'pfx' : 'off',
      )

      load('uiHost', settings.host || '')
      load('uiProxyHost', settings.proxyHost || '')
      load('hbPackage', env.homebridgePackagePath || '')
      load('uiMetrics', !env.disableServerMetricsMonitoring)
      load('enableMdnsAdvertise', env.enableMdnsAdvertise || false)
      load('uiAccDebug', env.accessoryControl?.debug ?? null)
      load('uiTempFile', env.temp ?? null)
      load('hbLinuxShutdown', env.linux?.shutdown ?? null)
      load('hbLinuxRestart', env.linux?.restart ?? null)
      load('scheduledRestartCron', env.scheduledRestartCron || '')

      await ctx.page.initMatterSettings()
      await ctx.page.initHapSettings()

      store.setState({ loading: false })
    },

    async initStartupSettings(): Promise<void> {
      try {
        const startupSettingsData = await api.get('/platform-tools/hb-service/homebridge-startup-settings')

        load('hbDebug', startupSettingsData.HOMEBRIDGE_DEBUG)
        load('hbInsecure', startupSettingsData.HOMEBRIDGE_INSECURE)
        load('hbKeep', startupSettingsData.HOMEBRIDGE_KEEP_ORPHANS)
        load('hbEnvDebug', startupSettingsData.ENV_DEBUG)
        load('hbEnvNode', startupSettingsData.ENV_NODE_OPTIONS)
      } catch (error) {
        reportError(error)
      }
    },

    async initNetworkingOptions(): Promise<void> {
      try {
        await slice.getNetworkSettings()
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
      ctx.page.buildBridgeNetworkAdapterList(adapters)

      load('hbMDns', mdnsAdvertiser.advertiser)
      load('hbPort', port.port)
      load('hbStartPort', ports.start ?? null)
      load('hbEndPort', ports.end ?? null)
    },

    async deleteInvalidSetting(key: string): Promise<void> {
      try {
        await api.delete(`/config-editor/ui/${key}`)
      } catch (error) {
        console.error(`Failed to delete invalid setting ${key}:`, error)
      }
    },
  }

  return slice
}

export type LoadingSlice = ReturnType<typeof createLoadingSlice>
