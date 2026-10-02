import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import { useEffect, useState } from 'react'

import { formatDatePattern } from '@/core/pipes/date-pattern'

const DEFAULT_TIME_FORMAT = 'H:mm'
const DEFAULT_DATE_FORMAT = 'yyyy-MM-dd'

export function ClockWidget({ widget, updateWidget }: WidgetProps) {
  const [currentTime, setCurrentTime] = useState(() => new Date())

  const timeFormat = widget.timeFormat || DEFAULT_TIME_FORMAT
  const dateFormat = widget.dateFormat || DEFAULT_DATE_FORMAT

  // Write the defaults onto the layout item, so the settings modal shows them
  useEffect(() => {
    const patch: Partial<typeof widget> = {}
    if (!widget.timeFormat) {
      patch.timeFormat = DEFAULT_TIME_FORMAT
    }
    if (!widget.dateFormat) {
      patch.dateFormat = DEFAULT_DATE_FORMAT
    }
    if (Object.keys(patch).length) {
      updateWidget(patch)
    }
  }, [widget.timeFormat, widget.dateFormat, updateWidget])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex-column d-flex align-items-stretch h-100 w-100 py-3">
      <div className="d-flex flex-row flex-grow-1 align-items-center w-100 text-center">
        <div className="d-flex justify-content-around flex-wrap w-100">
          <div className="text-center widget-value-parent-wrap">
            <div className="widget-value mb-0">{formatDatePattern(currentTime, timeFormat)}</div>
            <div className="widget-value-label grey-text">{formatDatePattern(currentTime, dateFormat)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
