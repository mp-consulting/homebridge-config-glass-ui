import type { ChildBridge, Plugin, PluginEditorContext } from '@/core/plugins/manage-plugins.interfaces'
import type { TFunction } from 'i18next'

import json5 from 'json5'

import { createChildBridgeSchema } from '@/core/helpers/child-bridges-schema.helper'
import { createEmitter } from '@/core/utilities/emitter'

/** What the controller needs from the outside world (injected in Angular). */
export interface ManualConfigDeps {
  api: {
    get: <T = any>(url: string) => Promise<T>
    post: <T = any>(url: string, body: unknown) => Promise<T>
  }
  toastError: (message: string, title: string) => void
  t: TFunction
  close: () => void
  navigate: (path: string) => void
  bridgeSettings: (plugin: Plugin, justInstalled: boolean) => Promise<void>
  openCorrectRestartModalWithBridges: (bridges: ChildBridge[]) => void
  isMobile: () => boolean
  featureFlags: {
    childBridgeDebugMode: boolean
    matterSupport: boolean
    protocolExternalsOnly: boolean
    matterDisableIpv4: boolean
    hapDisableIdentifyingMaterial: boolean
  }
  recommendChildBridges: () => boolean
}

/** The parts of a Monaco editor the modal uses. */
export interface ManualConfigEditor {
  getModel: () => { uri: { toString: () => string }, getValue: () => string, setValue: (value: string) => void } | null
  getAction: (id: string) => { run: () => Promise<void> | void } | null
  onDidChangeModelContent: (listener: () => void) => { dispose: () => void } | void
}

/** The parts of the Monaco namespace the modal uses. */
export interface ManualConfigMonaco {
  MarkerSeverity: { Error: number, Warning: number }
  editor: {
    getModelMarkers: (filter: { resource: unknown }) => Array<{ severity: number }>
    onDidChangeMarkers: (listener: (uris: unknown[]) => void) => { dispose: () => void } | void
  }
}

/**
 * The state and logic of the raw JSON config modal, ported from the Angular
 * component class nearly line for line (the config blocks are still edited in
 * place). `ManualConfig.tsx` renders it and re-renders on `subscribe`.
 */
export class ManualConfigController {
  public pluginAlias = ''
  public pluginType: 'platform' | 'accessory' | null = null
  public loading = true
  public canConfigure = false
  public show = ''
  public pluginConfig: Record<string, unknown>[] = []
  public currentBlock: string | undefined = undefined
  public currentBlockIndex: number | null = null
  public saveInProgress = false
  public isFirstSave = false
  public formBlocksValid: { [key: number]: boolean } = {}
  public formIsValid = true
  public strictValidation = false
  public monacoEditor: ManualConfigEditor | null = null
  public monaco: ManualConfigMonaco | null = null

  // Deferred validation checks still waiting on Monaco, so they can be cancelled
  // if the modal closes before they fire
  private validationTimers = new Set<ReturnType<typeof setTimeout>>()
  private editorDisposers: Array<() => void> = []
  private destroyed = false
  private readonly changes = createEmitter()
  private version = 0

  constructor(
    private readonly deps: ManualConfigDeps,
    public readonly plugin: Plugin,
    public readonly schema: any,
    private readonly editorContext?: PluginEditorContext,
  ) {}

  // ----- store plumbing for useSyncExternalStore
  public subscribe = (listener: () => void): (() => void) => this.changes.subscribe(listener)

  public getVersion = (): number => this.version

  private changed(): void {
    this.version += 1
    this.changes.emit()
  }

  public get arrayKey(): 'accessories' | 'platforms' {
    return this.pluginType === 'accessory' ? 'accessories' : 'platforms'
  }

  // ----- lifecycle
  public init(): void {
    // Initialize validation properties
    this.strictValidation = this.schema?.strictValidation || false

    if (this.deps.isMobile()) {
      this.loading = false
      this.canConfigure = false
      this.changed()
    } else {
      void this.loadPluginAlias()
    }
  }

  public destroy(): void {
    this.destroyed = true
    for (const timer of this.validationTimers) {
      clearTimeout(timer)
    }
    this.validationTimers.clear()
    this.detachEditor()
  }

