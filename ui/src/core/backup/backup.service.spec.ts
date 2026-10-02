import type { FakeApi, FakeToast } from '@/testing'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as toastModule from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'
import { fakeApi } from '@/testing'

import { backupService } from './backup.service'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/** Downloading a full backup, which the backup modal and the plugin flows share. */
describe('backupService', () => {
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  let api: FakeApi
  let saveAs: ReturnType<typeof vi.spyOn>

  const response = (size: number, fileName?: string) => ({
    body: { size },
    headers: { get: (name: string) => (name === 'File-Name' ? fileName ?? null : null) },
  })

  beforeEach(() => {
    api = fakeApi()
    toast.shown.length = 0
    saveAs = vi.spyOn(fileSaver, 'saveAs').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves the archive under the name the server gives it', async () => {
    api.respond('get', '/backup/download', response(10, 'homebridge-backup-x.tar.gz'))

    await backupService.downloadBackup()

    expect(api.lastCall('get', '/backup/download')?.options).toEqual({ observe: 'response', responseType: 'blob' })
    expect(saveAs).toHaveBeenCalledWith({ size: 10 }, 'homebridge-backup-x.tar.gz')
  })

  it('falls back to a default name', async () => {
    api.respond('get', '/backup/download', response(10))

    await backupService.downloadBackup()

    expect(saveAs.mock.calls[0][1]).toBe('homebridge-backup.tar.gz')
  })

  it('warns when the archive is too big to restore through the ui, and saves it anyway', async () => {
    api.respond('get', '/backup/download', response(globalThis.backup.maxBackupSize + 1))

    await backupService.downloadBackup()

    expect(toast.at('warning')[0].message).toBe('backup.backup_exceeds_max_size')
    expect(saveAs).toHaveBeenCalled()
  })

  it('lets a failure reach the caller, which owns the error toast', async () => {
    api.fail('get', '/backup/download', { status: 500 })

    await expect(backupService.downloadBackup()).rejects.toMatchObject({ status: 500 })
    expect(saveAs).not.toHaveBeenCalled()
  })
})
