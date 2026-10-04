import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { webPush } from '@/core/pwa/web-push'
import { fakeApi, renderWithProviders } from '@/testing'

import { BrowserPushSettings } from './BrowserPushSettings'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const STATE = {
  publicKey: 'BKEY',
  subscriptions: [{ id: 'abc', label: 'Firefox on Linux', createdAt: '2026-10-01T00:00:00Z', service: 'push.example.com' }],
}

describe('the browser notification settings', () => {
  let api: FakeApi

  async function open(unavailable: ReturnType<typeof import('@/core/pwa/web-push').pushUnavailableReason> = null) {
    api.respond('get', '/notifications/web-push', STATE)
    renderWithProviders(<BrowserPushSettings deps={{ unavailable: () => unavailable }} />)
    await act(async () => {})
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    api = fakeApi()
    vi.spyOn(webPush, 'currentSubscription').mockResolvedValue(null)
  })

  it('lists the subscribed devices and removes one', async () => {
    await open()
    expect(screen.getByText('Firefox on Linux')).toBeInTheDocument()

    api.respond('delete', '/notifications/web-push/subscriptions/abc', { removed: true })
    fireEvent.click(screen.getByRole('button', { name: 'settings.notifications.browser_remove' }))
    await act(async () => {})

    expect(api.callsTo('delete')[0].url).toBe('/notifications/web-push/subscriptions/abc')
  })

  it('turns notifications on for this device with the server\'s key', async () => {
    const subscribe = vi.spyOn(webPush, 'subscribeThisDevice').mockResolvedValue(true)
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'settings.notifications.browser_enable_here' }))
    await act(async () => {})

    expect(subscribe).toHaveBeenCalledWith('BKEY')
  })

  it('says why this browser cannot, instead of the button', async () => {
    await open('insecure')

    expect(screen.getByRole('status')).toHaveTextContent('settings.notifications.browser_insecure')
    expect(screen.queryByRole('button', { name: 'settings.notifications.browser_enable_here' })).toBeNull()
  })
})
