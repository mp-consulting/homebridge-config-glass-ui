import type { FakeApi } from '@/testing'

import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { fakeApi, makeAuthState, renderWithProviders } from '@/testing'

import { AccessoryHistoryNotice } from './AccessoryHistoryNotice'

const BASE = { enabled: true, insecureMode: true, recording: true, reason: null, retentionDays: 7 }

describe('the accessory history notice', () => {
  let api: FakeApi

  async function show(status: object, props: { showDisabled?: boolean } = {}) {
    api.respond('get', '/accessories/history/status', { ...BASE, ...status })
    const view = renderWithProviders(<AccessoryHistoryNotice {...props} />)
    await act(async () => {})
    return view
  }

  beforeEach(() => {
    api = fakeApi()
    useAuthStore.setState(makeAuthState())
  })

  it('says insecure mode is needed, with a link to the setting for admins', async () => {
    await show({ insecureMode: false, recording: false, reason: 'insecureModeRequired' })

    expect(screen.getByRole('status')).toHaveTextContent('accessories.history.notice_insecure')
    expect(screen.getByRole('link', { name: 'accessories.history.notice_open_setting' })).toHaveAttribute('href', '/settings?section=startup')
  })

  it('leaves the link out for non-admins', async () => {
    useAuthStore.setState(makeAuthState({ user: { admin: false } }))
    await show({ insecureMode: false, recording: false, reason: 'insecureModeRequired' })

    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says why the recorder could not attach', async () => {
    await show({ recording: false, reason: 'error', error: 'boom' })

    expect(screen.getByRole('status')).toHaveTextContent('accessories.history.notice_error')
  })

  it('renders nothing while recording, starting, or switched off unless asked', async () => {
    const { container, unmount } = await show({})
    expect(container).toBeEmptyDOMElement()
    unmount()

    const starting = await show({ recording: false, reason: 'starting' })
    expect(starting.container).toBeEmptyDOMElement()
    starting.unmount()

    const off = await show({ enabled: false, recording: false, reason: 'disabled' })
    expect(off.container).toBeEmptyDOMElement()
    off.unmount()

    await show({ enabled: false, recording: false, reason: 'disabled' }, { showDisabled: true })
    expect(screen.getByRole('status')).toHaveTextContent('accessories.history.notice_disabled')
  })
})
