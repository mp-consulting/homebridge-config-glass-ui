import type { MemoryWidgetData } from '@/modules/status/widgets/base-chart-widget/widget-interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useState } from 'react'
import { Line } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'

import { formatDecimal } from '@/core/pipes'
import { useSettingsStore } from '@/core/settings'
import { useChartWidget } from '@/modules/status/widgets/base-chart-widget/use-chart-widget'

import '@/modules/status/widgets/base-chart-widget/chart-widget.scss'

const GB = 1024 * 1024 * 1024

export function MemoryWidget(props: WidgetProps) {
  const { widget } = props
  const { t } = useTranslation()
  const metricsDisabled = useSettingsStore(state => state.env.disableServerMetricsMonitoring === true)

  const [totalMemory, setTotalMemory] = useState<number | undefined>(undefined)
  const [freeMemory, setFreeMemory] = useState<number | undefined>(undefined)

  const { backgroundRef, chartData, chartOptions } = useChartWidget(props, (io, series) => {
    if (metricsDisabled) {
      return
    }
    void io.request<MemoryWidgetData>('get-server-memory-info').then((data) => {
      if (!data.mem) {
        return
      }
      setTotalMemory(data.mem.total / GB)
      setFreeMemory(data.mem.available / GB)
      if (series.isEmpty()) {
        series.initialize(data.memoryUsageHistory)
      } else {
        series.push(data.memoryUsageHistory.slice(-1)[0])
      }
    })
  })

  return (
    <div className="hb-chart-widget flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={`drag-handler p-2${widget.draggable ? ' widget-cursor' : ''}`}>
        {t('status.memory.title_memory')}
      </div>
      <div ref={backgroundRef} className="hb-widget-chart-background"></div>
      {metricsDisabled
        ? (
            <div className="d-flex flex-row flex-grow-1 align-items-center justify-content-center w-100 gridster-item-content text-center px-3">
              <div className="grey-text">{t('status.metrics.label_disabled')}</div>
            </div>
          )
        : (
            <>
              <Line className="widget-chart h-100 w-100" data={chartData} options={chartOptions} />
              <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
                <div className="d-flex justify-content-around flex-wrap w-100">
                  <div className="text-center widget-value-parent-wrap">
                    <div className="widget-value mb-0">
                      {totalMemory !== undefined
                        ? `${formatDecimal(totalMemory, '1.0-2')} GB`
                        : <i className="fas fa-circle-notch fa-spin"></i>}
                    </div>
                    <div className="widget-value-label grey-text">{t('status.memory.label_total')}</div>
                  </div>
                  <div className="text-center widget-value-parent-wrap">
                    <div className="widget-value mb-0">
                      {freeMemory !== undefined
                        ? `${formatDecimal(freeMemory, '1.0-2')} GB`
                        : <i className="fas fa-circle-notch fa-spin"></i>}
                    </div>
                    <div className="widget-value-label grey-text">{t('status.memory.label_available')}</div>
                  </div>
                </div>
              </div>
            </>
          )}
    </div>
  )
}
