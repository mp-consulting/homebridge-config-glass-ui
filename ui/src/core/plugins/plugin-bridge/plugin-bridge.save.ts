import type { PluginBridgeState, SliceContext } from './plugin-bridge.state'

import { api } from '@/core/api'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { RE_COLON } from '@/core/regex.constants'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'

import { hasHideAlertsChanged, hasHideChildBridgeSetupChanged, saveHideAlerts, saveHideChildBridgeSetup } from './plugin-bridge.bridge-list'
import { getHapNameValidationError, getHapPortValidationError, normalizeHapConfig } from './plugin-bridge.hap'
import { getMatterPortValidationError, normalizeMatterConfig } from './plugin-bridge.matter'
import { hasScheduledRestartCronChanged, saveScheduledRestartCrons } from './plugin-bridge.schedule'
import { t } from './plugin-bridge.state'

const isHapDisabled = (h: any) => h === false || (typeof h === 'object' && h !== null && h.enabled === false)
const hapExternalsOnly = (h: any) => typeof h === 'object' && h !== null && h.externalsOnly === true
const hapDisableIdentifyingMaterial = (h: any) => typeof h === 'object' && h !== null && h.disableIdentifyingMaterial === true

/** Has a bridge changed in a way that needs a restart? */
function bridgeDiffers(bridge: any, original: any): boolean {
  const restartFields = ['name', 'port', 'model', 'manufacturer', 'firmwareRevision', 'debugModeEnabled']
  if (restartFields.some(field => bridge[field] !== original[field])) {
    return true
  }

  // Check env variables
  const currentEnv = bridge.env || {}
  const originalEnv = original.env || {}
  if (currentEnv.DEBUG !== originalEnv.DEBUG || currentEnv.NODE_OPTIONS !== originalEnv.NODE_OPTIONS) {
    return true
  }

  // Check HAP disabled state. Both shapes are tolerated: legacy boolean
  // (`hap === false`) and nested object (`hap.enabled === false`). Nested HAP
  // options are also part of the persisted state.
  if (isHapDisabled(bridge.hap) !== isHapDisabled(original.hap)
    || hapExternalsOnly(bridge.hap) !== hapExternalsOnly(original.hap)
    || hapDisableIdentifyingMaterial(bridge.hap) !== hapDisableIdentifyingMaterial(original.hap)) {
    return true
  }

  // Check Matter configuration
  const hasMatter = !!bridge.matter
  const hadMatter = !!original.matter
  if (hasMatter !== hadMatter) {
    return true
  }
  return hasMatter && hadMatter
    && (bridge.matter.port !== original.matter.port || bridge.matter.externalsOnly !== original.matter.externalsOnly)
}

/** Check if bridge configuration (not including hide alerts or cron) has changed */
export function hasBridgeConfigChanged(state: PluginBridgeState): boolean {
  // Compare against the count of UNIQUE bridge usernames currently in the
  // config blocks. `originalBridges` only stores one entry per unique bridge
  // (linked accessory blocks share a single bridge), so comparing the raw
  // `configBlocks.length` to it falsely reports "changed" both for plugins
  // without any child bridge AND for plugins with linked accessory blocks.
  const currentBridgeUsernames = new Set(
    state.configBlocks
      .filter(b => b._bridge && b._bridge.username)
      .map(b => b._bridge.username),
  )
  if (currentBridgeUsernames.size !== state.originalBridges.length) {
    return true
  }

  for (const block of state.configBlocks) {
    if (!block._bridge) {
      continue
    }
    const original = state.originalBridges.find(b => b.username === block._bridge.username)
    // A new bridge, or a changed one
    if (!original || bridgeDiffers(block._bridge, original)) {
      return true
    }
  }
  return false
}

/**
 * Check every block can be saved (toasting the first problem), and write each
 * into the shape the running Homebridge reads. False when the save must stop.
 */
function validateAndNormalize(state: PluginBridgeState): boolean {
  const { configBlocks, matterEnabledBlocks, hapEnabledBlocks, enabledBlocks } = state
  for (const [index, block] of configBlocks.entries()) {
    // At least one protocol must be on for any enabled child bridge — unless
    // the running Homebridge supports disabling all protocols. Accessory
    // blocks always use HAP (no Matter alternative), so treat HAP as on for
    // them even if the flag was never set explicitly — e.g. when an
    // accessory block is linked to a shared child bridge.
    const hapOn = block.accessory ? true : !!hapEnabledBlocks[index]
    if (!state.allowDisableAllProtocols && enabledBlocks[index] && !hapOn && !matterEnabledBlocks[index]) {
      toast.error(t('child_bridge.config.at_least_one_protocol'), t('toast.title_error'))
      return false
    }

    // HAP validation (only when HAP is enabled for this block)
    if (block._bridge?.username && hapEnabledBlocks[index] !== false) {
      if (getHapNameValidationError(state, index.toString())) {
        toast.error(t('plugins.bridge.name_error'), t('toast.title_error'))
        return false
      }
      if (getHapPortValidationError(state, index.toString())) {
        toast.error(t('plugins.bridge.port_error', { type: 'HAP' }), t('toast.title_error'))
        return false
      }
    }

    // Matter validation (for both Matter-only and HAP+Matter)
    if (matterEnabledBlocks[index] && getMatterPortValidationError(state, index.toString())) {
      toast.error(t('plugins.bridge.port_error', { type: 'Matter' }), t('toast.title_error'))
      return false
    }

    normalizeMatterConfig(block)

    // Normalize HAP into the shape supported by the running Homebridge.
    // externalsOnly carries through only when HAP is disabled; the
    // identifying-material preference is independent of enablement.
    const externalsOnly = state.isProtocolExternalsOnlyEnabled
      && hapEnabledBlocks[index] === false
      && state.hapExternalsOnlyBlocks[index] === true
    const disableIdentifyingMaterial = state.isHapDisableIdentifyingMaterialEnabled
      && state.hapDisableIdentifyingMaterialBlocks[index] === true
    normalizeHapConfig(state, block, hapEnabledBlocks[index], externalsOnly, disableIdentifyingMaterial)
  }
  return true
}

