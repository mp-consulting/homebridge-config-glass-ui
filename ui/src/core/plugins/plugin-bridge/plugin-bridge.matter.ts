import type { CheckboxEvent, MatterFabric, PluginBridgeState, SliceContext } from './plugin-bridge.state'

import { api } from '@/core/api'
import { RE_CONSECUTIVE_DASHES, RE_LEADING_TRAILING_DASH, RE_NON_ALNUM } from '@/core/regex.constants'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'

import { syncCheckboxDom, t, withEntry, withFlag } from './plugin-bridge.state'

/** Matter on a child bridge: the toggles, the port, and the commissioning (fabric) info. */
export interface MatterActions {
  toggleMatterBridge: (block: any, enable: boolean, index: string, event?: CheckboxEvent) => Promise<void>
  /**
   * Toggle the `matter.externalsOnly` flag for a block. Only meaningful when
   * Matter is disabled (the toggle is hidden in the UI when Matter is on).
   *
   * When toggled on against a child bridge that has never configured matter,
   * a matter block is auto-created (`{ port, enabled: false, externalsOnly: true }`)
   * so the user doesn't have to enable-then-disable matter just to reach this
   * setting. When toggled off again, that auto-created block is removed iff
   * matter wasn't otherwise engaged in this session (tracked via
   * `matterBridgeCache`, which is populated on every load and every
   * `toggleMatterBridge` call).
   */
  toggleMatterExternalsOnly: (event: CheckboxEvent, idx: number) => Promise<void>
  /**
   * Toggle the Matter disableIpv4 flag for a block. When on, the Matter mDNS
   * responder for this bridge runs IPv6-only. Only available on Homebridge
   * >= 2.2.0 (see the `matterDisableIpv4` feature flag) and only shown while
   * Matter is enabled for the block.
   */
  toggleMatterDisableIpv4: (event: CheckboxEvent, idx: number) => void
}

/** The id Matter storage is kept under (same sanitising as the backend). */
export function matterIdentifier(username: string): string {
  return username.replace(RE_NON_ALNUM, '-').replace(RE_CONSECUTIVE_DASHES, '-').replace(RE_LEADING_TRAILING_DASH, '')
}

/**
 * Human-readable name for a commissioned Matter fabric: the controller
 * vendor, plus the fabric's own label (the home name, on Apple Home
 * fabrics) when one is set.
 */
export function getMatterFabricLabel(fabric: MatterFabric): string {
  // The child bridge metadata path sends the raw matter.js field name
  // (rootVendorId); the accessory-info path maps it to vendorId in core.
  const vendorId = fabric.vendorId ?? fabric.rootVendorId
  const vendorNames: Record<number, string> = {
    0x1349: 'Apple Home',
    0x1384: 'Apple Keychain',
    0x6006: 'Google Home',
    0x1217: 'Amazon Alexa',
    0x1049: 'SmartThings',
  }
  const vendor = vendorNames[vendorId ?? 0] ?? `0x${(vendorId ?? 0).toString(16).toUpperCase()}`
  return fabric.label ? `${vendor} · ${fabric.label}` : vendor
}

export function getMatterPortValidationError(state: PluginBridgeState, index: string): boolean {
  const block = state.configBlocks[Number(index)]
  const port = block._bridge?.matter?.port

  if (!port && port !== 0) {
    return false // Empty is valid (optional)
  }

  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return true
  }

  // Check for reserved ports
  if ([5353, 8080, 8443].includes(port)) {
    return true
  }

  // Check if Matter port conflicts with HAP port on same bridge
  const hapPort = block._bridge?.port
  return !!hapPort && port === hapPort
}

/** Drop a matter block left without a port. */
export function normalizeMatterConfig(block: any): void {
  if (block._bridge?.matter) {
    // Normalize port: convert empty/null to undefined
    if (!block._bridge.matter.port && block._bridge.matter.port !== 0) {
      block._bridge.matter.port = undefined
    }

    // If port is undefined, remove the matter config
    if (block._bridge.matter.port === undefined) {
      delete block._bridge.matter
    }
  }
}

export async function getUnusedMatterPort(): Promise<number> {
  try {
    const lookup = await api.get<{ port: number }>('/server/port/new/matter')
    return lookup.port
  } catch {
    // Fallback to Matter port range if API call fails
    return Math.floor(Math.random() * (5541 - 5530 + 1) + 5530)
  }
}

