import type { FieldKey, PageContext } from '@/modules/settings/settings-page/types'

import { api } from '@/core/api'
import { settingsActions } from '@/core/settings'

/** Network: the mDNS advertiser, ports, port ranges and hosts. */
export function createNetworkSlice(ctx: PageContext) {
  const { v, setSaving, setInvalid, reportError, queueUiSettingChange, finishSaving } = ctx

  const slice = {
    async hbMDnsSave(value: string): Promise<void> {
      try {
        setSaving('hbMDns', true)
        await api.put('/server/mdns-advertiser', { advertiser: value })
        finishSaving('hbMDns', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('hbMDns', false)
      }
    },

    async hbPortSave(value: number): Promise<void> {
      if (value === v().uiPort) {
        setInvalid('hbPort', true)
        return
      }

      try {
        setSaving('hbPort', true)
        await api.put('/server/port', { port: value })
        setInvalid('hbPort', false)
        finishSaving('hbPort', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('hbPort', false)
      }
    },

    /**
     * One end of a port range. Both ends are always sent: the endpoint replaces
     * the pair, so sending only the end that changed would wipe the other.
     * @param url - the range endpoint
     * @param field - the end being saved
     * @param value - its new value
     */
    async portRangeSave(url: string, field: 'hbStartPort' | 'hbEndPort' | 'matterStartPort' | 'matterEndPort', value: number): Promise<void> {
      if (value && (typeof value !== 'number' || !Number.isInteger(value) || value < 1025 || value > 65533)) {
        setInvalid(field, true)
        return
      }
      const isStart = field.endsWith('StartPort')
      const otherField = isStart ? field.replace('Start', 'End') as FieldKey : field.replace('End', 'Start') as FieldKey
      const other = v()[otherField] as number | null
      const [start, end] = isStart ? [value, other] : [other, value]
      if (value && other && start! >= end!) {
        setInvalid(field, true)
        return
      }
      try {
        setSaving(field, true)
        setInvalid(field, false)
        await api.put(url, { start: start || undefined, end: end || undefined })
        finishSaving(field, () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving(field, false)
        setInvalid(field, true)
      }
    },

    hbStartPortSave(value: number): Promise<void> {
      return slice.portRangeSave('/server/ports', 'hbStartPort', value)
    },

    hbEndPortSave(value: number): Promise<void> {
      return slice.portRangeSave('/server/ports', 'hbEndPort', value)
    },

    async uiPortSave(value: number): Promise<void> {
      if (!value || typeof value !== 'number' || value < 1025 || value > 65533 || Number.isInteger(value) === false || value === v().hbPort) {
        setInvalid('uiPort', true)
        return
      }

      try {
        setSaving('uiPort', true)
        settingsActions.setEnvItem('port', value)
        await queueUiSettingChange('port', value)
        setInvalid('uiPort', false)
        finishSaving('uiPort', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('uiPort', false)
      }
    },

    async uiHostSave(value: string): Promise<void> {
      try {
        setSaving('uiHost', true)
        settingsActions.setItem('host', value)
        await queueUiSettingChange('host', value)
        finishSaving('uiHost', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('uiHost', false)
      }
    },

    async uiProxyHostSave(value: string): Promise<void> {
      try {
        setSaving('uiProxyHost', true)
        settingsActions.setItem('proxyHost', value)
        await queueUiSettingChange('proxyHost', value)
        finishSaving('uiProxyHost', () => settingsActions.showRestartToast())
      } catch (error) {
        reportError(error)
        setSaving('uiProxyHost', false)
      }
    },
  }

  return slice
}

export type NetworkSlice = ReturnType<typeof createNetworkSlice>
