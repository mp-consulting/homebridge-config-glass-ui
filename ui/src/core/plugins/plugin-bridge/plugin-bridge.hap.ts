import type { DeviceInfo } from '@/core/plugins/manage-plugins.interfaces'

import type { CheckboxEvent, PluginBridgeFeatures, PluginBridgeState, SliceContext } from './plugin-bridge.state'

import { api } from '@/core/api'
import {
  RE_COLON,
  RE_HAP_NAME_PATTERN,
  RE_INVALID_HAP_NAME_CHARS,
  RE_LEADING_TRAILING_NON_ALNUM_UNICODE,
  RE_LEADING_TRAILING_SPACE_APOSTROPHE,
} from '@/core/regex.constants'
import { toast } from '@/core/ui/toast'

import { syncCheckboxDom, t, withEntry, withFlag } from './plugin-bridge.state'

/** HomeKit (HAP) on a child bridge: the toggles, the pairing info and the name/port rules. */
export interface HapActions {
  toggleHapBridge: (block: any, enable: boolean, index: string, event?: CheckboxEvent) => Promise<void>
  /**
   * Toggle the `hap.externalsOnly` flag for a block. Only meaningful when HAP
   * is already disabled (the toggle is hidden in the UI when HAP is enabled).
   */
  toggleHapExternalsOnly: (event: CheckboxEvent, idx: number) => void
  /**
   * Toggle the `hap.disableIdentifyingMaterial` flag for a block. The option
   * is independent of HAP enablement and is preserved across HAP and child
   * bridge disable/enable round-trips.
   */
  toggleHapDisableIdentifyingMaterial: (event: CheckboxEvent, idx: number) => void
}

// ===== validation (selectors) =====

export function getHapNameValidationError(state: PluginBridgeState, index: string): boolean {
  const block = state.configBlocks[Number(index)]
  if (!block._bridge?.name) {
    return false // empty is valid
  }

  // HAP name validation: must start and end with letter/number, can contain letters, numbers, spaces, and apostrophes
  // https://github.com/homebridge/HAP-NodeJS/blob/ee41309fd9eac383cdcace39f4f6f6a3d54396f3/src/lib/util/checkName.ts#L12
  return !RE_HAP_NAME_PATTERN.test(block._bridge.name)
}

export function getHapPortValidationError(state: PluginBridgeState, index: string): boolean {
  const { configBlocks, enabledBlocks } = state
  const block = configBlocks[Number(index)]
  const port = block._bridge?.port

  if (!port && port !== 0) {
    return false // Empty is valid (optional - will be auto-allocated)
  }

  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1025 || port > 65533) {
    return true
  }

  // Check for port conflicts with other enabled bridges
  for (const [i, otherBlock] of configBlocks.entries()) {
    if (i.toString() !== index && enabledBlocks[i] && otherBlock._bridge?.port === port) {
      return true
    }
  }

  // Check if HAP port conflicts with Matter port on same bridge
  const matterPort = block._bridge?.matter?.port
  return !!matterPort && port === matterPort
}

/**
 * The display name of the first bridge whose name or port fails validation.
 * The disabled Save button needs to say why - the offending bridge may not
 * even be the one currently on screen (#2892).
 */
export function selectValidationErrorBridgeName(state: PluginBridgeState): string | null {
  for (const [index, block] of state.configBlocks.entries()) {
    if (state.enabledBlocks[index] && block._bridge?.username) {
      if (getHapNameValidationError(state, index.toString()) || getHapPortValidationError(state, index.toString())) {
        return block._bridge.name || block.name || block.platform || block.accessory || `#${index + 1}`
      }
    }
  }
  return null
}

/** Check if any validation errors exist across all enabled bridges */
export function selectHasValidationErrors(state: PluginBridgeState): boolean {
  return selectValidationErrorBridgeName(state) !== null
}

// ===== helpers =====

export async function getUnusedPort(): Promise<number> {
  try {
    const lookup = await api.get<{ port: number }>('/server/port/new')
    return lookup.port
  } catch {
    return Math.floor(Math.random() * (60000 - 30000 + 1) + 30000)
  }
}

