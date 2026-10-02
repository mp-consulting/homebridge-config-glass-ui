import type { FakeIoNamespace, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/core/settings'
import { ws as realWs } from '@/core/ws'
import { CpuWidget } from '@/modules/status/widgets/cpu-widget/CpuWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeSettingsState } from '@/testing'

const chart = vi.hoisted(() => ({ props: undefined as any }))

// jsdom has no canvas to draw on: the chart only records what it was given
vi.mock('react-chartjs-2', () => ({
  Line: (props: any) => {
    chart.props = props
    return <canvas className={props.className} />
  },
}))

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

/** The chart series as a plain array of values. */
function series(): number[] {
  return chart.props.data.datasets[0].data
}

/**
 * The cpu widget, and the chart series the cpu, memory and network widgets share.
 *
 * The rule that matters for the series is the length: it has to make room first,
 * before appending, or it grows past the configured history size and the
 * chart squeezes more and more points into the same box.
 */
describe('the cpu widget', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace
  let configureEvent: ReturnType<typeof createWidgetEvent>
  let updateWidget: Mock<(...args: any[]) => any>

  async function open(widget: Record<string, any> = {}, options: { env?: Record<string, any>, connected?: boolean, arrange?: () => void } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: options.env }))
    ws.namespaces.clear()
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-server-cpu-info', { cpuTemperature: {}, currentLoad: 0, cpuLoadHistory: [] })
    options.arrange?.()
    configureEvent = createWidgetEvent()
    updateWidget = vi.fn()
    const props = {
      widget: { component: 'CpuWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, ...widget },
      resizeEvent: createWidgetEvent(),
      configureEvent,
      updateWidget,
      saveWidgets: vi.fn(),
    }
    const result = render(<CpuWidget {...props} />)
    await act(async () => {})
    return result
  }

  /** Answer the next poll with a new reading. */
  function nextReading(currentLoad: number) {
    io.socket.respondTo('get-server-cpu-info', { cpuTemperature: {}, currentLoad, cpuLoadHistory: [] })
  }

  beforeEach(() => {
    chart.props = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the cpu load as unknown rather than zero before the first reading', async () => {
    const { container } = await open({}, { connected: false })

    // `0` would render as a confident "0%" on a server that simply has not answered yet
    expect(container.querySelector('.widget-value .fa-circle-notch')).not.toBeNull()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('asks for the cpu info once connected', async () => {
    const { container } = await open({}, {
      arrange: () => io.socket.respondTo('get-server-cpu-info', {
        cpuTemperature: { main: 45 },
        currentLoad: 12.5,
        cpuLoadHistory: [10, 11, 12],
      }),
    })

    const values = [...container.querySelectorAll('.widget-value')].map(el => el.textContent)
    expect(values).toEqual(['13%', '45°C'])
  })

  it('hides the temperature when there is no sensor', async () => {
    const { container } = await open({}, {
      arrange: () => io.socket.respondTo('get-server-cpu-info', { cpuTemperature: { main: -1 }, currentLoad: 5, cpuLoadHistory: [] }),
    })

    expect(container.querySelectorAll('.widget-value')).toHaveLength(1)
  })

  it('seeds the chart from the history the server sends', async () => {
    await open({}, {
      arrange: () => io.socket.respondTo('get-server-cpu-info', { cpuTemperature: {}, currentLoad: 13, cpuLoadHistory: [10, 11, 12] }),
    })

    // The first reading fills the chart in one go, so the widget is not blank for the first minute
    expect(series()).toEqual([10, 11, 12])
  })

  it('asks for nothing when metrics monitoring is switched off', async () => {
    await open({}, { env: { disableServerMetricsMonitoring: true } })

    // Collecting these is expensive on a small Pi, so it can be turned off entirely on the server
    expect(screen.getByText('status.metrics.label_disabled')).toBeInTheDocument()
    expect(io.requests).toHaveLength(0)
    expect(chart.props).toBeUndefined()
  })

  it('reads the temperature units from the settings', async () => {
    const { container } = await open({}, {
      env: { temperatureUnits: 'f' },
      arrange: () => io.socket.respondTo('get-server-cpu-info', { cpuTemperature: { main: 100 }, currentLoad: 1, cpuLoadHistory: [] }),
    })

    expect(container.querySelectorAll('.widget-value')[1].textContent).toBe('212°F')
  })

  describe('the chart series', () => {
    async function openWithHistory(historyItems: number, history: number[], refreshInterval = 1) {
      vi.useFakeTimers()
      await open({ historyItems, refreshInterval }, {
        arrange: () => io.socket.respondTo('get-server-cpu-info', { cpuTemperature: {}, currentLoad: history.at(-1), cpuLoadHistory: history }),
      })
    }

    /** Let one poll go out and its answer come back. */
    async function tick(seconds = 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(seconds * 1000)
      })
    }

    it('appends a new reading to a series with room in it', async () => {
      await openWithHistory(5, [1, 2])
      nextReading(3)
      await tick()

      expect(series()).toEqual([1, 2, 3])
    })

    it('never grows past the configured history length', async () => {
      await openWithHistory(3, [1, 2, 3])
      nextReading(4)
      await tick()

      // Room is made before appending. Appending first and trimming after left
      // one extra point on every tick, so the chart slowly crushed itself
      expect(series()).toEqual([2, 3, 4])
    })

    it('stays at the limit over many readings', async () => {
      await openWithHistory(3, [1, 2, 3])
      for (const value of [4, 5, 6, 7, 8]) {
        nextReading(value)
        await tick()
      }

      expect(series()).toEqual([6, 7, 8])
      expect(chart.props.data.labels).toHaveLength(3)
    })

    it('trims a history longer than the configured length', async () => {
      await openWithHistory(3, [1, 2, 3, 4, 5])

      // The server keeps its own history, which may be longer than this widget has been asked to show
      expect(series()).toEqual([3, 4, 5])
    })

    it('defaults the refresh interval and history length', async () => {
      await open({ historyItems: 0 })

      expect(updateWidget).toHaveBeenCalledWith({ refreshInterval: 10, historyItems: 60 })
    })

    it('leaves settings it already has alone', async () => {
      await open({ historyItems: 30, refreshInterval: 5 })

      expect(updateWidget).not.toHaveBeenCalled()
    })

    it('clamps a refresh interval outside the allowed range', async () => {
      vi.useFakeTimers()
      await open({ refreshInterval: 0.1, historyItems: 500 }, {
        arrange: () => io.socket.respondTo('get-server-cpu-info', { cpuTemperature: {}, currentLoad: 0, cpuLoadHistory: Array.from({ length: 100 }, (_, i) => i) }),
      })
      // History clamped to 60
      expect(series()).toHaveLength(60)
      const before = io.requests.length
      await tick(1)
      // Polled at 1s, not every 100ms
      expect(io.requests.length).toBe(before + 1)
    })

    it('never polls slower than once a minute', async () => {
      vi.useFakeTimers()
      // A widget polling every millisecond would hammer the server; one never polling looks dead
      await open({ refreshInterval: 9000 })
      const before = io.requests.length

      await tick(60)

      expect(io.requests.length).toBe(before + 1)
    })

    it('polls on the interval it was given', async () => {
      await openWithHistory(60, [1], 5)
      const before = io.requests.length

      await tick(5)

      expect(io.requests.length).toBe(before + 1)
    })

    it('stops polling while the socket is down', async () => {
      await openWithHistory(60, [1], 5)
      io.socket.disconnect()
      const before = io.requests.length

      await tick(15)

      // Requests against a dead socket would never be answered anyway
      expect(io.requests.length).toBe(before)
    })

    it('stops polling once it is gone', async () => {
      vi.useFakeTimers()
      const { unmount } = await open({ refreshInterval: 5 })
      unmount()
      const before = io.requests.length

      await vi.advanceTimersByTimeAsync(15000)

      expect(io.requests.length).toBe(before)
      // ...and gives its reference on the namespace back
      expect(io.end).toHaveBeenCalled()
    })

    it('starts over when its settings change', async () => {
      await openWithHistory(5, [1, 2, 3], 60)
      expect(series()).toEqual([1, 2, 3])

      io.socket.respondTo('get-server-cpu-info', { cpuTemperature: {}, currentLoad: 9, cpuLoadHistory: [9] })
      await act(async () => {
        configureEvent.next()
      })

      // The old points were sampled at the old interval, so keeping them would
      // draw a chart whose x-axis means two different things
      expect(series()).toEqual([9])
    })
  })
})
