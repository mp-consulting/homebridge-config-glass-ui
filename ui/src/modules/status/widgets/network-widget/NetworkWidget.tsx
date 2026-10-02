import type { NetworkWidgetData } from '@/modules/status/widgets/base-chart-widget/widget-interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'

import { formatDecimal } from '@/core/pipes'
import { useChartWidget } from '@/modules/status/widgets/base-chart-widget/use-chart-widget'

import '@/modules/status/widgets/base-chart-widget/chart-widget.scss'

export function NetworkWidget(props: WidgetProps) {
  const { widget, updateWidget } = props
  const { t } = useTranslation()

  const interfaceRef = useRef('')
  const [receivedPerSec, setReceivedPerSec] = useState<number | undefined>(undefined)
  const [sentPerSec, setSentPerSec] = useState<number | undefined>(undefined)

  const { backgroundRef, chartData, chartOptions } = useChartWidget(props, (io, series) => {
    void io.request<NetworkWidgetData>('get-server-network-info', { netInterfaces: [widget.networkInterface] }).then((data) => {
      // If no param given, the backend will return the default network interface
      // Clear the current chart if the network interface has changed
      if (interfaceRef.current !== data.net.iface) {
        interfaceRef.current = data.net.iface
        if (widget.networkInterface !== data.net.iface) {
          updateWidget({ networkInterface: data.net.iface })
        }
        series.clear()
      }

      setReceivedPerSec((data.net.rx_sec / 1024 / 1024) * 8)
      setSentPerSec((data.net.tx_sec / 1024 / 1024) * 8)

      // The chart looks strange if the data rate is < 1.
      const point = data.point < 1 ? 0 : data.point

      if (series.isEmpty()) {
        // Network widget initializes with a single point instead of history
        series.initialize([point])
      } else {
        series.push(point)
      }
    })
  })

  return (
    <div className="hb-chart-widget flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={`drag-handler p-2${widget.draggable ? ' widget-cursor' : ''}`}>
        {t('status.network.title_network')}
        {' '}
        (
        {widget.networkInterface}
        )
      </div>
      <Line className="widget-chart h-100 w-100" data={chartData} options={chartOptions} />
      <div ref={backgroundRef} className="hb-widget-chart-background"></div>
      <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
        <div className="d-flex justify-content-around flex-wrap w-100">
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">
              {receivedPerSec !== undefined
                ? `${formatDecimal(receivedPerSec, '1.0-1')} Mb/s`
                : <i className="fas fa-circle-notch fa-spin"></i>}
            </div>
            <div className="widget-value-label grey-text">{t('status.network.received_per_second')}</div>
          </div>
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">
              {sentPerSec !== undefined
                ? `${formatDecimal(sentPerSec, '1.0-1')} Mb/s`
                : <i className="fas fa-circle-notch fa-spin"></i>}
            </div>
            <div className="widget-value-label grey-text">{t('status.network.sent_per_second')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
