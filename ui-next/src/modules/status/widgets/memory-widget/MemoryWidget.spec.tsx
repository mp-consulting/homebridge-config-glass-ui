import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/core/settings'
import { ws as realWs } from '@/core/ws'
import { MemoryWidget } from '@/modules/status/widgets/memory-widget/MemoryWidget'
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

const gb = 1024 * 1024 * 1024

describe('the memory widget', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace

  async function open(options: { env?: Record<string, any>, connected?: boolean, response?: any } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: options.env }))
    ws.namespaces.clear()
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-server-memory-info', options.response ?? { mem: { total: 1, available: 0 }, memoryUsageHistory: [] })
    const props = {
      widget: { component: 'MemoryWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, refreshInterval: 10, historyItems: 60 },
      resizeEvent: createWidgetEvent(),
      configureEvent: createWidgetEvent(),
      updateWidget: vi.fn(),
      saveWidgets: vi.fn(),
    }
    const result = render(<MemoryWidget {...props} />)
    await act(async () => {})
    return result
  }

  const values = (container: HTMLElement) => [...container.querySelectorAll('.widget-value')].map(el => el.textContent)

  beforeEach(() => {
    chart.props = undefined
  })

  it('shows the memory as unknown rather than zero before the first reading', async () => {
    const { container } = await open({ connected: false })

    expect(container.querySelectorAll('.widget-value .fa-circle-notch')).toHaveLength(2)
  })

  it('reports the memory in gigabytes', async () => {
    const { container } = await open({ response: { mem: { total: 8 * gb, available: 2.5 * gb }, memoryUsageHistory: [70, 75] } })

    expect(values(container)).toEqual(['8 GB', '2.5 GB'])
  })

  it('ignores a reading with no memory in it', async () => {
    const { container } = await open({ response: { memoryUsageHistory: [70] } })

    // Rather than dividing undefined and rendering NaN GB
    expect(container.querySelectorAll('.widget-value .fa-circle-notch')).toHaveLength(2)
    expect(chart.props.data.datasets[0].data).toEqual([])
  })

  it('charts the usage history, not the free memory', async () => {
    await open({ response: { mem: { total: 8 * gb, available: 2 * gb }, memoryUsageHistory: [70, 75, 80] } })

    expect(chart.props.data.datasets[0].data).toEqual([70, 75, 80])
  })

  it('asks for nothing when metrics monitoring is switched off', async () => {
    await open({ env: { disableServerMetricsMonitoring: true } })

    expect(screen.getByText('status.metrics.label_disabled')).toBeInTheDocument()
    expect(io.requests).toHaveLength(0)
  })
})
