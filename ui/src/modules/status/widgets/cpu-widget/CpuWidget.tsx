import type { CpuWidgetData } from '@/modules/status/widgets/base-chart-widget/widget-interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useState } from 'react'
import { Line } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'

import { convertTemp, formatDecimal } from '@/core/pipes'
import { useSettingsStore } from '@/core/settings'
import { useChartWidget } from '@/modules/status/widgets/base-chart-widget/use-chart-widget'

import '@/modules/status/widgets/base-chart-widget/chart-widget.scss'

export function CpuWidget(props: WidgetProps) {
  const { widget } = props
  const { t } = useTranslation()
  const temperatureUnits = useSettingsStore(state => state.env.temperatureUnits)
  const metricsDisabled = useSettingsStore(state => state.env.disableServerMetricsMonitoring === true)

  const [cpuTemperature, setCpuTemperature] = useState<CpuWidgetData['cpuTemperature']>({})
  const [currentLoad, setCurrentLoad] = useState<number | undefined>(undefined)

  const { backgroundRef, chartData, chartOptions } = useChartWidget(props, (io, series, refreshInterval) => {
    if (metricsDisabled) {
      return
    }
    void io.request<CpuWidgetData>('get-server-cpu-info', { interval: refreshInterval }).then((data) => {
      setCpuTemperature(data.cpuTemperature)
      setCurrentLoad(data.currentLoad)
      if (series.isEmpty()) {
        series.initialize(data.cpuLoadHistory)
      } else {
        series.push(data.currentLoad)
      }
    })
  })

  const main = cpuTemperature.main

  return (
    <div className="hb-chart-widget flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={`drag-handler p-2${widget.draggable ? ' widget-cursor' : ''}`}>
        {t('status.cpu.title_cpu')}
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
                      {currentLoad !== undefined
                        ? `${formatDecimal(currentLoad, '1.0-0')}%`
                        : <i className="fas fa-circle-notch fa-spin"></i>}
                    </div>
                    <div className="widget-value-label grey-text">{t('status.cpu.load')}</div>
                  </div>
                  {/* -1 is the no-sensor sentinel, everything else is a real reading */}
                  {main !== undefined && main !== null && main !== -1 && (
                    <div className="text-center widget-value-parent-wrap">
                      <div className="widget-value mb-0">
                        {formatDecimal(convertTemp(main, temperatureUnits), '1.0-0')}
                        &deg;
                        {temperatureUnits.toUpperCase()}
                      </div>
                      <div className="widget-value-label grey-text">{t('status.cpu.temp')}</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
    </div>
  )
}
