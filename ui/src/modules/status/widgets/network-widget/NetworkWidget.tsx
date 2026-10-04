import type { NetworkWidgetData } from '@/modules/status/widgets/base-chart-widget/widget-interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { ChartData, ChartOptions } from 'chart.js'

import { useMemo, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { formatDecimal, scaleRate } from '@/core/pipes'
import { cx } from '@/core/utilities/cx'
import { useChartWidget } from '@/modules/status/widgets/base-chart-widget/use-chart-widget'

import '@/modules/status/widgets/base-chart-widget/chart-widget.scss'

// The chart never scales below 1 Mb/s each way, so an idle link's noise
// stays a flat line instead of filling the widget
const MIN_SCALE_BYTES = 1024 * 1024 / 8

/** The rate (bytes per second) the server reported, from older servers' combined MB/s if need be. */
function rates(data: NetworkWidgetData): { received: number, sent: number } {
  return {
    received: data.received ?? data.net.rx_sec ?? 0,
    sent: data.sent ?? data.net.tx_sec ?? 0,
  }
}

export function NetworkWidget(props: WidgetProps) {
  const { widget, updateWidget } = props
  const { t } = useTranslation()
  const unit = widget.networkUnit === 'bytes' ? 'bytes' : 'bits'

  const interfaceRef = useRef('')
  const [receivedPerSec, setReceivedPerSec] = useState<number | undefined>(undefined)
  const [sentPerSec, setSentPerSec] = useState<number | undefined>(undefined)

  const { backgroundRef, chartData, chartOptions } = useChartWidget(props, (io, _series, refreshInterval, seriesList) => {
    void io.request<NetworkWidgetData>('get-server-network-info', { netInterfaces: [widget.networkInterface], interval: refreshInterval }).then((data) => {
      // If no param given, the backend will return the default network interface
      // Clear the current chart if the network interface has changed
      if (interfaceRef.current !== data.net.iface) {
        interfaceRef.current = data.net.iface
        if (widget.networkInterface !== data.net.iface) {
          updateWidget({ networkInterface: data.net.iface })
        }
        seriesList.forEach(item => item.clear())
      }

      const { received, sent } = rates(data)
      setReceivedPerSec(received)
      setSentPerSec(sent)

      // Received is drawn above the axis and sent mirrored below it
      const [receivedSeries, sentSeries] = seriesList
      if (receivedSeries.isEmpty()) {
        // Network widget initializes with a single point instead of history
        receivedSeries.initialize([received])
        sentSeries.initialize([-sent])
      } else {
        receivedSeries.push(received)
        sentSeries.push(-sent)
      }
    })
  }, { seriesCount: 2 })

  const data = useMemo<ChartData<'line', number[], string>>(() => ({
    ...chartData,
    datasets: chartData.datasets.map((dataset, index) => ({
      ...dataset,
      label: index === 0 ? t('status.network.received_per_second') : t('status.network.sent_per_second'),
      ...(index === 1 ? { borderDash: [4, 4] } : {}),
    })),
  }), [chartData, t])

  const options = useMemo<ChartOptions<'line'>>(() => ({
    ...chartOptions,
    scales: {
      ...chartOptions.scales,
      y: { display: false, suggestedMax: MIN_SCALE_BYTES, suggestedMin: -MIN_SCALE_BYTES },
    },
  }), [chartOptions])

  const format = (bytesPerSecond: number) => {
    const { value, suffix } = scaleRate(bytesPerSecond, unit)
    return `${formatDecimal(value, '1.0-1')} ${suffix}`
  }

  return (
    <div className="hb-chart-widget flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={cx('drag-handler p-2', widget.draggable && 'widget-cursor')}>
        {t('status.network.title_network')}
        {' '}
        (
        {widget.networkInterface}
        )
      </div>
      <Line className="widget-chart h-100 w-100" data={data} options={options} />
      <div ref={backgroundRef} className="hb-widget-chart-background"></div>
      <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
        <div className="d-flex justify-content-around flex-wrap w-100">
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">
              {receivedPerSec !== undefined
                ? format(receivedPerSec)
                : <InlineSpinner />}
            </div>
            <div className="widget-value-label grey-text">
              <i className="fas fa-arrow-down me-1" aria-hidden="true"></i>
              {t('status.network.received_per_second')}
            </div>
          </div>
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">
              {sentPerSec !== undefined
                ? format(sentPerSec)
                : <InlineSpinner />}
            </div>
            <div className="widget-value-label grey-text">
              <i className="fas fa-arrow-up me-1" aria-hidden="true"></i>
              {t('status.network.sent_per_second')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
