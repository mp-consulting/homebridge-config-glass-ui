import type { PageContext } from '@/modules/settings/settings-page/types'

import { api } from '@/core/api'
import { settingsActions } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { AccessoryControlLists } from '@/modules/settings/accessory-control-lists/AccessoryControlLists'
import { Backup } from '@/modules/settings/backup/Backup'
import { PortOverviewModal } from '@/modules/settings/port-overview-modal/PortOverviewModal'
import { RemoveAllAccessories } from '@/modules/settings/remove-all-accessories/RemoveAllAccessories'
import { RemoveBridgeAccessories } from '@/modules/settings/remove-bridge-accessories/RemoveBridgeAccessories'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'
import { ResetAllBridges } from '@/modules/settings/reset-all-bridges/ResetAllBridges'
import { ResetIndividualBridges } from '@/modules/settings/reset-individual-bridges/ResetIndividualBridges'
import { SelectNetworkInterfaces } from '@/modules/settings/select-network-interfaces/SelectNetworkInterfaces'
import { MODAL_OPTIONS } from '@/modules/settings/settings-page/shared'
import { SslSettingsModal } from '@/modules/settings/ssl-settings-modal/SslSettingsModal'
import { Wallpaper } from '@/modules/settings/wallpaper/Wallpaper'

/** The modals the page opens (backup, wallpaper, SSL, resets, network interfaces). */
export function createModalsSlice(ctx: PageContext) {
  const { store, get, patch, reportError, deps, settingsEnv } = ctx

  const slice = {
    openBackupModal(): void {
      openModal(Backup, {}, MODAL_OPTIONS)
    },

    openConfigBackup(): void {
      // Go to /config?action=restore
      deps.navigate('/config?action=restore')
    },

    openWallpaperModal(): void {
      openModal(Wallpaper, {}, MODAL_OPTIONS)
    },

    async openSslModal(): Promise<void> {
      const modalRef = openModal(SslSettingsModal, {}, MODAL_OPTIONS)

      try {
        // Modal returns the selected mode when saved successfully
        const newSslType = await modalRef.result
        patch('uiSslType', newSslType)
        // Show the global restart toast since SSL changes require a restart
        settingsActions.showRestartToast()
      } catch {
        // Modal was dismissed without saving, do nothing
      }
    },

    resetHomebridgeState(): void {
      openModal(ResetAllBridges, {}, MODAL_OPTIONS)
    },

    unpairAccessory(): void {
      openModal(ResetIndividualBridges, {}, MODAL_OPTIONS)
    },

    removeAllCachedAccessories(): void {
      openModal(RemoveAllAccessories, {}, MODAL_OPTIONS)
    },

    async accessoryUiControl(): Promise<void> {
      try {
        const ref = openModal(AccessoryControlLists, {
          existingBlacklist: settingsEnv().accessoryControl?.instanceBlacklist || [],
        }, MODAL_OPTIONS)

        await ref.result
        settingsActions.showRestartToast()
      } catch (error) {
        if (error !== 'Dismiss') {
          reportError(error)
        }
      }
    },

    removeSingleCachedAccessories(): void {
      openModal(RemoveIndividualAccessories, { selectedBridge: '' }, MODAL_OPTIONS)
    },

    removeBridgeAccessories(): void {
      openModal(RemoveBridgeAccessories, {}, MODAL_OPTIONS)
    },

    async selectNetworkInterfaces(): Promise<void> {
      const ref = openModal(SelectNetworkInterfaces, {
        adaptersAvailable: get().adaptersAvailable,
        adaptersSelected: get().adaptersSelected,
      }, MODAL_OPTIONS)

      try {
        const adapters: string[] = await ref.result
        slice.buildBridgeNetworkAdapterList(adapters)
        await api.put('/server/network-interfaces/bridge', { adapters })
        settingsActions.showRestartToast()
      } catch (error) {
        if (error !== 'Dismiss') {
          reportError(error)
        }
      }
    },

    openPortOverview(): void {
      openModal(PortOverviewModal, {}, MODAL_OPTIONS)
    },

    buildBridgeNetworkAdapterList(adapters: string[]): void {
      if (!adapters.length) {
        store.setState({ adaptersSelected: [] })
        return
      }

      store.setState({
        adaptersSelected: adapters.map((interfaceName) => {
          const i = get().adaptersAvailable.find(x => x.iface === interfaceName)
          if (i) {
            return {
              iface: i.iface,
              selected: true,
              missing: false,
              ip4: i.ip4,
              ip6: i.ip6,
            }
          }
          return {
            iface: interfaceName,
            selected: true,
            missing: true,
          }
        }),
      })
    },
  }

  return slice
}

export type ModalsSlice = ReturnType<typeof createModalsSlice>
