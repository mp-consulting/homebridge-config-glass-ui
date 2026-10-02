import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ws as realWs } from '@/core/ws'
import { humaniseDuration } from '@/modules/status/widgets/uptime-widget/humanise-duration'
import { UptimeWidget } from '@/modules/status/widgets/uptime-widget/UptimeWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

describe('humaniseDuration', () => {
  it.each([
    [0, '< 1m'],
    [49, '< 1m'],
    [50, '1m'],
    [59, '1m'],
    [90, '2m'],
    [3599, '60m'],
    [3600, '1h'],
    [86399, '24h'],
    [86400, '1d'],
    [200000, '2d'],
  ])('describes %i seconds as %s', (seconds, expected) => {
    expect(humaniseDuration(seconds)).toBe(expected)
  })

  it('switches away from "< 1m" at 50 seconds, not at 60', () => {
    // Rounding is what sets the boundary: 50s rounds up to 1m, so anything
    // below it would print "1m" while still being under a minute
    expect(humaniseDuration(49)).toBe('< 1m')
    expect(humaniseDuration(50)).toBe('1m')
  })

  it('rounds hours but truncates days', () => {
    // 90 minutes rounds up to 2h, while 1.9 days floors to 1d
    expect(humaniseDuration(5400)).toBe('2h')
    expect(humaniseDuration(164160)).toBe('1d')
  })
})

/**
 * ⚠️ **It polls, because uptime only ever goes up.** Nothing pushes it, so the
 * widget asks every eleven seconds — and only while the socket is up, or every
 * tick queues a request that resolves when the connection comes back and floods
 * the widget with stale answers.
 */
describe('the uptime widget', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace

  async function create(options: { connected?: boolean, uptime?: number, processUptime?: number } = {}) {
    ws.namespaces.clear()
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-server-uptime-info', {
      time: { uptime: options.uptime ?? 3600 },
      processUptime: options.processUptime ?? 60,
    })
    const props = {
      widget: { component: 'UptimeWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false },
      resizeEvent: createWidgetEvent(),
      configureEvent: createWidgetEvent(),
      updateWidget: vi.fn(),
      saveWidgets: vi.fn(),
    }
    const result = render(<UptimeWidget {...props} />)
    await act(async () => {})
    return result
  }

  const values = (container: HTMLElement) => [...container.querySelectorAll('.widget-value')].map(el => el.textContent)

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks for the uptime as soon as the socket is up', async () => {
    const { container } = await create()

    expect(io.requests.map(r => r.resource)).toEqual(['get-server-uptime-info'])
    expect(values(container)).toEqual(['1h', '1m'])
  })

  it('asks again every eleven seconds', async () => {
    await create()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000)
    })

    expect(io.requests).toHaveLength(2)
  })

  it('stops asking while the socket is down', async () => {
    // ⚠️ Otherwise every tick queues a request that all resolve at once when the connection returns
    await create()
    io.socket.connected = false

    await vi.advanceTimersByTimeAsync(33000)

    expect(io.requests).toHaveLength(1)
  })

  it('asks nothing at all before the socket connects', async () => {
    const { container } = await create({ connected: false })

    expect(io.requests).toEqual([])
    expect(container.querySelectorAll('.widget-value .fa-circle-notch')).toHaveLength(2)
  })

  it('catches up when the socket connects', async () => {
    await create({ connected: false })

    await act(async () => {
      io.markConnected()
    })

    expect(io.requests.map(r => r.resource)).toEqual(['get-server-uptime-info'])
  })

  it('stops asking once the widget is gone', async () => {
    const { unmount } = await create()

    unmount()
    await vi.advanceTimersByTimeAsync(33000)

    expect(io.requests).toHaveLength(1)
  })

  it.each([
    [0, '< 1m'],
    [49, '< 1m'],
    [50, '1m'],
    [90, '2m'],
    [3599, '60m'],
    [3600, '1h'],
    [86399, '24h'],
    [86400, '1d'],
    [172800, '2d'],
    [259199, '2d'],
  ])('shows %i seconds as %s', async (seconds, expected) => {
    // Rounded below a day and truncated above it: "2d" for anything in the third
    // day, because "3d" for two and a half days reads as wrong
    const { container } = await create({ uptime: seconds })

    expect(values(container)[0]).toBe(expected)
  })

  it('reports the two uptimes separately', async () => {
    // Homebridge restarting does not restart the machine, and the gap between the two is the useful part
    const { container } = await create({ uptime: 172800, processUptime: 120 })

    expect(values(container)).toEqual(['2d', '2m'])
  })
})
