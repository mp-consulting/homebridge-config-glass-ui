import { RE_USERNAME } from '@/core/regex.constants'

/**
 * The basic checks of the Homebridge config spec run before a save. The
 * first failure wins, in the order the Angular editor checked them.
 */
export interface ConfigProblem {
  /** The translation key of the error toast. */
  key: string
  params?: Record<string, string>
  /** The offending platform / accessory entry, as JSON, to highlight in the editor. */
  offendingBlock?: string
}

function validateSection(sections: unknown[], type: 'accessory' | 'platform'): ConfigProblem | null {
  for (const section of sections) {
    // Check section is an object
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      return { key: 'config.error_blocks_objects', params: { type }, offendingBlock: JSON.stringify(section) }
    }

    // Check section contains platform/accessory key
    if (!(type in section)) {
      return { key: 'config.error_blocks_type', params: { type }, offendingBlock: JSON.stringify(section) }
    }

    // Check section platform/accessory key is a string
    if (typeof (section as Record<string, unknown>)[type] !== 'string') {
      return { key: 'config.error_string_type', params: { type }, offendingBlock: JSON.stringify(section) }
    }
  }
  return null
}

function validatePlugins(plugins: unknown[], key: string): ConfigProblem | null {
  for (const item of plugins) {
    if (typeof item !== 'string') {
      return { key: 'config.error_string_array', params: { key } }
    }
  }
  return null
}

/**
 * The first thing wrong with a parsed config, or null when it may be saved.
 * @param config - the parsed config.json
 */
export function findConfigProblem(config: any): ConfigProblem | null {
  if (typeof (config.bridge) !== 'object') {
    return { key: 'config.config_bridge_missing' }
  }
  if (!RE_USERNAME.test(config.bridge.username)) {
    return { key: 'config.config_username_error' }
  }
  if (config.accessories && !Array.isArray(config.accessories)) {
    return { key: 'config.config_accessory_must_be_array' }
  }
  if (config.platforms && !Array.isArray(config.platforms)) {
    return { key: 'config.config_platform_must_be_array' }
  }
  return (Array.isArray(config.platforms) ? validateSection(config.platforms, 'platform') : null)
    ?? (Array.isArray(config.accessories) ? validateSection(config.accessories, 'accessory') : null)
    ?? (Array.isArray(config.plugins) ? validatePlugins(config.plugins, 'plugins') : null)
    ?? (Array.isArray(config.disabledPlugins) ? validatePlugins(config.disabledPlugins, 'disabledPlugins') : null)
}