/** Load the bridge's HAP pairing (QR code, paired state); `false` when there is none. */
export async function getDeviceInfo(ctx: SliceContext, username: string): Promise<void> {
  let info: DeviceInfo | false
  try {
    info = await api.get<DeviceInfo>(`/server/pairings/${username.replace(RE_COLON, '')}`)
  } catch (error) {
    console.error(error)
    info = false
  }
  ctx.set(state => ({ deviceInfo: withEntry(state.deviceInfo, username, info) }))
}

export function generateUsername(): string {
  const hexDigits = '0123456789ABCDEF'
  let username = '0E:'
  for (let i = 0; i < 5; i += 1) {
    username += hexDigits.charAt(Math.round(Math.random() * 15))
    username += hexDigits.charAt(Math.round(Math.random() * 15))
    if (i !== 4) {
      username += ':'
    }
  }
  return username
}

/**
 * Sanitize a bridge name to comply with HAP name validation rules
 * Removes invalid characters and ensures name starts/ends with letter or number
 */
export function sanitizeBridgeName(name: string): string {
  if (!name) {
    return name
  }
  // Remove any characters that aren't letters, numbers, spaces, or apostrophes,
  // then leading/trailing spaces and apostrophes, then anything else that is
  // not a letter or number at either end
  return name
    .replace(RE_INVALID_HAP_NAME_CHARS, '')
    .replace(RE_LEADING_TRAILING_SPACE_APOSTROPHE, '')
    .replace(RE_LEADING_TRAILING_NON_ALNUM_UNICODE, '')
}

/** Older Homebridge only knows `hap: false`; newer runtimes take the nested object form. */
function usesNestedHap(features: PluginBridgeFeatures): boolean {
  return features.isProtocolExternalsOnlyEnabled || features.isHapDisableIdentifyingMaterialEnabled
}

/**
 * Write the HAP shape a block saves with, for the running Homebridge.
 * externalsOnly carries through only when HAP is disabled; the
 * identifying-material preference is independent of enablement.
 */
export function normalizeHapConfig(
  features: PluginBridgeFeatures,
  block: any,
  hapEnabled: boolean | undefined,
  hapExternalsOnly = false,
  hapDisableIdentifyingMaterial = false,
): void {
  if (!block._bridge) {
    return
  }
  if (hapEnabled === false) {
    if (usesNestedHap(features)) {
      // Nested form for newer Homebridge versions. Optional settings are
      // written only when explicitly toggled on.
      block._bridge.hap = {
        enabled: false,
        ...(hapExternalsOnly ? { externalsOnly: true } : {}),
        ...(hapDisableIdentifyingMaterial ? { disableIdentifyingMaterial: true } : {}),
      }
    } else {
      block._bridge.hap = false
    }
  } else if (hapDisableIdentifyingMaterial) {
    block._bridge.hap = { disableIdentifyingMaterial: true }
  } else {
    delete block._bridge.hap
  }
}

