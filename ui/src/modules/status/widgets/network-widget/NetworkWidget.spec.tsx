import type { FakeIoNamespace, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/core/settings'
import { ws as realWs } from '@/core/ws'
import { NetworkWidget } from '@/modules/status/widgets/network-widget/NetworkWidget'
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

const netResponse = {
  net: { iface: 'eth0', rx_sec: 1024 * 1024, tx_sec: 2 * 1024 * 1024 },
  point: 3,
  received: 1024 * 1024,
  sent: 2 * 1024 * 1024,
}

describe('the network widget', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace
  let updateWidget: Mock<(...args: any[]) => any>

  async function open(widget: Record<string, any> = {}, options: { connected?: boolean, response?: any } = {}) {
    useSettingsStore.setState(makeSettingsState())
    ws.namespaces.clear()
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-server-network-info', options.response ?? netResponse)
    updateWidget = vi.fn()
    const props = {
      widget: { component: 'NetworkWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, refreshInterval: 1, historyItems: 60, ...widget },
      resizeEvent: createWidgetEvent(),
      configureEvent: createWidgetEvent(),
      updateWidget,
      saveWidgets: vi.fn(),
    }
    const result = render(<NetworkWidget {...props} />)
    await act(async () => {})
    return result
  }

  const values = (container: HTMLElement) => [...container.querySelectorAll('.widget-value')].map(el => el.textContent)
  const series = () => chart.props.data.datasets[0].data
  const sentSeries = () => chart.props.data.datasets[1].data

  beforeEach(() => {
    chart.props = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the network rates as unknown rather than zero before the first reading', async () => {
    const { container } = await open({}, { connected: false })

    expect(container.querySelectorAll('.widget-value .fa-circle-notch')).toHaveLength(2)
  })

  it('asks about the interface the widget is configured for', async () => {
    await open({ networkInterface: 'wlan0' })

    expect(io.requests[0]).toEqual({
      resource: 'get-server-network-info',
      payload: { netInterfaces: ['wlan0'], interval: 1 },
    })
  })

  it('tells the server how often it polls, so the sampler keeps up', async () => {
    await open({ refreshInterval: 3 })

    expect(io.requests[0].payload).toEqual({ netInterfaces: [undefined], interval: 3 })
  })

  it('reports the rates in megabits per second', async () => {
    const { container } = await open()

    // The server reports bytes per second; the widget shows bits
    expect(values(container)).toEqual(['8 Mb/s', '16 Mb/s'])
  })

  it('remembers the interface the server chose', async () => {
    await open()

    // Asked with no interface, the server picks the default one, and the widget
    // stores it so the settings modal has something to show
    expect(updateWidget).toHaveBeenCalledWith({ networkInterface: 'eth0' })
  })

  it('names the interface in its title', async () => {
    const { container } = await open({ networkInterface: 'eth0' })

    expect(container.querySelector('.drag-handler')!.textContent).toBe('status.network.title_network (eth0)')
    expect(updateWidget).not.toHaveBeenCalled()
  })

  it('shows the rates in bytes when the widget is set to bytes', async () => {
    const { container } = await open({ networkUnit: 'bytes' })

    expect(values(container)).toEqual(['1 MB/s', '2 MB/s'])
  })

  it('scales the rate to the unit that fits', async () => {
    const { container } = await open({}, { response: { net: { iface: 'eth0', rx_sec: 0, tx_sec: 0 }, point: 0, received: 128, sent: 3 * 1024 ** 3 } })

    expect(values(container)).toEqual(['1 Kb/s', '24 Gb/s'])
  })

  it('falls back to rx_sec / tx_sec from an older server', async () => {
    const { container } = await open({}, { response: { net: { iface: 'eth0', rx_sec: 1024 * 1024, tx_sec: 0 }, point: 1 } })

    expect(values(container)).toEqual(['8 Mb/s', '0 b/s'])
  })

  it('charts received above the axis and sent mirrored below it', async () => {
    await open()

    expect(series()).toEqual([1024 * 1024])
    expect(sentSeries()).toEqual([-2 * 1024 * 1024])
    expect(chart.props.data.datasets.map((d: any) => d.label)).toEqual(['status.network.received_per_second', 'status.network.sent_per_second'])
  })

  it('clears both series when the interface changes', async () => {
    vi.useFakeTimers()
    await open()

    io.socket.respondTo('get-server-network-info', { net: { iface: 'wlan0', rx_sec: 0, tx_sec: 0 }, point: 0, received: 5, sent: 7 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    // Throughput on a different adapter is a different series entirely
    expect(updateWidget).toHaveBeenLastCalledWith({ networkInterface: 'wlan0' })
    expect(series()).toEqual([5])
    expect(sentSeries()).toEqual([-7])
  })

  it('appends readings on the same interface', async () => {
    vi.useFakeTimers()
    await open()
    io.socket.respondTo('get-server-network-info', { ...netResponse, received: 3, sent: 4 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(series()).toEqual([1024 * 1024, 3])
    expect(sentSeries()).toEqual([-2 * 1024 * 1024, -4])
  })
})
