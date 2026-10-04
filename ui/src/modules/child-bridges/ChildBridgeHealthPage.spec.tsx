import type { FakeApi, FakeToast } from '@/testing'

import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as toastModule from '@/core/ui/toast'
import { fakeApi, renderWithProviders } from '@/testing'

import { formatUptime } from './child-bridge-health'
import { ChildBridgeHealthPage } from './ChildBridgeHealthPage'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const healthy = {
  username: '0E:AA:BB:CC:DD:EE',
  name: 'Kitchen',
  plugin: 'homebridge-kitchen',
  identifier: 'kitchen',
  status: 'ok',
  manuallyStopped: false,
  upSince: '2026-10-04T10:00:00.000Z',
  uptime: 3_725,
  restartCount: 1,
  crashCount: 0,
  recentCrashes: 0,
  crashLoop: false,
  lastCrashAt: null,
}

const looping = {
  ...healthy,
  username: '0E:11:22:33:44:55',
  name: 'Garage',
  status: 'down',
  uptime: null,
  restartCount: 4,
  crashCount: 4,
  recentCrashes: 3,
  crashLoop: true,
}

describe('the child bridge health page', () => {
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  let api: FakeApi

  async function open(bridges: any[] = [healthy, looping]) {
    api.respond('get', '/status/homebridge/child-bridges/health', { crashLoop: { crashes: 3, windowMinutes: 10 }, bridges })
    const view = renderWithProviders(<ChildBridgeHealthPage />)
    await act(async () => {})
    return view
  }

  const row = (container: HTMLElement, username: string) => container.querySelector<HTMLElement>(`tr[data-username="${username}"]`)!

  beforeEach(() => {
    api = fakeApi()
    toast.shown.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows each bridge with its uptime, restarts and crashes', async () => {
    const { container } = await open()

    const kitchen = within(row(container, healthy.username))
    expect(kitchen.getByText('Kitchen')).toBeInTheDocument()
    expect(kitchen.getByText('child_bridge.health.status_ok')).toBeInTheDocument()
    expect(kitchen.getByText('1h 2m')).toBeInTheDocument()
  })

  it('flags a crash loop on the bridge and at the top of the page', async () => {
    const { container } = await open()

    expect(within(row(container, looping.username)).getByText('child_bridge.health.crash_loop')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('child_bridge.health.crash_loop_alert')
  })

  it('has no alert when nothing loops', async () => {
    await open([healthy])

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves the memory column out unless the server reports memory', async () => {
    await open([healthy])
    expect(screen.queryByText('child_bridge.health.memory')).toBeNull()
  })

  it('shows memory when the server reports it', async () => {
    const { container } = await open([{ ...healthy, memoryRss: 64 * 1024 * 1024 }])

    expect(screen.getByText('child_bridge.health.memory')).toBeInTheDocument()
    expect(within(row(container, healthy.username)).getByText('64 MB')).toBeInTheDocument()
  })

  it('says so when there are no child bridges', async () => {
    await open([])

    expect(screen.getByText('child_bridge.health.none')).toBeInTheDocument()
  })

  it('restarts a bridge by its device id', async () => {
    api.respond('put', /\/server\/restart\//, { ok: true })
    const { container } = await open()

    await act(async () => {
      fireEvent.click(within(row(container, healthy.username)).getByRole('button', { name: 'child_bridge.health.restart' }))
    })

    expect(api.callsTo('put', '/server/restart/0EAABBCCDDEE')).toHaveLength(1)
    expect(toast.at('success')).toHaveLength(1)
  })

  it('polls for fresh numbers', async () => {
    vi.useFakeTimers()
    await open()
    api.clearCalls()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(api.callsTo('get', '/status/homebridge/child-bridges/health')).toHaveLength(1)
  })

  it('formats uptimes with the two largest units', () => {
    expect(formatUptime(null)).toBe('—')
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(42)).toBe('42s')
    expect(formatUptime(90_061)).toBe('1d 1h')
    expect(formatUptime(3_600)).toBe('1h 0m')
  })
})
