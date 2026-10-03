import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { PluginBridgeModalData } from '@/core/ui/modal-data'

import type { ChildBridgeActions } from './plugin-bridge.child-bridge'
import type { PluginBridgeDeps, PluginBridgeStore, PluginBridgeStoreState, SliceContext } from './plugin-bridge.state'

import { createStore } from 'zustand/vanilla'

import { DEFAULT_PLUGIN_ICON } from '@/core/constants/assets'
import { managePlugins } from '@/core/plugins/manage-plugins'

import { createBridgeListSlice } from './plugin-bridge.bridge-list'
import { createChildBridgeSlice } from './plugin-bridge.child-bridge'
import { createHapSlice } from './plugin-bridge.hap'
import { initialize } from './plugin-bridge.load'
import { createMatterSlice } from './plugin-bridge.matter'
import { save } from './plugin-bridge.save'
import { createScheduleSlice } from './plugin-bridge.schedule'
import { initialState } from './plugin-bridge.state'

/** The modal as a whole: loading, saving, leaving, and the selected block's plain fields. */
export interface EditorActions extends ChildBridgeActions {
  /** ngOnInit. Runs once, however many times React mounts the view. */
  init: () => Promise<void>
  /** Re-render after a config block was written in place. */
  touch: () => void
  /** Write one field of the selected block's bridge, as `[(ngModel)]` did. */
  setBridgeField: (field: string, value: unknown) => void
  setBridgeEnv: (field: 'DEBUG' | 'NODE_OPTIONS', value: string) => void
  toggleAdvanced: () => void
  handleIconError: () => void
  save: () => Promise<void>
  openPluginConfig: () => void
  openFullConfigEditor: () => void
  dismissModal: () => void
  closeModal: () => void
}

/**
 * The state and rules of the child bridge modal (PluginBridgeComponent), one
 * store per mounted editor.
 *
 * The config blocks are edited in place, exactly as the Angular component did:
 * the `_bridge` objects the actions write are the ones posted back on save, and
 * the rules about which shape gets written live in the slices rather than in
 * the views. The saved bridge list is edited on a copy, written back on save.
 */
export function createPluginBridgeStore(data: PluginBridgeModalData, deps: PluginBridgeDeps): PluginBridgeStore {
  let initialized = false

  return createStore<PluginBridgeStoreState>()((set, get) => {
    const ctx: SliceContext = { set, get, deps }
    const selectedBridge = () => get().configBlocks[Number(get().selectedBlock)]?._bridge

    return {
      ...initialState(data),
      ...createChildBridgeSlice(ctx),
      ...createHapSlice(ctx),
      ...createMatterSlice(ctx),
      ...createBridgeListSlice(ctx),
      ...createScheduleSlice(ctx),

      init: () => {
        if (initialized) {
          return Promise.resolve()
        }
        initialized = true
        return initialize(ctx)
      },

      touch: () => set(state => ({ configBlocks: [...state.configBlocks] })),

      setBridgeField: (field, value) => {
        selectedBridge()[field] = value
        get().touch()
      },

      setBridgeEnv: (field, value) => {
        const bridge = selectedBridge()
        bridge.env ??= {}
        bridge.env[field] = value
        get().touch()
      },

      toggleAdvanced: () => set(state => ({ showAdvanced: !state.showAdvanced })),

      handleIconError: () => {
        const plugin = get().plugin
        if (plugin) {
          plugin.icon = DEFAULT_PLUGIN_ICON
          set({ plugin: { ...plugin } })
        }
      },

      save: () => save(ctx),

      openPluginConfig: () => {
        const plugin = get().plugin
        if (!plugin) {
          return
        }
        // Close the existing modal, and open the plugin config modal
        deps.activeModal.close()
        void managePlugins.settings({
          name: plugin.name,
          settingsSchema: true,
          links: {},
        } as unknown as Plugin)
      },

      openFullConfigEditor: () => {
        void deps.navigate('/config')
        deps.activeModal.close()
      },

      dismissModal: () => deps.activeModal.dismiss('Dismiss'),

      closeModal: () => deps.activeModal.close('Dismiss'),
    }
  })
}