export async function getMatterCommissioningInfo(ctx: SliceContext, username: string): Promise<void> {
  const store = (info: any) => ctx.set(state => ({ matterDeviceInfo: withEntry(state.matterDeviceInfo, username, info) }))
  try {
    // Get all child bridges from the status endpoint
    const bridges = await childBridges.getAll()

    // Find the bridge matching this username
    const bridge = bridges.find(b => b.username === username)

    if (bridge && bridge.matterSetupUri) {
      store({
        setupUri: bridge.matterSetupUri,
        pin: bridge.matterPin,
        serialNumber: bridge.matterSerialNumber,
        commissioned: bridge.matterCommissioned,
        deviceCount: bridge.matterDeviceCount,
        port: bridge.matterConfig?.port,
        fabrics: bridge.matterFabrics,
        fabricCount: bridge.matterFabricCount,
      })
    } else {
      // Bridge found but Matter not yet started, or QR code not available yet
      // Set partial info so template knows to wait for restart
      store({ port: bridge?.matterConfig?.port })
    }
  } catch (error) {
    console.error(error)
    // Set empty object so restart placeholder shows (instead of null which breaks template conditions)
    store({})
  }
}

/**
 * Show the commissioning info of a bridge whose Matter is (back) on: the
 * backend's, when the bridge was commissioned before; otherwise just the port,
 * whose missing setupUri makes the view ask for a restart.
 */
export async function restoreMatterCommissioningInfo(ctx: SliceContext, username: string, port: number | undefined): Promise<void> {
  const wasOriginallyEnabled = ctx.get().originalMatterBridges.some(m => m.port === port)
  if (wasOriginallyEnabled) {
    await getMatterCommissioningInfo(ctx, username)
  } else {
    ctx.set(state => ({ matterDeviceInfo: withEntry(state.matterDeviceInfo, username, { port }) }))
  }
}

/** Cache a block's matter port + disableIpv4 (the name is shared at `_bridge` level), for a later restore. */
export function cacheMatterConfig(ctx: SliceContext, idx: number, matter: any): void {
  ctx.set(state => ({
    matterBridgeCache: withEntry(state.matterBridgeCache, idx, { port: matter.port, disableIpv4: matter.disableIpv4 === true }),
  }))
}

/** Queue a bridge's Matter storage for deletion on save. */
export function markMatterForDeletion(ctx: SliceContext, username: string, name: string): void {
  const identifier = matterIdentifier(username)
  ctx.set(state => ({ deleteMatterBridges: [...state.deleteMatterBridges, { username, identifier, name }] }))
}

export function unmarkMatterForDeletion(ctx: SliceContext, username: string): void {
  const identifier = matterIdentifier(username)
  ctx.set(state => ({ deleteMatterBridges: state.deleteMatterBridges.filter(b => b.identifier !== identifier) }))
}

