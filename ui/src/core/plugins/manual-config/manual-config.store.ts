import type { ChildBridge, Plugin, PluginEditorContext } from '@/core/plugins/manage-plugins.interfaces'
import type { TFunction } from 'i18next'

import json5 from 'json5'
import { createStore } from 'zustand/vanilla'

import { createChildBridgeSchema } from '@/core/helpers/child-bridges-schema.helper'

/** What the store needs from the outside world. */
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

export interface ManualConfigSchema { uri: string, fileMatch: string[], schema: any }

export interface ManualConfigState {
  pluginAlias: string
  pluginType: 'platform' | 'accessory' | null
  loading: boolean
  canConfigure: boolean
  show: string
  /** The config blocks; the open one is written back in place on save/switch. */
  pluginConfig: Record<string, unknown>[]
  currentBlock: string | undefined
  currentBlockIndex: number | null
  saveInProgress: boolean
  isFirstSave: boolean
  formBlocksValid: { [key: number]: boolean }
  formIsValid: boolean
  strictValidation: boolean
}

export interface ManualConfigActions {
  /** Start loading (the modal opened); returns the teardown. */
  connect: () => () => void
  /** The editor of the open block mounted (`onInit` of ngx-monaco-editor). */
  onEditorInit: (editor: ManualConfigEditor, monaco: ManualConfigMonaco) => Promise<void>
  /** The editor went away (its block closed, or the modal). */
  detachEditor: () => void
  addBlock: () => void
  editBlock: (index: number) => void
  removeBlock: (index: number) => void
  save: () => Promise<void>
  openFullConfigEditor: () => void
  /** The JSON schema for the editor: the plugin's own (or a basic one) plus `_bridge`. */
  buildSchema: () => ManualConfigSchema
  /** Trigger validation update for the current block */
  onValidationChange: () => void
}

export type ManualConfigStore = ManualConfigState & ManualConfigActions

const allValid = (blocks: { [key: number]: boolean }) => Object.values(blocks).every(x => x)

/**
 * The state and logic of the raw JSON config modal (the Angular component
 * class), one store per open modal. `ManualConfig.tsx` renders it.
 */
