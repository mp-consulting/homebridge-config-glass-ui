import type { FakeApi, FakeOpenModal, FakeToast } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Confirm } from '@/core/components/confirm/Confirm'
import * as modalModule from '@/core/ui/modal'
import * as toastModule from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'
import { activeModalStub, fakeApi, renderWithProviders } from '@/testing'

import { ConfigRestore } from './ConfigRestore'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

/**
 * The list of config.json backups the editor's restore button opens. It never
 * writes anything itself: picking a backup closes with its id, and the editor
 * loads it into a diff for the user to save.
 */
describe('config restore', () => {
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  const modal = modalModule as unknown as FakeOpenModal
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>

  const backups = [
    { id: '1001', timestamp: '2026-08-16T02:00:00.000Z', file: 'config.json.1001' },
    { id: '1002', timestamp: '2026-08-15T02:00:00.000Z', file: 'config.json.1002' },
  ]

  async function open(props: { fromSettings?: boolean } = {}) {
    const result = renderWithProviders(
      <ConfigRestore activeModal={{ ...activeModal, update: vi.fn() }} currentConfig={'{ "current": true }'} {...props} />,
      { route: '/config' },
    )
    await act(async () => {})
    return result
  }

  async function click(element: HTMLElement) {
    await act(async () => {
      fireEvent.click(element)
    })
  }

  beforeEach(() => {
    api = fakeApi().respond('get', '/config-editor/backups', backups)
    activeModal = activeModalStub()
    toast.shown.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the backups', async () => {
    await open()

    expect(screen.getAllByRole('button', { name: 'config.restore.copy_to_editor' })).toHaveLength(2)
  })

  it('closes with the id of the backup to load', async () => {
    await open()

    await click(screen.getAllByRole('button', { name: 'config.restore.copy_to_editor' })[1])

    expect(activeModal.close).toHaveBeenCalledWith('1002')
  })

  it('gives up, with a toast, when the list cannot be read', async () => {
    api.fail('get', '/config-editor/backups', { status: 500, error: { message: 'no backups dir' } })
    await open()

    expect(toast.at('error')[0].message).toBe('no backups dir')
    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
  })

  it('goes back to the settings page when it was opened from there', async () => {
    const { router } = await open({ fromSettings: true })

    await click(screen.getAllByRole('button', { name: 'form.button_close' })[1])

    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('stays put when it was opened from the editor', async () => {
    const { router } = await open()

    await click(screen.getAllByRole('button', { name: 'form.button_close' })[0])

    expect(router.state.location.pathname).toBe('/config')
  })

  it('downloads a backup as formatted json', async () => {
    const saveAs = vi.spyOn(fileSaver, 'saveAs').mockImplementation(() => {})
    api.respond('get', '/config-editor/backups/1001', { bridge: { name: 'Old' } })
    await open()

    await click(screen.getAllByRole('button', { name: 'form.button_download' })[1])

    const [blob, name] = saveAs.mock.calls[0] as [Blob, string]
    expect(name).toBe('config-backup-1001.json')
    expect(await blob.text()).toBe('{\n    "bridge": {\n        "name": "Old"\n    }\n}')
  })

  it('downloads the config on screen as config.json', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await open()

    await click(screen.getAllByRole('button', { name: 'form.button_download' })[0])

    const anchor = anchorClick.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.getAttribute('download')).toBe('config.json')
    expect(anchor.getAttribute('href')).toBe(`data:text/json;charset=utf-8,${encodeURIComponent('{ "current": true }')}`)
    // Added for firefox and taken out again
    expect(document.body.contains(anchor)).toBe(false)
  })

  it('deletes one and reloads the list', async () => {
    await open()
    api.clearCalls()

    await click(screen.getAllByRole('button', { name: 'form.button_delete' })[0])

    expect(api.callsTo('delete', '/config-editor/backups/1001')).toHaveLength(1)
    expect(api.callsTo('get', '/config-editor/backups')).toHaveLength(1)
  })

  it('deletes them all once confirmed', async () => {
    await open()

    await click(screen.getByRole('button', { name: 'form.button_delete_all' }))

    // Every backup goes at once, and there is no undo
    expect(modal.lastOpened()?.component).toBe(Confirm)
    expect(modal.lastOpened()?.props?.confirmButtonClass).toBe('btn-danger')
    expect(api.callsTo('delete', '/config-editor/backups')).toHaveLength(0)

    await act(async () => modal.lastOpened()!.ref.close())

    expect(api.callsTo('delete', '/config-editor/backups')).toHaveLength(1)
    expect(toast.at('success')[0].message).toBe('config.restore.toast_backups_deleted')
    expect(screen.queryByRole('button', { name: 'config.restore.copy_to_editor' })).toBeNull()
  })

  it('keeps them all when the delete all is called off', async () => {
    await open()

    await click(screen.getByRole('button', { name: 'form.button_delete_all' }))
    await act(async () => modal.lastOpened()!.ref.dismiss('Dismiss'))

    expect(api.callsTo('delete', '/config-editor/backups')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'config.restore.copy_to_editor' })).toHaveLength(2)
  })

  it('clears the deleting marker when a delete fails', async () => {
    api.fail('delete', '/config-editor/backups/1001', { status: 500 })
    const { container } = await open()

    await click(screen.getAllByRole('button', { name: 'form.button_delete' })[0])

    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(toast.at('error')).toHaveLength(1)
  })
})
