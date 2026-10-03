import type { SliceContext } from './plugin-bridge.state'

import { api } from '@/core/api'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { toastApiError } from '@/core/utilities/http-error'

import { loadBridgeConfigs } from './plugin-bridge.bridge-list'
import { bridgesAvailableForLink } from './plugin-bridge.child-bridge'
import { getDeviceInfo } from './plugin-bridge.hap'
import { getMatterCommissioningInfo } from './plugin-bridge.matter'
import { withEntry, withFlag } from './plugin-bridge.state'

/** ngOnInit: read the plugin type, its config blocks, the saved bridge list and the global startup settings. */
export async function initialize(ctx: SliceContext): Promise<void> {
  const { set, get } = ctx
  try {
    await Promise.all([getPluginType(ctx), loadPluginConfig(ctx), (async () => set(loadBridgeConfigs()))(), loadGlobalStartupSettings(ctx)])
    const plugin = get().plugin
    const env = useSettingsStore.getState().env
    const initialHideSetup = !!plugin && !!env.plugins?.hideChildBridgeSetupFor?.includes(plugin.name)
    set({
      canShowBridgeDebug: settingsActions.isFeatureEnabled('childBridgeDebugMode'),
      hideChildBridgeSetup: initialHideSetup,
      originalHideChildBridgeSetup: initialHideSetup,
    })
  } catch (error) {
    console.error('Failed to initialize:', error)
    toastApiError(error)
  } finally {
    set({ loading: false })
  }
}

async function getPluginType(ctx: SliceContext): Promise<void> {
  const { plugin, editorContext } = ctx.get()
  if (!plugin) {
    return
  }

  try {
    const alias: any = editorContext?.alias
      ? editorContext.alias
      : await api.get(`/plugins/alias/${encodeURIComponent(plugin.name)}`)
    ctx.set({ isPlatform: alias.pluginType === 'platform' })
  } catch (error) {
    console.error(error)
    toastApiError(error)
    ctx.deps.activeModal.close()
  }
}

async function loadGlobalStartupSettings(ctx: SliceContext): Promise<void> {
  try {
    const data = await api.get<{ ENV_DEBUG?: string, ENV_NODE_OPTIONS?: string }>('/platform-tools/hb-service/homebridge-startup-settings')
    ctx.set({ globalDebug: data.ENV_DEBUG || '', globalNodeOptions: data.ENV_NODE_OPTIONS || '' })
  } catch {
    // Non-critical - prefix just won't show
  }
}

/** Read one block's HAP state. Two shapes are tolerated: the legacy boolean and the nested object. */
function readHap(ctx: SliceContext, block: any, i: number): void {
  const { isProtocolExternalsOnlyEnabled, isHapDisableIdentifyingMaterialEnabled } = ctx.get()
  // HAP is enabled by default:
  //   - Legacy boolean: `_bridge.hap === false` means disabled.
  //   - Nested object: `_bridge.hap.enabled === false` means disabled,
  //     and `_bridge.hap.externalsOnly === true` is also surfaced.
  // Accessory child bridges cannot disable HAP (no Matter alternative)
  // and never have externalsOnly meaning. They may still customize
  // identifying material through the nested HAP object.
  const hap = block._bridge.hap
  let hapEnabled = true
  let hapExternalsOnly = false
  if (!block.accessory) {
    if (hap === false) {
      hapEnabled = false
    } else if (typeof hap === 'object' && hap !== null) {
      hapEnabled = hap.enabled !== false
      hapExternalsOnly = hap.externalsOnly === true
    }
  }
  ctx.set(state => ({
    enabledBlocks: withFlag(state.enabledBlocks, i, true),
    hapEnabledBlocks: withFlag(state.hapEnabledBlocks, i, hapEnabled),
    ...(isProtocolExternalsOnlyEnabled ? { hapExternalsOnlyBlocks: withFlag(state.hapExternalsOnlyBlocks, i, hapExternalsOnly) } : {}),
    ...(isHapDisableIdentifyingMaterialEnabled
      ? { hapDisableIdentifyingMaterialBlocks: withFlag(state.hapDisableIdentifyingMaterialBlocks, i, typeof hap === 'object' && hap !== null && hap.disableIdentifyingMaterial === true) }
      : {}),
  }))
}

