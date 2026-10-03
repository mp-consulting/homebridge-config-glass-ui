import type { PageContext } from '@/modules/settings/settings-page/types'

import { notifications } from '@/core/notifications'
import { settingsActions } from '@/core/settings'

/** Security: the login form and the session timeout. */
export function createSecuritySlice(ctx: PageContext) {
  const { v, patch, setSaving, setInvalid, reportError, queueUiSettingChange, finishSaving } = ctx

  const slice = {
    async uiAuthSave(value: boolean): Promise<void> {
      try {
        setSaving('uiAuth', true)
        settingsActions.setItem('formAuth', value)
        await queueUiSettingChange('auth', value ? 'form' : 'none')
        notifications.set('formAuthEnabled', value)
        finishSaving('uiAuth', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('uiAuth', false)
      }
    },

    async uiSessionTimeoutSaveFromFields(): Promise<void> {
      const days = slice.normalizeSessionTimeoutField('uiSessionTimeoutDays', 0, 365)
      const hours = slice.normalizeSessionTimeoutField('uiSessionTimeoutHours', 0, 23)
      const minutes = slice.normalizeSessionTimeoutField('uiSessionTimeoutMinutes', 0, 59)

      if (days === null || hours === null || minutes === null) {
        return
      }

      // Convert to seconds
      const totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60)

      // Validate total: minimum 10 minutes (600 seconds)
      if (totalSeconds < 600) {
        setInvalid('uiSessionTimeoutMinutes', true)
        return
      }

      try {
        setSaving('uiSessionTimeout', true)
        settingsActions.setItem('sessionTimeout', totalSeconds)
        await queueUiSettingChange('sessionTimeout', totalSeconds)
        setInvalid('uiSessionTimeoutDays', false)
        setInvalid('uiSessionTimeoutHours', false)
        setInvalid('uiSessionTimeoutMinutes', false)
        finishSaving('uiSessionTimeout', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('uiSessionTimeout', false)
      }
    },

    normalizeSessionTimeoutField(field: 'uiSessionTimeoutDays' | 'uiSessionTimeoutHours' | 'uiSessionTimeoutMinutes', min: number, max: number): number | null {
      const value = v()[field] ?? 0

      if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max || !Number.isInteger(value)) {
        setInvalid(field, true)
        return null
      }

      setInvalid(field, false)
      patch(field, value)
      return value
    },

    async uiSessionTimeoutInactivityBasedSave(value: boolean): Promise<void> {
      try {
        setSaving('uiSessionTimeoutInactivityBased', true)
        settingsActions.setItem('sessionTimeoutInactivityBased', value)
        await queueUiSettingChange('sessionTimeoutInactivityBased', value)
        finishSaving('uiSessionTimeoutInactivityBased', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('uiSessionTimeoutInactivityBased', false)
      }
    },
  }

  return slice
}

export type SecuritySlice = ReturnType<typeof createSecuritySlice>
