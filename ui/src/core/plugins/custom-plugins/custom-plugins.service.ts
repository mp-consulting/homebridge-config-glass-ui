import type { Plugin, PluginEditorContext } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalRef } from '@/core/ui/modal'
import type { ComponentType } from 'react'

import { api } from '@/core/api'
import { CustomPlugins } from '@/core/plugins/custom-plugins/CustomPlugins'
import { ignoreDismiss } from '@/core/ui/ignore-dismiss'
import { openModal } from '@/core/ui/modal'

const open = openModal as (component: unknown, props: Record<string, any>, options?: Record<string, any>) => ModalRef

async function loadPluginConfig(pluginName: string): Promise<any[]> {
  return api.get(`/config-editor/plugin/${encodeURIComponent(pluginName)}`)
}

/** Opens a plugin's own settings UI (CustomPluginsService). */
export const customPlugins = {
  /**
   * Settings components registered by plugin name, opened in place of the
   * standard form. Nothing registers one today; the hook is kept.
   */
  plugins: {} as Record<string, ComponentType<any>>,

  async openSettings(plugin: Plugin, schema: any, editorContext?: PluginEditorContext): Promise<unknown> {
    const pluginConfig = editorContext?.config ?? await loadPluginConfig(plugin.name)

    const ref = open(customPlugins.plugins[plugin.name], {
      plugin,
      schema,
      pluginConfig,
      editorContext,
    }, { size: 'lg', backdrop: 'static' })

    return ref.result.catch(ignoreDismiss)
  },

  async openCustomSettingsUi(plugin: Plugin, schema: any, editorContext?: PluginEditorContext): Promise<unknown> {
    const pluginConfig = editorContext?.config ?? await loadPluginConfig(plugin.name)

    const ref = open(CustomPlugins, {
      plugin,
      schema,
      pluginConfig,
      editorContext,
    }, { size: 'lg', backdrop: 'static' })

    return ref.result.catch(ignoreDismiss)
  },
}
