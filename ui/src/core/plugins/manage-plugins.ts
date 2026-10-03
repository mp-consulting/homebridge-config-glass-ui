import type { ChildBridge, Plugin, PluginEditorContext } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalRef } from '@/core/ui/modal'

import { lt, minVersion } from 'semver'

import { api } from '@/core/api'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { customPlugins } from '@/core/plugins/custom-plugins/custom-plugins.service'
import { ManagePlugin } from '@/core/plugins/manage-plugin/ManagePlugin'
import { ManageVersion } from '@/core/plugins/manage-version/ManageVersion'
import { ManualConfig } from '@/core/plugins/manual-config/ManualConfig'
import { PluginBridge } from '@/core/plugins/plugin-bridge/PluginBridge'
import { PluginCompatibility } from '@/core/plugins/plugin-compatibility/PluginCompatibility'
import { PluginConfig } from '@/core/plugins/plugin-config/PluginConfig'
import { PluginExternals } from '@/core/plugins/plugin-externals/PluginExternals'
import { ResetAccessories } from '@/core/plugins/reset-accessories/ResetAccessories'
import { SwitchToScoped } from '@/core/plugins/switch-to-scoped/SwitchToScoped'
import { UninstallPlugin } from '@/core/plugins/uninstall-plugin/UninstallPlugin'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { t } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { UpdateAllModal } from '@/core/update-all/UpdateAllModal'
import { createEmitter } from '@/core/utilities/emitter'
import { toastApiError } from '@/core/utilities/http-error'

/** `Subject.asObservable()` of the Angular service: `subscribe(cb)` returns its unsubscribe. */
export interface PluginListRefresh {
  subscribe: (listener: () => void) => (() => void) & { unsubscribe: () => void }
}

const pluginListRefresh = createEmitter()

function emitPluginListRefresh(): void {
  pluginListRefresh.emit()
}

const onPluginListRefresh: PluginListRefresh = {
  subscribe(listener) {
    const unsubscribe = pluginListRefresh.subscribe(listener) as (() => void) & { unsubscribe: () => void }
    unsubscribe.unsubscribe = unsubscribe
    return unsubscribe
  },
}

// The modal components are typed by their own props; this facade only hands
// them data, so it opens them through one loosely typed alias.
const open = openModal as (component: unknown, props: Record<string, any>, options?: Record<string, any>) => ModalRef

const LARGE_STATIC = { size: 'lg', backdrop: 'static' } as const

/**
 * Every plugin action goes through here: install, update, uninstall,
 * settings, child bridges, version picker (ManagePluginsService).
 */
