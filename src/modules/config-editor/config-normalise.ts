import { HomebridgeConfig, PlatformConfig } from '../../core/config/config.interfaces.js'
import { generatePin, generateUsername } from '../../core/hap-identity.js'
import { RE_COLON, RE_PIN, RE_USERNAME } from '../../core/regex.constants.js'

export { generatePin, generateUsername }

/**
 * Normalise a config object in place: ensure the bridge block is complete
 * and valid, the array sections are arrays, and the optional sections are
 * well-formed. Shared by the full-file save path and the locked
 * read-modify-write path so both persist the same shape. `currentBridge` is
 * the running bridge block, used as the fallback for an invalid username/pin;
 * `assertRestartCommandsSafe` rejects unsafe UI commands.
 */
export function normaliseConfig(
  config: HomebridgeConfig | null,
  currentBridge: HomebridgeConfig['bridge'],
  assertRestartCommandsSafe: (config: HomebridgeConfig) => void,
): HomebridgeConfig {
  if (!config) {
    config = {} as HomebridgeConfig
  }

  if (!config.bridge) {
    config.bridge = {} as HomebridgeConfig['bridge']
  }

  // If bridge.port is a string, try and convert to a number
  if (typeof config.bridge.port === 'string') {
    config.bridge.port = Number.parseInt(config.bridge.port, 10)
  }

  // Ensure the bridge.port is valid
  if (!config.bridge.port || typeof config.bridge.port !== 'number' || config.bridge.port > 65533 || config.bridge.port < 1025) {
    config.bridge.port = Math.floor(Math.random() * (52000 - 51000 + 1) + 51000)
  }

  // Ensure bridge.username exists
  if (!config.bridge.username) {
    config.bridge.username = generateUsername()
  }

  // Ensure the username matches the required pattern
  if (!RE_USERNAME.test(config.bridge.username)) {
    if (RE_USERNAME.test(currentBridge.username)) {
      config.bridge.username = currentBridge.username
    } else {
      config.bridge.username = generateUsername()
    }
  }

  // Ensure bridge.pin exists
  if (!config.bridge.pin) {
    config.bridge.pin = generatePin()
  }

  // Ensure the pin matches the required pattern
  if (!RE_PIN.test(config.bridge.pin)) {
    if (RE_PIN.test(currentBridge.pin)) {
      config.bridge.pin = currentBridge.pin
    } else {
      config.bridge.pin = generatePin()
    }
  }

  // Ensure the bridge.name exists and is a string
  if (!config.bridge.name || typeof config.bridge.name !== 'string') {
    config.bridge.name = `Homebridge ${config.bridge.username.substring(config.bridge.username.length - 5).replace(RE_COLON, '')}`
  }

  // Ensure accessories is an array
  if (!config.accessories || !Array.isArray(config.accessories)) {
    config.accessories = []
  }

  // Ensure platforms is an array
  if (!config.platforms || !Array.isArray(config.platforms)) {
    config.platforms = []
  }

  // Reject unsafe restart/shutdown commands in the UI platform block.
  // Both save paths land here — the full-config JSON editor (`POST
  // /config-editor`) and the patch-style settings UI (`PUT/PATCH
  // /config-editor/ui` → `setPropertiesForUi`) — so this is the right
  // chokepoint for the allowlist check. Runs after the array-shape
  // coercion above so the find() below can't blow up on bad input.
  assertRestartCommandsSafe(config)

  // Ensure config.plugins is an array and not empty
  if (config.plugins && Array.isArray(config.plugins)) {
    if (!config.plugins.length) {
      delete config.plugins
    }
  } else if (config.plugins) {
    delete config.plugins
  }

  // Ensure config.mdns is valid
  if (config.mdns && typeof config.mdns !== 'object') {
    delete config.mdns
  }

  // Ensure config.disabledPlugins is an array
  if (config.disabledPlugins && !Array.isArray(config.disabledPlugins)) {
    delete config.disabledPlugins
  }

  return config
}

/**
 * Removes empty objects and arrays from the provided object
 * Warning: This will modify the object in place, so use with caution.
 * @param {Record<string, any>} obj
 * @return {void}
 * @private
 */
export function removeEmpty(obj: Record<string, any>): void {
  Object.keys(obj).forEach((key) => {
    const value = obj[key]
    if (value === '' || value === null || value === undefined || value === false || (Array.isArray(value) && value.length === 0)) {
      // Checking for 'false' is okay for the UI as all defaults are false
      delete obj[key]
    } else if (typeof value === 'object') {
      removeEmpty(value)
      if (Object.keys(value).length === 0) {
        delete obj[key]
      }
    }
  })
}

/**
 * Cleans up the UI config object
 * - Removes empty objects and arrays
 * - Ensures the name key is first and platform key is last
 * @param {Record<string, any>} uiConfig
 * @return {Record<string, any>}
 * @private
 */
export function cleanUpUiConfig(uiConfig: Record<string, any>): PlatformConfig {
  // Name key first, platform key last
  const { name, platform, ...rest } = uiConfig
  const cleanedUiConfig: PlatformConfig = {
    name,
    platform: platform || 'config',
    ...rest,
  }

  // Clean up bridges array - remove entries without a username
  if (Array.isArray(cleanedUiConfig.bridges)) {
    cleanedUiConfig.bridges = cleanedUiConfig.bridges.filter(bridge => bridge && bridge.username)
  }

  removeEmpty(cleanedUiConfig)
  return cleanedUiConfig
}
