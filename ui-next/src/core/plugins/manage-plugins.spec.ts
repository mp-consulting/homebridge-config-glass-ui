import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { FakeApi, FakeOpenModal } from '@/testing'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { customPlugins } from '@/core/plugins/custom-plugins/custom-plugins.service'
import { ManagePlugin } from '@/core/plugins/manage-plugin/ManagePlugin'
import { managePlugins as service } from '@/core/plugins/manage-plugins'
import { ManageVersion } from '@/core/plugins/manage-version/ManageVersion'
import { ManualConfig } from '@/core/plugins/manual-config/ManualConfig'
import { PluginBridge } from '@/core/plugins/plugin-bridge/PluginBridge'
import { PluginCompatibility } from '@/core/plugins/plugin-compatibility/PluginCompatibility'
import { PluginConfig } from '@/core/plugins/plugin-config/PluginConfig'
import { PluginExternals } from '@/core/plugins/plugin-externals/PluginExternals'
import { ResetAccessories } from '@/core/plugins/reset-accessories/ResetAccessories'
import { SwitchToScoped } from '@/core/plugins/switch-to-scoped/SwitchToScoped'
import { UninstallPlugin } from '@/core/plugins/uninstall-plugin/UninstallPlugin'
import { useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { UpdateAllModal } from '@/core/update-all/UpdateAllModal'
import { fakeApi, makeSettingsState } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/plugins/custom-plugins/custom-plugins.service', () => ({
  customPlugins: { plugins: {}, openCustomSettingsUi: vi.fn(), openSettings: vi.fn() },
}))

// Each modal is a stand-in: this spec is about which one opens, with what
vi.mock('@/core/components/restart-homebridge/RestartHomebridge', () => ({ RestartHomebridge: () => null }))
vi.mock('@/core/plugins/manage-plugin/ManagePlugin', () => ({ ManagePlugin: () => null }))
vi.mock('@/core/plugins/manage-version/ManageVersion', () => ({ ManageVersion: () => null }))
vi.mock('@/core/plugins/manual-config/ManualConfig', () => ({ ManualConfig: () => null }))
vi.mock('@/core/plugins/plugin-bridge/PluginBridge', () => ({ PluginBridge: () => null }))
vi.mock('@/core/plugins/plugin-compatibility/PluginCompatibility', () => ({ PluginCompatibility: () => null }))
vi.mock('@/core/plugins/plugin-config/PluginConfig', () => ({ PluginConfig: () => null }))
vi.mock('@/core/plugins/plugin-externals/PluginExternals', () => ({ PluginExternals: () => null }))
vi.mock('@/core/plugins/reset-accessories/ResetAccessories', () => ({ ResetAccessories: () => null }))
vi.mock('@/core/plugins/switch-to-scoped/SwitchToScoped', () => ({ SwitchToScoped: () => null }))
vi.mock('@/core/plugins/uninstall-plugin/UninstallPlugin', () => ({ UninstallPlugin: () => null }))
vi.mock('@/core/update-all/UpdateAllModal', () => ({ UpdateAllModal: () => null }))

const modal = modalModule as unknown as FakeOpenModal

/**
 * The facade every plugin action goes through: install, update, uninstall,
 * settings, child bridges, version picker.
 *
 * It owns three decisions worth pinning:
 *
 * ⚠️ **what happens after an install.** A plugin that already has config needs a
 * Homebridge restart; one that does not needs its settings opened, or the user
 * installs a plugin and nothing appears to happen.
 *
 * ⚠️ **the compatibility gate.** A plugin declaring a newer Node or Homebridge
 * than the box is running must warn before installing, not after.
 *
 * ⚠️ **which settings UI opens.** A plugin can have a custom UI, a registered
 * custom UI, a schema-driven form or nothing but raw JSON, and they are picked in
 * that order.
 */
