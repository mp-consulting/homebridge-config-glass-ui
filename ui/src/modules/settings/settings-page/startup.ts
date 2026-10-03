import type { FieldKey, PageContext } from '@/modules/settings/settings-page/types'

import { api } from '@/core/api'
import { RE_CRON_FIELD, RE_WHITESPACE_SINGLE } from '@/core/regex.constants'
import { settingsActions } from '@/core/settings'

/** Startup: the hb-service startup settings and the UI config values that need a restart. */
export function createStartupSlice(ctx: PageContext) {
  const { v, setSaving, setInvalid, reportError, fullServiceRestartThenToast, queueUiSettingChange, finishSaving } = ctx

  const slice = {
    /**
     * The startup settings endpoint replaces the block wholesale, so every
     * field has to be sent or the others are wiped.
     * @param field - the field that changed
     * @param key - its key in the block
     * @param value - its new value
     */
    async startupSave(field: 'hbDebug' | 'hbInsecure' | 'hbKeep' | 'hbEnvDebug' | 'hbEnvNode', key: string, value: unknown): Promise<void> {
      try {
        setSaving(field, true)
        await api.put('/platform-tools/hb-service/homebridge-startup-settings', {
          HOMEBRIDGE_DEBUG: v().hbDebug,
          HOMEBRIDGE_KEEP_ORPHANS: v().hbKeep,
          HOMEBRIDGE_INSECURE: v().hbInsecure,
          ENV_DEBUG: v().hbEnvDebug,
          ENV_NODE_OPTIONS: v().hbEnvNode,
          [key]: value,
        })
        if (field === 'hbKeep') {
          settingsActions.setKeepOrphans(value as boolean)
        }
        finishSaving(field, fullServiceRestartThenToast)
      } catch (error) {
        reportError(error)
        setSaving(field, false)
      }
    },

    hbDebugSave(value: boolean): Promise<void> {
      return slice.startupSave('hbDebug', 'HOMEBRIDGE_DEBUG', value)
    },

    hbInsecureSave(value: boolean): Promise<void> {
      return slice.startupSave('hbInsecure', 'HOMEBRIDGE_INSECURE', value)
    },

    hbKeepSave(value: boolean): Promise<void> {
      return slice.startupSave('hbKeep', 'HOMEBRIDGE_KEEP_ORPHANS', value)
    },

    hbEnvDebugSave(value: string): Promise<void> {
      return slice.startupSave('hbEnvDebug', 'ENV_DEBUG', value)
    },

    hbEnvNodeSave(value: string): Promise<void> {
      return slice.startupSave('hbEnvNode', 'ENV_NODE_OPTIONS', value)
    },

    /**
     * A UI config value that needs a restart to apply.
     * @param field - the field saved
     * @param envKey - where it lives in `env` (`setEnvItem`), or nothing
     * @param configKey - the UI config key
     * @param value - the value to write
     * @param fullRestart - flag a full service restart before the toast
     */
    async uiConfigSave(field: FieldKey, envKey: string | null, configKey: string, value: unknown, fullRestart: boolean): Promise<void> {
      try {
        setSaving(field, true)
        if (envKey) {
          settingsActions.setEnvItem(envKey, value)
        }
        await queueUiSettingChange(configKey, value)
        finishSaving(field, fullRestart ? fullServiceRestartThenToast : () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving(field, false)
      }
    },

    hbPackageSave(value: string): Promise<void> {
      return slice.uiConfigSave('hbPackage', 'homebridgePackagePath', 'homebridgePackagePath', value, false)
    },

    uiMetricsSave(value: boolean): Promise<void> {
      return slice.uiConfigSave('uiMetrics', 'disableServerMetricsMonitoring', 'disableServerMetricsMonitoring', !value, true)
    },

    enableMdnsAdvertiseSave(value: boolean): Promise<void> {
      return slice.uiConfigSave('enableMdnsAdvertise', 'enableMdnsAdvertise', 'enableMdnsAdvertise', value, true)
    },

    uiAccDebugSave(value: boolean): Promise<void> {
      return slice.uiConfigSave('uiAccDebug', 'accessoryControl.debug', 'accessoryControl.debug', value, false)
    },

    uiTempFileSave(value: string): Promise<void> {
      return slice.uiConfigSave('uiTempFile', 'temp', 'temp', value, true)
    },

    hbLinuxShutdownSave(value: string): Promise<void> {
      return slice.uiConfigSave('hbLinuxShutdown', 'linux.shutdown', 'linux.shutdown', value, true)
    },

    hbLinuxRestartSave(value: string): Promise<void> {
      return slice.uiConfigSave('hbLinuxRestart', 'linux.restart', 'linux.restart', value, true)
    },

    validateCronExpression(cron: string): boolean {
      // Empty is valid (disables scheduled restart)
      if (!cron || !cron.trim()) {
        return true
      }

      // Must have exactly 5 fields: minute hour day month weekday
      const fields = cron.trim().split(RE_WHITESPACE_SINGLE)
      if (fields.length !== 5) {
        return false
      }

      return fields.every(field => RE_CRON_FIELD.test(field))
    },

    async scheduledRestartCronSave(value: string): Promise<void> {
      // Validate cron expression
      if (!slice.validateCronExpression(value)) {
        setInvalid('scheduledRestartCron', true)
        return
      }

      setInvalid('scheduledRestartCron', false)

      // Convert empty string to null
      const cronValue = value?.trim() ? value : null
      await slice.uiConfigSave('scheduledRestartCron', 'scheduledRestartCron', 'scheduledRestartCron', cronValue, true)
    },
  }

  return slice
}

export type StartupSlice = ReturnType<typeof createStartupSlice>
