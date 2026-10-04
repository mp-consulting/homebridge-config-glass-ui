import type { FakeApi, FakeOpenModal, FakeToast } from '@/testing'

import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { Confirm } from '@/core/components/confirm/Confirm'
import * as modalModule from '@/core/ui/modal'
import * as toastModule from '@/core/ui/toast'
import { fakeApi, makeAuthState, renderWithProviders } from '@/testing'

import { SceneEditor } from './SceneEditor'
import { ScenesPage } from './ScenesPage'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const evening = {
  id: '0123456789abcdef',
  name: 'Evening',
  actions: [{ uniqueId: 'lamp', characteristicType: 'On', value: true }],
  schedules: [{ cron: '0 19 * * *', enabled: true }],
}

describe('the scenes page', () => {
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  const modal = modalModule as unknown as FakeOpenModal
  let api: FakeApi

  async function open(admin = true) {
    useAuthStore.setState(makeAuthState({ user: { admin } }))
    const view = renderWithProviders(<ScenesPage />)
    await act(async () => {})
    return view
  }

  const row = (container: HTMLElement) => within(container.querySelector<HTMLElement>(`[data-scene="${evening.id}"]`)!)

  beforeEach(() => {
    api = fakeApi().respond('get', '/scenes', [evening])
    modal.opened.length = 0
    toast.shown.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('lists the scenes with their schedule', async () => {
    const { container } = await open()

    expect(row(container).getByText('Evening')).toBeInTheDocument()
    expect(container).toHaveTextContent('0 19 * * *')
  })

  it('runs a scene', async () => {
    api.respond('post', `/scenes/${evening.id}/run`, { sceneId: evening.id, ok: true, results: [] })
    const { container } = await open(false)

    await act(async () => {
      fireEvent.click(row(container).getByRole('button', { name: 'scenes.run' }))
    })

    expect(api.callsTo('post', `/scenes/${evening.id}/run`)).toHaveLength(1)
    expect(toast.at('success')).toHaveLength(1)
  })

  it('warns about the values a run could not set', async () => {
    api.respond('post', `/scenes/${evening.id}/run`, { sceneId: evening.id, ok: false, results: [{ uniqueId: 'lamp', characteristicType: 'On', value: true, ok: false, error: 'gone' }] })
    const { container } = await open()

    await act(async () => {
      fireEvent.click(row(container).getByRole('button', { name: 'scenes.run' }))
    })

    expect(toast.at('warning')[0].message).toBe('On: gone')
  })

  it('offers no management to a non-admin', async () => {
    const { container } = await open(false)

    expect(screen.queryByRole('button', { name: 'scenes.add' })).toBeNull()
    expect(row(container).queryByRole('button', { name: 'scenes.edit' })).toBeNull()
  })

  it('opens the editor to add and to edit', async () => {
    const { container } = await open()

    fireEvent.click(screen.getByRole('button', { name: /scenes.add/ }))
    expect(modal.lastOpened()?.component).toBe(SceneEditor)
    expect(modal.lastOpened()?.props?.scene).toBeUndefined()

    fireEvent.click(row(container).getByRole('button', { name: 'scenes.edit' }))
    expect(modal.lastOpened()?.props?.scene).toEqual(evening)
  })

  it('deletes a scene once confirmed', async () => {
    api.respond('delete', `/scenes/${evening.id}`, { ok: true })
    const { container } = await open()

    fireEvent.click(row(container).getByRole('button', { name: 'form.button_delete' }))
    expect(modal.lastOpened()?.component).toBe(Confirm)
    await act(async () => modal.lastOpened()!.ref.close())

    expect(api.callsTo('delete', `/scenes/${evening.id}`)).toHaveLength(1)
  })

  it('says so when there are none', async () => {
    api.respond('get', '/scenes', [])
    await open(false)

    expect(screen.getByText('scenes.none')).toBeInTheDocument()
  })
})
