import type { BridgeConfig } from '@/core/interfaces/settings.interfaces'
import type { DeviceInfo } from '@/core/plugins/manage-plugins.interfaces'
import type { PluginBridgeAccessoryLink, PluginBridgeDeleteBridge, PluginBridgeMatterBridge } from '@/core/plugins/plugin-bridge/plugin-bridge.interfaces'
import type { ActiveModal } from '@/core/ui/modal'
import type { PluginBridgeModalData } from '@/core/ui/modal-data'
import type { StoreApi } from 'zustand/vanilla'

import type { BridgeListActions } from './plugin-bridge.bridge-list'
import type { HapActions } from './plugin-bridge.hap'
import type { MatterActions } from './plugin-bridge.matter'
import type { ScheduleActions } from './plugin-bridge.schedule'
import type { EditorActions } from './plugin-bridge.store'

import { settingsActions } from '@/core/settings'
import { t } from '@/core/ui/i18n'

/** The part of a checkbox change event the toggles read. */
export interface CheckboxEvent {
  target: EventTarget | { checked: boolean } | null
}

export interface MatterFabric {
  fabricIndex?: number
  vendorId?: number
  rootVendorId?: number
  label?: string
}

export interface PluginBridgeDeps {
  activeModal: Pick<ActiveModal, 'close' | 'dismiss'>
  navigate: (path: string) => unknown
}

/** A per-block flag (keyed by config block index). */
export type BlockFlags = Record<number, boolean>

/** What the running Homebridge supports, read once when the editor opens. */
export interface PluginBridgeFeatures {
  isMatterSupported: boolean
  // A plugin that declares the `supports-matter` keyword without `supports-hap`
  // publishes nothing over HAP (#3975). New child bridges for such plugins
  // default to Matter on / HAP off, so the HAP QR code (which would pair an
  // empty bridge) never appears, and the HAP section is hidden entirely since
  // the options cannot mean anything. It reappears if HAP is somehow enabled on
  // such a bridge, so that state is never unreachable.
  isMatterOnlyPlugin: boolean
  // When false (older Homebridge), at least one of HAP/Matter must stay enabled.
  allowDisableAllProtocols: boolean
  // When true (Homebridge >= 2.0.3-beta.22), disabling Matter on a child bridge
  // is non-destructive (_bridge.matter.enabled=false, storage kept).
  allowMatterDisableInPlace: boolean
  // When true (Homebridge >= 2.0.3-beta.26), HAP config uses the nested object
  // form (`{ enabled?, externalsOnly? }`) and both HAP and Matter expose an
  // externalsOnly toggle that suppresses the bridge accessory/node itself
  // while still allowing plugins to publish external accessories.
  isProtocolExternalsOnlyEnabled: boolean
  // When true (Homebridge >= 2.2.2-beta.0), HAP exposes a toggle that disables
  // username-derived identifying material in bridge and mDNS service names.
  isHapDisableIdentifyingMaterialEnabled: boolean
  // When true (Homebridge >= 2.2.0), Matter exposes a disableIpv4 toggle that
  // makes the Matter mDNS responder IPv6-only.
  isMatterDisableIpv4Enabled: boolean
  // Homebridge >= 2.2.2-beta.8 includes the commissioned fabric list in child
  // bridge metadata; older runtimes omit the fields entirely.
  isMatterFabricInfoEnabled: boolean
}

export interface PluginBridgeState extends PluginBridgeFeatures {
  plugin: any
  schema: any
  justInstalled: boolean
  editorContext: PluginBridgeModalData['editorContext']

  loading: boolean
  canConfigure: boolean
  saveInProgress: boolean
  /**
   * The plugin's config blocks: the working copy edited in place and posted on
   * save. After writing to a block, call `touch()` so the views re-render.
   */
  configBlocks: any[]
  selectedBlock: string
  isPlatform: boolean
  showAdvanced: boolean
  globalDebug: string
  globalNodeOptions: string
  canShowBridgeDebug: boolean

  enabledBlocks: BlockFlags
  hapEnabledBlocks: BlockFlags
  matterEnabledBlocks: BlockFlags
  // Only meaningful when isProtocolExternalsOnlyEnabled and HAP is disabled for the block.
  hapExternalsOnlyBlocks: BlockFlags
  hapDisableIdentifyingMaterialBlocks: BlockFlags
  // Only meaningful when isProtocolExternalsOnlyEnabled and Matter is disabled for the block.
  matterExternalsOnlyBlocks: BlockFlags
  // Only meaningful when isMatterDisableIpv4Enabled and Matter is enabled.
  matterDisableIpv4Blocks: BlockFlags

  bridgeCache: Map<number, Record<string, any>>
  originalBridges: any[]
  deviceInfo: Map<string, DeviceInfo | false>
  matterBridgeCache: Map<number, Record<string, any>>
  originalMatterBridges: any[]
  matterDeviceInfo: Map<string, any>
  /** Blocks whose Matter was switched off before their child bridge was. */
  matterExplicitlyDisabledBeforeChildBridge: Set<number>
  deleteMatterBridges: PluginBridgeMatterBridge[]
  deleteBridges: PluginBridgeDeleteBridge[]
  deletingPairedBridge: boolean