export function createMatterSlice(ctx: SliceContext): MatterActions {
  const { set, get } = ctx
  const setFlag = (key: 'matterEnabledBlocks' | 'matterExternalsOnlyBlocks' | 'matterDisableIpv4Blocks', idx: number, value: boolean) =>
    set(state => ({ [key]: withFlag(state[key], idx, value) }))

  const enableMatter = async (block: any, idx: number) => {
    const { isProtocolExternalsOnlyEnabled, isMatterDisableIpv4Enabled } = get()
    setFlag('matterEnabledBlocks', idx, true)
    // Re-enabling Matter must clear any lingering externalsOnly — the
    // runtime validation rejects `enabled: true + externalsOnly: true`.
    if (isProtocolExternalsOnlyEnabled) {
      setFlag('matterExternalsOnlyBlocks', idx, false)
      if (block._bridge?.matter?.externalsOnly !== undefined) {
        delete block._bridge.matter.externalsOnly
      }
    }

    const matterCache = get().matterBridgeCache.get(idx)

    // Create _bridge object if it doesn't exist (Matter-only case)
    if (!block._bridge) {
      block._bridge = { env: {} }
    }
    get().touch()

    // Restore the port from cache, or allocate a new one the first time
    const port: number | undefined = matterCache?.port ? matterCache.port : await getUnusedMatterPort()

    // Preserve disableIpv4 across the rebuild: an in-place-disabled block
    // still carries it, otherwise fall back to the cached value.
    const keepDisableIpv4 = block._bridge.matter?.disableIpv4 === true || matterCache?.disableIpv4 === true

    // Only store port + disableIpv4 in matter config - name is now shared at _bridge level
    block._bridge.matter = {
      port,
      ...(keepDisableIpv4 ? { disableIpv4: true } : {}),
    }
    get().touch()
    if (isMatterDisableIpv4Enabled) {
      setFlag('matterDisableIpv4Blocks', idx, keepDisableIpv4)
    }
    set(state => ({ matterBridgeCache: withEntry(state.matterBridgeCache, idx, { port, disableIpv4: keepDisableIpv4 }) }))

    if (block._bridge.username) {
      // If this was marked for deletion, remove it from the delete list
      unmarkMatterForDeletion(ctx, block._bridge.username)
      // Also clear the "explicitly disabled" tracking flag since user is now enabling Matter
      set(state => ({ matterExplicitlyDisabledBeforeChildBridge: withoutIndex(state.matterExplicitlyDisabledBeforeChildBridge, idx) }))
      await restoreMatterCommissioningInfo(ctx, block._bridge.username, port)
    }
  }

  const disableMatter = (block: any, idx: number) => {
    const plugin = get().plugin
    setFlag('matterEnabledBlocks', idx, false)

    if (get().allowMatterDisableInPlace) {
      // In-place disable (Homebridge >= 2.0.3-beta.22): keep the matter block,
      // port and on-disk commissioning; just mark it disabled so re-enabling
      // does not require re-commissioning.
      if (block._bridge?.matter) {
        cacheMatterConfig(ctx, idx, block._bridge.matter)
        block._bridge.matter.enabled = false
      }
      // Hide commissioning (QR) info while it is disabled
      if (block._bridge?.username) {
        set(state => ({ matterDeviceInfo: withEntry(state.matterDeviceInfo, block._bridge.username, null) }))
      }
      get().touch()
      return
    }

    // Legacy teardown (older Homebridge): remove the block and delete its
    // commissioning storage on save, if it was originally enabled.
    const wasOriginallyEnabled = get().originalMatterBridges.some(m =>
      block._bridge?.matter && m.port === block._bridge.matter.port,
    )

    // Cache the current values before deleting (for potential restore)
    if (block._bridge && block._bridge.matter) {
      cacheMatterConfig(ctx, idx, block._bridge.matter)
      delete block._bridge.matter
    }

    if (block._bridge?.username) {
      // Clear commissioning info when disabling
      set(state => ({ matterDeviceInfo: withEntry(state.matterDeviceInfo, block._bridge.username, null) }))
      if (wasOriginallyEnabled) {
        markMatterForDeletion(ctx, block._bridge.username, block._bridge.name || plugin.displayName || plugin.name)
      }
    }

    // Clean up if _bridge is now empty
    if (block._bridge && Object.keys(block._bridge).length === 0) {
      delete block._bridge
    }
    get().touch()
  }

  return {
    toggleMatterBridge: async (block, enable, index, event) => {
      if (!get().plugin) {
        return
      }
      const idx = Number(index)

      // Matter is only supported for platform-based plugins
      if (block.accessory) {
        syncCheckboxDom(event, false)
        setFlag('matterEnabledBlocks', idx, false)
        return
      }

      // Refuse to disable Matter when HAP is also off — at least one protocol is
      // required unless the running Homebridge supports disabling all protocols.
      if (!enable && !get().hapEnabledBlocks[idx] && !get().allowDisableAllProtocols) {
        toast.info(t('child_bridge.config.disable_matter_requires_hap'), t('toast.title_notice'))
        syncCheckboxDom(event, true)
        setFlag('matterEnabledBlocks', idx, true)
        return
      }

      if (enable) {
        await enableMatter(block, idx)
      } else {
        disableMatter(block, idx)
      }
    },

    toggleMatterExternalsOnly: async (event, idx) => {
      if (!get().isProtocolExternalsOnlyEnabled) {
        return
      }
      const checked = (event.target as HTMLInputElement).checked
      const block = get().configBlocks[idx]

      // Accessory blocks have no matter — sync DOM back and bail.
      if (block?.accessory) {
        syncCheckboxDom(event, false)
        setFlag('matterExternalsOnlyBlocks', idx, false)
        return
      }

      setFlag('matterExternalsOnlyBlocks', idx, checked)

      if (!block?._bridge) {
        return
      }

      if (checked) {
        if (!block._bridge.matter) {
          const port = await getUnusedMatterPort()
          block._bridge.matter = { port, enabled: false, externalsOnly: true }
        } else {
          block._bridge.matter.externalsOnly = true
        }
      } else {
        if (!block._bridge.matter) {
          return
        }
        delete block._bridge.matter.externalsOnly
        // If the matter block exists only because the user toggled externalsOnly
        // on (matter was never originally configured and was never engaged via
        // the matter toggle in this session), tearing externalsOnly off tears
        // the block out too — otherwise we'd leave behind an orphan
        // `{ port, enabled: false }` matter block the user never asked for.
        if (!get().matterBridgeCache.has(idx)) {
          delete block._bridge.matter
        }
      }
      get().touch()
    },

    toggleMatterDisableIpv4: (event, idx) => {
      if (!get().isMatterDisableIpv4Enabled) {
        return
      }
      const checked = (event.target as HTMLInputElement).checked
      const block = get().configBlocks[idx]

      setFlag('matterDisableIpv4Blocks', idx, checked)

      if (!block?._bridge?.matter) {
        return
      }

      if (checked) {
        block._bridge.matter.disableIpv4 = true
      } else {
        delete block._bridge.matter.disableIpv4
      }

      // Keep the cache in sync so disable/enable round-trips preserve the flag
      set((state) => {
        const existing = state.matterBridgeCache.get(idx)
        return existing ? { matterBridgeCache: withEntry(state.matterBridgeCache, idx, { ...existing, disableIpv4: checked }) } : {}
      })
      get().touch()
    },
  }
}

/** A new set without `idx`. */
export function withoutIndex(set: Set<number>, idx: number): Set<number> {
  const next = new Set(set)
  next.delete(idx)
  return next
}
