import type { FakeApi, FakeToast } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiActions } from '@/core/ai/ai.store'
import * as toastModule from '@/core/ui/toast'
import { NotificationsSection } from '@/modules/settings/sections/NotificationsSection'
import { SettingsPageContext } from '@/modules/settings/settings-page.context'
import { createSettingsPage } from '@/modules/settings/settings-page.store'
import { fakeApi, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

function stored() {
  return {
    channels: {
      webhook: { enabled: false, url: '' },
      ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '', token: '' },
      pushover: { enabled: false, userKey: '', appToken: '' },
      telegram: { enabled: true, botToken: '********', chatId: '-100123' },
    },
    events: { homebridgeDown: true, homebridgeUp: true, childBridgeCrashLoop: true, updatesAvailable: true, backupFailed: true, dailyDigest: false },
    dailyDigestTime: '08:00',
  }
}

describe('the notifications settings', () => {
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  let api: FakeApi

  async function render() {
    const page = createSettingsPage({ navigate: () => {}, isPwa: false })
    const view = renderWithProviders(
      <SettingsPageContext value={page}>
        <NotificationsSection />
      </SettingsPageContext>,
    )
    await act(async () => {})
    return view
  }

  beforeEach(() => {
    api = fakeApi().respond('get', '/notifications/settings', stored())
    toast.shown.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    aiActions.reset()
  })

  it('shows a stored secret only as the placeholder, in a password box', async () => {
    await render()

    const token = screen.getByLabelText<HTMLInputElement>('settings.notifications.telegram_token')
    expect(token.type).toBe('password')
    expect(token.value).toBe('********')
    expect(screen.getByLabelText<HTMLInputElement>('settings.notifications.telegram_chat').value).toBe('-100123')
  })

  it('shows a channel\'s fields once it is switched on, and saves on the button', async () => {
    api.respond('put', '/notifications/settings', (call: any) => call.body)
    await render()
    expect(screen.queryByLabelText('settings.notifications.ntfy_topic')).toBeNull()

    fireEvent.click(screen.getByLabelText('ntfy common.labels.enabled'))
    fireEvent.change(screen.getByLabelText('settings.notifications.ntfy_topic'), { target: { value: 'alerts' } })
    fireEvent.click(screen.getByLabelText('settings.notifications.event_updates'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })

    const [call] = api.callsTo('put', '/notifications/settings')
    expect(call.body.channels.ntfy).toMatchObject({ enabled: true, topic: 'alerts' })
    // The untouched secret goes back as the placeholder, which keeps it
    expect(call.body.channels.telegram.botToken).toBe('********')
    expect(call.body.events.updatesAvailable).toBe(false)
    expect(toast.at('success')).toHaveLength(1)
  })

  it('sends a test to a channel and reports each result', async () => {
    api.respond('post', '/notifications/test', [{ channel: 'telegram', ok: false, error: 'HTTP 401' }])
    await render()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'settings.notifications.send_test' })[3])
    })

    expect(api.callsTo('post', '/notifications/test')[0].body).toEqual({ channel: 'telegram' })
    expect(toast.at('error')[0].message).toBe('Telegram: HTTP 401')
  })

  it('asks for a save before a test once something changed', async () => {
    await render()

    fireEvent.change(screen.getByLabelText('settings.notifications.telegram_chat'), { target: { value: '-1009' } })

    expect(screen.getAllByRole('button', { name: 'settings.notifications.send_test' })[3]).toBeDisabled()
  })

  it('asks for the digest time once the daily digest is switched on, and saves it', async () => {
    api.respond('put', '/notifications/settings', (call: any) => call.body)
    await render()
    expect(screen.queryByLabelText('settings.notifications.digest_time')).toBeNull()

    fireEvent.click(screen.getByLabelText('settings.notifications.event_daily_digest'))
    const time = screen.getByLabelText<HTMLInputElement>('settings.notifications.digest_time')
    expect(time.value).toBe('08:00')
    fireEvent.change(time, { target: { value: '07:15' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })

    const [call] = api.callsTo('put', '/notifications/settings')
    expect(call.body.events.dailyDigest).toBe(true)
    expect(call.body.dailyDigestTime).toBe('07:15')
  })

  it('will not save an empty digest time', async () => {
    await render()
    fireEvent.click(screen.getByLabelText('settings.notifications.event_daily_digest'))
    fireEvent.change(screen.getByLabelText('settings.notifications.digest_time'), { target: { value: '' } })

    expect(screen.getByLabelText('settings.notifications.digest_time')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'form.button_save' })).toBeDisabled()
  })

  it('says the digest needs the Assistant while it is off', async () => {
    await render()
    fireEvent.click(screen.getByLabelText('settings.notifications.event_daily_digest'))
    expect(screen.getByTestId('notifications-needs-assistant')).toHaveTextContent('settings.notifications.needs_assistant')

    act(() => aiActions.setStatus({ enabled: true } as any))
    expect(screen.queryByTestId('notifications-needs-assistant')).toBeNull()
  })
})