export function createManualConfigStore(deps: ManualConfigDeps, plugin: Plugin, schema: any, editorContext?: PluginEditorContext) {
  let monacoEditor: ManualConfigEditor | null = null
  let monaco: ManualConfigMonaco | null = null
  // Deferred validation checks still waiting on Monaco, so they can be cancelled
  // if the modal closes before they fire
  const validationTimers = new Set<ReturnType<typeof setTimeout>>()
  let editorDisposers: Array<() => void> = []
  let destroyed = false

  return createStore<ManualConfigStore>()((set, get) => {
    const arrayKey = (): 'accessories' | 'platforms' => get().pluginType === 'accessory' ? 'accessories' : 'platforms'

    /**
     * Re-check the editor's contents once Monaco has caught up.
     *
     * ⚠️ Tracked rather than fired and forgotten: one left running past the
     * modal's unmount would touch state that no longer exists.
     * @param delayMs - how long to wait for Monaco
     */
    const scheduleValidation = (delayMs: number): void => {
      const timer = setTimeout(() => {
        validationTimers.delete(timer)
        get().onValidationChange()
      }, delayMs)
      validationTimers.add(timer)
    }

    /**
     * Check if the current JSON content matches the schema
     * @returns true if valid, false if there are validation errors
     */
    const isJsonValid = (): boolean => {
      if (!monacoEditor || !monaco) {
        // Consider valid if no editor
        return true
      }

      const model = monacoEditor.getModel()
      if (!model) {
        return true
      }

      // Get validation markers (errors, warnings) from Monaco
      const m = monaco
      const markers = m.editor.getModelMarkers({ resource: model.uri })

      // Filter for error-level and warning-level markers (schema violations)
      const validationIssues = markers.filter(marker =>
        marker.severity === m.MarkerSeverity.Error || marker.severity === m.MarkerSeverity.Warning,
      )

      return !validationIssues.length
    }

    const childBridgeSchema = () => {
      const flags = deps.featureFlags
      return createChildBridgeSchema(deps.t, {
        isDebugModeEnabled: flags.childBridgeDebugMode,
        isMatterSupported: flags.matterSupport,
        isPlatformPlugin: get().pluginType === 'platform',
        isProtocolExternalsOnlyEnabled: flags.protocolExternalsOnly,
        isMatterDisableIpv4Enabled: flags.matterDisableIpv4,
        isHapDisableIdentifyingMaterialEnabled: flags.hapDisableIdentifyingMaterial,
      })
    }

    const createBasicSchema = (): any => {
      const t = deps.t
      const bridgeSchema = childBridgeSchema()

      if (get().pluginType === 'platform') {
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
            _bridge: bridgeSchema,
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
            _bridge: bridgeSchema,
          },
        }
      }
    }

    const saveCurrentBlock = (): boolean => {
      const { currentBlockIndex, pluginType, pluginAlias, pluginConfig } = get()
      if (currentBlockIndex !== null && monacoEditor) {
        let currentBlockString: string = monacoEditor.getModel()!.getValue().trim()
        let currentBlockNew: unknown

        // Fix the object if the user has pasted an example that did not include the opening and closing brackets
        if (currentBlockString.charAt(0) === '"' && currentBlockString.charAt(currentBlockString.length - 1) === ']') {
          currentBlockString = `{${currentBlockString}}`
        }

        try {
          currentBlockNew = json5.parse(currentBlockString)
        } catch (error) {
          console.error(error)
          deps.toastError(deps.t('config.config_invalid_json'), deps.t('toast.title_error'))
          return false
        }

        if (Array.isArray(currentBlockNew) || typeof currentBlockNew !== 'object' || currentBlockNew === null) {
          deps.toastError(deps.t('plugins.config.must_be_object'), deps.t('toast.title_error'))
          return false
        }

        // Type-safe: we've confirmed it's a non-null object
        let typedBlock = currentBlockNew as Record<string, unknown>

        // Fix the object if the user pasted an example that included the "accessories" or "platforms" array
        const key = arrayKey()
        if (
          !typedBlock[pluginType!]
          && Array.isArray(typedBlock[key])
          && (typedBlock[key] as unknown[]).length
          && Object.keys(typedBlock).length === 1
        ) {
          typedBlock = (typedBlock[key] as Record<string, unknown>[])[0]
        }

        // Accessory types need a valid name
        if (pluginType === 'accessory' && (!typedBlock.name || typeof typedBlock.name !== 'string')) {
          deps.toastError(deps.t('plugins.config.name_property'), deps.t('toast.title_error'))
          typedBlock.name = ''
          monacoEditor.getModel()!.setValue(JSON.stringify(typedBlock, null, 4))
          return false
        }

        const currentBlock = pluginConfig[currentBlockIndex]
        Object.keys(currentBlock).forEach(x => delete currentBlock[x])
        Object.assign(currentBlock, typedBlock)

        // Ensure the plugin alias is set
        currentBlock[pluginType!] = pluginAlias
      }

      return true
    }

    const loadHomebridgeConfig = async (): Promise<void> => {
      if (!plugin) {
        return
      }
      const config: any[] = editorContext?.config
        ?? await deps.api.get<any[]>(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`)
      if (destroyed) {
        return
      }
      const pluginConfig = config as Record<string, unknown>[]

      // Initialize validation state for all blocks
      const formBlocksValid: { [key: number]: boolean } = {}
      for (let i = 0; i < pluginConfig.length; i += 1) {
        formBlocksValid[i] = true
      }
      set({ pluginConfig, canConfigure: true, loading: false, formBlocksValid, formIsValid: allValid(formBlocksValid) })

      if (pluginConfig.length) {
        get().editBlock(0)
      } else {
        set({ isFirstSave: true })
        get().addBlock()
      }
    }

    const loadPluginAlias = async (): Promise<void> => {
      if (!plugin) {
        return
      }
      try {
        const result = editorContext?.alias
          ? editorContext.alias
          : await deps.api.get<any>(`/plugins/alias/${encodeURIComponent(plugin.name)}`)
        if (destroyed) {
          return
        }
        if (result.pluginAlias && result.pluginType) {
          set({ pluginAlias: result.pluginAlias, pluginType: result.pluginType })
          void loadHomebridgeConfig()
        } else {
          set({ loading: false })
        }
      } catch {
        set({ loading: false })
      }
    }

    return {
      pluginAlias: '',
      pluginType: null,
      loading: true,
      canConfigure: false,
      show: '',
      pluginConfig: [],
      currentBlock: undefined,
      currentBlockIndex: null,
      saveInProgress: false,
      isFirstSave: false,
      formBlocksValid: {},
      formIsValid: true,
      strictValidation: false,

      connect: () => {
        destroyed = false
        // Initialize validation properties
        set({ strictValidation: schema?.strictValidation || false })

        if (deps.isMobile()) {
          set({ loading: false, canConfigure: false })
        } else {
          void loadPluginAlias()
        }

        return () => {
          destroyed = true
          for (const timer of validationTimers) {
            clearTimeout(timer)
          }
          validationTimers.clear()
          get().detachEditor()
        }
      },

      onEditorInit: async (editor, m) => {
        get().detachEditor()
        monacoEditor = editor
        monaco = m

        // Add event listener for content changes to trigger validation
        // Debounce validation to avoid excessive calls
        const contentSub = editor.onDidChangeModelContent(() => scheduleValidation(300))
        if (contentSub) {
          editorDisposers.push(() => contentSub.dispose())
        }

        // Also listen for marker changes to get more accurate validation timing
        const markerSub = m.editor.onDidChangeMarkers((uris: unknown[]) => {
          const modelUri = monacoEditor?.getModel()?.uri
          if (modelUri && uris.some(uri => (uri as { toString: () => string }).toString() === modelUri.toString())) {
            // Markers for our model have changed, update validation state
            get().onValidationChange()
          }
        })
        if (markerSub) {
          editorDisposers.push(() => markerSub.dispose())
        }

        editor.getModel()?.setValue(get().currentBlock ?? '')
        await editor.getAction('editor.action.formatDocument')?.run()
      },

      detachEditor: () => {
        editorDisposers.forEach(dispose => dispose())
        editorDisposers = []
        monacoEditor = null
      },

      addBlock: () => {
        if (!saveCurrentBlock()) {
          deps.toastError(deps.t('plugins.config.please_fix'), deps.t('toast.title_error'))
          return
        }

        const { pluginConfig, pluginType, pluginAlias } = get()
        set({
          pluginConfig: [...pluginConfig, {
            [pluginType!]: pluginAlias,
            name: pluginAlias,
          }],
        })

        get().editBlock(get().pluginConfig.length - 1)
      },

      editBlock: (index) => {
        const { currentBlockIndex, pluginConfig } = get()
        let formBlocksValid = get().formBlocksValid
        // Save current block and capture its final validation state
        if (currentBlockIndex !== null) {
          if (!saveCurrentBlock()) {
            return
          }

          // Capture final validation state for the block we're leaving
          formBlocksValid = { ...formBlocksValid, [currentBlockIndex]: isJsonValid() }
        }

        const sameBlock = currentBlockIndex === index
        const currentBlock = JSON.stringify(pluginConfig[index], null, 4)

        // The editor stays mounted when the open block is edited again, so give it
        // the saved block (Angular pushed it in through ngModel)
        if (sameBlock && monacoEditor) {
          monacoEditor.getModel()?.setValue(currentBlock)
        }

        // Initialize validation state for this block if not already set
        if (!(index in formBlocksValid)) {
          formBlocksValid = { ...formBlocksValid, [index]: true }
        }

        // Update overall validation immediately
        set({
          show: `configBlock.${index}`,
          currentBlockIndex: index,
          currentBlock,
          formBlocksValid,
          formIsValid: allValid(formBlocksValid),
        })

        // Trigger validation check after Monaco is ready
        scheduleValidation(150)
      },

      removeBlock: (index) => {
        const { pluginConfig } = get()
        const block = pluginConfig[index]

        let updated = pluginConfig
        const blockIndex = pluginConfig.findIndex(x => x === block)
        if (blockIndex > -1) {
          updated = [...pluginConfig]
          updated.splice(blockIndex, 1)
        }

        set({ pluginConfig: updated, currentBlockIndex: null, currentBlock: undefined, show: '' })
      },

      save: async () => {
        set({ saveInProgress: true })
        if (!saveCurrentBlock()) {
          set({ saveInProgress: false })
          return
        }

        try {
          if (!plugin) {
            return
          }
          const response = await deps.api.post<{ config: any[], affectedBridges: ChildBridge[] }>(
            `/config-editor/plugin/${encodeURIComponent(plugin.name)}?include=restart-info`,
            get().pluginConfig,
          )
          const newConfig = response.config
          deps.close()

          // Possible child bridge setup recommendation if the plugin is not Homebridge Glass UI
          // If it is the first time configuring the plugin, then offer to set up a child bridge straight away
          if (get().isFirstSave && deps.recommendChildBridges() && newConfig[0]?.platform) {
            void deps.bridgeSettings(plugin, true)
            return
          }

          // This will show the child bridge restart modal if needed, otherwise the full restart homebridge modal.
          // Affected bridges come from the save response so we skip the
          // follow-up /status/homebridge/child-bridges fetch.
          deps.openCorrectRestartModalWithBridges(response.affectedBridges)
        } catch (error) {
          console.error(error)
          deps.toastError(deps.t('config.failed_to_save_config'), deps.t('toast.title_error'))
          set({ saveInProgress: false })
        }
      },

      openFullConfigEditor: () => {
        deps.navigate('/config')
        deps.close()
      },

      buildSchema: () => {
        const { pluginAlias: alias, pluginType } = get()
        // Create a basic schema if plugin doesn't have one
        let schemaToUse = schema?.schema
        if (!schemaToUse) {
          schemaToUse = createBasicSchema()
        }

        const pluginAlias = schema?.pluginAlias || alias
        const schemaUri = `http://plugin/${pluginAlias}/config.json`

        const bridgeSchema = childBridgeSchema()

        // Ensure required properties are present for the plugin type
        const existingRequired = schemaToUse.required || []
        const requiredProperties = [...existingRequired]

        if (pluginType === 'platform') {
          // Platform must have 'platform' property
          if (!requiredProperties.includes('platform')) {
            requiredProperties.push('platform')
          }

          // Also - we must ensure that the platform property is equal to the plugin alias
          if (schemaToUse.properties?.platform) {
            schemaToUse.properties.platform.const = alias
          } else {
            schemaToUse.properties = {
              ...schemaToUse.properties,
              platform: {
                type: 'string',
                title: 'Platform Name',
                description: 'This is used by Homebridge to identify which plugin this platform belongs to.',
                const: alias,
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
            schemaToUse.properties.accessory.const = alias
          } else {
            schemaToUse.properties = {
              ...schemaToUse.properties,
              accessory: {
                type: 'string',
                title: deps.t('child_bridge.config.accessory'),
                description: 'This is used by Homebridge to identify which plugin this accessory belongs to.',
                const: alias,
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
              _bridge: bridgeSchema,
            },
          },
        }
      },

      onValidationChange: () => {
        if (destroyed) {
          return
        }
        const { currentBlockIndex } = get()
        if (currentBlockIndex !== null && monacoEditor) {
          // Update validation state immediately since we're now called when markers are ready
          const formBlocksValid = { ...get().formBlocksValid, [currentBlockIndex]: isJsonValid() }
          set({ formBlocksValid, formIsValid: allValid(formBlocksValid) })
        }
      },
    }
  })
}
