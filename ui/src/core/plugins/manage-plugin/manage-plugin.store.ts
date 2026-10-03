import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalRef } from '@/core/ui/modal'
import type { OwnedIoNamespace } from '@/core/ws'

import { createStore } from 'zustand/vanilla'

import { api } from '@/core/api'
import { backupService } from '@/core/backup/backup.service'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { HbV2Modal } from '@/core/components/hb-v2-modal/HbV2Modal'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { SELF_PACKAGES } from '@/core/plugins/manage-plugin/support-message'
import { PluginLogs } from '@/core/plugins/plugin-logs/PluginLogs'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { childBridges as childBridgesService } from '@/core/utilities/child-bridges'
import { fileSaver } from '@/core/utilities/file-saver'
import { toastApiError } from '@/core/utilities/http-error'

const RE_STARTS_WITH_DIGIT = /^\d/

const open = openModal as (component: unknown, props: Record<string, any>, options?: Record<string, any>) => ModalRef

/** The terminal size npm is told about. */
export interface TerminalSize {
  cols: number
  rows: number
}

/** What the modal was opened with, defaults filled in. */
export interface ManagePluginInput {
  action: string
  pluginName: string
  pluginDisplayName: string
  targetVersion: string
  latestVersion: string
  installedVersion: string
  isConfigured: boolean
  onRefreshPluginList: () => void
  close: (result?: unknown) => void
  navigate: (path: string) => void
}

export interface ManagePluginState {
  targetVersionPretty: string
  actionComplete: boolean
  actionFailed: boolean
  justUpdatedPlugin: boolean
  childBridges: ChildBridge[]
  versionNotes: string
  versionNotesLoaded: boolean
  versionNotesShow: boolean
  fullChangelog: string
  fullChangelogLoaded: boolean
  releaseNotesShow: boolean
  downloadingBackup: boolean
  releaseNotesTab: number
  // Curated screen-reader announcements for the install/uninstall/update flow.
  // The xterm output is too noisy for SRs (per-line live region with ANSI noise),
  // so we mute it briefly with terminalAriaHidden while we announce the action.
  actionLiveMessage: string
  terminalAriaHidden: boolean
}

export interface ManagePluginActions {
  /** The terminal session is up (mount); `detach` ends it. */
  attach: (io: OwnedIoNamespace, size: () => TerminalSize) => void
  detach: () => void
  /** Keep a line of npm output for the error log download. */
  appendLog: (line: string) => void
  /** Run the action the modal was opened for. */
  start: () => void
  update: () => void
  setReleaseNotesTab: (tab: number) => void
  onRestartHomebridgeClick: () => void
  onRestartChildBridgeClick: () => Promise<void>
  downloadLogFile: () => void
  downloadBackupFile: () => Promise<void>
}

export type ManagePluginStore = ManagePluginState & ManagePluginActions

/**
 * The i18n key of the past-tense verb of an action, as Angular set it in
 * ngOnInit (the present-tense one it also set was never shown).
 * @param action - Install, Uninstall or Update
 * @param targetVersion - the version being installed
 * @param installedVersion - the version installed now
 */
export function pastTenseKey(action: string, targetVersion: string, installedVersion: string): string {
  return action === 'Install'
    ? (targetVersion === installedVersion ? 'plugins.manage.reinstalled' : 'plugins.manage.installed')
    : action === 'Uninstall'
      ? 'plugins.manage.uninstalled'
      : action === 'Update' ? 'plugins.manage.updated' : ''
}

/** Whether npm can run from the ui: never for the ui itself (or Homebridge) on Windows. */
export function isOnlineUpdateOk(pluginName: string, platform: string | undefined): boolean {
  return !(SELF_PACKAGES.includes(pluginName) && platform === 'win32')
}

/**
 * The state and behaviour of the manage plugin modal (ManagePluginComponent):
 * running npm for an install, uninstall or update over the `plugins`
 * namespace, the release notes of an update, and what to offer afterwards.
 * One store per open modal; `useManagePluginTerminal` drives the terminal.
 */
