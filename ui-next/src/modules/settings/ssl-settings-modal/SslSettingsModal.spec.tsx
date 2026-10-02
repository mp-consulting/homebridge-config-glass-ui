import type { EnvInterface } from '@/core/interfaces/settings.interfaces'
import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeToast } from '@/testing'

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSettingsStore, useSettingsStore } from '@/core/settings'
import * as toastModule from '@/core/ui/toast'
import { isSslFormInvalid } from '@/modules/settings/ssl-settings-modal/ssl-settings'
import { SslSettingsModal } from '@/modules/settings/ssl-settings-modal/SslSettingsModal'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const toast = (toastModule as unknown as { toast: FakeToast }).toast

/**
 * The modal that decides how the UI serves itself over HTTPS.
 *
 * Getting this wrong locks the user out of their own UI: a saved mode with a
 * missing file means the server cannot start its listener. So the two things
 * worth pinning are the guard that stops a half-filled mode being saved, and the
 * exact set of config keys each mode writes - every mode has to clear the keys
 * belonging to the others.
 */
describe('the ssl settings modal', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>

  function open(ssl: EnvInterface['ssl'] = {}) {
    useSettingsStore.setState(makeSettingsState({ env: { ssl } }))
    return renderWithProviders(<SslSettingsModal activeModal={activeModal as unknown as ActiveModal} />)
  }

  const makeFile = (name: string) => new File(['-----BEGIN-----'], name)
  const mode = (name: 'off' | 'selfsigned' | 'keycert' | 'pfx') => document.querySelector<HTMLInputElement>(`input[name="sslMode"][value="${name}"]`)!
  const selectMode = (name: 'off' | 'selfsigned' | 'keycert' | 'pfx') => fireEvent.click(mode(name))
  const selectedMode = () => document.querySelector<HTMLInputElement>('input[name="sslMode"]:checked')?.value
  const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })
  const fileInput = (accept: string) => document.querySelector<HTMLInputElement>(`input[type="file"][accept="${accept}"]`)!
  const chooseKey = (files: File[]) => fireEvent.change(fileInput('.pem,.key'), { target: { files } })
  const chooseCert = (files: File[]) => fireEvent.change(fileInput('.pem,.crt'), { target: { files } })
  const choosePfx = (files: File[]) => fireEvent.change(fileInput('.pfx,.p12'), { target: { files } })
  const hostnames = () => document.querySelector<HTMLInputElement>('input[placeholder="localhost, 127.0.0.1, homebridge.local"]')!
  const passphrase = () => document.querySelector<HTMLInputElement>('input[type="password"]')!
  const ssl = () => useSettingsStore.getState().env.ssl as Record<string, unknown>

  /** Press save and wait for it to finish one way or the other. */
  async function save() {
    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())
    await waitFor(() => expect(activeModal.close.mock.calls.length + toast.at('error').length).toBeGreaterThan(0))
    await waitFor(() => expect(saveButton().querySelector('.fa-spinner')).toBeNull())
  }

  beforeEach(() => {
    vi.clearAllMocks()
    toast.shown.length = 0
    resetSettingsStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api = fakeApi()
    activeModal = activeModalStub()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('working out the current mode', () => {
    it('is off when nothing is configured', () => {
      open()

      expect(selectedMode()).toBe('off')
      expect(saveButton()).toBeDisabled()
    })

    it('is keycert when a key or a cert is saved', () => {
      // Either one alone is enough: a half-saved pair still has to reopen in the
      // mode it belongs to so the user can finish it
      const { unmount } = open({ key: '/etc/key.pem' })
      expect(selectedMode()).toBe('keycert')
      unmount()

      open({ cert: '/etc/cert.pem' })
      expect(selectedMode()).toBe('keycert')
    })

    it('is pfx when a pfx file is saved', () => {
      open({ pfx: '/etc/cert.pfx' })

      expect(selectedMode()).toBe('pfx')
      expect(screen.getByText('/etc/cert.pfx')).toBeInTheDocument()
    })

    it('is pfx when only a passphrase is known', () => {
      // The server never sends the passphrase back, just the fact it has one
      open({ hasPassphrase: true })

      expect(selectedMode()).toBe('pfx')
    })

    it('prefers keycert when both kinds are somehow saved', () => {
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem', pfx: '/etc/cert.pfx' })

      expect(selectedMode()).toBe('keycert')
    })

    it('never shows the saved passphrase', () => {
      open({ pfx: '/etc/cert.pfx', hasPassphrase: true })

      expect(passphrase().value).toBe('')
    })

    it('marks the chosen mode', () => {
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })

      const option = mode('keycert').closest('label')!
      expect(option.querySelector('.fa-key')).toHaveClass('primary-text')
      expect(option.querySelector('.fa-check-circle')).not.toBeNull()
      expect(mode('off').closest('label')!.querySelector('.fa-ban')).toHaveClass('grey-text')
    })
  })

  describe('the save button', () => {
    it('needs at least one hostname for a self-signed certificate', () => {
      open()
      selectMode('selfsigned')

      // The default is prefilled, so this only bites when the user clears it
      expect(hostnames().value).toBe('localhost, 127.0.0.1')
      expect(saveButton()).toBeEnabled()
      fireEvent.change(hostnames(), { target: { value: '   ' } })

      expect(saveButton()).toBeDisabled()
    })

    it('becomes valid again once a hostname is typed back', () => {
      open()
      selectMode('selfsigned')
      fireEvent.change(hostnames(), { target: { value: '' } })
      fireEvent.change(hostnames(), { target: { value: 'homebridge.local' } })

      expect(saveButton()).toBeEnabled()
    })

    it('needs both halves of a key and certificate pair', () => {
      open()
      selectMode('keycert')
      expect(saveButton()).toBeDisabled()

      chooseKey([makeFile('key.pem')])
      expect(saveButton()).toBeDisabled()

      chooseCert([makeFile('cert.pem')])
      expect(saveButton()).toBeEnabled()
      expect(screen.getByText('cert.pem')).toHaveClass('primary-text')
    })

    it('accepts a key and certificate that are already saved', () => {
      // Reopening the modal on a working setup must not demand the files again
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })

      expect(screen.getByText('/etc/key.pem')).toBeInTheDocument()
      expect(screen.getByText('/etc/cert.pem')).toBeInTheDocument()
      const config = { mode: 'keycert' as const, hostnames: '', keyPath: '/etc/key.pem', certPath: '/etc/cert.pem', pfxPath: '', passphrase: '' }
      expect(isSslFormInvalid(config, { key: null, cert: null, pfx: null })).toBe(false)
    })

    it('needs a pfx file, but not a passphrase', () => {
      open()
      selectMode('pfx')
      expect(saveButton()).toBeDisabled()

      choosePfx([makeFile('cert.pfx')])

      // A pfx without a passphrase is legal, so an empty one cannot block save
      expect(saveButton()).toBeEnabled()
    })

    it('goes back to invalid when a chosen file is cleared', () => {
      open()
      selectMode('pfx')
      choosePfx([makeFile('cert.pfx')])
      choosePfx([])

      expect(saveButton()).toBeDisabled()
    })
  })

  describe('spotting changes', () => {
    it('counts switching mode as a change', () => {
      open()

      selectMode('selfsigned')

      expect(saveButton()).toBeEnabled()
    })

    it('counts choosing a file as a change on its own', () => {
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      expect(saveButton()).toBeDisabled()

      // Replacing the certificate does not alter any text field
      chooseCert([makeFile('newer-cert.pem')])

      expect(saveButton()).toBeEnabled()
    })

    it('counts typing a passphrase as a change', () => {
      open({ pfx: '/etc/cert.pfx' })

      fireEvent.change(passphrase(), { target: { value: 'hunter2' } })

      expect(saveButton()).toBeEnabled()
    })

    it('goes back to unchanged when the mode is switched back', () => {
      open()

      selectMode('pfx')
      selectMode('off')

      expect(saveButton()).toBeDisabled()
    })
  })

  describe('saving off mode', () => {
    it('clears every ssl key in one request', async () => {
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      selectMode('off')

      await save()

      // One PATCH rather than four PUTs, so the config is only rewritten once
      expect(api.callsTo('patch', '/config-editor/ui')).toHaveLength(1)
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({
        'ssl.key': '',
        'ssl.cert': '',
        'ssl.pfx': '',
        'ssl.passphrase': '',
      })
    })

    it('forgets the paths locally too', async () => {
      // Reopening the modal reads these back
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      selectMode('off')

      await save()

      expect(ssl().key).toBe('')
      expect(ssl().cert).toBe('')
      expect(activeModal.close).toHaveBeenCalledWith('off')
    })
  })

  describe('saving a self-signed certificate', () => {
    it('sends the hostnames as a trimmed list', async () => {
      open()
      api.respond('post', '/server/ssl/selfsigned/generate', { keyPath: '/gen/key.pem', certPath: '/gen/cert.pem' })
      selectMode('selfsigned')
      fireEvent.change(hostnames(), { target: { value: 'localhost, 127.0.0.1 ,  homebridge.local ,' } })

      await save()

      expect(api.lastCall('post', '/server/ssl/selfsigned/generate')?.body).toEqual({
        hostnames: ['localhost', '127.0.0.1', 'homebridge.local'],
        mode: 'keycert',
      })
    })

    it('stores the generated paths and closes as keycert', async () => {
      // Self-signed is stored as a key and certificate pair, and the caller's
      // toggle has to agree
      open()
      api.respond('post', '/server/ssl/selfsigned/generate', { keyPath: '/gen/key.pem', certPath: '/gen/cert.pem' })
      selectMode('selfsigned')

      await save()

      expect(ssl().key).toBe('/gen/key.pem')
      expect(ssl().cert).toBe('/gen/cert.pem')
      expect(activeModal.close).toHaveBeenCalledWith('keycert')
      expect(api.callsTo('patch')).toHaveLength(0)
    })

    it('clears any pfx setup it replaces', async () => {
      open({ pfx: '/etc/cert.pfx', hasPassphrase: true })
      api.respond('post', '/server/ssl/selfsigned/generate', { keyPath: '/gen/key.pem', certPath: '/gen/cert.pem' })
      selectMode('selfsigned')

      await save()

      expect(ssl().pfx).toBe('')
      expect(ssl().passphrase).toBe('')
    })

    it('writes no config at all when generating fails', async () => {
      // Pointing the config at a certificate that was never written would stop
      // the server serving the UI at all
      open()
      api.fail('post', '/server/ssl/selfsigned/generate', { error: { message: 'openssl missing' } })
      selectMode('selfsigned')

      await save()

      expect(api.callsTo('patch')).toHaveLength(0)
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(toast.at('error')[0].message).toBe('openssl missing')
    })
  })

  describe('saving a key and certificate pair', () => {
    it('uploads both files under the same field name', async () => {
      open()
      api.respond('post', '/server/ssl/keycert', { keyPath: '/up/key.pem', certPath: '/up/cert.pem' })
      selectMode('keycert')
      chooseKey([makeFile('key.pem')])
      chooseCert([makeFile('cert.pem')])

      await save()

      const form = api.lastCall('post', '/server/ssl/keycert')?.body as FormData
      // The server takes them as one multi-file field, in key-then-cert order
      expect(form.getAll('uploads').map(entry => (entry as File).name)).toEqual(['key.pem', 'cert.pem'])
    })

    it('saves the paths the server gave back, not the local file names', async () => {
      open()
      api.respond('post', '/server/ssl/keycert', { keyPath: '/up/key.pem', certPath: '/up/cert.pem' })
      selectMode('keycert')
      chooseKey([makeFile('key.pem')])
      chooseCert([makeFile('cert.pem')])

      await save()

      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({
        'ssl.key': '/up/key.pem',
        'ssl.cert': '/up/cert.pem',
        'ssl.pfx': '',
        'ssl.passphrase': '',
      })
      expect(activeModal.close).toHaveBeenCalledWith('keycert')
    })

    it('refuses to upload one half of a pair', async () => {
      // The saved pair has to match: a new key alone leaves a certificate that
      // no longer verifies against it
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      chooseKey([makeFile('newer-key.pem')])

      await save()

      expect(api.callsTo('post', '/server/ssl/keycert')).toHaveLength(0)
      expect(api.callsTo('patch')).toHaveLength(0)
      expect(toast.at('error')[0].message).toBe('settings.security.upload_both_files')
    })

    it('keeps the saved paths when no new files were chosen', async () => {
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      // A change elsewhere, so there is something to save
      selectMode('pfx')
      fireEvent.change(passphrase(), { target: { value: 'irrelevant' } })
      selectMode('keycert')

      await save()

      expect(api.callsTo('post', '/server/ssl/keycert')).toHaveLength(0)
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toMatchObject({
        'ssl.key': '/etc/key.pem',
        'ssl.cert': '/etc/cert.pem',
      })
    })

    it('forgets the chosen files once they are uploaded', async () => {
      // Otherwise a second save would upload the same files again
      api.respond('post', '/server/ssl/keycert', { keyPath: '/up/key.pem', certPath: '/up/cert.pem' })
      api.fail('patch', '/config-editor/ui', new Error('read only file system'))
      open()
      selectMode('keycert')
      chooseKey([makeFile('key.pem')])
      chooseCert([makeFile('cert.pem')])

      await save()

      expect(fileInput('.pem,.key').value).toBe('')
      expect(screen.queryByText('key.pem')).toBeNull()
      expect(screen.getByText('/up/key.pem')).toBeInTheDocument()
    })
  })

  describe('saving a pfx bundle', () => {
    it('sends the passphrase with the upload', async () => {
      // The server needs it to decrypt the bundle's MAC and check it is usable
      open()
      api.respond('post', '/server/ssl/pfx', { pfxPath: '/up/cert.pfx' })
      selectMode('pfx')
      choosePfx([makeFile('cert.pfx')])
      fireEvent.change(passphrase(), { target: { value: 'hunter2' } })

      await save()

      const form = api.lastCall('post', '/server/ssl/pfx')?.body as FormData
      expect((form.get('upload') as File).name).toBe('cert.pfx')
      expect(form.get('passphrase')).toBe('hunter2')
    })

    it('clears any key and certificate setup it replaces', async () => {
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      api.respond('post', '/server/ssl/pfx', { pfxPath: '/up/cert.pfx' })
      selectMode('pfx')
      choosePfx([makeFile('cert.pfx')])
      fireEvent.change(passphrase(), { target: { value: 'hunter2' } })

      await save()

      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({
        'ssl.key': '',
        'ssl.cert': '',
        'ssl.pfx': '/up/cert.pfx',
        'ssl.passphrase': 'hunter2',
      })
      expect(activeModal.close).toHaveBeenCalledWith('pfx')
    })

    it('writes no config when the bundle is rejected', async () => {
      open()
      api.fail('post', '/server/ssl/pfx', { error: { message: 'wrong passphrase' } })
      selectMode('pfx')
      choosePfx([makeFile('cert.pfx')])

      await save()

      expect(api.callsTo('patch')).toHaveLength(0)
      expect(toast.at('error')[0].message).toBe('wrong passphrase')
    })

    it('lets the user try again after a failure', async () => {
      // The spinner is cleared in a finally block, so a failed save does not
      // leave the button stuck
      open({ key: '/etc/key.pem', cert: '/etc/cert.pem' })
      api.fail('patch', '/config-editor/ui', new Error('read only file system'))
      selectMode('off')

      await save()

      expect(saveButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })
})