/** Read one block's bridge: a new bridge (cached, with its pairing), or a link to an earlier block's. */
async function readBridge(ctx: SliceContext, block: any, i: number): Promise<void> {
  const { set, get } = ctx
  // For accessory plugin blocks, the username might be the same as a previous block
  const existingBridgeEntry = [...get().bridgeCache.entries()].find(([, bridge]) => bridge.username === block._bridge.username)
  if (existingBridgeEntry) {
    const [existingBridgeIndex, existingBridge] = existingBridgeEntry
    block._bridge.env = {}
    set(state => ({
      accessoryBridgeLinks: [...state.accessoryBridgeLinks, {
        index: i.toString(),
        usesIndex: existingBridgeIndex.toString(),
        name: existingBridge.name,
        port: existingBridge.port,
        username: block._bridge.username,
      }],
    }))
    return
  }

  block._bridge.env = block._bridge.env || {}
  set(state => ({ bridgeCache: withEntry(state.bridgeCache, i, block._bridge) }))
  await getDeviceInfo(ctx, block._bridge.username)

  // If the bridge does not have a name in the config, then override it from the pairing
  if (!block._bridge.name) {
    const info = get().deviceInfo.get(block._bridge.username)
    if (info) {
      block._bridge.name = info.displayName
    }
  }
  // Deep clone the bridge config to track original state
  set(state => ({ originalBridges: [...state.originalBridges, JSON.parse(JSON.stringify(block._bridge))] }))
}

/** Read one block's Matter state (Matter is enabled if the matter object exists). */
async function readMatter(ctx: SliceContext, block: any, i: number): Promise<void> {
  const { allowMatterDisableInPlace, isProtocolExternalsOnlyEnabled, isMatterDisableIpv4Enabled } = ctx.get()
  // Matter is only supported for platform-based plugins
  if (block.accessory) {
    // Strip Matter config from accessory-based plugins
    delete block._bridge.matter
    return
  }
  const matter = block._bridge.matter
  // A block with `enabled: false` is the in-place disabled state — the
  // toggle shows off, but the port + commissioning storage are kept.
  const matterEnabled = !allowMatterDisableInPlace || matter.enabled !== false
  ctx.set(state => ({
    matterEnabledBlocks: withFlag(state.matterEnabledBlocks, i, matterEnabled),
    // externalsOnly is only meaningful on the new homebridge runtime
    // (>= 2.0.3-beta.26) and only when matter is disabled (validation
    // requires enabled: false alongside externalsOnly: true).
    ...(isProtocolExternalsOnlyEnabled ? { matterExternalsOnlyBlocks: withFlag(state.matterExternalsOnlyBlocks, i, matter.externalsOnly === true) } : {}),
    ...(isMatterDisableIpv4Enabled ? { matterDisableIpv4Blocks: withFlag(state.matterDisableIpv4Blocks, i, matter.disableIpv4 === true) } : {}),
    // Only cache port + disableIpv4 - name is now shared at _bridge level
    matterBridgeCache: withEntry(state.matterBridgeCache, i, { port: matter.port, disableIpv4: matter.disableIpv4 === true }),
    originalMatterBridges: [...state.originalMatterBridges, { port: matter.port }],
  }))
  // Use username as key, just like HAP
  if (block._bridge.username) {
    await getMatterCommissioningInfo(ctx, block._bridge.username)
  }
}

async function loadPluginConfig(ctx: SliceContext): Promise<void> {
  const { set, get } = ctx
  const { plugin, editorContext } = get()
  if (!plugin) {
    return
  }

  try {
    const loadedConfigBlocks: any[] = editorContext?.config
      ?? await api.get<any[]>(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`)
    set({ configBlocks: loadedConfigBlocks })

    for (const [i, block] of loadedConfigBlocks.entries()) {
      if (block._bridge) {
        readHap(ctx, block, i)
      }
      if (block._bridge && block._bridge.username) {
        await readBridge(ctx, block, i)
      }
      if (block._bridge && block._bridge.matter) {
        await readMatter(ctx, block, i)
      }
    }

    // If the plugin has just been installed, and there are no existing bridges, enable all blocks
    if (get().justInstalled && get().bridgeCache.size === 0) {
      loadedConfigBlocks.forEach((block: any, index: number) => {
        set(state => ({ enabledBlocks: withFlag(state.enabledBlocks, index, true) }))
        void get().toggleExternalBridge(block, true, index.toString())
      })
    }

    const state = get()
    const selectedBlock = state.selectedBlock
    // Check if the currently selected bridge has any links
    const currentBridgeLinks = state.accessoryBridgeLinks.find(link => link.username === state.bridgeCache.get(Number(selectedBlock))?.username)
    set({
      ...(currentBridgeLinks ? { currentBridgeHasLinks: true } : {}),
      currentlySelectedLink: state.accessoryBridgeLinks.find(link => link.index === selectedBlock) || null,
      bridgesAvailableForLink: bridgesAvailableForLink(state, selectedBlock),
    })
    get().touch()
  } catch (error) {
    set({ canConfigure: false })
    console.error(error)
  }
}