export const managePlugins = {
  /** Fires when the plugins list needs to be refreshed. */
  onPluginListRefresh,

  /**
   * Open the Update All modal. Both entry points (the plugins page toolbar
   * and the update-info widget) come through here so the modal's options
   * cannot drift between them. Callers hook their own refresh to the
   * returned ref's result - skipping the 'handover' reason, which means
   * the server is restarting right now.
   */
  openUpdateAllModal(): ModalRef {
    return open(UpdateAllModal, {}, {
      size: 'lg',
      // A run must not be interrupted by a stray backdrop click
      backdrop: 'static',
    })
  },

  async installPlugin(plugin: Plugin, targetVersion: string, backToVersionModal: Plugin | null = null): Promise<void> {
    const ref = open(ManagePlugin, {
      action: 'Install',
      pluginName: plugin.name,
      pluginDisplayName: plugin.displayName,
      targetVersion,
      isConfigured: plugin.isConfigured,
      onRefreshPluginList: emitPluginListRefresh,
      verifiedPlugin: plugin.verifiedPlugin,
      verifiedPlusPlugin: plugin.verifiedPlusPlugin,
      funding: plugin.funding,
      backToVersionModal,
    }, LARGE_STATIC)

    try {
      const result = await ref.result

      // Handle just-installed action
      if (result?.action === 'just-installed' && result?.plugin) {
        // /auth/settings only re-runs on login + full HB restart + UI plugin
        // save, so the cached flag stays false after the first install until
        // the next reload. Flip it locally so the Accessories empty-state and
        // other consumers see the new plugin immediately.
        settingsActions.setEnvItem('hasInstalledPlugins', true)
        if (result.plugin.isConfigured) {
          open(RestartHomebridge, {}, { size: 'lg', backdrop: 'static', keyboard: false })
        } else {
          await managePlugins.settings(result.plugin)
        }
      }
    } catch {
      // Modal was dismissed
    }
  },

  async uninstallPlugin(plugin: Plugin, childBridges: ChildBridge[]): Promise<void> {
    // Preload alias via editor-context so the modal doesn't have to
    // refetch it (used to determine dynamic-platform behaviour).
    let editorContext: PluginEditorContext | undefined
    try {
      editorContext = await managePlugins.loadEditorContext(plugin.name)
    } catch (error) {
      console.error(error)
    }

    const ref = open(UninstallPlugin, {
      plugin,
      childBridges,
      action: 'Uninstall',
      keepOrphans: useSettingsStore.getState().keepOrphans,
      onRefreshPluginList: emitPluginListRefresh,
      editorContext,
    }, LARGE_STATIC)

    try {
      await ref.result
      // Refresh the plugin list after uninstall completes
      emitPluginListRefresh()
    } catch {
      // Modal was dismissed without uninstalling
    }
  },

  async checkAndUpdatePlugin(plugin: Plugin, targetVersion: string): Promise<void> {
    if (!await managePlugins.checkHbAndNodeVersion(plugin, 'update')) {
      return
    }

    await managePlugins.updatePlugin(plugin, targetVersion)
  },

  async updatePlugin(plugin: Plugin, targetVersion: string, backToVersionModal: Plugin | null = null): Promise<void> {
    const ref = open(ManagePlugin, {
      action: 'Update',
      pluginName: plugin.name,
      pluginDisplayName: plugin.displayName,
      targetVersion,
      latestVersion: plugin.latestVersion,
      installedVersion: plugin.installedVersion,
      isDisabled: plugin.disabled,
      isConfigured: plugin.isConfigured,
      onRefreshPluginList: emitPluginListRefresh,
      verifiedPlugin: plugin.verifiedPlugin,
      verifiedPlusPlugin: plugin.verifiedPlusPlugin,
      funding: plugin.funding,
      backToVersionModal,
    }, LARGE_STATIC)

    try {
      const result = await ref.result

      // Handle just-installed action (also triggered for updates)
      if (result?.action === 'just-installed' && result?.plugin) {
        if (result.plugin.isConfigured) {
          open(RestartHomebridge, {}, { size: 'lg', backdrop: 'static', keyboard: false })
        } else {
          await managePlugins.settings(result.plugin)
        }
      }
    } catch {
      // Modal was dismissed
    }
  },

  async upgradeHomebridge(homebridgePkg: Plugin, targetVersion: string): Promise<void> {
    if (!await managePlugins.checkHbAndNodeVersion(homebridgePkg, 'update')) {
      return
    }

    open(ManagePlugin, {
      action: 'Update',
      pluginName: homebridgePkg.name,
      pluginDisplayName: homebridgePkg.displayName,
      targetVersion,
      latestVersion: homebridgePkg.latestVersion,
      installedVersion: homebridgePkg.installedVersion,
    }, LARGE_STATIC)
  },

  /**
   * Open the version selector
   * @param plugin - the plugin (or homebridge itself)
   * @param onSettingsChange - called when the version modal changed a setting
   */
  async installAlternateVersion(plugin: Plugin, onSettingsChange?: () => void): Promise<void> {
    const ref = open(ManageVersion, {
      plugin,
      onRefreshPluginList: emitPluginListRefresh,
      onSettingsChange,
    }, LARGE_STATIC)

    try {
      const { action, version, engines } = await ref.result

      if (!await managePlugins.checkHbAndNodeVersion({ ...plugin, updateEngines: engines }, action)) {
        return
      }

      if (plugin.name === 'homebridge') {
        return await managePlugins.upgradeHomebridge(plugin, version)
      }

      return plugin.installedVersion
        ? await managePlugins.updatePlugin(plugin, version, plugin)
        : managePlugins.installPlugin(plugin, version, plugin)
    } catch {
      // Do nothing
    }
  },

  /**
   * Open the child bridge modal
   * @param plugin - the plugin
   * @param justInstalled - opened straight after an install
   */
  async bridgeSettings(plugin: Plugin, justInstalled = false): Promise<void> {
    // Single aggregated fetch — replaces the historical schema + alias +
    // config + child-bridges fan-out that fired once the modal opened.
    let editorContext: PluginEditorContext
    try {
      editorContext = await managePlugins.loadEditorContext(plugin.name)
    } catch (error) {
      console.error(error)
      toast.error(t('plugins.toast_failed_to_load_plugin_schema'), t('toast.title_error'))
      return
    }

    const schema = plugin.settingsSchema ? editorContext.configSchema : undefined

    const ref = open(PluginBridge, {
      schema,
      plugin,
      justInstalled,
      editorContext,
    }, LARGE_STATIC)

    try {
      const result = await ref.result

      // If the modal closed with 'refresh' result, emit refresh event
      if (result === 'refresh') {
        emitPluginListRefresh()
      }
    } catch { /* modal was dismissed */ }
  },

  /**
   * Open the external-accessories modal — shows QR codes for accessories the plugin
   * has published with their own setup code (HAP or Matter).
   * @param plugin - the plugin
   */
  async externalAccessories(plugin: Plugin): Promise<void> {
    const ref = open(PluginExternals, { plugin }, LARGE_STATIC)

    try {
      await ref.result
    } catch { /* modal was dismissed */ }
  },

  /**
   * Open the plugin settings modal
   * @param plugin - the plugin
   */
  async settings(plugin: Plugin): Promise<unknown> {
    let editorContext: PluginEditorContext
    try {
      editorContext = await managePlugins.loadEditorContext(plugin.name)
    } catch (error) {
      console.error(error)
      toast.error(t('plugins.toast_failed_to_load_plugin_schema'), t('toast.title_error'))
      return
    }

    const schema = plugin.settingsSchema ? editorContext.configSchema : undefined

    // Open the custom ui if the plugin has one
    if (schema && schema.customUi) {
      return customPlugins.openCustomSettingsUi(plugin, schema, editorContext)
    }

    if (customPlugins.plugins[plugin.name]) {
      return customPlugins.openSettings(plugin, schema, editorContext)
    }

    // Open the standard ui
    const ref = open(plugin.settingsSchema ? PluginConfig : ManualConfig, {
      schema,
      plugin,
      editorContext,
    }, LARGE_STATIC)

    return ref.result.catch(() => { /* modal dismissed */ })
  },

  /** Open the JSON config modal */
  async jsonEditor(plugin: Plugin): Promise<unknown> {
    let editorContext: PluginEditorContext | undefined
    try {
      editorContext = await managePlugins.loadEditorContext(plugin.name)
    } catch (error) {
      console.error(error)
    }

    const schema = plugin.settingsSchema ? editorContext?.configSchema : undefined

    const ref = open(ManualConfig, {
      schema,
      plugin,
      editorContext,
    }, LARGE_STATIC)

    return ref.result.catch(error => console.error(error))
  },

  async checkHbAndNodeVersion(plugin: Plugin, action: string): Promise<boolean> {
    let isValidNode = true
    let isValidHb = true
    const { env } = useSettingsStore.getState()

    try {
      // Check Node.js version from the `package.engines` of the plugin being installed/updated
      if (plugin.updateEngines?.node && lt(env.nodeVersion, minVersion(plugin.updateEngines.node)!)) {
        isValidNode = false
      }

      // Check Homebridge version from the `package.engines` of the plugin being installed/updated
      if (plugin.updateEngines?.homebridge && env.homebridgeVersion && lt(env.homebridgeVersion, minVersion(plugin.updateEngines.homebridge)!)) {
        isValidHb = false
      }
    } catch (error: any) {
      console.error(error)
      toastApiError(error)
      return false
    }

    // If either are false, open modal warning about compatibility
    if (!isValidNode || !isValidHb) {
      try {
        const ref = open(PluginCompatibility, {
          plugin,
          isValidNode,
          isValidHb,
          action,
        }, LARGE_STATIC)

        return await ref.result
      } catch {
        return false
      }
    }

    return true
  },

  /**
   * Fetch the aggregated editor-context payload (alias + config schema +
   * existing config blocks + child bridges) used to populate plugin
   * settings modals. Replaces the historical fan-out of four separate
   * calls per modal open. Returns `configSchema: null` for schema-less
   * plugins.
   */
  async loadEditorContext(pluginName: string): Promise<PluginEditorContext> {
    return api.get<PluginEditorContext>(`/plugins/${encodeURIComponent(pluginName)}/editor-context`)
  },

  /** Open the reset child bridges modal */
  async resetChildBridges(childBridges: ChildBridge[]): Promise<void> {
    open(ResetAccessories, { childBridges }, LARGE_STATIC)
  },

  async switchToScoped(plugin: Plugin): Promise<void> {
    open(SwitchToScoped, { plugin }, LARGE_STATIC)
  },
}

export type ManagePlugins = typeof managePlugins
