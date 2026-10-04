import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { toastApiError } from '@/core/utilities/http-error'
import { INNER_BLOCK, INNER_FLEX, SaveIndicator, SettingRow } from '@/modules/settings/sections/rows'

interface HistoryConfig {
  enabled?: boolean
  retentionDays?: number
}

const DEFAULT_RETENTION_DAYS = 7

/**
 * The accessory history recorder's two settings (`accessoryHistory.enabled`,
 * `accessoryHistory.retentionDays` in the UI config), read and saved on their own.
 */
export function AccessoryHistorySettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<HistoryConfig | null>(null)
  const [days, setDays] = useState('')
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let active = true
    api.get<HistoryConfig | null>('/config-editor/ui/accessoryHistory').then(
      (value) => {
        if (active) {
          setConfig(value ?? {})
          setDays(String(value?.retentionDays ?? DEFAULT_RETENTION_DAYS))
        }
      },
      (error) => {
        console.error(error)
        if (active) {
          setConfig({})
          setDays(String(DEFAULT_RETENTION_DAYS))
        }
      },
    )
    return () => {
      active = false
      clearTimeout(timerRef.current)
    }
  }, [])

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.patch('/config-editor/ui', patch)
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setSaving(false)
  }

  const setEnabled = (enabled: boolean) => {
    setConfig(current => ({ ...current, enabled }))
    void save({ 'accessoryHistory.enabled': enabled })
  }

  const changeDays = (value: string) => {
    setDays(value)
    clearTimeout(timerRef.current)
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 365) {
      timerRef.current = setTimeout(() => void save({ 'accessoryHistory.retentionDays': parsed }), 1500)
    }
  }

  if (!config) {
    return null
  }
  const enabled = config.enabled !== false

  return (
    <SettingRow item="setting-accessory-history">
      <div className={INNER_FLEX}>
        <span>
          {t('settings.accessory.history')}
          <br />
          <small className="grey-text pe-2">{t('settings.accessory.history_desc')}</small>
        </span>
        <div className="d-flex align-items-center">
          <div className="order-1 order-md-2">
            <input
              type="checkbox"
              className="rendux-input"
              id="accessoryHistory"
              checked={enabled}
              aria-label={t('settings.accessory.history')}
              onChange={event => setEnabled(event.target.checked)}
            />
            <label htmlFor="accessoryHistory" className="rendux-label ms-3 min-w-50"></label>
          </div>
          <SaveIndicator show={saving} />
        </div>
      </div>
      {enabled && (
        <div className={`${INNER_BLOCK} mt-2`}>
          <label htmlFor="accessoryHistoryDays" className="small grey-text">{t('settings.accessory.history_retention')}</label>
          <div className="input-group w-auto">
            <input
              id="accessoryHistoryDays"
              type="number"
              min={1}
              max={365}
              className="form-control custom-input"
              value={days}
              onChange={event => changeDays(event.target.value)}
            />
            <span className="input-group-text custom-input">{t('settings.accessory.history_days')}</span>
          </div>
        </div>
      )}
    </SettingRow>
  )
}
