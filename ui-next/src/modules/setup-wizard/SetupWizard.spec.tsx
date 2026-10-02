import type { FakeApi, FakeIoNamespace, FakeToast, FakeWs } from '@/testing'
import type { MockInstance } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, getStoredToken, setStoredToken, useAuthStore } from '@/core/auth'
import { useSettingsStore } from '@/core/settings'
import { toast as realToast } from '@/core/ui/toast'
import { ws as realWs } from '@/core/ws'
import { environment } from '@/environments/environment'
import { fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

import { validateCreateUser } from './create-user-form'
import { SetupWizard } from './SetupWizard'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const ws = realWs as unknown as FakeWs
const toast = realToast as unknown as FakeToast

/**
 * The setup wizard — the first thing anyone sees on a fresh install. It either
 * creates the first user, or restores a backup onto the empty box.
 *
 * ⚠️ **The restore path is authenticated.** There is no user yet, so it fetches a
 * temporary token from `/setup-wizard/get-setup-wizard-token` and then uploads the
 * archive to `POST /backup/restore`, which is behind both the auth guard and the
 * admin guard. That token therefore has to reach the token store the api wrapper
 * reads it from, or every request in the flow goes out with no Authorization
 * header and the restore 401s.
 */
describe('setupWizard', () => {
  let api: FakeApi
  let io: FakeIoNamespace
  let login: MockInstance<typeof authActions.login>

  const SETUP_TOKEN = 'setup-wizard-token'

  function create(options: { env?: Record<string, any>, settingsLoaded?: boolean } = {}) {
    api = fakeApi()
      .respond('get', '/setup-wizard/get-setup-wizard-token', { access_token: SETUP_TOKEN })
      .respond('post', '/setup-wizard/create-first-user', {})
      .respond('post', '/backup/restore', {})
      .respond('put', '/backup/restart', {})
    login = vi.spyOn(authActions, 'login').mockResolvedValue(undefined)
    useSettingsStore.setState(makeSettingsState({ env: { setupWizardComplete: false, ...options.env }, settingsLoaded: options.settingsLoaded ?? true }))

    ws.namespaces.clear()
    io = ws.namespace('backup')
    io.socket.respondTo('do-restore', {})

    setStoredToken(null)
    return renderWithProviders(<SetupWizard />, { route: '/setup' })
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  const progress = () => Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
  const container = () => document.querySelector('.setup-container') as HTMLElement
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const type = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })

  function fileOfSize(bytes: number, name = 'homebridge-backup.tar.gz') {
    const file = new File(['x'], name, { type: 'application/gzip' })
    Object.defineProperty(file, 'size', { value: bytes })
    return file
  }

  /** Pick files in the restore step's file input. */
  function pick(files: File[]) {
    const input = document.getElementById('restoreFileUpload') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    fireEvent.change(input)
    return input
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.backup = { maxBackupSize: 10 * 1024 * 1024, maxBackupSizeText: '10MB' } as any
    toast.shown.length = 0
    toast.error.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    setStoredToken(null)
  })

  describe('arriving on the wizard', () => {
    it('titles the page', () => {
      create()

      expect(document.title).toBe('setup_wizard_page_title')
    })

    it('starts on the welcome step', () => {
      create()

      expect(screen.getByText('setup.button_get_started')).toBeInTheDocument()
      expect(progress()).toBe(1)
    })

    it('shows the wallpaper the user set', () => {
      create({ env: { customWallpaperHash: 'abc123' } })

      expect(container().style.background).toContain(`${environment.api.base}/auth/wallpaper/abc123`)
      expect(container()).not.toHaveClass('anim')
    })

    it('shows no wallpaper when none is set', () => {
      create()

      expect(container().getAttribute('style')).toBeNull()
      expect(container()).toHaveClass('anim')
    })

    it('waits for the settings before deciding on a wallpaper', () => {
      // On a fresh install the wizard renders before /auth/settings has answered
      create({ settingsLoaded: false, env: { customWallpaperHash: 'abc123' } })

      expect(container().getAttribute('style')).toBeNull()
    })
  })

  describe('moving through the steps', () => {
    it('goes to the account form', () => {
      create()

      click('setup.button_get_started')

      expect(screen.getByText('setup.create_account')).toBeInTheDocument()
      expect(progress()).toBe(50)
    })

    it('goes to the restore form', () => {
      create()

      click('setup_wizard_restore')

      expect(document.getElementById('restoreFileUpload')).toBeInTheDocument()
      expect(progress()).toBe(20)
    })

    it('comes back from the restore form, forgetting the chosen file', () => {
      create()
      click('setup_wizard_restore')
      pick([fileOfSize(1000)])

      click('form.button_back')

      expect(screen.getByText('setup.button_get_started')).toBeInTheDocument()
      expect(progress()).toBe(1)

      // Forgotten: back on the restore form there is nothing to continue with
      click('setup_wizard_restore')
      expect(screen.getByRole('button', { name: 'form.button_continue' })).toBeDisabled()
    })
  })

  describe('creating the first user', () => {
    function fill(values: { username?: string, password?: string, passwordConfirm?: string }) {
      click('setup.button_get_started')
      type('form-username', values.username ?? 'admin')
      type('form-pass', values.password ?? 'password')
      type('form-pass-confirm', values.passwordConfirm ?? values.password ?? 'password')
    }

    async function submit() {
      fireEvent.submit(document.getElementById('form-username')!.closest('form')!)
      await settle()
    }

    it('sends the account to the server', async () => {
      create()
      fill({ username: 'someone', password: 'a-password' })

      await submit()

      expect(api.lastCall('post', '/setup-wizard/create-first-user')?.body).toMatchObject({
        username: 'someone',
        password: 'a-password',
      })
    })

    it('uses the username as the display name', async () => {
      // The wizard has no name field; the users page can change it later
      create()
      fill({ username: 'someone' })

      await submit()

      expect(api.lastCall('post', '/setup-wizard/create-first-user')?.body.name).toBe('someone')
    })

    it('signs the new user straight in', async () => {
      // Otherwise the wizard hands them to a login page for an account they only
      // just typed
      create()
      fill({ username: 'someone', password: 'a-password' })

      await submit()

      expect(login).toHaveBeenCalledWith({ username: 'someone', password: 'a-password' })
      expect(screen.getByText('setup_wizard_complete_title')).toBeInTheDocument()
    })

    it('records that the wizard is done', async () => {
      create()
      fill({})

      await submit()

      expect(useSettingsStore.getState().env.setupWizardComplete).toBe(true)
      expect(progress()).toBe(100)
    })

    it('stays on the form and says what went wrong', async () => {
      create()
      api.fail('post', '/setup-wizard/create-first-user', { error: { message: 'Username already taken' } })
      fill({})

      await submit()

      expect(screen.getByText('setup.create_account')).toBeInTheDocument()
      expect(progress()).toBe(50)
      expect(screen.getByRole('button', { name: 'form.button_continue' })).toBeEnabled()
      expect(toast.error).toHaveBeenCalledWith('Username already taken', 'toast.title_error')
    })

    it('does not sign anyone in when the account was not created', async () => {
      create()
      api.fail('post', '/setup-wizard/create-first-user', new Error('disk full'))
      fill({})

      await submit()

      expect(login).not.toHaveBeenCalled()
    })

    it('marks the fields as the user fills them in', () => {
      create()
      fill({ username: 'admin', password: 'abc', passwordConfirm: 'abc' })

      expect(document.getElementById('form-username')).toHaveClass('is-valid')
      expect(document.getElementById('form-pass')).toHaveClass('is-invalid')
      expect(screen.getByRole('button', { name: 'form.button_continue' })).toBeDisabled()
    })
  })

  describe('the account form rules', () => {
    const values = (username: string, password: string, passwordConfirm: string) => ({ username, password, passwordConfirm })

    it('wants a username and a password', () => {
      const errors = validateCreateUser(values('', '', ''))

      expect(errors.username).toHaveProperty('required')
      expect(errors.password).toHaveProperty('required')
    })

    it('wants a password of at least four characters', () => {
      expect(validateCreateUser(values('admin', 'abc', 'abc')).password).toHaveProperty('minlength')
    })

    it('refuses two passwords that do not match', () => {
      const errors = validateCreateUser(values('admin', 'password', 'different'))

      expect(errors.form).toHaveProperty('matchPassword')
      expect(errors.passwordConfirm).toHaveProperty('matchPassword')
    })

    it('accepts them once they match', () => {
      const errors = validateCreateUser(values('admin', 'password', 'password'))

      expect(errors.form).toBeNull()
      expect(errors.passwordConfirm).toBeNull()
    })

    it('keeps the empty-field error while the confirmation is blank', () => {
      // ⚠️ A careless match check replaces `required`, and the form looks valid
      // while empty
      const errors = validateCreateUser(values('admin', 'password', ''))

      expect(errors.passwordConfirm).toHaveProperty('required')
      expect(errors.passwordConfirm).toHaveProperty('matchPassword')
    })

    it('keeps the empty-field error after a mismatch is corrected away', () => {
      const errors = validateCreateUser(values('admin', '', ''))

      expect(errors.passwordConfirm).toHaveProperty('required')
      expect(errors.passwordConfirm).not.toHaveProperty('matchPassword')
    })
  })

  describe('picking a backup file', () => {
    const continueButton = () => screen.getByRole('button', { name: 'form.button_continue' })

    it('takes the file the user picked', () => {
      create()
      click('setup_wizard_restore')

      pick([fileOfSize(1000)])

      expect(continueButton()).toBeEnabled()
      expect(progress()).toBe(40)
    })

    it('refuses one bigger than the server will accept', () => {
      // ⚠️ Checked here rather than after uploading: the upload of a large archive
      // takes minutes, and the server would refuse it at the end
      create()
      click('setup_wizard_restore')

      pick([fileOfSize(50 * 1024 * 1024)])

      expect(continueButton()).toBeDisabled()
      expect(progress()).toBe(20)
      expect(toast.error).toHaveBeenCalled()
    })

    it('clears the input after refusing one, so the same file can be re-picked', () => {
      create()
      click('setup_wizard_restore')
      const input = document.getElementById('restoreFileUpload') as HTMLInputElement
      const setValue = vi.spyOn(input, 'value', 'set')

      pick([fileOfSize(50 * 1024 * 1024)])

      expect(setValue).toHaveBeenCalledWith('')
    })

    it('forgets the file when the picker is cleared', () => {
      create()
      click('setup_wizard_restore')
      pick([fileOfSize(1000)])

      pick([])

      expect(continueButton()).toBeDisabled()
      expect(progress()).toBe(20)
    })
  })

  describe('restoring the backup', () => {
    /**
     * Start a restore with a file already chosen.
     *
     * ⚠️ Fake timers are not optional here: after the restart the wizard waits
     * five times three seconds before it starts polling.
     */
    function startRestore() {
      click('setup_wizard_restore')
      pick([fileOfSize(1000)])
      click('form.button_continue')
    }

    async function runRestore() {
      startRestore()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000)
      })
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    /**
     * What the token situation was at the moment a request was made. Measured
     * inside the responder: the wizard hands the token back as part of the same
     * run, so anything checked afterwards sees `null` whether it was set or not.
     */
    function tokenDuring(method: 'get' | 'post' | 'put', url: string) {
      const seen: { stored: string | null, localStorage: number } = { stored: null, localStorage: -1 }
      api.respond(method, url, () => {
        seen.stored = getStoredToken()
        seen.localStorage = Object.keys(window.localStorage).filter(key => window.localStorage.getItem(key) === SETUP_TOKEN).length
        return {}
      })
      return seen
    }

    it('has the token in place when it uploads the archive', async () => {
      create()
      const seen = tokenDuring('post', '/backup/restore')

      await runRestore()

      expect(seen.stored).toBe(SETUP_TOKEN)
    })

    it('still has it when it asks for the restart', async () => {
      create()
      const seen = tokenDuring('put', '/backup/restart')

      await runRestore()

      expect(seen.stored).toBe(SETUP_TOKEN)
    })

    it('never puts the token in local storage', async () => {
      // Any script on the page could read an admin bearer token there
      create()
      const seen = tokenDuring('post', '/backup/restore')

      await runRestore()

      expect(seen.localStorage).toBe(0)
    })

    it('uploads the archive under the name the server expects', async () => {
      create()

      await runRestore()

      const body = api.lastCall('post', '/backup/restore')?.body as FormData
      expect(body).toBeInstanceOf(FormData)
      expect((body.get('restoreArchive') as File).name).toBe('homebridge-backup.tar.gz')
    })

    it('asks the server to run the restore', async () => {
      create()

      await runRestore()

      expect(io.requests.map(r => r.resource)).toContain('do-restore')
    })

    it('restarts homebridge once the restore is done', async () => {
      create()

      await runRestore()

      expect(api.callsTo('put', '/backup/restart')).toHaveLength(1)
    })

    it('says homebridge is starting while it waits', async () => {
      create()
      api.fail('get', '/auth/settings', new Error('not up yet'))

      startRestore()
      await settle()

      expect(screen.getByText('setup_wizard_starting')).toBeInTheDocument()
      expect(document.getElementById('output')!.textContent).toContain('Starting Homebridge, please wait...')
    })

    it('gives the token back at the end', async () => {
      // It is an admin token on a box that now has the restored user database
      create()

      await runRestore()

      expect(getStoredToken()).toBeNull()
      expect(useAuthStore.getState().token).toBeNull()
    })

    it('closes the socket when it is finished with it', async () => {
      create()

      await runRestore()

      expect(io.end).toHaveBeenCalled()
      expect(io.socket.handlers('stdout')).toHaveLength(0)
    })

    it('waits for homebridge to answer before saying it is done', async () => {
      create()
      api.fail('get', '/auth/settings', new Error('not up yet'))

      await runRestore()

      expect(screen.getByText('setup_wizard_starting')).toBeInTheDocument()

      api.respond('get', '/auth/settings', {})
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      expect(screen.getByText('setup_wizard_complete')).toBeInTheDocument()
      expect(progress()).toBe(100)
      expect(screen.getByRole('link', { name: 'form.button_continue' })).toHaveAttribute('href', '/login')
    })

    it('stops asking once homebridge is up', async () => {
      create()
      api.respond('get', '/auth/settings', {})

      startRestore()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16000)
      })
      const asked = api.callsTo('get', '/auth/settings').length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(api.callsTo('get', '/auth/settings')).toHaveLength(asked)
    })

    it('stops asking when the wizard goes away', async () => {
      const { unmount } = create()
      api.fail('get', '/auth/settings', new Error('not up yet'))

      await runRestore()
      const asked = api.callsTo('get', '/auth/settings').length
      unmount()
      await vi.advanceTimersByTimeAsync(5000)

      expect(api.callsTo('get', '/auth/settings')).toHaveLength(asked)
    })

    it('goes back to the file picker when the upload fails', async () => {
      create()
      api.fail('post', '/backup/restore', { error: { message: 'Archive is not a valid backup' } })

      await runRestore()

      expect(document.getElementById('restoreFileUpload')).toBeInTheDocument()
      expect(progress()).toBe(20)
      expect(toast.error).toHaveBeenCalledWith('Archive is not a valid backup', 'toast.title_error')
    })

    it('does not restart homebridge when the restore itself failed', async () => {
      create()
      api.fail('post', '/backup/restore', new Error('upload failed'))

      await runRestore()

      expect(api.callsTo('put', '/backup/restart')).toEqual([])
    })

    it('says so when the token cannot be fetched', async () => {
      create()
      api.fail('get', '/setup-wizard/get-setup-wizard-token', new Error('server unavailable'))

      await runRestore()

      expect(document.getElementById('restoreFileUpload')).toBeInTheDocument()
      expect(api.callsTo('post', '/backup/restore')).toEqual([])
    })
  })

  describe('the restore log', () => {
    async function output(lines: string) {
      create()
      api.fail('get', '/auth/settings', new Error('not up yet'))
      click('setup_wizard_restore')
      pick([fileOfSize(1000)])
      click('form.button_continue')
      await settle()
      // Only the lines this call adds: the wizard has already appended its own
      // "Starting Homebridge" line by now
      const box = document.getElementById('output')!
      const before = box.children.length
      io.socket.fire('stdout', lines)
      return [...box.children].slice(before).map(child => ({ text: child.textContent, classes: child.className }))
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('shows what the server printed', async () => {
      const rendered = await output('Extracting archive\n')

      expect(rendered.map(line => line.text)).toEqual(['Extracting archive'])
    })

    it('strips the colour codes out of the text', async () => {
      // They would otherwise be printed literally
      const rendered = await output('\x1B[0;32mRestore complete\x1B[0m\n')

      expect(rendered[0].text).toBe('Restore complete')
    })

    it.each([
      ['an error', '[0;31m', 'red-text'],
      ['a success', '[0;32m', 'green-text'],
      ['a warning', '[0;33m', 'orange-text'],
      ['a note', '[0;36m', 'cyan-text'],
    ])('colours %s line', async (_label, code, expected) => {
      const rendered = await output(`\x1B${code}Something happened\x1B[0m\n`)

      expect(rendered[0].classes).toContain(expected)
    })

    it('ignores blank lines', async () => {
      const rendered = await output('One line\n\n\n')

      expect(rendered).toHaveLength(1)
    })

    it('shows several lines in one payload', async () => {
      const rendered = await output('First\nSecond\n')

      expect(rendered.map(line => line.text)).toEqual(['First', 'Second'])
    })
  })
})
