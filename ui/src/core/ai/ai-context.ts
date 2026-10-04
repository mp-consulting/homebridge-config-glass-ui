import type { AiChatContext } from './ai.interfaces'

import { useEffect } from 'react'

/**
 * The page context the Assistant chat sends with each question: the route,
 * what kind of page it is, and the plugin whose settings are open (plugin
 * settings are a dialog over the Plugins page, so the route alone cannot tell).
 */

/** Plugin settings dialogs open right now, innermost last. */
const openPlugins: string[] = []

/**
 * Tell the Assistant a plugin's settings are open while the calling component
 * is mounted (PluginConfig, CustomPlugins).
 * @param pluginName - the plugin's package name
 */
export function useAssistantPluginContext(pluginName: string | undefined): void {
  useEffect(() => {
    if (!pluginName) {
      return
    }
    openPlugins.push(pluginName)
    return () => {
      const index = openPlugins.lastIndexOf(pluginName)
      if (index !== -1) {
        openPlugins.splice(index, 1)
      }
    }
  }, [pluginName])
}

/** The plugin whose settings dialog is open, if any. */
export function currentAssistantPlugin(): string | undefined {
  return openPlugins.at(-1)
}

const PAGES: Array<[prefix: string, page: string]> = [
  ['/plugins', 'plugins'],
  ['/config', 'config-editor'],
  ['/accessories', 'accessories'],
  ['/quick', 'quick-controls'],
  ['/scenes', 'scenes'],
  ['/logs', 'logs'],
  ['/users', 'users'],
  ['/settings', 'settings'],
  ['/support', 'support'],
  ['/child-bridges', 'child-bridges'],
  ['/power-options', 'power-options'],
  ['/platform-tools', 'platform-tools'],
  ['/restart', 'restart'],
]

/**
 * The context for a chat request.
 * @param pathname - the router path (without the base path)
 * @param plugin - the plugin whose settings are open (defaults to the registered one)
 */
export function buildAssistantContext(pathname: string, plugin: string | undefined = currentAssistantPlugin()): AiChatContext {
  const route = (pathname || '/').split(/[?#]/)[0].slice(0, 200) || '/'
  let page = route === '/' ? 'dashboard' : 'other'
  for (const [prefix, name] of PAGES) {
    if (route === prefix || route.startsWith(`${prefix}/`)) {
      page = name
      break
    }
  }
  if (plugin) {
    return { route, page: 'plugin-settings', plugin }
  }
  return { route, page }
}