export function createManagePluginStore(input: ManagePluginInput) {
  const { action, pluginName, pluginDisplayName, targetVersion, latestVersion, installedVersion, onRefreshPluginList, close, navigate } = input

  let io: OwnedIoNamespace | null = null
  let size: () => TerminalSize = () => ({ cols: 0, rows: 0 })
  let errorLog = ''
  let restoreTerminalTimer: ReturnType<typeof setTimeout> | null = null
  let detached = false

  const onlineUpdateOk = () => isOnlineUpdateOk(pluginName, useSettingsStore.getState().env.platform)
  const pastTenseVerb = () => {
    const key = pastTenseKey(action, targetVersion, installedVersion)
    return key ? i18n.t(key) : ''
  }
  const toastSuccess = () => i18n.t('toast.title_success')
  const term = () => size()

  return createStore<ManagePluginStore>()((set, get) => {
    function speakAction(messageKey: string, suppressTerminalMs = 2000): void {
      // Clear-then-set so consecutive messages re-trigger the aria-live announcement
      set({ terminalAriaHidden: true, actionLiveMessage: '' })
      setTimeout(() => {
        if (!detached) {
          set({ actionLiveMessage: i18n.t(messageKey, { pluginName: pluginDisplayName || pluginName }) })
        }
      }, 0)

      if (restoreTerminalTimer) {
        clearTimeout(restoreTerminalTimer)
      }
      restoreTerminalTimer = setTimeout(() => {
        set({ terminalAriaHidden: false })
      }, suppressTerminalMs)
    }

    function install(): void {
      if (!onlineUpdateOk()) {
        return
      }

      if (pluginName === 'homebridge') {
        void upgradeHomebridge()
        return
      }

      io!.request('install', {
        name: pluginName,
        version: targetVersion,
        termCols: term().cols,
        termRows: term().rows,
      }).then(async () => {
        speakAction('plugins.a11y.installed_restart', 3000)
        toast.success(i18n.t('plugins.manage.toast_success', { verb: pastTenseVerb(), name: pluginName }), toastSuccess())

        // Invalidate caches BEFORE notifying the plugins page — otherwise its
        // loadInstalledPlugins() reads the pre-install cached list and the
        // new card doesn't appear until the next manual reload.
        pluginsCache.invalidate()
        childBridgesService.invalidate()

        // Trigger refresh of the plugin list in the background
        onRefreshPluginList()

        // Fetch the updated plugin data and close with it
        try {
          const installedPlugins = await pluginsCache.get()
          const installedPlugin = installedPlugins.find(x => x.name === pluginName)
          close({ action: 'just-installed', plugin: installedPlugin })
        } catch (error) {
          console.error('Failed to fetch updated plugin data:', error)
          close({ action: 'just-installed', pluginName })
        }
      }, (error) => {
        speakAction('plugins.a11y.install_failed', 3000)
        set({ actionFailed: true })
        console.error(error)
        navigate('/plugins')
        toastApiError(error)
      })
    }

    function uninstall(): void {
      io!.request('uninstall', {
        name: pluginName,
        termCols: term().cols,
        termRows: term().rows,
      }).then(() => {
        speakAction('plugins.a11y.uninstalled_restart', 3000)
        pluginsCache.invalidate()
        childBridgesService.invalidate()
        // Trigger refresh of the plugin list in the background
        onRefreshPluginList()

        close()
        navigate('/plugins')
        open(RestartHomebridge, {}, { size: 'lg', backdrop: 'static', keyboard: false })
      }, (error) => {
        speakAction('plugins.a11y.uninstall_failed', 3000)
        set({ actionFailed: true })
        console.error(error)
        toastApiError(error)
      })
    }

    async function upgradeHomebridge(): Promise<void> {
      let res = 'update'

      // Only want to show this modal updating from existing version <2 to 2
      // This is just some temporary not-so-great logic to determine if the user is updating from <2 to 2
      if (
        Number(installedVersion.split('.')[0]) < 2
        && ['2', 'alpha', 'beta'].includes(targetVersion.split('.')[0])
      ) {
        const ref = open(HbV2Modal, { isUpdating: true, skipIfCompatible: false }, { size: 'lg', backdrop: 'static' })
        try {
          res = await ref.result
        } catch {
          // Dismissed: treated like any answer other than 'update'
          res = 'dismissed'
        }
      }

      if (res === 'update') {
        // Continue selected, so update homebridge
        speakAction('plugins.a11y.updating_homebridge', 4000)
        io!.request('homebridge-update', {
          version: targetVersion,
          termCols: term().cols,
          termRows: term().rows,
        }).then(async () => {
          close()
          try {
            await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
          } catch (error) {
            console.error(error)
          }
          navigate('/restart')
        }, (error) => {
          set({ actionFailed: true })
          console.error(error)
          toastApiError(error, 'toast.title_error')
          close()
        })
      } else {
        // Modal dismissed, also close the update modal
        close()
      }
    }

    async function getVersionNotes(): Promise<void> {
      set({ releaseNotesShow: true })

      try {
        const reqChangelog = await api.get<any>(`/plugins/release/${encodeURIComponent(pluginName)}`, {
          params: { version: targetVersion },
        })
        set({ fullChangelog: reqChangelog.changelog })

        // Only update targetVersionPretty from changelog if we're targeting 'latest'
        if (reqChangelog.latestVersion && targetVersion === 'latest') {
          set({ targetVersionPretty: reqChangelog.latestVersion })
        }

        if (reqChangelog.notes) {
          set({ versionNotes: reqChangelog.notes, versionNotesShow: true })
        } else {
          const isPrerelease = ['beta', 'alpha', 'test', 'next'].includes(targetVersion) || targetVersion.includes('-')
          set({ versionNotesShow: !isPrerelease })
        }
      } catch (error) {
        console.error('Error loading release notes:', error)
      }

      set({ fullChangelogLoaded: true, versionNotesLoaded: true })
    }

    async function getChildBridges(): Promise<ChildBridge[]> {
      const data = await childBridgesService.getAll()
      const pluginBridges = data.filter(bridge => pluginName === bridge.plugin)
      set({ childBridges: pluginBridges })
      return pluginBridges
    }

    return {
      targetVersionPretty: targetVersion === 'latest'
        ? `v${latestVersion}`
        : (RE_STARTS_WITH_DIGIT.test(targetVersion) ? `v${targetVersion}` : targetVersion),
      actionComplete: false,
      actionFailed: false,
      justUpdatedPlugin: false,
      childBridges: [],
      versionNotes: '',
      versionNotesLoaded: false,
      versionNotesShow: false,
      fullChangelog: '',
      fullChangelogLoaded: false,
      // getVersionNotes() showed the release notes as soon as an update opened
      releaseNotesShow: action === 'Update',
      downloadingBackup: false,
      releaseNotesTab: 1,
      actionLiveMessage: '',
      terminalAriaHidden: false,

      attach: (handle, terminalSize) => {
        detached = false
        io = handle
        size = terminalSize
      },

      detach: () => {
        detached = true
        if (restoreTerminalTimer) {
          clearTimeout(restoreTerminalTimer)
          restoreTerminalTimer = null
        }
      },

      appendLog: (line) => {
        errorLog += `${line}\r\n`
      },

      start: () => {
        switch (action) {
          case 'Install':
            speakAction('plugins.a11y.installing', 4000)
            install()
            break
          case 'Uninstall':
            speakAction('plugins.a11y.uninstalling', 4000)
            uninstall()
            break
          case 'Update':
            void getVersionNotes()
            break
        }
      },

      update: () => {
        // Hide the release notes
        set({ releaseNotesShow: false, versionNotes: '', fullChangelog: '' })

        if (!onlineUpdateOk()) {
          return
        }

        // If this is updating homebridge, use an alternative workflow
        if (pluginName === 'homebridge') {
          void upgradeHomebridge()
          return
        }

        speakAction('plugins.a11y.updating', 4000)

        io!.request('update', {
          name: pluginName,
          version: targetVersion,
          termCols: term().cols,
          termRows: term().rows,
        }).then(async () => {
          // Updating the UI needs a restart straight away
          if (pluginName === '@mp-consulting/homebridge-config-glass-ui') {
            try {
              // Set full service restart flag to ensure hb-service restarts properly
              await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
            } catch (error) {
              console.error('Failed to set restart flag:', error)
            }
            window.location.href = 'restart'
            return
          }

          let bridges: ChildBridge[] = []
          try {
            bridges = await getChildBridges()
          } catch (error) {
            console.error(error)
          }

          // Invalidate caches BEFORE notifying the plugins page so the new
          // version metadata flows through on the same refresh cycle.
          pluginsCache.invalidate()
          childBridgesService.invalidate()

          // Trigger refresh of the plugin list in the background
          onRefreshPluginList()

          // If plugin is not configured and has no child bridges, no restart needed
          if (!input.isConfigured && bridges.length === 0) {
            toast.success(i18n.t('plugins.manage.toast_success', { verb: pastTenseVerb(), name: pluginName }), toastSuccess())
            close()
            navigate('/plugins')
          } else {
            // Plugin is configured or has child bridges, show restart UI
            speakAction('plugins.a11y.updated_restart', 3000)
            set({ actionComplete: true, justUpdatedPlugin: true })
            navigate('/plugins')
          }
        }, (error) => {
          speakAction('plugins.a11y.update_failed', 3000)
          set({ actionFailed: true })
          console.error(error)
          toastApiError(error)
        })
      },

      setReleaseNotesTab: tab => set({ releaseNotesTab: tab }),

      onRestartHomebridgeClick: () => {
        navigate('/restart')
        close()
      },

      onRestartChildBridgeClick: async () => {
        const { childBridges } = get()
        try {
          for (const bridge of childBridges) {
            await api.put(`/server/restart/${bridge.username}`, {})
          }
          open(PluginLogs, {
            plugin: {
              name: pluginName,
              displayName: pluginDisplayName,
            },
            childBridges,
          }, { size: 'xl', backdrop: 'static' })
        } catch (error) {
          console.error(error)
          toast.error(i18n.t('plugins.manage.child_bridge_restart_failed'), i18n.t('toast.title_error'))
        } finally {
          close()
        }
      },

      downloadLogFile: () => {
        const blob = new Blob([errorLog], { type: 'text/plain;charset=utf-8' })
        fileSaver.saveAs(blob, `${pluginName}-error.log`)
      },

      downloadBackupFile: async () => {
        set({ downloadingBackup: true })
        try {
          await backupService.downloadBackup()
        } catch (error) {
          console.error(error)
          toastApiError(error, 'toast.title_error')
        } finally {
          if (!detached) {
            set({ downloadingBackup: false })
          }
        }
      },
    }
  })
}
