import type { MockInstance } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, useAuthStore } from '@/core/auth'
import { useSettingsStore } from '@/core/settings'
import { environment } from '@/environments/environment'
import { makeAuthState, makeSettingsState, renderWithProviders, setMatchMedia } from '@/testing'

import { Login } from './Login'
import { loader } from './route'

/**
 * The login page.
 *
 * Two things here are security decisions rather than presentation. A non-admin
 * who was sent to the login page from an admin-only route must not be returned
 * to it afterwards, and the route they were heading for is read out of session
 * storage and removed in the same breath, so an abandoned login cannot leave a
 * target behind for whoever logs in next.
 *
 * The rest is about the two ways a browser fills this form in: password
 * managers write straight to the DOM without an input event, so the native
 * input values are read back before the form is submitted.
 */
describe('login', () => {
  let login: MockInstance<typeof authActions.login>

  function httpError(status: number) {
    return Object.assign(new Error(`HTTP ${status}`), { status })
  }

  function open(options: { admin?: boolean, targetRoute?: string } = {}) {
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    return renderWithProviders(<Login targetRoute={options.targetRoute} />, { route: '/login' })
  }

  const input = (id: string) => document.getElementById(id) as HTMLInputElement
  const type = (id: string, value: string) => fireEvent.change(input(id), { target: { value } })
  const submitButton = () => document.getElementById('submit-button') as HTMLButtonElement

  async function fill(username: string, password: string) {
    type('form-username', username)
    type('form-pass', password)
  }

  async function submit() {
    await act(async () => {
      fireEvent.submit(submitButton().closest('form')!)
    })
    await act(async () => {})
  }

  beforeEach(() => {
    useSettingsStore.setState(makeSettingsState())
    login = vi.spyOn(authActions, 'login').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('signing in', () => {
    it('sends what the user typed', async () => {
      open()
      await fill('admin', 'letmein')

      await submit()

      expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'letmein', otp: '' })
    })

    it('needs both a username and a password', async () => {
      open()
      expect(submitButton()).toBeDisabled()

      type('form-username', 'admin')
      expect(submitButton()).toBeDisabled()

      type('form-pass', 'letmein')
      expect(submitButton()).toBeEnabled()
    })

    it('goes to the home page by default', async () => {
      const { router } = open()
      await fill('admin', 'letmein')

      await submit()

      expect(router.state.location.pathname).toBe('/')
    })

    it('returns an admin to the page they were trying to reach', async () => {
      const { router } = open({ targetRoute: '/config' })
      await fill('admin', 'letmein')

      await submit()

      expect(router.state.location.pathname).toBe('/config')
    })

    it('forgets the target route as soon as it reads it', () => {
      window.sessionStorage.setItem('target_route', '/config')

      expect(loader()).toBe('/config')

      // Read and removed together, so abandoning this login cannot send the next
      // person who signs in to a page they never asked for
      expect(window.sessionStorage.getItem('target_route')).toBeNull()
    })

    it('goes home when no target was remembered', () => {
      expect(loader()).toBe('/')
    })

    it('sends a non-admin home instead of to an admin-only page', async () => {
      const { router } = open({ admin: false, targetRoute: '/config' })
      await fill('bob', 'letmein')

      await submit()

      // The route guards would bounce them straight back here, which reads as a
      // failed login rather than a permission problem
      expect(router.state.location.pathname).toBe('/')
    })

    it.each(['/accessories', '/plugins', '/logs', '/support'])('lets a non-admin through to %s', async (route) => {
      const { router } = open({ admin: false, targetRoute: route })
      await fill('bob', 'letmein')

      await submit()

      expect(router.state.location.pathname).toBe(route)
    })

    it('shows a failure without saying which half was wrong', async () => {
      login.mockRejectedValue(httpError(401))
      const { router } = open()
      await fill('admin', 'wrong')

      await submit()

      expect(screen.getByText('login.invalid_credentials')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/login')
    })

    it('announces the failure to screen readers', async () => {
      login.mockRejectedValue(httpError(401))
      open()
      await fill('admin', 'wrong')

      await submit()

      expect(screen.getByRole('alert')).toHaveTextContent('login.invalid_credentials')
    })

    it('names the fields for assistive technology, not just by placeholder', () => {
      open()

      expect(screen.getByRole('textbox', { name: 'users.label_username' })).toBe(input('form-username'))
      expect(screen.getByLabelText('users.label_password')).toBe(input('form-pass'))
    })

    it('clears a previous failure when trying again', async () => {
      login.mockRejectedValueOnce(httpError(401))
      const { router } = open()
      await fill('admin', 'wrong')
      await submit()

      type('form-pass', 'right')
      await submit()

      expect(screen.queryByText('login.invalid_credentials')).toBeNull()
      expect(router.state.location.pathname).toBe('/')
    })

    it('lets the user try again even when the request throws', async () => {
      login.mockRejectedValue(httpError(500))
      open()
      await fill('admin', 'letmein')

      await submit()

      // Otherwise a server error leaves the user with no way to retry
      expect(submitButton()).toBeEnabled()
    })
  })

  describe('two factor authentication', () => {
    async function askForCode() {
      login.mockRejectedValue(httpError(412))
      const result = open()
      await fill('admin', 'letmein')
      await submit()
      return result
    }

    it('asks for a code when the server says one is needed', async () => {
      await askForCode()

      // 412 means the password was right - this is not a failed login
      expect(input('form-ota')).toBeInTheDocument()
      expect(screen.queryByText('login.invalid_credentials')).toBeNull()
    })

    it('starts requiring a six digit code once asked', async () => {
      await askForCode()

      // The field is optional until it appears, so the rule only applies then
      expect(submitButton()).toBeDisabled()

      type('form-ota', '12345')
      expect(submitButton()).toBeDisabled()

      type('form-ota', '123456')
      expect(submitButton()).toBeEnabled()
    })

    it('marks the code as wrong on a second refusal', async () => {
      await askForCode()

      type('form-ota', '000000')
      await submit()

      // The second 412 means the password is still fine but the code is not, so
      // the message has to point at the code rather than the password
      expect(screen.getByText('login.invalid_code')).toBeInTheDocument()
      expect(screen.queryByText('login.invalid_credentials')).toBeNull()
      expect(submitButton()).toBeDisabled()
    })

    it('sends the code with the next attempt', async () => {
      const { router } = await askForCode()

      login.mockResolvedValue(undefined)
      type('form-ota', '123456')
      await submit()

      expect(login).toHaveBeenLastCalledWith({ username: 'admin', password: 'letmein', otp: '123456' })
      expect(router.state.location.pathname).toBe('/')
    })

    it('clears the wrong-code marker when trying again', async () => {
      await askForCode()
      type('form-ota', '000000')
      await submit()

      type('form-ota', '654321')
      await submit()

      // Cleared at the start of each attempt, so it reflects this try rather
      // than accumulating
      expect(screen.getAllByText('login.invalid_code')).toHaveLength(1)
      expect(login).toHaveBeenCalledTimes(3)
    })

    it('moves the cursor to the code field', async () => {
      vi.useFakeTimers()
      await askForCode()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(document.activeElement).toBe(input('form-ota'))
    })
  })

  describe('what the browser filled in', () => {
    it('picks up a password written straight into the input', async () => {
      open()
      type('form-username', 'admin')

      // A password manager sets the DOM value without an input event
      input('form-pass').value = 'from-the-keychain'

      await submit()

      expect(login).toHaveBeenCalledWith(expect.objectContaining({ password: 'from-the-keychain' }))
    })

    it('picks up an autofilled username too', async () => {
      open()
      input('form-username').value = 'from-the-keychain'

      await submit()

      expect(login).toHaveBeenCalledWith(expect.objectContaining({ username: 'from-the-keychain' }))
    })

    it('prefers what the user typed over an empty input', async () => {
      open()
      await fill('admin', 'typed-by-hand')

      await submit()

      expect(login).toHaveBeenCalledWith(expect.objectContaining({ password: 'typed-by-hand' }))
    })

    it('enables the button once an autofilled password is read back', async () => {
      vi.useFakeTimers()
      open()
      type('form-username', 'admin')
      input('form-pass').value = 'from-the-keychain'

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(submitButton()).toBeEnabled()
    })
  })

  describe('the background', () => {
    const container = () => document.querySelector('.login-container') as HTMLElement

    it('uses the custom wallpaper when one is set', () => {
      useSettingsStore.setState(makeSettingsState({ env: { customWallpaperHash: 'abc123' } }))
      open()

      expect(container().style.background).toContain(`${environment.api.base}/auth/wallpaper/abc123`)
      expect(container()).not.toHaveClass('anim')
    })

    it('stays plain when there is no wallpaper', () => {
      open()

      expect(container().getAttribute('style')).toBeNull()
      expect(container()).toHaveClass('anim')
    })

    it('waits for the settings before deciding', () => {
      // The login page is often the first thing to render, before /auth/settings
      // has answered, so reading the hash too early would miss the wallpaper
      useSettingsStore.setState(makeSettingsState({ settingsLoaded: false, env: { customWallpaperHash: 'abc123' } }))
      open()
      expect(container().getAttribute('style')).toBeNull()

      act(() => {
        useSettingsStore.setState({ settingsLoaded: true })
      })

      expect(container().style.background).toContain('abc123')
    })
  })

  describe('focus', () => {
    it('puts the cursor in the username box on a desktop', () => {
      open()

      expect(document.activeElement).toBe(input('form-username'))
    })

    it('leaves the cursor alone on a touch device', () => {
      setMatchMedia(true)
      open()

      // iOS will not open the keyboard without a gesture, so focusing here would
      // show a focus ring and nothing else
      expect(document.activeElement).not.toBe(input('form-username'))
    })
  })
})
