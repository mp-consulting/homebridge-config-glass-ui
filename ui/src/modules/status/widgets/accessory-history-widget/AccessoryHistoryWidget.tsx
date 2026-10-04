import type { HistorySeries } from '@/core/accessories/history/accessory-history'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { fetchAccessoryHistory, summarise } from '@/core/accessories/history/accessory-history'
import { HistoryChart } from '@/core/accessories/history/HistoryChart'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { formatDecimal } from '@/core/pipes'
import { cx } from '@/core/utilities/cx'

import '@/modules/status/widgets/base-chart-widget/chart-widget.scss'

const REFRESH_MS = 60_000

/**
 * One accessory characteristic's recorded history (temperature, humidity,
 * power…) over the chosen hours, refreshed every minute.
 */
export function AccessoryHistoryWidget({ widget }: WidgetProps) {
  const { t } = useTranslation()
  const backgroundRef = useRef<HTMLDivElement>(null)
  const [color, setColor] = useState<string>()
  const [series, setSeries] = useState<HistorySeries | null>(null)
  const [loaded, setLoaded] = useState(false)
  const uniqueId = widget.historyAccessory
  const type = widget.historyType
  const hours = widget.historyHours || 24

  useEffect(() => {
    if (backgroundRef.current) {
      setColor(getComputedStyle(backgroundRef.current).backgroundColor || undefined)
    }
  }, [])

  const load = useCallback(async () => {
    if (!uniqueId || !type) {
      return
    }
    try {
      const history = await fetchAccessoryHistory(uniqueId, { hours, type, maxPoints: 200 })
      setSeries(history.series.find(item => item.type === type) ?? null)
    } catch (error) {
      console.error(error)
      setSeries(null)
    }
    setLoaded(true)
  }, [uniqueId, type, hours])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) {
        void load()
      }
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const stats = series ? summarise(series.points) : null
  const unit = series?.unit === 'celsius' ? '°C' : series?.unit === 'percentage' ? '%' : series?.unit === 'lux' ? ' lx' : ''

  return (
    <div className="hb-chart-widget hb-accessory-history-widget flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={cx('drag-handler p-2', widget.draggable && 'widget-cursor')}>
        {t('status.widget.history.title')}
        {widget.historyLabel && ` (${widget.historyLabel})`}
      </div>
      <div ref={backgroundRef} className="hb-widget-chart-background"></div>
      {!uniqueId || !type
        ? <div className="d-flex flex-grow-1 align-items-center justify-content-center grey-text p-2 text-center">{t('status.widget.history.not_configured')}</div>
        : !loaded
            ? <div className="d-flex flex-grow-1 align-items-center justify-content-center"><InlineSpinner /></div>
            : !stats
                ? <div className="d-flex flex-grow-1 align-items-center justify-content-center grey-text p-2 text-center">{t('status.widget.history.no_data')}</div>
                : (
                    <>
                      <div className="flex-grow-1 px-2" style={{ minHeight: 0 }}>
                        <HistoryChart points={series!.points} color={color} className="w-100 h-100" />
                      </div>
                      <div className="d-flex justify-content-around w-100 text-center small pt-1">
                        <span>
                          <span className="grey-text">{t('status.widget.history.latest')}</span>
                          {' '}
                          {`${formatDecimal(stats.latest, '1.0-1')}${unit}`}
                        </span>
                        <span>
                          <span className="grey-text">{t('status.widget.history.min')}</span>
                          {' '}
                          {`${formatDecimal(stats.min, '1.0-1')}${unit}`}
                        </span>
                        <span>
                          <span className="grey-text">{t('status.widget.history.max')}</span>
                          {' '}
                          {`${formatDecimal(stats.max, '1.0-1')}${unit}`}
                        </span>
                      </div>
                    </>
                  )}
    </div>
  )
}
