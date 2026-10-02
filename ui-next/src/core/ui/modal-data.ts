import type { PluginEditorContext, PluginFundingOption } from '@/core/plugins/manage-plugins.interfaces'

/**
 * The data each modal is opened with. In Angular these were injection tokens;
 * here they are the props a modal component takes (besides `activeModal`).
 */

// ===== Confirm Modal =====
export interface ConfirmModalData {
  title: string
  message: string
  message2?: string
  message3?: string
  confirmButtonLabel?: string
  confirmButtonClass?: string
  faIconClass?: string
}

// ===== Information Modal =====
export interface InformationModalData {
  title: string
  subtitle?: string
  message?: string
  markdownMessage2?: string
  ctaButtonLabel?: string
  ctaButtonLink?: string
  faIconClass?: string
}

// ===== Plugin Management =====
export interface PluginModalData {
  plugin: any // Plugin type
  schema?: any
  pluginConfig?: any[]
  editorContext?: PluginEditorContext
}

export interface PluginBridgeModalData {
  plugin: any
  schema: any
  justInstalled?: boolean
  editorContext?: PluginEditorContext
}

export interface PluginExternalsModalData {
  plugin: any
}

export interface CustomPluginsModalData {
  plugin: any
  schema: any
  pluginConfig?: any[]
  editorContext?: PluginEditorContext
}

export interface PluginLogsModalData {
  plugin: any
  childBridges?: any[]
  editorContext?: PluginEditorContext
}

export interface UninstallPluginModalData {
  plugin: any
  childBridges?: any[]
  action?: string
  keepOrphans?: boolean
  onRefreshPluginList?: () => void
  editorContext?: PluginEditorContext
}

export interface ResetAccessoriesModalData {
  childBridges?: any[]
}

export interface ManagePluginModalData {
  action: string
  pluginName: string
  pluginDisplayName?: string
  plugin?: any
  targetVersion?: string
  latestVersion?: string
  installedVersion?: string
  isValidNode?: boolean
  isValidHb?: boolean
  isDisabled?: boolean
  isConfigured?: boolean
  justInstalled?: boolean
  schema?: any
  childBridges?: any[]
  isUpdating?: boolean
  onRefreshPluginList?: () => void
  verifiedPlugin?: boolean
  verifiedPlusPlugin?: boolean
  funding?: PluginFundingOption[] | PluginFundingOption
  backToVersionModal?: any
}

export interface DisablePluginModalData {
  pluginName: string
  isConfigured?: boolean
  isConfiguredDynamicPlatform?: boolean
  keepOrphans?: boolean
}

export interface PluginCompatibilityModalData {
  plugin: any
  isValidNode?: boolean
  isValidHb?: boolean
  action?: 'install' | 'update' | 'alternate' | null
}

export interface ManageVersionModalData {
  plugin: any
  onRefreshPluginList: () => void
  onSettingsChange?: () => void
}

export interface SwitchToScopedModalData {
  plugin: any
}

// ===== User Management =====
export interface UserModalData {
  user: any // User type
  existingUsers?: any[] // For duplicate validation
}

export interface AddUserModalData {
  existingUsers: any[] // List of existing users for duplicate validation
}

// ===== Settings =====
export interface NetworkInterfacesModalData {
  adaptersAvailable: any[]
  adaptersSelected: any[]
}

export interface AccessoryControlListsModalData {
  existingBlacklist: string[]
}

export interface RestoreModalData {
  setupWizardRestore?: boolean
  selectedBackup?: any
}

// ===== Remove Individual Accessories =====
export interface RemoveIndividualAccessoriesModalData {
  selectedBridge: string
  highlightUuid?: string
  highlightCacheFile?: string
}

// ===== Accessory Info =====
export interface AccessoryInfoModalData {
  service: any
  accessoryCache: any[]
  pairingCache: any[]
}

// ===== Config Editor =====
export interface ConfigRestoreModalData {
  currentConfig: string
  fromSettings?: boolean
}

// ===== Widget Control =====
export interface WidgetControlModalData {
  widget: any
}

// ===== Widget Visibility =====
export interface WidgetVisibilityModalData {
  dashboard: any
  resetLayout: () => void
}

// ===== Child Bridges =====
export interface RestartChildBridgesModalData {
  bridges: any[]
}

// ===== Node Version Modal =====
export interface NodeVersionModalData {
  nodeVersion: string
  latestVersion: string
  showNodeUnsupportedWarning: boolean
  homebridgeRunningInSynologyPackage: boolean
  homebridgeRunningInDocker: boolean
  homebridgePkg: any
  architecture: string
  supportsNodeJs24: boolean
  onUpdate?: () => Promise<void>
  statusIo?: any
}

// ===== Homebridge V2 Modal =====
export interface HbV2ModalData {
  isUpdating: boolean
  skipIfCompatible: boolean
}
