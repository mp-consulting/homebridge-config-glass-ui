import type { PluginBridgeAccessoryLink } from '@/core/plugins/plugin-bridge/plugin-bridge.interfaces'

import type { PluginBridgeState, SliceContext } from './plugin-bridge.state'

import { generateUsername, getDeviceInfo, getUnusedPort, sanitizeBridgeName } from './plugin-bridge.hap'
import {
  cacheMatterConfig,
  getUnusedMatterPort,
  markMatterForDeletion,
  matterIdentifier,
  restoreMatterCommissioningInfo,
  unmarkMatterForDeletion,
  withoutIndex,
} from './plugin-bridge.matter'
import { withEntry, withFlag } from './plugin-bridge.state'

/**
 * Setting up a child bridge for a block: switching it on and off, and linking
 * an accessory block to a bridge an earlier block already runs.
 */
export interface ChildBridgeActions {
  toggleExternalBridge: (block: any, enable: boolean, index: string) => Promise<void>
  onBlockChange: (index: string) => void
  onLinkBridgeChange: (username: string) => void
}

/**
 * The bridges the block at `index` can share: only accessory blocks can link,
 * and only to an earlier, enabled bridge that is not being deleted.
 */
export function bridgesAvailableForLink(state: PluginBridgeState, index: string): PluginBridgeAccessoryLink[] {
  const availableBridges: PluginBridgeAccessoryLink[] = []
  if (state.configBlocks[Number(index)]?.accessory) {
    for (const [i, bridge] of state.bridgeCache.entries()) {
      if (state.enabledBlocks[i] && !state.deleteBridges.some(b => b.id === bridge.username) && i < Number(index)) {
        availableBridges.push({
          index: i.toString(),
          usesIndex: index,
          name: bridge.name,
          port: bridge.port,
          username: bridge.username,
        })
      }
    }
  }
  return availableBridges
}

