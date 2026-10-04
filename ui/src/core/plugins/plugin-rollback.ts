import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'

import { create } from 'zustand'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { escapeHtml } from '@/core/helpers/html.helper'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { t } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'

/** `GET /plugins/rollback`: a plugin that can go back to the version it had before its last update. */
export interface PluginRollbackEntry {
  name: string
  fromVersion: string
  toVersion: string
  updatedAt: string
  expiresAt: string
  /** Its bridge crash looped soon after the update. */
  suspect: { reason: 'childBridgeCrashLoop' | 'homebridgeCrashLoop', at: string, bridge?: string } | null
}

interface PluginRollbackState {
  entries: Record<string, PluginRollbackEntry>
}

export const usePluginRollbackStore = create<PluginRollbackState>()(() => ({ entries: {} }))

/** The rollback offered for one plugin, if any. */
export function usePluginRollback(name: string): PluginRollbackEntry | undefined {
  return usePluginRollbackStore(state => state.entries[name])
}

export const pluginRollback = {
  /** Load what can be rolled back (administrators; an older server has none). */
  async load(): Promise<void> {
    try {
      const list = await api.get<PluginRollbackEntry[]>('/plugins/rollback')
      usePluginRollbackStore.setState({ entries: Object.fromEntries((Array.isArray(list) ? list : []).map(entry => [entry.name, entry])) })
    } catch {
      usePluginRollbackStore.setState({ entries: {} })
    }
  },

  /**
   * Ask, then install the previous version through the usual plugin dialog
   * (the server clears the record once it is installed).
   */
  async rollBack(plugin: Plugin, entry: PluginRollbackEntry): Promise<void> {
    const ref = openModal(Confirm, {
      title: plugin.displayName || plugin.name,
      message: t('plugins.rollback.confirm', {
        pluginName: escapeHtml(plugin.displayName || plugin.name),
        fromVersion: escapeHtml(entry.fromVersion),
        toVersion: escapeHtml(entry.toVersion),
      }),
      confirmButtonLabel: t('plugins.rollback.button', { version: entry.fromVersion }),
      faIconClass: 'fa-clock-rotate-left primary-text',
    }, { size: 'lg', backdrop: 'static' })
    try {
      await ref.result
    } catch {
      return
    }
    await managePlugins.updatePlugin(plugin, entry.fromVersion)
    await pluginRollback.load()
  },
}
