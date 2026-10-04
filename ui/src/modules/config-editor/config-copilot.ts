import type { HomebridgeConfig } from './config-editor.interfaces'

/**
 * Put a block Config Copilot generated into the whole config.json: it replaces
 * the block of the same plugin (the one with the same `name` when there are
 * several, else the first), or is appended when the plugin has none yet.
 * Returns a new config; the one given is left as it is.
 * @param config - the config as in the editor
 * @param block - the generated block, carrying its `platform` or `accessory` key
 */
export function withCopilotBlock(config: HomebridgeConfig, block: Record<string, unknown>): HomebridgeConfig {
  const next = structuredClone(config) as Record<string, any>
  const type = typeof block.platform === 'string' ? 'platform' : typeof block.accessory === 'string' ? 'accessory' : null
  if (!type) {
    return next as HomebridgeConfig
  }
  const key = type === 'platform' ? 'platforms' : 'accessories'
  const list: Array<Record<string, unknown>> = Array.isArray(next[key]) ? next[key] : []
  const alias = block[type] as string
  const matches = (entry: Record<string, unknown>) => entry?.[type] === alias || (typeof entry?.[type] === 'string' && (entry[type] as string).endsWith(`.${alias}`))
  let index = list.findIndex(entry => matches(entry) && entry.name === block.name)
  if (index === -1) {
    index = list.findIndex(matches)
  }
  if (index === -1) {
    list.push(block)
  } else {
    list[index] = block
  }
  next[key] = list
  return next as HomebridgeConfig
}
