import type { FakeApi } from '@/testing'

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessoryHistoryWidget } from '@/modules/status/widgets/accessory-history-widget/AccessoryHistoryWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { fakeApi } from '@/testing'

const chart = vi.hoisted(() => ({ props: undefined as any }))

// jsdom has no canvas: the chart only records what it was given
vi.mock('react-chartjs-2', () => ({
  Line: (props: any) => {
    chart.props = props
    return <canvas />
  },
}))

const T0 = Date.parse('2026-10-04T10:00:00Z')

describe('the accessory history widget', () => {
  let api: FakeApi

  async function open(widget: Record<string, any> = {}) {
    const props = {
      widget: { component: 'AccessoryHistoryWidgetComponent', x: 0, y: 0, cols: 5, rows: 5, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, ...widget },
      resizeEvent: createWidgetEvent(),
      configureEvent: createWidgetEvent(),
      updateWidget: vi.fn(),
      saveWidgets: vi.fn(),
    }
    const view = render(<AccessoryHistoryWidget {...props} />)
    await act(async () => {})
    return view
  }

  beforeEach(() => {
    chart.props = undefined
    api = fakeApi().respond('get', /\/accessories\/abc\/history/, {
      uniqueId: 'abc',
      from: T0,
      to: T0 + 3_600_000,
      series: [{ type: 'CurrentTemperature', unit: 'celsius', points: [[T0, 20], [T0 + 60_000, 22.5], [T0 + 120_000, 21]] }],
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('asks to be configured until an accessory is chosen', async () => {
    await open()

    expect(screen.getByText('status.widget.history.not_configured')).toBeInTheDocument()
    expect(api.callsTo('get')).toHaveLength(0)
  })

  it('charts the chosen characteristic over the chosen hours', async () => {
    await open({ historyAccessory: 'abc', historyType: 'CurrentTemperature', historyHours: 72, historyLabel: 'Kitchen - Temperature' })

    expect(api.callsTo('get')[0].url).toContain('/accessories/abc/history?hours=72&type=CurrentTemperature')
    expect(chart.props.data.datasets[0].data).toEqual([20, 22.5, 21])
    expect(screen.getByText('status.widget.history.title (Kitchen - Temperature)')).toBeInTheDocument()
    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('22.5°C')).toBeInTheDocument()
  })

  it('says so when nothing was recorded', async () => {
    api.respond('get', /\/accessories\/abc\/history/, { uniqueId: 'abc', from: 0, to: 0, series: [] })
    await open({ historyAccessory: 'abc', historyType: 'CurrentTemperature' })

    expect(screen.getByText('status.widget.history.no_data')).toBeInTheDocument()
  })

  it('refreshes every minute', async () => {
    vi.useFakeTimers()
    await open({ historyAccessory: 'abc', historyType: 'CurrentTemperature' })
    api.clearCalls()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(api.callsTo('get')).toHaveLength(1)
  })
})
