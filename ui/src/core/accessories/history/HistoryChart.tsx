import type { ChartData, ChartOptions } from 'chart.js'

import { CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement } from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

Chart.register(LineController, LineElement, PointElement, Filler, LinearScale, CategoryScale)

export interface HistoryChartProps {
  points: Array<[number, number]>
  /** No axes, a thin line: for a row of a list. */
  sparkline?: boolean
  className?: string
  /** Line colour (CSS colour); the theme's primary by default. */
  color?: string
}

/** A recorded series as a line: a full chart with time labels, or a sparkline. */
export function HistoryChart({ points, sparkline = false, className, color = 'rgba(148,159,177,0.8)' }: HistoryChartProps) {
  const data = useMemo<ChartData<'line', number[], string>>(() => ({
    labels: points.map(([t]) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
    datasets: [{
      data: points.map(([, value]) => value),
      borderColor: color,
      backgroundColor: color.replace(/[\d.]+\)$/, '0.15)'),
      fill: !sparkline,
      borderWidth: sparkline ? 1.5 : 2,
    }],
  }), [points, sparkline, color])

  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    elements: { point: { radius: 0 }, line: { tension: 0.3 } },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: !sparkline, ticks: { maxTicksLimit: 6, autoSkip: true } },
      y: { display: !sparkline, ticks: { maxTicksLimit: 5 } },
    },
  }), [sparkline])

  return <Line className={className} data={data} options={options} />
}
