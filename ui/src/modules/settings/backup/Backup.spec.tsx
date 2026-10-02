import type { EnvInterface } from '@/core/interfaces/settings.interfaces'
import type { FakeApi, FakeOpenModal, FakeToast } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsActions, useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import * as toastModule from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'
import { Backup } from '@/modules/settings/backup/Backup'
import { Restore } from '@/modules/settings/backup/restore/Restore'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/**
 * The backup modal: download a backup now, manage the scheduled ones, and hand
 * over to the restore modal.
 *
 * The scheduled-backup switches write straight to config.json through a
 * debounce, which is the part worth pinning - the debounce exists so typing a
 * path does not write a file per keystroke, and it is easy to lose in a
 * refactor without anything looking broken.
 */
describe('backup', () => {
  const modal = modalModule as unknown as FakeOpenModal
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  let api: FakeApi
  let saveAs: ReturnType<typeof vi.spyOn>
  let showRestartToast: ReturnType<typeof vi.spyOn>
  let activeModal: ReturnType<typeof activeModalStub>

  const scheduledBackups = [
    { id: 'backup-1', fileName: 'homebridge-backup-1.tar.gz', timestamp: '2026-08-16T02:00:00.000Z', size: 1.2 },
    { id: 'backup-2', fileName: 'homebridge-backup-2.tar.gz', timestamp: '2026-08-15T02:00:00.000Z', size: 1.1 },
  ]

  /**
   * A blob response of a claimed size, as the download endpoints return.
   * @param size - the size to report in bytes
   * @param fileName - the value of the File-Name header, if any
   */
  function blobResponse(size: number, fileName?: string) {
    return {
      body: { size },
      headers: { get: (name: string) => (name === 'File-Name' ? fileName ?? null : null) },
    }
  }

  function configure(env: Partial<EnvInterface> = {}) {
    useSettingsStore.setState(makeSettingsState({ env }))
  }

  /** Render the modal and let its two initial reads settle. */
  async function open() {
    const result = renderWithProviders(<Backup activeModal={{ ...activeModal, update: vi.fn() }} />)
    await act(async () => {})
    return result
  }

  function button(label: string, index = 0): HTMLButtonElement {
    return screen.getAllByRole('button', { name: label })[index] as HTMLButtonElement
  }

  /** The download button for a fresh backup (the first one with that label). */
  const downloadNowButton = () => button('form.button_download', 0)
  /** The "backup now" (save on the server) button. */
  const createNowButton = () => button('backup.backup_now', 0)

  async function click(element: HTMLElement) {
    await act(async () => {
      fireEvent.click(element)
    })
  }

  beforeEach(() => {
    api = fakeApi()
      .respond('get', '/backup/scheduled-backups', scheduledBackups)
      .respond('get', '/backup/scheduled-backups/next', { next: '2026-08-18T02:00:00.000Z' })
    configure()
    activeModal = activeModalStub()
    modal.opened.length = 0
    modal.openModal.mockClear()
    toast.shown.length = 0
    saveAs = vi.spyOn(fileSaver, 'saveAs').mockImplementation(() => {})
    showRestartToast = vi.spyOn(settingsActions, 'showRestartToast').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('opening the modal', () => {
    it('lists the scheduled backups and when the next one is due', async () => {
      const { container } = await open()

      expect(container.querySelectorAll('.list-group-box')[1].querySelectorAll('.list-group-item')).toHaveLength(3)
      expect(screen.getByText('backup.scheduled_backup_time')).toBeInTheDocument()
    })

    it('shows the schedule as enabled when it is not disabled', async () => {
      const { container } = await open()

      // The config key is a negative (`scheduledBackupDisable`) and the switch
      // is a positive, so this reads inverted on purpose
      expect(container.querySelector<HTMLInputElement>('#disableScheduledBackups')!.checked).toBe(true)
    })

    it('shows the schedule as disabled when the config turns it off', async () => {
      configure({ scheduledBackupDisable: true })
      const { container } = await open()

      expect(container.querySelector<HTMLInputElement>('#disableScheduledBackups')!.checked).toBe(false)
    })

    it('prefills the configured backup path', async () => {
      configure({ scheduledBackupPath: '/mnt/nas/backups' })
      await open()

      expect(screen.getByRole('textbox', { name: 'backup.settings_path' })).toHaveValue('/mnt/nas/backups')
    })

    it('stays usable when the backup list cannot be read', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('get', '/backup/scheduled-backups', new Error('offline'))
      const { container } = await open()

      // Only the list is missing; downloading a fresh backup still works, so
      // this failure is logged rather than shown
      expect(container.querySelectorAll('.list-group-box')).toHaveLength(1)
      expect(toast.at('error')).toHaveLength(0)
    })
  })

  describe('downloading a backup now', () => {
    it('asks for the archive as a blob', async () => {
      api.respond('get', '/backup/download', blobResponse(1024, 'my-backup.tar.gz'))
      await open()

      await click(downloadNowButton())

      expect(api.lastCall('get', '/backup/download')?.options).toEqual({
        observe: 'response',
        responseType: 'blob',
      })
      expect(saveAs).toHaveBeenCalledWith({ size: 1024 }, 'my-backup.tar.gz')
    })

    it('falls back to a default file name', async () => {
      api.respond('get', '/backup/download', blobResponse(1024))
      await open()

      await click(downloadNowButton())

      expect(saveAs.mock.calls[0][1]).toBe('homebridge-backup.tar.gz')
    })

    it('warns about an archive too big to restore, but still saves it', async () => {
      api.respond('get', '/backup/download', blobResponse(globalThis.backup.maxBackupSize + 1, 'huge.tar.gz'))
      await open()

      await click(downloadNowButton())

      // The upload limit only applies to restoring it again through the UI, so
      // the user still gets the file - they just need to know
      expect(toast.at('warning')).toHaveLength(1)
      expect(saveAs).toHaveBeenCalled()
    })

    it('re-enables the button when the download fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('get', '/backup/download', new Error('offline'))
      await open()

      await click(downloadNowButton())

      expect(downloadNowButton()).not.toBeDisabled()
      expect(toast.at('error')).toHaveLength(1)
    })
  })

  describe('the scheduled backups list', () => {
    it('downloads one by id', async () => {
      api.respond('get', '/backup/scheduled-backups/backup-1', blobResponse(1024))
      await open()

      await click(button('form.button_download', 1))

      expect(saveAs).toHaveBeenCalledWith({ size: 1024 }, 'homebridge-backup-1.tar.gz')
    })

    it('tells the user when one cannot be downloaded', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('get', '/backup/scheduled-backups/backup-1', new Error('gone'))
      await open()

      await click(button('form.button_download', 1))

      expect(toast.at('error')[0].message).toBe('backup.backup_download_failed')
      expect(saveAs).not.toHaveBeenCalled()
    })

    it('deletes one and reloads the list', async () => {
      await open()
      api.clearCalls()

      await click(button('form.button_delete', 0))

      expect(api.callsTo('delete', '/backup/scheduled-backups/backup-1')).toHaveLength(1)
      expect(api.callsTo('get', '/backup/scheduled-backups')).toHaveLength(1)
    })

    it('clears the deleting marker even when the delete fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('delete', '/backup/scheduled-backups/backup-1', new Error('read only'))
      const { container } = await open()

      await click(button('form.button_delete', 0))

      // Otherwise that one row keeps its spinner for as long as the modal is open
      expect(container.querySelector('.fa-circle-notch')).toBeNull()
      expect(button('form.button_delete', 0)).not.toBeDisabled()
      expect(toast.at('error')[0].message).toBe('backup.backup_delete_failed')
    })

    it('creates a backup on demand and reloads the list', async () => {
      await open()
      api.clearCalls()

      await click(createNowButton())

      expect(api.lastCall('post', '/backup')?.body).toEqual({})
      expect(api.callsTo('get', '/backup/scheduled-backups')).toHaveLength(1)
      expect(createNowButton()).not.toBeDisabled()
    })
  })

  describe('handing over to the restore modal', () => {
    it('closes itself first, then opens restore', async () => {
      await open()

      await click(button('form.button_restore', 0))

      // Both are `size: 'lg'` modals; leaving this one open would stack them
      expect(activeModal.close).toHaveBeenCalled()
      expect(modal.lastOpened()?.component).toBe(Restore)
    })

    it('passes the chosen backup through the modal props', async () => {
      await open()

      await click(button('form.button_restore', 1))

      expect(modal.propsFor()?.selectedBackup).toEqual(scheduledBackups[1])
    })

    it('passes nothing when the user wants to upload their own file', async () => {
      await open()

      await click(button('backup.restore_now'))

      // Restore switches between "restore this scheduled backup" and "upload an
      // archive" purely on whether this is null
      expect(modal.propsFor()?.selectedBackup).toBeNull()
    })

    it('opens restore so it cannot be dismissed by a stray click', async () => {
      await open()

      await click(button('backup.restore_now'))

      // A restore that is half done and then dismissed leaves an unusable install
      expect(modal.lastOpened()?.options?.backdrop).toBe('static')
    })
  })

  describe('changing the backup schedule', () => {
    it('waits for the user to stop before writing the config', async () => {
      vi.useFakeTimers()
      await open()
      api.clearCalls()
      const input = screen.getByRole('textbox', { name: 'backup.settings_path' })

      fireEvent.change(input, { target: { value: '/mnt' } })
      fireEvent.change(input, { target: { value: '/mnt/nas' } })
      fireEvent.change(input, { target: { value: '/mnt/nas/backups' } })
      await act(() => vi.advanceTimersByTimeAsync(1500))

      // One write for three keystrokes: each one otherwise rewrites config.json
      expect(api.callsTo('patch', '/config-editor/ui')).toHaveLength(1)
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({
        scheduledBackupPath: '/mnt/nas/backups',
      })
    })

    it('saves the switch as the inverse config key', async () => {
      vi.useFakeTimers()
      const { container } = await open()
      api.clearCalls()

      fireEvent.click(container.querySelector('#disableScheduledBackups')!)
      await act(() => vi.advanceTimersByTimeAsync(500))

      // Switching the schedule off means writing `disable: true`
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({
        scheduledBackupDisable: true,
      })
      expect(useSettingsStore.getState().env.scheduledBackupDisable).toBe(true)
    })

    it('asks the user to restart after a schedule change', async () => {
      vi.useFakeTimers()
      const { container } = await open()

      fireEvent.click(container.querySelector('#disableScheduledBackups')!)
      await act(() => vi.advanceTimersByTimeAsync(500))

      // The schedule is read at startup, so the change does nothing until then
      expect(showRestartToast).toHaveBeenCalled()
    })

    it('does not claim a restart is needed when the write failed', async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('patch', '/config-editor/ui', new Error('read only file system'))
      const { container } = await open()

      fireEvent.click(container.querySelector('#disableScheduledBackups')!)
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(showRestartToast).not.toHaveBeenCalled()
      expect(toast.at('error')).toHaveLength(1)
    })
  })
})
