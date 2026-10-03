import type { PageContext } from '@/modules/settings/settings-page/types'

import { Confirm } from '@/core/components/confirm/Confirm'
import { settingsActions } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { MODAL_OPTIONS, t } from '@/modules/settings/settings-page/shared'

/** Terminal and log: the terminal options and the log size limits. */
export function createTerminalSlice(ctx: PageContext) {
  const { patch, setSaving, setInvalid, reportError, queueUiSettingChange, finishSaving, terminal } = ctx

  const slice = {
    async uiTerminalPersistenceSave(value: boolean): Promise<void> {
      // If turning off persistence and there's an active session, show confirmation
      if (!value && terminal.hasActiveSession()) {
        const ref = openModal(Confirm, {
          title: t('settings.terminal.persistence_confirm_title'),
          message: t('settings.terminal.persistence_confirm_message'),
          message2: t('common.phrases.are_you_sure'),
          confirmButtonLabel: t('form.button_continue'),
          confirmButtonClass: 'btn-primary',
          faIconClass: 'fas fa-exclamation-triangle text-warning',
        }, MODAL_OPTIONS)

        try {
          // An error will throw if the user cancels the modal
          await ref.result
        } catch {
          // User canceled, revert the value
          patch('uiTerminalPersistence', true)
          return
        }
      }

      try {
        setSaving('uiTerminalPersistence', true)

        // If persistence is being turned off, clean up any existing session completely
        if (!value) {
          void terminal.destroyPersistentSession()
        }

        settingsActions.setEnvItem('terminal.persistence', value)
        await queueUiSettingChange('terminal.persistence', value)
        finishSaving('uiTerminalPersistence')
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalPersistence', false)
      }
    },

    async uiTerminalHideWarningSave(value: boolean): Promise<void> {
      try {
        setSaving('uiTerminalHideWarning', true)
        settingsActions.setEnvItem('terminal.hideWarning', value)
        await queueUiSettingChange('terminal.hideWarning', value)
        finishSaving('uiTerminalHideWarning')
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalHideWarning', false)
      }
    },

    async uiTerminalBufferSizeSave(value: number): Promise<void> {
      if (value && (typeof value !== 'number' || value < 0 || Number.isInteger(value) === false)) {
        setInvalid('uiTerminalBufferSize', true)
        return
      }

      try {
        setSaving('uiTerminalBufferSize', true)
        settingsActions.setEnvItem('terminal.bufferSize', value)
        await queueUiSettingChange('terminal.bufferSize', value)
        setInvalid('uiTerminalBufferSize', false)
        finishSaving('uiTerminalBufferSize')
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalBufferSize', false)
      }
    },

    async uiTerminalFontSizeSave(value: number): Promise<void> {
      try {
        setSaving('uiTerminalFontSize', true)
        settingsActions.setEnvItem('terminal.fontSize', value)
        await queueUiSettingChange('terminal.fontSize', value)
        finishSaving('uiTerminalFontSize')
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalFontSize', false)
      }
    },

    async uiTerminalFontWeightSave(value: string): Promise<void> {
      try {
        setSaving('uiTerminalFontWeight', true)
        settingsActions.setEnvItem('terminal.fontWeight', value)
        await queueUiSettingChange('terminal.fontWeight', value)
        finishSaving('uiTerminalFontWeight')
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalFontWeight', false)
      }
    },

    async uiTerminalLightingModeSave(value: string): Promise<void> {
      try {
        setSaving('uiTerminalLightingMode', true)
        settingsActions.setEnvItem('terminal.lightingMode', value)
        settingsActions.updateTerminalBodyClass()
        await queueUiSettingChange('terminal.lightingMode', value)
        finishSaving('uiTerminalLightingMode')
      } catch (error) {
        reportError(error)
        setSaving('uiTerminalLightingMode', false)
      }
    },

    async hbLogSizeSave(value: number): Promise<void> {
      if (value && (typeof value !== 'number' || value < -1 || Number.isInteger(value) === false)) {
        setInvalid('hbLogSize', true)
        return
      }

      try {
        setSaving('hbLogSize', true)
        settingsActions.setEnvItem('log.maxSize', value)
        if (!value || value === -1) {
          // If the value is -1, we set the log.maxSize to undefined
          // This will remove the setting from the config file
          await queueUiSettingChange('log.truncateSize', null)
          setInvalid('hbLogTruncate', false)
        }
        await queueUiSettingChange('log.maxSize', value)
        setInvalid('hbLogSize', false)
        finishSaving('hbLogSize', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('hbLogSize', false)
      }
    },

    async hbLogTruncateSave(value: number): Promise<void> {
      if (value && (typeof value !== 'number' || value < 0 || Number.isInteger(value) === false)) {
        setInvalid('hbLogTruncate', true)
        return
      }

      try {
        setSaving('hbLogTruncate', true)
        settingsActions.setEnvItem('log.truncateSize', value)
        await queueUiSettingChange('log.truncateSize', value)
        setInvalid('hbLogTruncate', false)
        finishSaving('hbLogTruncate', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('hbLogTruncate', false)
      }
    },
  }

  return slice
}

export type TerminalSlice = ReturnType<typeof createTerminalSlice>
