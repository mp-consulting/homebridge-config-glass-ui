import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { ws as realWs } from '@/core/ws'
import { MatterQrcodeWidget } from '@/modules/status/widgets/matter-qrcode-widget/MatterQrcodeWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeAuthState } from '@/testing'

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

vi.mock('@/core/components/qrcode/QrCode', () => ({
  QrCode: ({ data }: { data: string }) => <div className="qrcode-container" data-testid="qrcode" data-data={data} />,
}))

describe('the matter pairing code', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace

  async function open(options: { pairing?: Record<string, any>, admin?: boolean } = {}) {
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    ws.namespaces.clear()
    io = ws.namespace('status')
    io.socket.respondTo('get-homebridge-pairing-pin', options.pairing ?? { pin: '031-45-154', paired: false, setupUri: 'X-HM://0024K0RR0TEST' })
    const result = render(
      <MatterQrcodeWidget
        widget={{ component: 'MatterQrcodeWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false }}
        resizeEvent={createWidgetEvent()}
        configureEvent={createWidgetEvent()}
        updateWidget={vi.fn()}
        saveWidgets={vi.fn()}
      />,
    )
    await act(async () => {})
    return result
  }

  const flushFrames = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  const pin = (container: HTMLElement) => container.querySelector('.pairing-pin')?.textContent ?? ''
  const pill = (container: HTMLElement) => container.querySelector('.pairing-status-pill')

  it('stays off when the status has no matter block', async () => {
    const { container } = await open()

    // Unlike HAP, Matter is off unless the server says otherwise
    expect(screen.getByText('status.services.matter_not_enabled')).toBeInTheDocument()
    expect(pin(container)).toBe('')
    expect(container.querySelector('.fa-circle-notch')).toBeNull()
  })

  it('shows the code when matter is enabled', async () => {
    const { container } = await open({ pairing: { matter: { enabled: true, pin: '1234-567-8901', setupUri: 'MT:TEST', commissioned: false } } })

    expect(pin(container)).toBe('1234-567-8901')
    expect(screen.getByTestId('qrcode')).toHaveAttribute('data-data', 'MT:TEST')
    expect(pill(container)).toHaveTextContent('status.widget.qr_unpaired')
    expect(container.querySelector('.pairing-card-title')).toHaveTextContent('Matter')
  })

  it('says it is commissioned once a controller has it', async () => {
    const { container } = await open({ pairing: { matter: { enabled: true, pin: '1234-567-8901', commissioned: true } } })

    expect(pill(container)).toHaveClass('is-paired')
  })

  it('keeps the last pin when an update omits it', async () => {
    const { container } = await open({ pairing: { matter: { enabled: true, pin: '1234-567-8901' } } })

    await act(async () => {
      io.socket.fire('homebridge-status', { matter: { enabled: true, commissioned: true } })
    })
    await flushFrames()

    // The pin does not change while the fabric exists, and blanking it would
    // make the widget look broken mid-commissioning
    expect(pin(container)).toBe('1234-567-8901')
    expect(pill(container)).toHaveClass('is-paired')
  })

  it('clears the code when matter is turned off', async () => {
    const { container } = await open({ pairing: { matter: { enabled: true, pin: '1234-567-8901', setupUri: 'MT:TEST', commissioned: true } } })

    await act(async () => {
      io.socket.fire('homebridge-status', { matter: { enabled: false } })
    })
    await flushFrames()

    expect(screen.queryByTestId('qrcode')).toBeNull()
    expect(pill(container)).toBeNull()
  })

  it('detaches its status listener when removed', async () => {
    const { unmount } = await open()

    unmount()

    expect(io.socket.handlers('homebridge-status')).toHaveLength(0)
  })

  it('tells a non-admin the code is admin-only and keeps the commissioning status', async () => {
    const { container } = await open({ admin: false, pairing: { paired: false, matter: { enabled: true, commissioned: true } } })
    await flushFrames()

    expect(pin(container)).toBe('')
    expect(screen.queryByTestId('qrcode')).toBeNull()
    const text = container.textContent
    expect(text).toContain('status.widget.pairing_admin_only')
    expect(text).toContain('status.widget.qr_paired')
  })
})
