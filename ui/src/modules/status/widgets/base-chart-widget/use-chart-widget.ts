import type { IoNamespace } from '@/core/ws'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { ChartData, ChartOptions } from 'chart.js'
import type { RefObject } from 'react'

import { CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement } from 'chart.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useNamespace, useNamespaceConnected } from '@/core/ws'

// Status widgets only use filled line charts with hidden axes/legend/tooltips,
// so register just the chart.js components they need instead of the full default set.
Chart.register(LineController, LineElement, PointElement, Filler, LinearScale, CategoryScale)

/** The fixed-length series a chart widget draws. */
export interface ChartSeries {
  /** Whether nothing has been charted yet (the next reading seeds it). */
  isEmpty: () => boolean
  /** Seed the chart from the server's history, trimmed to the configured length. */
  initialize: (history: number[]) => void
  /** Append a reading, dropping the oldest first when the series is full. */
  push: (value: number) => void
  /** Drop every point. */
  clear: () => void
}

export interface ChartWidget {
  /** The `status` namespace (null until it is held). */
  io: IoNamespace | null
  /** Put on the `.hb-widget-chart-background` div: the line colour is read from it. */
  backgroundRef: RefObject<HTMLDivElement | null>
  chartData: ChartData<'line', number[], string>
  chartOptions: ChartOptions<'line'>
  series: ChartSeries
  /** One series per dataset (`options.seriesCount`); `series` is the first. */
  seriesList: ChartSeries[]
  refreshInterval: number
  historyItems: number
}

function baseOptions(color?: string): ChartOptions<'line'> {
  return {
    responsive: true,
    // A new point arrives every few seconds on a dashboard left open for
    // hours: animating each redraw costs frames for nothing
    animation: false,
    elements: {
      point: {
        radius: 0,
      },
      line: {
        tension: 0.4,
        backgroundColor: color || 'rgba(148,159,177,0.2)',
        borderColor: color || 'rgba(148,159,177,0.2)',
        fill: 'origin',
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    scales: {
      x: {
        display: false,
      },
      y: {
        display: false,
        max: 100,
        min: 0,
      },
    },
  }
}

/**
 * What `BaseChartWidgetComponent` gave the cpu, memory and network widgets:
 * the chart config, a fixed-length series, and polling on the configured
 * interval (only while the socket is up and the tab is visible), restarted from scratch when the
 * widget's settings change.
 * @param props - the widget's props
 * @param fetchData - asks the server for a reading; the latest one is always called. It gets the
 * refresh interval (seconds) to send along, so the server samples at least that often.
 */
export function useChartWidget(
  props: WidgetProps,
  fetchData: (io: IoNamespace, series: ChartSeries, refreshInterval: number, seriesList: ChartSeries[]) => void,
  options: { seriesCount?: number } = {},
): ChartWidget {
  const seriesCount = Math.max(1, options.seriesCount ?? 1)
  const { widget, configureEvent, updateWidget } = props
  const io = useNamespace('status')
  const backgroundRef = useRef<HTMLDivElement | null>(null)
  const [userColor, setUserColor] = useState<string>()

  // Interval and history items should be in [1, 60]
  const refreshInterval = Math.min(60, Math.max(1, widget.refreshInterval || 10))
  const historyItems = Math.min(60, Math.max(1, widget.historyItems || 60))

  // Write the defaults onto the layout item, so the settings modal shows them
  useEffect(() => {
    const patch: Partial<typeof widget> = {}
    if (!widget.refreshInterval) {
      patch.refreshInterval = 10
    }
    if (!widget.historyItems) {
      patch.historyItems = 60
    }
    if (Object.keys(patch).length) {
      updateWidget(patch)
    }
  }, [widget.refreshInterval, widget.historyItems, updateWidget])

  // The points live in a ref so a reading that arrives between renders sees the
  // ones before it; `points` is the copy the chart is drawn from
  const pointsRef = useRef<number[][]>([])
  const [points, setPoints] = useState<number[][]>([])
  const historyItemsRef = useRef(historyItems)
  historyItemsRef.current = historyItems

  const seriesList = useMemo<ChartSeries[]>(() => Array.from({ length: seriesCount }, (_, index) => {
    const current = () => pointsRef.current[index] ?? []
    const commit = (next: number[]) => {
      const all = Array.from({ length: seriesCount }, (__, i) => pointsRef.current[i] ?? [])
      all[index] = next
      pointsRef.current = all
      setPoints(all)
    }
    return {
      isEmpty: () => current().length === 0,
      initialize: history => commit(history.slice(-historyItemsRef.current)),
      push: (value) => {
        // Make room first so the series never holds more than historyItems points
        const existing = current().length >= historyItemsRef.current
          ? current().slice(1)
          : current()
        commit([...existing, value])
      },
      clear: () => commit([]),
    }
  }), [seriesCount])
  const series = seriesList[0]

  const fetchRef = useRef(fetchData)
  fetchRef.current = fetchData
  const refreshIntervalRef = useRef(refreshInterval)
  refreshIntervalRef.current = refreshInterval
  const fetchNow = useCallback(() => {
    if (io) {
      fetchRef.current(io, series, refreshIntervalRef.current, seriesList)
    }
  }, [io, series, seriesList])

  // Lookup the chart color based on the current theme
  useLayoutEffect(() => {
    if (backgroundRef.current) {
      setUserColor(getComputedStyle(backgroundRef.current).backgroundColor || undefined)
    }
  }, [])

  useNamespaceConnected(io, fetchNow)

  // Bumped by a settings change, so the interval starts over even when it kept its length
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!io) {
      return undefined
    }
    // No polling while the tab is in the background: nobody sees the chart,
    // and the server would still sample on every request. One reading is
    // fetched as soon as the tab is visible again.
    const timer = setInterval(() => {
      if (io.socket.connected && !document.hidden) {
        fetchNow()
      }
    }, refreshInterval * 1000)
    const onVisibilityChange = () => {
      if (!document.hidden && io.socket.connected) {
        fetchNow()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [io, fetchNow, refreshInterval, generation])

  // Listen for configuration changes
  useEffect(() => configureEvent.subscribe(() => {
    // The old points were sampled at the old settings: start the chart over
    seriesList.forEach(item => item.clear())
    setGeneration(value => value + 1)
    if (io?.socket.connected) {
      fetchNow()
    }
  }), [configureEvent, seriesList, io, fetchNow])

  const chartData = useMemo<ChartData<'line', number[], string>>(() => ({
    labels: (points[0] ?? []).map(() => 'point'),
    datasets: Array.from({ length: seriesCount }, (_, index) => ({ data: points[index] ?? [] })),
  }), [points, seriesCount])

  const chartOptions = useMemo(() => baseOptions(userColor), [userColor])

  return { io, backgroundRef, chartData, chartOptions, series, seriesList, refreshInterval, historyItems }
}
