import type { ScheduledBackup } from '@/core/backup/backup.interfaces'
import type { ChildBridge, Plugin, PluginEditorContext, PluginFundingOption } from '@/core/plugins/manage-plugins.interfaces'
import type { IoNamespace } from '@/core/ws'
import type { Widget } from '@/modules/status/widgets/widget.types'
import type { User } from '@/modules/users/users.interface'

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
  plugin: Plugin
  schema?: any
  pluginConfig?: any[]
  editorContext?: PluginEditorContext
}

export interface PluginBridgeModalData {
  plugin: Plugin
  schema: any
  justInstalled?: boolean
  editorContext?: PluginEditorContext
}

export interface PluginExternalsModalData {
  plugin: Plugin
}

export interface CustomPluginsModalData {
  plugin: Plugin
  schema: any
  pluginConfig?: any[]
  editorContext?: PluginEditorContext
}

export interface PluginLogsModalData {
  plugin: Plugin
  childBridges?: ChildBridge[]
  editorContext?: PluginEditorContext
}

export interface UninstallPluginModalData {
  plugin: Plugin
  childBridges?: ChildBridge[]
  action?: string
  keepOrphans?: boolean
  onRefreshPluginList?: () => void
  editorContext?: PluginEditorContext
}

export interface ResetAccessoriesModalData {
  childBridges?: ChildBridge[]
}

export interface ManagePluginModalData {
  action: string
  pluginName: string
  pluginDisplayName?: string
  plugin?: Plugin
  targetVersion?: string
  latestVersion?: string
  installedVersion?: string
  isValidNode?: boolean
  isValidHb?: boolean
  isDisabled?: boolean
  isConfigured?: boolean
  justInstalled?: boolean
  schema?: any
  childBridges?: ChildBridge[]
  isUpdating?: boolean
  onRefreshPluginList?: () => void
  verifiedPlugin?: boolean
  verifiedPlusPlugin?: boolean
  funding?: PluginFundingOption[] | PluginFundingOption
  backToVersionModal?: Plugin | null
}

export interface DisablePluginModalData {
  pluginName: string
  isConfigured?: boolean
  isConfiguredDynamicPlatform?: boolean
  keepOrphans?: boolean
}

export interface PluginCompatibilityModalData {
  plugin: Plugin
  isValidNode?: boolean
  isValidHb?: boolean
  action?: 'install' | 'update' | 'alternate' | null
}

export interface ManageVersionModalData {
  plugin: Plugin
  onRefreshPluginList: () => void
  onSettingsChange?: () => void
}

export interface SwitchToScopedModalData {
  /** Only a plugin with a scoped successor is offered the switch. */
  plugin: Plugin & { newHbScope: NonNullable<Plugin['newHbScope']> }
}

// ===== User Management =====
export interface UserModalData {
  user: User
  /** For duplicate validation. */
  existingUsers?: User[]
}

export interface AddUserModalData {
  /** For duplicate validation. */
  existingUsers: User[]
}

// ===== Settings =====
export interface AccessoryControlListsModalData {
  existingBlacklist: string[]
}

export interface RestoreModalData {
  setupWizardRestore?: boolean
  selectedBackup?: ScheduledBackup | null
}

// ===== Remove Individual Accessories =====
export interface RemoveIndividualAccessoriesModalData {
  selectedBridge: string
  highlightUuid?: string
  highlightCacheFile?: string
}

// ===== Config Editor =====
export interface ConfigRestoreModalData {
  currentConfig: string
  fromSettings?: boolean
}

// ===== Widget Control =====
export interface WidgetControlModalData {
  widget: Widget
}

// ===== Widget Visibility =====
export interface WidgetVisibilityModalData {
  dashboard: Array<Partial<Widget>>
  resetLayout: () => void
}

// ===== Child Bridges =====
export interface RestartChildBridgesModalData {
  bridges: { name: string, username: string, matterSerialNumber?: string }[]
}

// ===== Node Version Modal =====
export interface NodeVersionModalData {
  nodeVersion: string
  latestVersion: string
  showNodeUnsupportedWarning: boolean
  homebridgeRunningInSynologyPackage: boolean
  homebridgeRunningInDocker: boolean
  /** The homebridge package, for its own engines range. */
  homebridgePkg: Pick<Plugin, 'engines'>
  architecture: string
  supportsNodeJs24: boolean
  onUpdate?: () => Promise<void>
  statusIo?: Pick<IoNamespace, 'request'> | null
}

// ===== Homebridge V2 Modal =====
export interface HbV2ModalData {
  isUpdating: boolean
  skipIfCompatible: boolean
}
