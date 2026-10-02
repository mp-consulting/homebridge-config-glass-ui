import type { ConfirmFn, TerminalWs } from './types'

import { saveAs } from 'file-saver'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { ws } from '@/core/ws'

import { LogService } from './log.service'
import { TerminalNavigationGuard } from './terminal-navigation-guard'
import { xtermFactory } from './terminal.factory'
import { TerminalService } from './terminal.service'

/**
 * The real wiring of the terminal services. Kept apart from the classes so a
 * spec can build them with fakes, and so the hooks spec can `vi.mock` this file
 * without loading the app graph.
 */

const t = (key: string) => i18n.t(key)

/** Opens the shared confirm modal; dismiss → false (NgbModal rejected `result`). */
export const confirmModal: ConfirmFn = async (data) => {
  const ref = openModal(Confirm, data, { size: 'lg', backdrop: 'static' })
  try {
    await ref.result
    return true
  } catch {
    return false
  }
}

const terminalWs = ws as unknown as TerminalWs

/** The one interactive terminal, shared by the terminal page and the dashboard widget. */
export const terminalService = new TerminalService({
  terminals: xtermFactory,
  ws: terminalWs,
  api,
})

/** A fresh read-only log terminal; each host needs its own (see LogService). */
export function createLogService(): LogService {
  return new LogService({
    terminals: xtermFactory,
    ws: terminalWs,
    api,
    confirm: confirmModal,
    toast,
    t,
    saveAs: (data, filename) => saveAs(data as Blob, filename),
  })
}

/** `env.terminal`, read at the moment of asking. */
export function getTerminalSettings() {
  return useSettingsStore.getState().env?.terminal
}

export const terminalNavigationGuard = new TerminalNavigationGuard({
  terminal: terminalService,
  getTerminalSettings,
  confirm: confirmModal,
  t,
})