  /** The editor of the open block mounted (`onInit` of ngx-monaco-editor). */
  public async onEditorInit(editor: ManualConfigEditor, monaco: ManualConfigMonaco): Promise<void> {
    this.detachEditor()
    this.monacoEditor = editor
    this.monaco = monaco

    // Add event listener for content changes to trigger validation
    // Debounce validation to avoid excessive calls
    const contentSub = editor.onDidChangeModelContent(() => this.scheduleValidation(300))
    if (contentSub) {
      this.editorDisposers.push(() => contentSub.dispose())
    }

    // Also listen for marker changes to get more accurate validation timing
    const markerSub = monaco.editor.onDidChangeMarkers((uris: unknown[]) => {
      const modelUri = this.monacoEditor?.getModel()?.uri
      if (modelUri && uris.some(uri => (uri as { toString: () => string }).toString() === modelUri.toString())) {
        // Markers for our model have changed, update validation state
        this.onValidationChange()
      }
    })
    if (markerSub) {
      this.editorDisposers.push(() => markerSub.dispose())
    }

    editor.getModel()?.setValue(this.currentBlock ?? '')
    await editor.getAction('editor.action.formatDocument')?.run()
  }

  /** The editor went away (its block closed, or the modal). */
  public detachEditor(): void {
    this.editorDisposers.forEach(dispose => dispose())
    this.editorDisposers = []
    this.monacoEditor = null
  }

  /**
   * Re-check the editor's contents once Monaco has caught up.
   *
   * ⚠️ Tracked rather than fired and forgotten: one left running past the
   * modal's unmount would touch state that no longer exists.
   * @param delayMs - how long to wait for Monaco
   */
  private scheduleValidation(delayMs: number): void {
    const timer = setTimeout(() => {
      this.validationTimers.delete(timer)
      this.onValidationChange()
    }, delayMs)
    this.validationTimers.add(timer)
  }

  // ----- actions
  public addBlock(): void {
    if (!this.saveCurrentBlock()) {
      this.deps.toastError(this.deps.t('plugins.config.please_fix'), this.deps.t('toast.title_error'))
      return
    }

    this.pluginConfig = [...this.pluginConfig, {
      [this.pluginType!]: this.pluginAlias,
      name: this.pluginAlias,
    }]

    this.editBlock(this.pluginConfig.length - 1)
  }

  public editBlock(index: number): void {
    // Save current block and capture its final validation state
    if (this.currentBlockIndex !== null) {
      if (!this.saveCurrentBlock()) {
        return
      }

      // Capture final validation state for the block we're leaving
      this.formBlocksValid = { ...this.formBlocksValid, [this.currentBlockIndex]: this.isJsonValid() }
    }

    const sameBlock = this.currentBlockIndex === index
    this.show = `configBlock.${index}`
    this.currentBlockIndex = index
    this.currentBlock = JSON.stringify(this.pluginConfig[index], null, 4)

    // The editor stays mounted when the open block is edited again, so give it
    // the saved block (Angular pushed it in through ngModel)
    if (sameBlock && this.monacoEditor) {
      this.monacoEditor.getModel()?.setValue(this.currentBlock)
    }

    // Initialize validation state for this block if not already set
    if (!(index in this.formBlocksValid)) {
      this.formBlocksValid = { ...this.formBlocksValid, [index]: true }
    }

    // Update overall validation immediately
    this.updateOverallValidation()
    this.changed()

    // Trigger validation check after Monaco is ready
    this.scheduleValidation(150)
  }

  public removeBlock(index: number): void {
    const block = this.pluginConfig[index]

    const blockIndex = this.pluginConfig.findIndex(x => x === block)
    if (blockIndex > -1) {
      const updated = [...this.pluginConfig]
      updated.splice(blockIndex, 1)
      this.pluginConfig = updated
    }

    this.currentBlockIndex = null
    this.currentBlock = undefined
    this.show = ''
    this.changed()
  }

  public async save(): Promise<void> {
    this.saveInProgress = true
    this.changed()
    if (!this.saveCurrentBlock()) {
      this.saveInProgress = false
      this.changed()
      return
    }

    try {
      const plugin = this.plugin
      if (!plugin) {
        return
      }
      const response = await this.deps.api.post<{ config: any[], affectedBridges: ChildBridge[] }>(
        `/config-editor/plugin/${encodeURIComponent(plugin.name)}?include=restart-info`,
        this.pluginConfig,
      )
      const newConfig = response.config
      this.deps.close()

      // Possible child bridge setup recommendation if the plugin is not Homebridge Glass UI
      // If it is the first time configuring the plugin, then offer to set up a child bridge straight away
      if (this.isFirstSave && this.deps.recommendChildBridges() && newConfig[0]?.platform) {
        void this.deps.bridgeSettings(plugin, true)
        return
      }

      // This will show the child bridge restart modal if needed, otherwise the full restart homebridge modal.
      // Affected bridges come from the save response so we skip the
      // follow-up /status/homebridge/child-bridges fetch.
      this.deps.openCorrectRestartModalWithBridges(response.affectedBridges)
    } catch (error) {
      console.error(error)
      this.deps.toastError(this.deps.t('config.failed_to_save_config'), this.deps.t('toast.title_error'))
      this.saveInProgress = false
      this.changed()
    }
  }