export function createChildBridgeSlice(ctx: SliceContext): ChildBridgeActions {
  const { set, get } = ctx
  const setFlag = (key: 'enabledBlocks' | 'hapEnabledBlocks' | 'matterEnabledBlocks' | 'matterDisableIpv4Blocks' | 'hapDisableIdentifyingMaterialBlocks', idx: number, value: boolean) =>
    set(state => ({ [key]: withFlag(state[key], idx, value) }))

  const enableChildBridge = async (block: any, index: string) => {
    const idx = Number(index)
    const plugin = get().plugin
    const bridgeCache = get().bridgeCache.get(idx)
    const matterCache = get().matterBridgeCache.get(idx)
    const keepHapDisableIdentifyingMaterial = get().isHapDisableIdentifyingMaterialEnabled
      && typeof bridgeCache?.hap === 'object'
      && bridgeCache.hap !== null
      && bridgeCache.hap.disableIdentifyingMaterial === true

    // Always create HAP bridge configuration when HAP toggle is enabled
    block._bridge = {
      username: bridgeCache ? bridgeCache.username : generateUsername(),
      port: await getUnusedPort(),
      name: bridgeCache?.name || sanitizeBridgeName(plugin.displayName || plugin.name),
      model: bridgeCache?.model,
      manufacturer: bridgeCache?.manufacturer,
      firmwareRevision: bridgeCache?.firmwareRevision,
      debugModeEnabled: bridgeCache?.debugModeEnabled,
      env: bridgeCache?.env || {},
      ...(keepHapDisableIdentifyingMaterial ? { hap: { disableIdentifyingMaterial: true } } : {}),
    }
    get().touch()

    // Restore Matter configuration if it was previously cached (cached means it was enabled before disabling)
    // BUT only if the user didn't explicitly disable Matter before disabling the child bridge
    if (matterCache && !get().matterExplicitlyDisabledBeforeChildBridge.has(idx)) {
      // Only restore port + disableIpv4 - name is shared at _bridge level
      block._bridge.matter = {
        port: matterCache.port ?? await getUnusedMatterPort(),
        ...(matterCache.disableIpv4 === true ? { disableIpv4: true } : {}),
      }
      get().touch()
      if (get().isMatterDisableIpv4Enabled) {
        setFlag('matterDisableIpv4Blocks', idx, matterCache.disableIpv4 === true)
      }
      setFlag('matterEnabledBlocks', idx, true)

      if (block._bridge.username) {
        await restoreMatterCommissioningInfo(ctx, block._bridge.username, matterCache.port)
        // Remove from Matter deletion list since we're restoring it
        unmarkMatterForDeletion(ctx, block._bridge.username)
      }
    }

    if (get().deleteBridges.some(b => b.id === block._bridge.username)) {
      set(state => ({ deleteBridges: state.deleteBridges.filter(b => b.id !== block._bridge.username) }))
    }

    set(state => ({
      matterExplicitlyDisabledBeforeChildBridge: withoutIndex(state.matterExplicitlyDisabledBeforeChildBridge, idx),
      bridgeCache: withEntry(state.bridgeCache, idx, block._bridge),
    }))
    await getDeviceInfo(ctx, block._bridge.username)

    setFlag('enabledBlocks', idx, true)
    // HAP defaults to on whenever a child bridge is enabled
    setFlag('hapEnabledBlocks', idx, true)
    if (get().isHapDisableIdentifyingMaterialEnabled) {
      setFlag('hapDisableIdentifyingMaterialBlocks', idx, keepHapDisableIdentifyingMaterial)
    }

    // Matter-only plugin (#3975): a brand-new child bridge defaults to
    // Matter on / HAP off instead. Enabling Matter first keeps the
    // at-least-one-protocol guard in toggleHapBridge satisfied. Bridges
    // with existing configuration keep their saved state.
    if (get().isMatterOnlyPlugin && !block.accessory && !bridgeCache && !matterCache) {
      await get().toggleMatterBridge(block, true, index)
      await get().toggleHapBridge(block, false, index)
    }
  }

  const disableChildBridge = (block: any, index: string) => {
    const idx = Number(index)
    const plugin = get().plugin
    setFlag('enabledBlocks', idx, false)
    setFlag('hapEnabledBlocks', idx, false)

    // Cache Matter configuration before deleting if Matter is enabled
    if (block._bridge?.matter && get().matterEnabledBlocks[idx]) {
      cacheMatterConfig(ctx, idx, block._bridge.matter)
    }

    if (get().accessoryBridgeLinks.some(link => link.index === index)) {
      // A linked block: dropping the link is all there is to it
      set(state => ({
        accessoryBridgeLinks: state.accessoryBridgeLinks.filter(link => link.index !== index),
        currentlySelectedLink: null,
      }))
    } else {
      // Store unused child bridge id for deletion, so no bridges are orphaned
      const originalBridge = get().originalBridges.find(b => b.username === block._bridge.username)
      if (originalBridge && !get().deleteBridges.some(b => b.id === block._bridge.username)) {
        const info = get().deviceInfo.get(block._bridge.username)
        set(state => ({
          deleteBridges: [...state.deleteBridges, {
            id: block._bridge.username,
            bridgeName: block._bridge.name || originalBridge.displayName,
            paired: info ? info._isPaired : false,
          }],
        }))
      }

      if (block._bridge?.username) {
        // User explicitly disabled Matter before disabling child bridge: track
        // this so we don't restore Matter when re-enabling the child bridge
        const identifier = matterIdentifier(block._bridge.username)
        if (get().deleteMatterBridges.some(b => b.identifier === identifier)) {
          set(state => ({ matterExplicitlyDisabledBeforeChildBridge: new Set(state.matterExplicitlyDisabledBeforeChildBridge).add(idx) }))
        }
      }

      // Also mark Matter for deletion if it was originally enabled AND not already in deletion list
      if (block._bridge?.matter && block._bridge.username) {
        const wasOriginallyEnabled = get().originalMatterBridges.some(m => m.port === block._bridge.matter.port)
        const identifier = matterIdentifier(block._bridge.username)
        if (wasOriginallyEnabled && !get().deleteMatterBridges.some(b => b.identifier === identifier)) {
          markMatterForDeletion(ctx, block._bridge.username, block._bridge.name || plugin.displayName || plugin.name)
        }
      }
    }

    // Also disable the Matter toggle state when disabling the child bridge
    setFlag('matterEnabledBlocks', idx, false)

    delete block._bridge
    get().touch()
  }

  return {
    toggleExternalBridge: async (block, enable, index) => {
      if (!get().plugin) {
        return
      }
      if (enable) {
        await enableChildBridge(block, index)
      } else {
        disableChildBridge(block, index)
      }
      // Figure out if we are deleting at least one paired bridge
      set(state => ({ deletingPairedBridge: state.deleteBridges.some(b => b.paired) }))
    },

    onBlockChange: (index) => {
      set({ selectedBlock: index })
      const links = get().accessoryBridgeLinks
      set({
        currentlySelectedLink: links.find(link => link.index === index) || null,
        currentBridgeHasLinks: links.some(link => link.usesIndex === index),
      })
      set({ bridgesAvailableForLink: bridgesAvailableForLink(get(), index) })
    },

    onLinkBridgeChange: (username) => {
      if (!username) {
        return
      }
      const { configBlocks, selectedBlock, bridgeCache } = get()
      const idx = Number(selectedBlock)

      // Get the index of the first block in the config with this bridge username
      const index = configBlocks.findIndex(block => block._bridge?.username === username)
      const accessoryBridgeLinks = [...get().accessoryBridgeLinks, {
        index: selectedBlock,
        usesIndex: index.toString(),
        name: bridgeCache.get(index)?.name,
        port: bridgeCache.get(index)?.port,
        username,
      }]

      // Update this block with the bridge details
      configBlocks[idx]._bridge = { username }

      set(state => ({
        accessoryBridgeLinks,
        currentlySelectedLink: accessoryBridgeLinks.find(link => link.index === selectedBlock) || null,
        enabledBlocks: withFlag(state.enabledBlocks, idx, true),
        // Linked accessory blocks always ride HAP on the shared bridge (Matter is
        // platform-only), so mark HAP enabled — otherwise the save-time
        // "at least one protocol" guard wrongly rejects the linked block.
        hapEnabledBlocks: withFlag(state.hapEnabledBlocks, idx, true),
      }))
      get().touch()
    },
  }
}