describe('managePlugins', () => {
  let api: FakeApi
  const cp = customPlugins as unknown as {
    plugins: Record<string, unknown>
    openCustomSettingsUi: ReturnType<typeof vi.fn>
    openSettings: ReturnType<typeof vi.fn>
  }

  function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
    return {
      name: 'homebridge-example',
      displayName: 'Example',
      installedVersion: '1.0.0',
      latestVersion: '1.1.0',
      isConfigured: true,
      settingsSchema: true,
      verifiedPlugin: true,
      verifiedPlusPlugin: false,
      disabled: false,
      ...overrides,
    } as Plugin
  }

  function editorContext(overrides: Record<string, any> = {}) {
    return { alias: 'Example', configSchema: { pluginAlias: 'Example', schema: {} }, blocks: [], childBridges: [], ...overrides }
  }

  const env = () => useSettingsStore.getState().env

  beforeEach(() => {
    api = fakeApi()
    modal.opened.length = 0
    modal.openModal.mockClear()
    vi.mocked(toast.error).mockClear()
    cp.plugins = {}
    cp.openCustomSettingsUi.mockClear()
    cp.openSettings.mockClear()
    useSettingsStore.setState(makeSettingsState({ env: { nodeVersion: '22.0.0', homebridgeVersion: '1.8.0' } }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
  })

  async function settle() {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  }

  const last = () => modal.lastOpened()!

  describe('installing a plugin', () => {
    it('opens the manage modal with everything it needs to show', async () => {
      void service.installPlugin(makePlugin({ verifiedPlusPlugin: true }), '1.1.0')
      await settle()

      expect(last().component).toBe(ManagePlugin)
      expect(last().props).toMatchObject({
        action: 'Install',
        pluginName: 'homebridge-example',
        pluginDisplayName: 'Example',
        targetVersion: '1.1.0',
        verifiedPlusPlugin: true,
      })
    })

    it('carries the funding links through, so the thank-you panel can show them', async () => {
      const funding = [{ type: 'github', url: 'https://github.com/sponsors/someone' }]

      void service.installPlugin(makePlugin({ funding }), '1.1.0')
      await settle()

      expect(last().props?.funding).toEqual(funding)
    })

    it('remembers that plugins are now installed', async () => {
      useSettingsStore.setState({ env: { ...env(), hasInstalledPlugins: false } })

      void service.installPlugin(makePlugin(), '1.1.0')
      await settle()
      last().ref.close({ action: 'just-installed', plugin: makePlugin() })
      await settle()

      expect(env().hasInstalledPlugins).toBe(true)
    })

    it('asks for a restart when the new plugin already has config', async () => {
      void service.installPlugin(makePlugin({ isConfigured: true }), '1.1.0')
      await settle()
      last().ref.close({ action: 'just-installed', plugin: makePlugin({ isConfigured: true }) })
      await settle()

      expect(last().component).toBe(RestartHomebridge)
    })

    it('cannot be clicked away from the restart prompt', async () => {
      void service.installPlugin(makePlugin(), '1.1.0')
      await settle()
      last().ref.close({ action: 'just-installed', plugin: makePlugin() })
      await settle()

      expect(last().options).toMatchObject({ backdrop: 'static', keyboard: false })
    })

    it('opens the settings when the new plugin has no config yet', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.installPlugin(makePlugin(), '1.1.0')
      await settle()
      last().ref.close({ action: 'just-installed', plugin: makePlugin({ isConfigured: false }) })
      await settle()

      expect(last().component).toBe(PluginConfig)
    })

    it('does nothing further when the install modal is dismissed', async () => {
      void service.installPlugin(makePlugin(), '1.1.0')
      await settle()
      last().ref.dismiss()
      await settle()

      expect(modal.opened).toHaveLength(1)
    })

    it('does nothing further when the modal closes without installing', async () => {
      void service.installPlugin(makePlugin(), '1.1.0')
      await settle()
      last().ref.close({ action: 'cancelled' })
      await settle()

      expect(modal.opened).toHaveLength(1)
    })
  })

  describe('updating a plugin', () => {
    it('tells the modal which versions are involved', async () => {
      void service.updatePlugin(makePlugin({ installedVersion: '1.0.0', latestVersion: '2.0.0' }), '2.0.0')
      await settle()

      expect(last().props).toMatchObject({ action: 'Update', installedVersion: '1.0.0', latestVersion: '2.0.0', targetVersion: '2.0.0' })
    })

    it('passes on whether the plugin is disabled', async () => {
      void service.updatePlugin(makePlugin({ disabled: true }), '2.0.0')
      await settle()

      expect(last().props?.isDisabled).toBe(true)
    })

    it('asks for a restart afterwards', async () => {
      void service.updatePlugin(makePlugin(), '2.0.0')
      await settle()
      last().ref.close({ action: 'just-installed', plugin: makePlugin({ isConfigured: true }) })
      await settle()

      expect(last().component).toBe(RestartHomebridge)
    })

    it('does not claim plugins are installed for the first time', async () => {
      useSettingsStore.setState({ env: { ...env(), hasInstalledPlugins: false } })

      void service.updatePlugin(makePlugin(), '2.0.0')
      await settle()
      last().ref.close({ action: 'just-installed', plugin: makePlugin() })
      await settle()

      expect(env().hasInstalledPlugins).toBe(false)
    })

    it('checks compatibility before updating', async () => {
      void service.checkAndUpdatePlugin(makePlugin({ updateEngines: { node: '>=99.0.0' } }), '2.0.0')
      await settle()

      expect(last().component).toBe(PluginCompatibility)
    })

    it('does not update when the compatibility warning is refused', async () => {
      void service.checkAndUpdatePlugin(makePlugin({ updateEngines: { node: '>=99.0.0' } }), '2.0.0')
      await settle()
      last().ref.close(false)
      await settle()

      expect(modal.opened).toHaveLength(1)
    })

    it('goes ahead when the user accepts the warning', async () => {
      void service.checkAndUpdatePlugin(makePlugin({ updateEngines: { node: '>=99.0.0' } }), '2.0.0')
      await settle()
      last().ref.close(true)
      await settle()

      expect(last().component).toBe(ManagePlugin)
    })
  })

  describe('the compatibility gate', () => {
    it('says nothing when the plugin declares no requirements', async () => {
      expect(await service.checkHbAndNodeVersion(makePlugin(), 'install')).toBe(true)
      expect(modal.opened).toEqual([])
    })

    it('says nothing when the box already meets them', async () => {
      expect(await service.checkHbAndNodeVersion(makePlugin({ updateEngines: { node: '>=20.0.0', homebridge: '^1.6.0' } }), 'install')).toBe(true)
    })

    it('warns when the plugin wants a newer node', async () => {
      void service.checkHbAndNodeVersion(makePlugin({ updateEngines: { node: '>=24.0.0' } }), 'install')
      await settle()

      expect(last().props).toMatchObject({ isValidNode: false, isValidHb: true, action: 'install' })
    })

    it('warns when the plugin wants a newer homebridge', async () => {
      void service.checkHbAndNodeVersion(makePlugin({ updateEngines: { homebridge: '^2.0.0' } }), 'update')
      await settle()

      expect(last().props).toMatchObject({ isValidNode: true, isValidHb: false, action: 'update' })
    })

    it('reads a range rather than a plain version', async () => {
      expect(await service.checkHbAndNodeVersion(makePlugin({ updateEngines: { homebridge: '^1.8.0' } }), 'install')).toBe(true)
    })

    it('ignores a homebridge requirement when the version is unknown', async () => {
      useSettingsStore.setState({ env: { ...env(), homebridgeVersion: undefined as any } })

      expect(await service.checkHbAndNodeVersion(makePlugin({ updateEngines: { homebridge: '^2.0.0' } }), 'install')).toBe(true)
    })

    it('refuses rather than guessing when the requirement cannot be read', async () => {
      const result = await service.checkHbAndNodeVersion(makePlugin({ updateEngines: { node: 'not-a-version' } }), 'install')

      expect(result).toBe(false)
      expect(toast.error).toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
    })

    it('treats a dismissed warning as a no', async () => {
      const pending = service.checkHbAndNodeVersion(makePlugin({ updateEngines: { node: '>=24.0.0' } }), 'install')
      await settle()
      last().ref.dismiss()

      expect(await pending).toBe(false)
    })
  })

  describe('picking a different version', () => {
    it('opens the version list for the plugin', async () => {
      void service.installAlternateVersion(makePlugin())
      await settle()

      expect(last().component).toBe(ManageVersion)
      expect(last().props?.plugin.name).toBe('homebridge-example')
    })

    it('updates an installed plugin to the chosen version', async () => {
      void service.installAlternateVersion(makePlugin({ installedVersion: '1.0.0' }))
      await settle()
      last().ref.close({ action: 'update', version: '0.9.0', engines: {} })
      await settle()

      expect(last().props).toMatchObject({ action: 'Update', targetVersion: '0.9.0' })
    })

    it('installs a plugin that is not installed yet', async () => {
      void service.installAlternateVersion(makePlugin({ installedVersion: undefined as any }))
      await settle()
      last().ref.close({ action: 'install', version: '0.9.0', engines: {} })
      await settle()

      expect(last().props).toMatchObject({ action: 'Install', targetVersion: '0.9.0' })
    })

    it('offers a way back to the version list', async () => {
      const plugin = makePlugin()

      void service.installAlternateVersion(plugin)
      await settle()
      last().ref.close({ action: 'update', version: '0.9.0', engines: {} })
      await settle()

      expect(last().props?.backToVersionModal).toBe(plugin)
    })

    it('checks the engines of the version being chosen, not the latest one', async () => {
      void service.installAlternateVersion(makePlugin())
      await settle()
      last().ref.close({ action: 'update', version: '0.9.0', engines: { node: '>=24.0.0' } })
      await settle()

      expect(last().component).toBe(PluginCompatibility)
    })

    it('takes the homebridge route for homebridge itself', async () => {
      void service.installAlternateVersion(makePlugin({ name: 'homebridge', displayName: 'Homebridge' }))
      await settle()
      last().ref.close({ action: 'update', version: '1.9.0', engines: {} })
      await settle()

      expect(last().props).toMatchObject({ action: 'Update', pluginName: 'homebridge' })
      expect(last().props?.isConfigured).toBeUndefined()
    })

    it('does nothing when the version list is dismissed', async () => {
      void service.installAlternateVersion(makePlugin())
      await settle()
      last().ref.dismiss()
      await settle()

      expect(modal.opened).toHaveLength(1)
    })
  })

  describe('uninstalling a plugin', () => {
    it('hands the modal the child bridges it will have to remove', async () => {
      const childBridges = [{ identifier: 'abc', name: 'Example Bridge' }] as any[]

      void service.uninstallPlugin(makePlugin(), childBridges)
      await settle()

      expect(last().component).toBe(UninstallPlugin)
      expect(last().props?.childBridges).toBe(childBridges)
    })

    it('passes on whether orphaned accessories are kept', async () => {
      useSettingsStore.setState({ keepOrphans: true })

      void service.uninstallPlugin(makePlugin(), [])
      await settle()

      expect(last().props?.keepOrphans).toBe(true)
    })

    it('loads the plugin editor context first, so the modal does not have to', async () => {
      api.respond('get', /editor-context/, editorContext({ alias: 'ExamplePlatform' }))

      void service.uninstallPlugin(makePlugin(), [])
      await settle()

      expect(last().props?.editorContext).toMatchObject({ alias: 'ExamplePlatform' })
    })

    it('still opens when the context cannot be loaded', async () => {
      api.fail('get', /editor-context/, new Error('schema is not valid json'))

      void service.uninstallPlugin(makePlugin(), [])
      await settle()

      expect(last().component).toBe(UninstallPlugin)
      expect(last().props?.editorContext).toBeUndefined()
      expect(console.error).toHaveBeenCalled()
    })

    it('refreshes the plugin list once the uninstall finishes', async () => {
      const refreshed = vi.fn()
      const unsubscribe = service.onPluginListRefresh.subscribe(refreshed)

      void service.uninstallPlugin(makePlugin(), [])
      await settle()
      last().ref.close()
      await settle()

      expect(refreshed).toHaveBeenCalled()
      unsubscribe()
    })

    it('leaves the list alone when the uninstall is abandoned', async () => {
      const refreshed = vi.fn()
      const sub = service.onPluginListRefresh.subscribe(refreshed)

      void service.uninstallPlugin(makePlugin(), [])
      await settle()
      last().ref.dismiss()
      await settle()

      expect(refreshed).not.toHaveBeenCalled()
      sub.unsubscribe()
    })

    it('hands the modal a refresh callback that reaches the subscribers', async () => {
      const refreshed = vi.fn()
      const unsubscribe = service.onPluginListRefresh.subscribe(refreshed)

      void service.uninstallPlugin(makePlugin(), [])
      await settle()
      last().props?.onRefreshPluginList()
      unsubscribe()
      last().props?.onRefreshPluginList()

      expect(refreshed).toHaveBeenCalledTimes(1)
    })
  })

  describe('opening the settings', () => {
    it('opens the schema form for a plugin with a schema', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.settings(makePlugin({ settingsSchema: true }))
      await settle()

      expect(last().component).toBe(PluginConfig)
      expect(last().props?.schema).toMatchObject({ pluginAlias: 'Example' })
    })

    it('opens the raw json editor for a plugin without one', async () => {
      api.respond('get', /editor-context/, editorContext({ configSchema: null }))

      void service.settings(makePlugin({ settingsSchema: false }))
      await settle()

      expect(last().component).toBe(ManualConfig)
      expect(last().props?.schema).toBeUndefined()
    })

    it('hands over to the plugin own ui when it declares one', async () => {
      api.respond('get', /editor-context/, editorContext({ configSchema: { customUi: true } }))

      await service.settings(makePlugin())

      expect(cp.openCustomSettingsUi).toHaveBeenCalled()
      expect(modal.opened).toEqual([])
    })

    it('hands over to a registered custom ui', async () => {
      api.respond('get', /editor-context/, editorContext())
      cp.plugins['homebridge-example'] = { some: 'registration' }

      await service.settings(makePlugin())

      expect(cp.openSettings).toHaveBeenCalled()
      expect(modal.opened).toEqual([])
    })

    it('says so and opens nothing when the schema cannot be loaded', async () => {
      api.fail('get', /editor-context/, new Error('plugin not found'))

      await service.settings(makePlugin())

      expect(modal.opened).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('plugins.toast_failed_to_load_plugin_schema', 'toast.title_error')
    })

    it('asks the server for that plugin context, url-encoding the name', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.settings(makePlugin({ name: '@scope/homebridge-example' }))
      await settle()

      expect(api.lastCall('get')?.url).toBe('/plugins/%40scope%2Fhomebridge-example/editor-context')
    })
  })

  describe('opening the json editor directly', () => {
    it('always opens the raw editor, schema or not', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.jsonEditor(makePlugin({ settingsSchema: true }))
      await settle()

      expect(last().component).toBe(ManualConfig)
    })

    it('passes the schema through so the editor can still validate', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.jsonEditor(makePlugin({ settingsSchema: true }))
      await settle()

      expect(last().props?.schema).toMatchObject({ pluginAlias: 'Example' })
    })

    it('opens anyway when the context fails, with no toast', async () => {
      api.fail('get', /editor-context/, new Error('schema is not valid json'))

      void service.jsonEditor(makePlugin())
      await settle()

      expect(last().component).toBe(ManualConfig)
      expect(toast.error).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('the child bridge settings', () => {
    it('opens the bridge modal with the loaded context', async () => {
      api.respond('get', /editor-context/, editorContext({ childBridges: [{ identifier: 'abc' }] }))

      void service.bridgeSettings(makePlugin())
      await settle()

      expect(last().component).toBe(PluginBridge)
      expect(last().props?.editorContext).toMatchObject({ childBridges: [{ identifier: 'abc' }] })
    })

    it('says it was opened straight after an install when it was', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.bridgeSettings(makePlugin(), true)
      await settle()

      expect(last().props?.justInstalled).toBe(true)
    })

    it('leaves the schema out for a plugin that has none', async () => {
      api.respond('get', /editor-context/, editorContext())

      void service.bridgeSettings(makePlugin({ settingsSchema: false }))
      await settle()

      expect(last().props?.schema).toBeUndefined()
    })

    it('refuses to open when the context cannot be loaded', async () => {
      api.fail('get', /editor-context/, new Error('plugin not found'))

      await service.bridgeSettings(makePlugin())

      expect(modal.opened).toEqual([])
      expect(toast.error).toHaveBeenCalled()
    })

    it('refreshes the plugin list when the modal asks for it', async () => {
      const refreshed = vi.fn()
      const unsubscribe = service.onPluginListRefresh.subscribe(refreshed)
      api.respond('get', /editor-context/, editorContext())

      void service.bridgeSettings(makePlugin())
      await settle()
      last().ref.close('refresh')
      await settle()

      expect(refreshed).toHaveBeenCalled()
      unsubscribe()
    })

    it('leaves the list alone on any other outcome', async () => {
      const refreshed = vi.fn()
      const unsubscribe = service.onPluginListRefresh.subscribe(refreshed)
      api.respond('get', /editor-context/, editorContext())

      void service.bridgeSettings(makePlugin())
      await settle()
      last().ref.close('restart')
      await settle()

      expect(refreshed).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('the other modals it opens', () => {
    it('shows the external accessories of a plugin', async () => {
      const plugin = makePlugin()

      void service.externalAccessories(plugin)
      await settle()

      expect(last().component).toBe(PluginExternals)
      expect(last().props?.plugin).toBe(plugin)
    })

    it('opens the bridge reset modal with the bridges to reset', async () => {
      const childBridges = [{ identifier: 'abc' }] as any[]

      await service.resetChildBridges(childBridges)

      expect(last().component).toBe(ResetAccessories)
      expect(last().props?.childBridges).toBe(childBridges)
    })

    it('opens the switch-to-scoped modal for a renamed plugin', async () => {
      const plugin = makePlugin()

      await service.switchToScoped(plugin)

      expect(last().component).toBe(SwitchToScoped)
      expect(last().props?.plugin).toBe(plugin)
    })

    it('opens every one of them as a large modal that cannot be clicked away', async () => {
      await service.switchToScoped(makePlugin())

      expect(last().options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })
  })

  describe('the update all opener', () => {
    it('opens the modal large and undismissable, and hands back the ref', () => {
      const ref = service.openUpdateAllModal()

      expect(last().component).toBe(UpdateAllModal)
      expect(last().options).toMatchObject({ size: 'lg', backdrop: 'static' })
      expect(ref).toBe(last().ref)
    })
  })
})