  public openFullConfigEditor(): void {
    this.deps.navigate('/config')
    this.deps.close()
  }

  // ----- validation
  /** The JSON schema for the editor: the plugin's own (or a basic one) plus `_bridge`. */
  public buildSchema(): { uri: string, fileMatch: string[], schema: any } {
    // Create a basic schema if plugin doesn't have one
    let schemaToUse = this.schema?.schema
    if (!schemaToUse) {
      schemaToUse = this.createBasicSchema()
    }

    const pluginAlias = this.schema?.pluginAlias || this.pluginAlias
    const schemaUri = `http://plugin/${pluginAlias}/config.json`

    const childBridgeSchema = this.childBridgeSchema()

    // Ensure required properties are present for the plugin type
    const existingRequired = schemaToUse.required || []
    const requiredProperties = [...existingRequired]

    if (this.pluginType === 'platform') {
      // Platform must have 'platform' property
      if (!requiredProperties.includes('platform')) {
        requiredProperties.push('platform')
      }

      // Also - we must ensure that the platform property is equal to the plugin alias
      if (schemaToUse.properties?.platform) {
        schemaToUse.properties.platform.const = this.pluginAlias
      } else {
        schemaToUse.properties = {
          ...schemaToUse.properties,
          platform: {
            type: 'string',
            title: 'Platform Name',
            description: 'This is used by Homebridge to identify which plugin this platform belongs to.',
            const: this.pluginAlias,
          },
        }
      }
    } else {
      // Accessory must have both 'accessory' and 'name' properties
      if (!requiredProperties.includes('accessory')) {
        requiredProperties.push('accessory')
      }
      if (!requiredProperties.includes('name')) {
        requiredProperties.push('name')
      }

      // Also - we must ensure that the accessory property is equal to the plugin alias
      if (schemaToUse.properties?.accessory) {
        schemaToUse.properties.accessory.const = this.pluginAlias
      } else {
        schemaToUse.properties = {
          ...schemaToUse.properties,
          accessory: {
            type: 'string',
            title: this.deps.t('child_bridge.config.accessory'),
            description: 'This is used by Homebridge to identify which plugin this accessory belongs to.',
            const: this.pluginAlias,
          },
        }
      }
    }

    return {
      uri: schemaUri,
      fileMatch: ['*'], // Apply to all JSON files in this editor
      schema: {
        ...schemaToUse,
        required: requiredProperties,
        properties: {
          ...schemaToUse.properties,
          _bridge: childBridgeSchema,
        },
      },
    }
  }

  private childBridgeSchema() {
    const flags = this.deps.featureFlags
    return createChildBridgeSchema(this.deps.t, {
      isDebugModeEnabled: flags.childBridgeDebugMode,
      isMatterSupported: flags.matterSupport,
      isPlatformPlugin: this.pluginType === 'platform',
      isProtocolExternalsOnlyEnabled: flags.protocolExternalsOnly,
      isMatterDisableIpv4Enabled: flags.matterDisableIpv4,
      isHapDisableIdentifyingMaterialEnabled: flags.hapDisableIdentifyingMaterial,
    })
  }

  private createBasicSchema(): any {
    const t = this.deps.t
    const childBridgeSchema = this.childBridgeSchema()

    if (this.pluginType === 'platform') {
      // Platform template
      return {
        type: 'object',
        required: ['platform'],
        title: t('plugins.button_settings'),
        properties: {
          platform: {
            type: 'string',
            title: 'Platform Name',
            description: 'This is used by Homebridge to identify which plugin this platform belongs to.',
            not: { enum: ['config'] },
          },
          name: {
            type: 'string',
            title: t('accessories.name'),
            description: 'The name of the platform.',
          },
          _bridge: childBridgeSchema,
        },
      }
    } else {
      // Accessory template
      return {
        type: 'object',
        required: ['accessory', 'name'],
        title: t('plugins.button_settings'),
        properties: {
          accessory: {
            type: 'string',
            title: t('child_bridge.config.accessory'),
            description: 'This is used by Homebridge to identify which plugin this accessory belongs to.',
          },
          name: {
            type: 'string',
            title: t('accessories.name'),
            description: 'The name of the accessory.',
          },
          _bridge: childBridgeSchema,
        },
      }
    }
  }

  /**
   * Check if the current JSON content matches the schema
   * @returns true if valid, false if there are validation errors
   */
  public isJsonValid(): boolean {
    if (!this.monacoEditor || !this.monaco) {
      // Consider valid if no editor
      return true
    }

    const model = this.monacoEditor.getModel()
    if (!model) {
      return true
    }

    // Get validation markers (errors, warnings) from Monaco
    const monaco = this.monaco
    const markers = monaco.editor.getModelMarkers({ resource: model.uri })

    // Filter for error-level and warning-level markers (schema violations)
    const validationIssues = markers.filter(marker =>
      marker.severity === monaco.MarkerSeverity.Error || marker.severity === monaco.MarkerSeverity.Warning,
    )

    return !validationIssues.length
  }