export function createHapSlice(ctx: SliceContext): HapActions {
  const { set, get } = ctx
  const setFlag = (key: 'hapEnabledBlocks' | 'hapExternalsOnlyBlocks' | 'hapDisableIdentifyingMaterialBlocks', idx: number, value: boolean) =>
    set(state => ({ [key]: withFlag(state[key], idx, value) }))

  /**
   * Write the "HAP disabled" shape onto a bridge block.
   *
   * externalsOnly is never set here — disabling HAP transitions the block to
   * the plain disabled shape, and the externalsOnly toggle (which only appears
   * once HAP is disabled) writes the externalsOnly shape itself via
   * toggleHapExternalsOnly(). The independent disableIdentifyingMaterial
   * preference is preserved in either nested disabled shape.
   */
  const writeHapDisabled = (block: any, idx: number) => {
    if (usesNestedHap(get())) {
      block._bridge.hap = {
        enabled: false,
        ...(get().hapDisableIdentifyingMaterialBlocks[idx] === true ? { disableIdentifyingMaterial: true } : {}),
      }
    } else {
      block._bridge.hap = false
    }
  }

  const enableHap = async (block: any, idx: number) => {
    const keepDisableIdentifyingMaterial = get().isHapDisableIdentifyingMaterialEnabled
      && get().hapDisableIdentifyingMaterialBlocks[idx] === true
    setFlag('hapEnabledBlocks', idx, true)
    // Re-enabling HAP must also clear any lingering externalsOnly setting —
    // the validation rule on the new runtime is `externalsOnly requires
    // enabled: false`, so this combination would be rejected.
    if (get().isProtocolExternalsOnlyEnabled) {
      setFlag('hapExternalsOnlyBlocks', idx, false)
    }

    if (!block._bridge) {
      block._bridge = { env: {} }
    }

    // Restore HAP defaults if missing (Matter-only bridge gaining HAP).
    if (!block._bridge.username) {
      block._bridge.username = generateUsername()
    }
    get().touch()
    if (!block._bridge.port) {
      block._bridge.port = await getUnusedPort()
    }
    const plugin = get().plugin
    if (!block._bridge.name && plugin) {
      block._bridge.name = sanitizeBridgeName(plugin.displayName || plugin.name)
    }

    if (keepDisableIdentifyingMaterial) {
      block._bridge.hap = { disableIdentifyingMaterial: true }
    } else {
      delete block._bridge.hap
    }

    set(state => ({ bridgeCache: withEntry(state.bridgeCache, idx, block._bridge) }))
    get().touch()
    await getDeviceInfo(ctx, block._bridge.username)
  }

  return {
    toggleHapBridge: async (block, enable, index, event) => {
      const idx = Number(index)

      // Accessory-style child bridges cannot disable HAP (no Matter alternative).
      if (!enable && block.accessory) {
        toast.error(t('child_bridge.config.hap_disabled_for_accessory'), t('toast.title_error'))
        syncCheckboxDom(event, true)
        setFlag('hapEnabledBlocks', idx, true)
        return
      }

      // Mutual exclusion: refuse to disable HAP unless Matter is enabled for this
      // block — unless the running Homebridge supports disabling all protocols.
      if (!enable && !get().matterEnabledBlocks[idx] && !get().allowDisableAllProtocols) {
        toast.info(t('child_bridge.config.disable_hap_requires_matter'), t('toast.title_notice'))
        syncCheckboxDom(event, true)
        setFlag('hapEnabledBlocks', idx, true)
        return
      }

      if (enable) {
        await enableHap(block, idx)
      } else {
        block._bridge = block._bridge || {}
        writeHapDisabled(block, idx)
        setFlag('hapEnabledBlocks', idx, false)
        get().touch()
      }
    },

    toggleHapExternalsOnly: (event, idx) => {
      if (!get().isProtocolExternalsOnlyEnabled) {
        return
      }
      const checked = (event.target as HTMLInputElement).checked
      const block = get().configBlocks[idx]

      // externalsOnly is only valid when HAP is disabled; write the nested
      // object form with the current toggle state.
      if (block?._bridge && get().hapEnabledBlocks[idx] === false) {
        block._bridge.hap = {
          enabled: false,
          ...(checked ? { externalsOnly: true } : {}),
          ...(get().hapDisableIdentifyingMaterialBlocks[idx] === true ? { disableIdentifyingMaterial: true } : {}),
        }
      }
      setFlag('hapExternalsOnlyBlocks', idx, checked)
      get().touch()
    },

    toggleHapDisableIdentifyingMaterial: (event, idx) => {
      if (!get().isHapDisableIdentifyingMaterialEnabled) {
        return
      }
      const checked = (event.target as HTMLInputElement).checked
      const block = get().configBlocks[idx]

      if (block?._bridge) {
        const existingHap = block._bridge.hap
        const hap = typeof existingHap === 'object' && existingHap !== null
          ? { ...existingHap }
          : existingHap === false || get().hapEnabledBlocks[idx] === false
            ? { enabled: false }
            : {}

        if (checked) {
          hap.disableIdentifyingMaterial = true
        } else {
          delete hap.disableIdentifyingMaterial
        }

        if (Object.keys(hap).length > 0) {
          block._bridge.hap = hap
        } else {
          delete block._bridge.hap
        }
      }
      setFlag('hapDisableIdentifyingMaterialBlocks', idx, checked)
      get().touch()
    },
  }
}
