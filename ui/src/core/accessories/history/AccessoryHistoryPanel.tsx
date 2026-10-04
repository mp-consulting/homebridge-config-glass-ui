import type { AccessoryHistory } from './accessory-history'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDecimal } from '@/core/pipes'

import { fetchAccessoryHistory, summarise } from './accessory-history'
import { HistoryChart } from './HistoryChart'

/**
 * The accessory info modal's last 24 hours of recorded sensor values, one
 * sparkline per characteristic. Renders nothing when nothing is recorded.
 */
export default function AccessoryHistoryPanel({ uniqueId }: { uniqueId: string }) {
  const { t } = useTranslation()
  const [history, setHistory] = useState<AccessoryHistory | null>(null)

  useEffect(() => {
    let active = true
    fetchAccessoryHistory(uniqueId, { hours: 24, maxPoints: 96 }).then(
      (value) => {
        if (active) {
          setHistory(value)
        }
      },
      // History is a nice-to-have: an older server, or recording switched off
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [uniqueId])

  const series = history?.series.filter(item => item.points.length > 1) ?? []
  if (!series.length) {
    return null
  }

  return (
    <ul className="list-group list-group-box mb-3 hb-accessory-history" aria-label={t('accessories.history.title')}>
      <li className="list-group-item text-center grey-text small">{t('accessories.history.last_24h')}</li>
      {series.map((item) => {
        const stats = summarise(item.points)!
        return (
          <li key={item.type} className="list-group-item d-flex align-items-center justify-content-between">
            <span className="me-3 text-nowrap">
              {item.description ?? item.type}
              <br />
              <small className="grey-text font-monospace">
                {t('accessories.history.range', { min: formatDecimal(stats.min, '1.0-1'), max: formatDecimal(stats.max, '1.0-1') })}
              </small>
            </span>
            <div className="flex-grow-1" style={{ height: 36, maxWidth: 220 }} data-testid={`sparkline-${item.type}`}>
              <HistoryChart points={item.points} sparkline className="w-100 h-100" />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
