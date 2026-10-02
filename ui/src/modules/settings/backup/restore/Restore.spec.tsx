import type { FakeApi, FakeIoNamespace, FakeOpenModal, FakeTerminals, FakeToast, FakeWs } from '@/testing'

import type { RestoreProps } from './Restore'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsActions, useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import * as toastModule from '@/core/ui/toast'
import * as wsModule from '@/core/ws'
import { Backup } from '@/modules/settings/backup/Backup'
import { activeModalStub, fakeApi, fakeTerminals, makeEnv, makeSettingsState, renderWithProviders } from '@/testing'

import { Restore } from './Restore'
import { restoreDeps } from './restore.deps'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))

/**
 * The restore modal, which is the most destructive screen in the app: it
 * replaces the whole Homebridge storage directory and then restarts the
 * service. Once the archive is unpacked there is no undo.
 *
 * There are four routes into a restore (uploaded .tar.gz, uploaded .hbfx, a
 * scheduled backup, and the setup wizard) and each one has a different upload
 * step but the same websocket handoff afterwards. The point of these specs is
 * that each route reaches the right endpoint and then really does trigger the
 * unpack - the .hbfx one in particular used to look fine while never starting,
 * because the upload resolved on the first upload event rather than the response.
 */
describe('restore', () => {
  const modal = modalModule as unknown as FakeOpenModal
  const toast = (toastModule as unknown as { toast: FakeToast }).toast
  const ws = (wsModule as unknown as { ws: FakeWs }).ws
  const realDeps = { ...restoreDeps }

  let xterm: FakeTerminals
  let api: FakeApi
  let io: FakeIoNamespace
  let activeModal: ReturnType<typeof activeModalStub>
  let upload: { resolve: (value?: unknown) => void, reject: (error: unknown) => void, progress: (loaded: number, total: number) => void } | null
  let getTerminalOptions: ReturnType<typeof vi.spyOn>

  const scheduledBackup = { id: 'backup-1', fileName: 'homebridge-backup-1.tar.gz', timestamp: 0, size: 1 }

  /**
   * Render the modal.
   *
   * `arrange` runs after the fakes are built but before the component mounts,
   * which is the only window for registering a response the modal reaches for
   * while it opens.
   * @param props - the restore modal data
   * @param arrange - registers responses on the freshly built fakes
   */
  async function open(props: Partial<RestoreProps> = {}, arrange?: () => void) {
    arrange?.()
    const result = renderWithProviders(
      <Restore activeModal={{ ...activeModal, update: vi.fn() }} selectedBackup={null} {...props} />,
      { route: '/settings' },
    )
    await act(async () => {})
    return result
  }

  /**
   * Choose files in the archive picker.
   * @param names - the names of the selected files
   */
  function pick(names: string[]) {
    const input = document.querySelector<HTMLInputElement>('#restoreFileUpload')!
    fireEvent.change(input, { target: { files: names.map(name => new File(['archive'], name)) } })
  }

  const restoreButton = () => screen.getByRole('button', { name: /form\.button_restore|backup\.label_/ })

  async function clickRestore() {
    await act(async () => {
      fireEvent.click(restoreButton())
    })
  }

  beforeEach(() => {
    api = fakeApi()
    useSettingsStore.setState(makeSettingsState())
    activeModal = activeModalStub()
    modal.opened.length = 0
    toast.shown.length = 0
    ws.namespaces.clear()
    ws.connectToNamespace.mockClear()
    io = ws.namespace('backup')
    xterm = fakeTerminals()
    upload = null
    restoreDeps.terminals = xterm.factory
    restoreDeps.uploadWithProgress = vi.fn((_path: string, _body: FormData, onProgress: (loaded: number, total: number) => void) =>
      new Promise((resolve, reject) => {
        upload = { resolve, reject, progress: onProgress }
      })) as unknown as typeof restoreDeps.uploadWithProgress
    getTerminalOptions = vi.spyOn(settingsActions, 'getTerminalOptions')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    Object.assign(restoreDeps, realDeps)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('opening the modal', () => {
    it('opens its own websocket namespace', async () => {
      await open()

      // Not `getExistingNamespace`: nothing else in the app opens 'backup', so
      // the modal is responsible for connecting it
      expect(ws.connectToNamespace).toHaveBeenCalledWith('backup')
    })

    it('shows the server output as it arrives', async () => {
      await open()

      io.socket.fire('stdout', 'Extracting archive...')

      expect(xterm.terminals[0].written).toEqual(['Extracting archive...'])
    })

    it('builds a read-only terminal', async () => {
      await open()

      // The user cannot type into a restore, and an enabled stdin would send
      // keystrokes to a socket with nothing listening
      expect(getTerminalOptions).toHaveBeenCalledWith({ disableStdin: true })
    })

    it('starts with nothing chosen when opened for an upload', async () => {
      const { container } = await open()

      expect(restoreButton()).toBeDisabled()
      expect(container.querySelector('#plugin-log-output')).toHaveAttribute('hidden')
    })
  })

  describe('choosing an archive', () => {
    it('spots an hbfx archive by its extension', async () => {
      vi.useFakeTimers()
      await open()

      pick(['old-install.hbfx'])
      await clickRestore()

      // .hbfx is a Homebridge for Docker export, which the server unpacks
      // through a different endpoint entirely
      expect(restoreDeps.uploadWithProgress).toHaveBeenCalledWith('/backup/restore/hbfx', expect.any(FormData), expect.any(Function))
    })

    it('treats anything else as a homebridge archive', async () => {
      await open()

      pick(['homebridge-backup.tar.gz'])
      await clickRestore()

      expect(api.callsTo('post', '/backup/restore')).toHaveLength(1)
      expect(restoreDeps.uploadWithProgress).not.toHaveBeenCalled()
    })

    it('forgets the file when the picker is cleared', async () => {
      await open()
      pick(['old-install.hbfx'])
      expect(restoreButton()).not.toBeDisabled()

      pick([])

      expect(restoreButton()).toBeDisabled()
    })
  })

  describe('restoring an uploaded homebridge archive', () => {
    it('uploads the archive and then asks for the unpack', async () => {
      vi.useFakeTimers()
      await open()
      pick(['homebridge-backup.tar.gz'])

      await clickRestore()
      await act(() => vi.advanceTimersByTimeAsync(500))

      const call = api.lastCall('post', '/backup/restore')
      expect((call?.body as FormData).get('restoreArchive')).toBeInstanceOf(File)
      // Uploading is only half of it: the archive sits on disk until this asks
      // for it to be unpacked
      expect(io.requests.map(request => request.resource)).toContain('do-restore')
    })

    it('reports success once the unpack finishes', async () => {
      vi.useFakeTimers()
      await open({}, () => io.socket.respondTo('do-restore', {}))
      pick(['homebridge-backup.tar.gz'])

      await clickRestore()
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(toast.at('success')[0].message).toBe('backup.backup_restored')
      // Done and not failed: the restart button replaces the restore footer
      expect(screen.getByRole('button', { name: 'menu.hbrestart.title' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'form.button_back' })).toBeNull()
    })

    it('marks the restore as failed when the unpack errors', async () => {
      vi.useFakeTimers()
      await open({}, () => io.socket.respondTo('do-restore', { error: 'not a homebridge backup' }))
      pick(['homebridge-backup.tar.gz'])

      await clickRestore()
      await act(() => vi.advanceTimersByTimeAsync(500))

      // The install is half-replaced at this point, so the modal has to say so
      // rather than quietly offering the restart button
      expect(toast.at('error')[0].message).toBe('backup.restore_failed')
      expect(screen.getByRole('button', { name: 'form.button_back' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'menu.hbrestart.title' })).toBeNull()
    })

    it('never asks for the unpack when the upload is rejected', async () => {
      vi.useFakeTimers()
      await open({}, () => api.fail('post', '/backup/restore', { error: { message: 'archive too large' } }))
      pick(['homebridge-backup.tar.gz'])

      await clickRestore()
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(io.requests).toHaveLength(0)
      expect(document.querySelector('#plugin-log-output')).toHaveAttribute('hidden')
      expect(toast.at('error')[0].message).toBe('archive too large')
      expect(restoreButton()).not.toBeDisabled()
    })

    it('clears the terminal so a second attempt starts fresh', async () => {
      await open()
      pick(['homebridge-backup.tar.gz'])

      await clickRestore()

      expect(xterm.terminals[0].reset).toHaveBeenCalled()
    })
  })

  describe('restoring an uploaded hbfx archive', () => {
    it('waits for the response rather than the first upload event', async () => {
      vi.useFakeTimers()
      await open()
      pick(['old-install.hbfx'])

      await clickRestore()
      await act(async () => upload!.progress(10, 100))
      await act(() => vi.advanceTimersByTimeAsync(500))
      // The regression this guards: resolving on the first (Sent) event made
      // the restore appear to upload and then simply never start
      expect(io.requests).toHaveLength(0)

      await act(async () => upload!.resolve({ status: 'ok' }))
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(io.requests.map(request => request.resource)).toContain('do-restore-hbfx')
      expect(document.querySelector('#plugin-log-output')).not.toHaveAttribute('hidden')
    })

    it('reports upload progress as a percentage', async () => {
      await open()
      pick(['old-install.hbfx'])

      await clickRestore()
      await act(async () => upload!.progress(512, 2048))

      // An hbfx export can be hundreds of megabytes, so the bar is the only
      // sign anything is happening
      expect(restoreButton().textContent).toContain('25% -')
      expect(restoreButton().textContent).toContain('backup.label_uploading')
    })

    it('uses its own unpack request, not the homebridge one', async () => {
      vi.useFakeTimers()
      await open()
      pick(['old-install.hbfx'])

      await clickRestore()
      await act(async () => upload!.resolve({ status: 'ok' }))
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(io.requests.map(request => request.resource)).not.toContain('do-restore')
    })

    it('lets the user try again when the upload fails', async () => {
      await open()
      pick(['old-install.hbfx'])

      await clickRestore()
      await act(async () => upload!.reject({ status: 400, error: { message: 'not a valid hbfx file' } }))

      expect(restoreButton()).not.toBeDisabled()
      expect(document.querySelector('#plugin-log-output')).toHaveAttribute('hidden')
      expect(toast.at('error')[0].message).toBe('not a valid hbfx file')
    })
  })

  describe('restoring a scheduled backup', () => {
    it('restores by id without uploading anything', async () => {
      vi.useFakeTimers()
      await open({ selectedBackup: scheduledBackup })

      await clickRestore()
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(api.lastCall('post', '/backup/scheduled-backups/backup-1/restore')?.body).toEqual({})
      expect(api.callsTo('post', '/backup/restore')).toHaveLength(0)
      expect(io.requests.map(request => request.resource)).toContain('do-restore')
    })

    it('shows the chosen backup instead of the file picker', async () => {
      const { container } = await open({ selectedBackup: scheduledBackup })

      // A scheduled backup is always a homebridge archive, so there is no
      // picker that could divert it to the hbfx route
      expect(container.querySelector('#restoreFileUpload')).toBeNull()
      expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('homebridge-backup-1.tar.gz')
    })
  })

  describe('the setup wizard route', () => {
    it('starts restoring as soon as it opens', async () => {
      // The restart that follows is failed so the modal stays on screen
      await open({ setupWizardRestore: true }, () => api.fail('put', '/backup/restart', new Error('offline')))

      // The wizard has already uploaded the archive, so there is nothing for
      // the user to press
      expect(document.querySelector('#plugin-log-output')).not.toHaveAttribute('hidden')
      expect(io.requests.map(request => request.resource)).toContain('do-restore')
    })

    it('restarts by itself once the unpack finishes', async () => {
      await open({ setupWizardRestore: true }, () => io.socket.respondTo('do-restore', {}))
      await act(async () => {})

      expect(api.callsTo('put', '/backup/restart')).toHaveLength(1)
    })

    it('waits for the user on the ordinary route', async () => {
      vi.useFakeTimers()
      await open({}, () => io.socket.respondTo('do-restore', {}))
      await act(() => vi.advanceTimersByTimeAsync(500))

      expect(io.requests).toHaveLength(0)
    })
  })

  describe('finishing up', () => {
    async function restoreDone() {
      const result = await open({}, () => io.socket.respondTo('do-restore', {}))
      pick(['homebridge-backup.tar.gz'])
      vi.useFakeTimers()
      await clickRestore()
      await act(() => vi.advanceTimersByTimeAsync(500))
      vi.useRealTimers()
      return result
    }

    it('restarts the server and goes back to the status page', async () => {
      const { router } = await restoreDone()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'menu.hbrestart.title' }))
      })

      expect(api.lastCall('put', '/backup/restart')?.body).toEqual({})
      expect(activeModal.close).toHaveBeenCalledWith(true)
      expect(router.state.location.pathname).toBe('/')
    })

    it('stays put when the restart request fails', async () => {
      const { router } = await restoreDone()
      api.fail('put', '/backup/restart', new Error('offline'))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'menu.hbrestart.title' }))
      })

      // Swallowed on purpose: the server going away mid-request is the normal
      // case here, and the page reload is what actually recovers
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(router.state.location.pathname).toBe('/settings')
    })

    it('goes back to the backup modal on request', async () => {
      await open()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_back' }))

      expect(activeModal.dismiss).toHaveBeenCalled()
      expect(modal.lastOpened()?.component).toBe(Backup)
      expect(modal.lastOpened()?.options).toEqual({ size: 'lg', backdrop: 'static' })
    })

    it('closes the socket and the terminal on teardown', async () => {
      const { unmount } = await open()
      const term = xterm.terminals[0]

      unmount()

      // The namespace is this modal's alone, and an undisposed terminal keeps
      // its buffer and listeners alive for as long as the page is open
      expect(io.end).toHaveBeenCalled()
      expect(term.dispose).toHaveBeenCalled()
      expect(io.socket.handlers('stdout')).toHaveLength(0)
    })
  })

  describe('the terminal theme', () => {
    it('follows the effective terminal lighting mode', async () => {
      useSettingsStore.setState(makeSettingsState({ actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } as any }))
      const { container } = await open()

      expect(container.querySelector('.modal-content')).toHaveClass('terminal-light-theme')
      expect(container.querySelector('#plugin-log-output')).toHaveClass('terminal-light-bg')

      act(() => {
        useSettingsStore.setState({ env: makeEnv({ terminal: { lightingMode: 'dark' } } as any) })
      })

      expect(container.querySelector('.modal-content')).not.toHaveClass('terminal-light-theme')
      expect(container.querySelector('#plugin-log-output')).toHaveClass('terminal-dark-bg')
    })
  })
})