/** Delete the pairings of the bridges no block uses any more, so no bridges are orphaned. */
async function deleteUnusedBridges(state: PluginBridgeState): Promise<void> {
  for (const bridge of state.deleteBridges) {
    try {
      await api.delete(`/server/pairings/${bridge.id.replace(RE_COLON, '')}`)
    } catch (error) {
      console.error(error)
      toast.error(t('settings.reset_bridge.error'), t('toast.title_error'))
    }
  }

  // Delete unused Matter bridges (storage cleanup)
  // Skip bridges that were already deleted via the HAP pairing endpoint above (it deletes Matter info too)
  const matterBridgesToDelete = state.deleteMatterBridges.filter(
    mb => !state.deleteBridges.some(b => b.id === mb.username),
  )
  for (const matterBridge of matterBridgesToDelete) {
    try {
      await api.delete(`/server/pairings/${matterBridge.username.replace(RE_COLON, '')}/matter`)
    } catch (error) {
      console.error(error)
      toast.error(t('settings.reset_bridge.error'), t('toast.title_error'))
    }
  }
}

export async function save(ctx: SliceContext): Promise<void> {
  const { set, get, deps } = ctx
  const plugin = get().plugin
  if (!plugin) {
    return
  }

  set({ saveInProgress: true })

  try {
    if (!validateAndNormalize(get())) {
      set({ saveInProgress: false })
      return
    }
    get().touch()

    await api.post(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`, get().configBlocks)
    await deleteUnusedBridges(get())

    // Check what has changed
    const state = get()
    const cronHasChanged = hasScheduledRestartCronChanged(state)
    const hideAlertsChanged = hasHideAlertsChanged(state)
    const hideChildBridgeSetupChanged = hasHideChildBridgeSetupChanged(state)
    const bridgeConfigChanged = hasBridgeConfigChanged(state)
    const bridgesDeleted = state.deleteBridges.length > 0 || state.deleteMatterBridges.length > 0
    const nothingChangedHere = !cronHasChanged && !hideAlertsChanged && !hideChildBridgeSetupChanged && !bridgeConfigChanged && !bridgesDeleted

    /*
     * ⚠️ `justInstalled` means we were opened straight from a first-time plugin
     * config save, which deliberately skipped its own restart prompt and left
     * it to us (see the `isFirstSave()` branches in plugin-config,
     * custom-plugins and manual-config).
     *
     * So there is ALWAYS a saved config change to restart for in that case,
     * even when nothing on this screen was touched. Declining the child bridge
     * used to leave every flag above false, so the modal closed silently and
     * the restart was never offered - which also made it look as though the
     * config had not saved at all (#2946).
     */
    const nothingChanged = nothingChangedHere && !state.justInstalled
    const onlyHideAlertsChanged = !state.justInstalled
      && (hideAlertsChanged || hideChildBridgeSetupChanged) && !cronHasChanged && !bridgeConfigChanged && !bridgesDeleted

    // Save the per-plugin "hide set-up recommendation" toggle if it changed
    if (hideChildBridgeSetupChanged) {
      try {
        await saveHideChildBridgeSetup(ctx)
      } catch (error) {
        console.error(error)
      }
    }

    await saveHideAlerts(get())
    await saveScheduledRestartCrons(get(), cronHasChanged)

    if (nothingChanged) {
      // Close modal without restart if nothing changed
      deps.activeModal.close()
    } else if (onlyHideAlertsChanged) {
      // Close modal with 'refresh' result if only hide alerts changed
      deps.activeModal.close('refresh')
    } else {
      // Show restart modal for any other changes
      deps.activeModal.close()
      openModal(RestartHomebridge, {}, {
        size: 'lg',
        backdrop: 'static',
        keyboard: false,
      })
    }
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : t('config.failed_to_save_config')
    toast.error(message, t('toast.title_error'))
  } finally {
    set({ saveInProgress: false })
  }
}