  accessoryBridgeLinks: PluginBridgeAccessoryLink[]
  bridgesAvailableForLink: PluginBridgeAccessoryLink[]
  currentlySelectedLink: PluginBridgeAccessoryLink | null
  currentBridgeHasLinks: boolean

  /** A copy of the saved bridge list (`env.bridges`), keyed by upper-case username; edits stay local until saved. */
  bridgeConfigs: Map<string, BridgeConfig>
  originalScheduledRestartCrons: Map<string, string | null>
  originalHideAlerts: Map<string, { hideHapAlert?: boolean, hideMatterAlert?: boolean }>
  hideChildBridgeSetup: boolean
  originalHideChildBridgeSetup: boolean
}

export type PluginBridgeStoreState = PluginBridgeState & EditorActions & HapActions & MatterActions & BridgeListActions & ScheduleActions
export type PluginBridgeStore = StoreApi<PluginBridgeStoreState>

/** What every slice of the store is built from. */
export interface SliceContext {
  set: StoreApi<PluginBridgeStoreState>['setState']
  get: StoreApi<PluginBridgeStoreState>['getState']
  deps: PluginBridgeDeps
}

export { t }

export const defaultIcon = 'assets/hb-icon.png'

/** What Angular's number value accessor wrote for an `<input type="number">`: null when empty. */
export function numberValue(value: string): number | null {
  return value === '' ? null : Number.parseFloat(value)
}

/** One block's flag set to `value`, as a new record. */
export function withFlag(flags: BlockFlags, idx: number, value: boolean): BlockFlags {
  return { ...flags, [idx]: value }
}

/** A new map with `key` set to `value`. */
export function withEntry<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value)
}

// The checkboxes are controlled from this state. On a rejected toggle the
// handler writes back the value the state already had; force the DOM into
// the desired state too, so the toggle never shows what was refused.
export function syncCheckboxDom(event: CheckboxEvent | undefined, checked: boolean): void {
  const target = event?.target as HTMLInputElement | null | undefined
  if (target) {
    target.checked = checked
  }
}

export function readFeatures(plugin: any): PluginBridgeFeatures {
  const isFeatureEnabled = (key: string) => settingsActions.isFeatureEnabled(key)
  const isMatterSupported = isFeatureEnabled('matterSupport')
  return {
    isMatterSupported,
    isMatterOnlyPlugin: isMatterSupported && plugin?.supportsMatter === true && plugin?.supportsHap !== true,
    allowDisableAllProtocols: isFeatureEnabled('disableAllProtocols'),
    allowMatterDisableInPlace: isFeatureEnabled('matterDisableInPlace'),
    isProtocolExternalsOnlyEnabled: isFeatureEnabled('protocolExternalsOnly'),
    isHapDisableIdentifyingMaterialEnabled: isFeatureEnabled('hapDisableIdentifyingMaterial'),
    isMatterDisableIpv4Enabled: isFeatureEnabled('matterDisableIpv4'),
    isMatterFabricInfoEnabled: isFeatureEnabled('matterFabricInfo'),
  }
}

export function initialState(data: PluginBridgeModalData): PluginBridgeState {
  return {
    ...readFeatures(data.plugin),
    plugin: data.plugin,
    schema: data.schema,
    justInstalled: data.justInstalled ?? false,
    editorContext: data.editorContext,
    loading: true,
    canConfigure: true,
    saveInProgress: false,
    configBlocks: [],
    selectedBlock: '0',
    isPlatform: false,
    showAdvanced: false,
    globalDebug: '',
    globalNodeOptions: '',
    canShowBridgeDebug: false,
    enabledBlocks: {},
    hapEnabledBlocks: {},
    matterEnabledBlocks: {},
    hapExternalsOnlyBlocks: {},
    hapDisableIdentifyingMaterialBlocks: {},
    matterExternalsOnlyBlocks: {},
    matterDisableIpv4Blocks: {},
    bridgeCache: new Map(),
    originalBridges: [],
    deviceInfo: new Map(),
    matterBridgeCache: new Map(),
    originalMatterBridges: [],
    matterDeviceInfo: new Map(),
    matterExplicitlyDisabledBeforeChildBridge: new Set(),
    deleteMatterBridges: [],
    deleteBridges: [],
    deletingPairedBridge: false,
    accessoryBridgeLinks: [],
    bridgesAvailableForLink: [],
    currentlySelectedLink: null,
    currentBridgeHasLinks: false,
    bridgeConfigs: new Map(),
    originalScheduledRestartCrons: new Map(),
    originalHideAlerts: new Map(),
    hideChildBridgeSetup: false,
    originalHideChildBridgeSetup: false,
  }
}

/** An icon-only link markup for a translation's `{{ link }}` slot, with an accessible name. */
export function externalIconLink(href: string, label: string): string {
  const name = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><i class="fas fa-up-right-from-square primary-text" aria-hidden="true"></i></a>`
}

/** Icon-only links out, named for screen readers by `label`. */
export const linkChildBridges = (label: string) => externalIconLink('https://github.com/homebridge/homebridge/wiki/Child-Bridges', label)
export const linkDebug = (label: string) => externalIconLink('https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Debug-Common-Values', label)
export const linkCron = (label: string) => externalIconLink('https://crontab.guru/', label)
