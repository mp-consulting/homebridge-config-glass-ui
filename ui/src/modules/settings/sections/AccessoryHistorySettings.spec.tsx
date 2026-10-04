import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessoryHistorySettings } from '@/modules/settings/sections/AccessoryHistorySettings'
import { SettingsPageContext } from '@/modules/settings/settings-page.context'
import { createSettingsPage } from '@/modules/settings/settings-page.store'
import { fakeApi, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

describe('the accessory history settings', () => {
  let api: FakeApi

  async function render(stored: unknown = null) {
    api.respond('get', '/config-editor/ui/accessoryHistory', stored)
    const page = createSettingsPage({ navigate: () => {}, isPwa: false })
    renderWithProviders(
      <SettingsPageContext value={page}>
        <ul><AccessoryHistorySettings /></ul>
      </SettingsPageContext>,
    )
    await act(async () => {})
  }

  beforeEach(() => {
    api = fakeApi().respond('patch', '/config-editor/ui', {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is on with a week of history by default', async () => {
    await render()

    expect(screen.getByLabelText<HTMLInputElement>('settings.accessory.history').checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('settings.accessory.history_retention').value).toBe('7')
  })

  it('saves the switch at once', async () => {
    await render({ enabled: true, retentionDays: 30 })

    await act(async () => {
      fireEvent.click(screen.getByLabelText('settings.accessory.history'))
    })

    expect(api.callsTo('patch', '/config-editor/ui')[0].body).toEqual({ 'accessoryHistory.enabled': false })
    expect(screen.queryByLabelText('settings.accessory.history_retention')).toBeNull()
  })

  it('saves a valid retention once typing settles, and ignores an invalid one', async () => {
    vi.useFakeTimers()
    await render()

    fireEvent.change(screen.getByLabelText('settings.accessory.history_retention'), { target: { value: '0' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(api.callsTo('patch')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('settings.accessory.history_retention'), { target: { value: '14' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(api.callsTo('patch', '/config-editor/ui')[0].body).toEqual({ 'accessoryHistory.retentionDays': 14 })
  })
})
