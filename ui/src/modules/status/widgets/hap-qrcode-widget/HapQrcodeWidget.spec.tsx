import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { ws as realWs } from '@/core/ws'
import { HapQrcodeWidget } from '@/modules/status/widgets/hap-qrcode-widget/HapQrcodeWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeAuthState } from '@/testing'

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

// The QR code component draws an svg from a third-party library and has its own spec
vi.mock('@/core/components/qrcode/QrCode', () => ({
  QrCode: ({ data }: { data: string }) => <div className="qrcode-container" data-testid="qrcode" data-data={data} />,
}))

/**
 * The HAP pairing code. The thing that matters is not showing a code that
 * cannot work: a bridge with HAP switched off, or in externals-only mode, has no
 * bridge accessory to pair with, and a QR code there would send the user round
 * in circles in the Home app.
 */
describe('the hap pairing code', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace
  let resizeEvent: ReturnType<typeof createWidgetEvent>

  async function open(options: { connected?: boolean, pairing?: Record<string, any>, admin?: boolean } = {}) {
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    ws.namespaces.clear()
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-homebridge-pairing-pin', options.pairing ?? {
      pin: '031-45-154',
      paired: false,
      setupUri: 'X-HM://0024K0RR0TEST',
    })
    resizeEvent = createWidgetEvent()
    const result = render(
      <HapQrcodeWidget
        widget={{ component: 'HapQrcodeWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false }}
        resizeEvent={resizeEvent}
        configureEvent={createWidgetEvent()}
        updateWidget={vi.fn()}
        saveWidgets={vi.fn()}
      />,
    )
    await act(async () => {})
    return result
  }

  /** Let the pending frame callbacks run. */
  const flushFrames = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)))

  const pin = (container: HTMLElement) => container.querySelector('.pairing-pin')?.textContent ?? ''
  const pill = (container: HTMLElement) => container.querySelector('.pairing-status-pill')

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the pin and the setup code', async () => {
    const { container } = await open()
    await flushFrames()

    expect(pin(container)).toBe('031-45-154')
    expect(screen.getByTestId('qrcode')).toHaveAttribute('data-data', 'X-HM://0024K0RR0TEST')
    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(pill(container)).toHaveTextContent('status.widget.qr_unpaired')
    expect(screen.getByText('status.code_scan')).toBeInTheDocument()
  })

  it('treats a status with no hap block as hap being on', async () => {
    // Older Homebridge versions do not send the flag at all, and they always publish the bridge
    const { container } = await open({ pairing: { pin: '031-45-154', paired: false } })

    expect(pin(container)).toBe('031-45-154')
    expect(screen.queryByText('status.services.hap_not_enabled')).toBeNull()
    expect(screen.getByText('status.widget.pairing_waiting')).toBeInTheDocument()
  })

  it('hides the code when hap is switched off', async () => {
    // There is no bridge accessory to pair with, so a code here would simply never work
    const { container } = await open({ pairing: { pin: '031-45-154', paired: true, setupUri: 'X-HM://X', hap: { enabled: false } } })

    expect(screen.getByText('status.services.hap_not_enabled')).toBeInTheDocument()
    expect(pin(container)).toBe('')
    expect(screen.queryByTestId('qrcode')).toBeNull()
    expect(pill(container)).toBeNull()
  })

  it('hides the code in externals-only mode', async () => {
    // HAP is on and plugins still publish their own accessories, but the bridge itself is not advertised
    const { container } = await open({ pairing: { pin: '031-45-154', paired: false, setupUri: 'X-HM://X', hap: { enabled: true, externalsOnly: true } } })

    expect(screen.getByText('status.services.hap_externals_only')).toBeInTheDocument()
    expect(pin(container)).toBe('')
    expect(screen.queryByTestId('qrcode')).toBeNull()
  })

  it('says it is paired once the home app has it', async () => {
    const { container } = await open({ pairing: { pin: '031-45-154', paired: true, setupUri: 'X-HM://X' } })

    expect(pill(container)).toHaveClass('is-paired')
    expect(pill(container)).toHaveTextContent('status.widget.qr_paired')
    expect(screen.queryByText('status.code_scan')).toBeNull()
  })

  it('follows the live status when it changes', async () => {
    const { container } = await open()

    await act(async () => {
      io.socket.fire('homebridge-status', { pin: '031-45-154', paired: true, hap: { enabled: true } })
    })
    await flushFrames()

    // Pairing in the Home app changes this while the page is open
    expect(pill(container)).toHaveClass('is-paired')
  })

  it('asks for nothing until the socket connects', async () => {
    const { container } = await open({ connected: false })

    expect(io.requests).toHaveLength(0)
    expect(container.querySelector('.fa-circle-notch')).not.toBeNull()
  })

  it('detaches its status listener when removed', async () => {
    const { unmount } = await open()
    expect(io.socket.handlers('homebridge-status')).toHaveLength(1)

    unmount()

    // The status namespace is shared, so a widget switched off on the dashboard must stop listening
    expect(io.socket.handlers('homebridge-status')).toHaveLength(0)
  })

  it('tells a non-admin the code is admin-only and keeps the pairing status', async () => {
    // The server leaves the pin and setup code out for anyone who is not an admin
    const { container } = await open({ admin: false, pairing: { paired: true, hap: { enabled: true } } })
    await flushFrames()

    expect(pin(container)).toBe('')
    expect(screen.queryByTestId('qrcode')).toBeNull()
    const text = container.textContent
    expect(text).toContain('status.widget.pairing_admin_only')
    expect(text).toContain('status.widget.qr_paired')
    expect(text).not.toContain('status.widget.pairing_waiting')
  })

  it('copies the pin and confirms it for a moment', async () => {
    const { container } = await open()
    const button = container.querySelector('.pairing-pin-copy')!
    expect(button).toHaveAttribute('aria-label', 'status.widget.pairing_copy_code')

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(button)
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('031-45-154')
    expect(button).toHaveAttribute('aria-label', 'common.a11y.copied')
    expect(button.querySelector('i')).toHaveClass('fa-check')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(button).toHaveAttribute('aria-label', 'status.widget.pairing_copy_code')
  })

  it('sizes the code to the square above the pin on resize', async () => {
    const { container } = await open()
    const area = container.querySelector('.pairing-pin-area')!.parentElement!
    vi.spyOn(area, 'offsetHeight', 'get').mockReturnValue(300)
    vi.spyOn(area, 'offsetWidth', 'get').mockReturnValue(500)
    vi.spyOn(container.querySelector('.pairing-pin-area') as HTMLElement, 'offsetHeight', 'get').mockReturnValue(60)

    await act(async () => {
      resizeEvent.next()
    })

    expect(container.querySelector<HTMLElement>('.pairing-qr-area')!.style.height).toBe('240px')
    expect(container.querySelector<HTMLElement>('.pairing-qr-tile')!.style.width).toBe('240px')
  })
})
