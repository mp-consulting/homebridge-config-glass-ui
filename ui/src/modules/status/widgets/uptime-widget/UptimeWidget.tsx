import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { useNamespace, useNamespaceConnected } from '@/core/ws'

import { humaniseDuration } from './humanise-duration'

export function UptimeWidget({ widget }: WidgetProps) {
  const { t } = useTranslation()
  const io = useNamespace('status')
  const [serverUptime, setServerUptime] = useState('')
  const [processUptime, setProcessUptime] = useState('')

  const getServerUptimeInfo = useCallback(() => {
    void io?.request<{ time: { uptime: number }, processUptime: number }>('get-server-uptime-info').then((data) => {
      setServerUptime(humaniseDuration(data.time.uptime))
      setProcessUptime(humaniseDuration(data.processUptime))
    })
  }, [io])

  useNamespaceConnected(io, getServerUptimeInfo)

  // Uptime only ever goes up and nothing pushes it, so poll - only while the
  // socket is up, or every tick queues a request that resolves when it returns
  useEffect(() => {
    if (!io) {
      return undefined
    }
    const timer = setInterval(() => {
      if (io.socket.connected) {
        getServerUptimeInfo()
      }
    }, 11000)
    return () => clearInterval(timer)
  }, [io, getServerUptimeInfo])

  return (
    <div className="flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={`drag-handler p-2${widget.draggable ? ' widget-cursor' : ''}`}>
        {t('status.uptime.title_uptime')}
      </div>
      <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
        <div className="d-flex justify-content-around flex-wrap w-100">
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">
              {serverUptime || <InlineSpinner />}
            </div>
            <div className="widget-value-label grey-text">{t('status.widget.uptime.label_server')}</div>
          </div>
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">
              {processUptime || <InlineSpinner />}
            </div>
            <div className="widget-value-label grey-text">{t('status.widget.uptime.label_process')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