  /** Trigger validation update for the current block */
  public onValidationChange(): void {
    if (this.destroyed) {
      return
    }
    if (this.currentBlockIndex !== null && this.monacoEditor) {
      // Update validation state immediately since we're now called when markers are ready
      this.formBlocksValid = { ...this.formBlocksValid, [this.currentBlockIndex]: this.isJsonValid() }
      this.updateOverallValidation()
      this.changed()
    }
  }

  private updateOverallValidation(): void {
    this.formIsValid = Object.values(this.formBlocksValid).every(x => x)
  }

  // ----- loading
  private async loadPluginAlias(): Promise<void> {
    const plugin = this.plugin
    if (!plugin) {
      return
    }
    try {
      const result = this.editorContext?.alias
        ? this.editorContext.alias
        : await this.deps.api.get<any>(`/plugins/alias/${encodeURIComponent(plugin.name)}`)
      if (this.destroyed) {
        return
      }
      if (result.pluginAlias && result.pluginType) {
        this.pluginAlias = result.pluginAlias
        this.pluginType = result.pluginType
        this.changed()
        void this.loadHomebridgeConfig()
      } else {
        this.loading = false
        this.changed()
      }
    } catch {
      this.loading = false
      this.changed()
    }
  }

  private async loadHomebridgeConfig(): Promise<void> {
    const plugin = this.plugin
    if (!plugin) {
      return
    }
    const config: any[] = this.editorContext?.config
      ?? await this.deps.api.get<any[]>(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`)
    if (this.destroyed) {
      return
    }
    this.pluginConfig = config as Record<string, unknown>[]

    this.canConfigure = true
    this.loading = false

    // Initialize validation state for all blocks
    this.initializeValidationState()

    if (this.pluginConfig.length) {
      this.editBlock(0)
    } else {
      this.isFirstSave = true
      this.addBlock()
    }
    this.changed()
  }

  private saveCurrentBlock(): boolean {
    if (this.currentBlockIndex !== null && this.monacoEditor) {
      let currentBlockString: string = this.monacoEditor.getModel()!.getValue().trim()
      let currentBlockNew: unknown

      // Fix the object if the user has pasted an example that did not include the opening and closing brackets
      if (currentBlockString.charAt(0) === '"' && currentBlockString.charAt(currentBlockString.length - 1) === ']') {
        currentBlockString = `{${currentBlockString}}`
      }

      try {
        currentBlockNew = json5.parse(currentBlockString)
      } catch (error) {
        console.error(error)
        this.deps.toastError(this.deps.t('config.config_invalid_json'), this.deps.t('toast.title_error'))
        return false
      }

      if (Array.isArray(currentBlockNew) || typeof currentBlockNew !== 'object' || currentBlockNew === null) {
        this.deps.toastError(this.deps.t('plugins.config.must_be_object'), this.deps.t('toast.title_error'))
        return false
      }

      // Type-safe: we've confirmed it's a non-null object
      let typedBlock = currentBlockNew as Record<string, unknown>

      // Fix the object if the user pasted an example that included the "accessories" or "platforms" array
      if (
        !typedBlock[this.pluginType!]
        && Array.isArray(typedBlock[this.arrayKey])
        && (typedBlock[this.arrayKey] as unknown[]).length
        && Object.keys(typedBlock).length === 1
      ) {
        typedBlock = (typedBlock[this.arrayKey] as Record<string, unknown>[])[0]
      }

      // Accessory types need a valid name
      if (this.pluginType === 'accessory' && (!typedBlock.name || typeof typedBlock.name !== 'string')) {
        this.deps.toastError(this.deps.t('plugins.config.name_property'), this.deps.t('toast.title_error'))
        typedBlock.name = ''
        this.monacoEditor.getModel()!.setValue(JSON.stringify(typedBlock, null, 4))
        return false
      }

      const currentBlock = this.pluginConfig[this.currentBlockIndex]
      Object.keys(currentBlock).forEach(x => delete currentBlock[x])
      Object.assign(currentBlock, typedBlock)

      // Ensure the plugin alias is set
      currentBlock[this.pluginType!] = this.pluginAlias
    }

    return true
  }

  private initializeValidationState(): void {
    // Always initialise validation state
    const validationState: { [key: number]: boolean } = {}
    for (let i = 0; i < this.pluginConfig.length; i += 1) {
      validationState[i] = true
    }
    this.formBlocksValid = validationState
    this.updateOverallValidation()
  }
}
