import type { Guard } from '@/core/auth/guards'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { authActions, resetAuthStore, useAuthStore } from '@/core/auth/auth.store'
import { TEST_INSTANCE_ID } from '@/core/auth/auth.testing'
import { logsGuard, requireAdmin, requireAuth, requireLoggedOut, routeUrl, setupWizardGuard } from '@/core/auth/guards'
import { resetSettingsStore, useSettingsStore } from '@/core/settings'
import { toast } from '@/core/ui/toast'

vi.mock('@/core/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key), changeLanguage: vi.fn(async () => {}) },
}))

/**
 * The route guards are the app's permission surface, so each one's outcomes
 * are pinned here: what it allows, where it sends the user instead, and what
 * it remembers on the way.
 *
 * The settings store reports itself already loaded and the session restore is
 * stubbed to an already-resolved promise; every guard waits on both.
 */
describe('route guards', () => {
  const request = new Request('http://localhost/plugins')

  function configure(options: {
    authenticated?: boolean
    settings?: Record<string, any>
    user?: Record<string, any>
    tokenReady?: Promise<void>
  } = {}) {
    resetAuthStore()
    resetSettingsStore()
    vi.mocked(toast.error).mockClear()

    const { env, ...settings } = options.settings ?? {}
    useSettingsStore.setState({
      env: { instanceId: TEST_INSTANCE_ID, setupWizardComplete: true, ...env } as any,
      formAuth: true,
      settingsLoaded: true,
      ...settings,
    })
    useAuthStore.setState({
      token: 'test-access-token',
      user: { username: 'admin', admin: true, instanceId: TEST_INSTANCE_ID, ...options.user },
    })

    vi.spyOn(authActions, 'tokenReady').mockImplementation(() => options.tokenReady ?? Promise.resolve())
    vi.spyOn(authActions, 'isAuthenticated').mockImplementation(async () => options.authenticated ?? true)
    vi.spyOn(authActions, 'isLoggedIn').mockImplementation(() => Boolean(useAuthStore.getState().token))
    vi.spyOn(authActions, 'noauth').mockResolvedValue(undefined)
    vi.spyOn(authActions, 'refreshSession').mockResolvedValue(undefined)
    vi.spyOn(authActions, 'checkAndRefreshIfNeeded').mockResolvedValue(undefined)
  }

  function run(guard: Guard): Promise<Response | null> {
    return guard({ request })
  }

  /** Where a guard result sends the user, or null when it lets them through. */
  async function outcome(guard: Guard): Promise<string | null> {
    const result = await run(guard)
    return result ? result.headers.get('Location') : null
  }

  afterEach(() => {
    vi.restoreAllMocks()
    resetAuthStore()
    resetSettingsStore()
  })

  describe('requireAuth', () => {
    it('lets a signed-in user through', async () => {
      configure({ authenticated: true })

      await expect(outcome(requireAuth)).resolves.toBeNull()
    })

    it('sends a signed-out user to the login page', async () => {
      configure({ authenticated: false })

      await expect(outcome(requireAuth)).resolves.toBe('/login')
    })

    it('remembers where the user was heading', async () => {
      configure({ authenticated: false })

      await run(requireAuth)

      // The login page reads this so the user lands where they meant to go
      expect(window.sessionStorage.getItem('target_route')).toBe('/plugins')
    })

    it('sends a fresh install to the setup wizard', async () => {
      configure({ settings: { env: { setupWizardComplete: false } } })

      await expect(outcome(requireAuth)).resolves.toBe('/setup')
    })

    it('signs the user in silently when the ui has no login', async () => {
      configure({ settings: { formAuth: false } })

      await expect(outcome(requireAuth)).resolves.toBeNull()
      expect(authActions.noauth).toHaveBeenCalled()
    })

    it('tops up the session on the way through', async () => {
      configure({ authenticated: true })

      await run(requireAuth)

      expect(authActions.checkAndRefreshIfNeeded).toHaveBeenCalled()
    })
  })

  describe('requireAdmin', () => {
    it('lets an admin through', async () => {
      configure({ authenticated: true, user: { admin: true } })

      await expect(outcome(requireAdmin)).resolves.toBeNull()
    })

    it('turns a non-admin away with a message', async () => {
      configure({ authenticated: true, user: { admin: false } })

      await expect(outcome(requireAdmin)).resolves.toBe('/')
      expect(toast.error).toHaveBeenCalledWith('toast.no_auth', 'toast.title_error')
    })

    it('checks with the server on every admin navigation', async () => {
      configure({ authenticated: true })

      await run(requireAdmin)

      // The backend rejects the refresh when the user's admin flag changed,
      // so a demoted admin loses access within one navigation
      expect(authActions.refreshSession).toHaveBeenCalledWith('admin-guard')
    })

    it('sends the user to login when that check is rejected', async () => {
      configure({ authenticated: true })
      vi.mocked(authActions.refreshSession).mockRejectedValue(new Error('admin flag changed'))

      await expect(outcome(requireAdmin)).resolves.toBe('/login')
      expect(window.sessionStorage.getItem('target_route')).toBe('/plugins')
    })

    it('sends a signed-out user to the login page', async () => {
      configure({ authenticated: false })

      await expect(outcome(requireAdmin)).resolves.toBe('/login')
    })

    it('signs the user in silently when the ui has no login', async () => {
      configure({ settings: { formAuth: false } })

      await expect(outcome(requireAdmin)).resolves.toBeNull()
      expect(authActions.noauth).toHaveBeenCalled()
    })
  })

  describe('requireLoggedOut', () => {
    it('shows the login page to a signed-out user', async () => {
      configure()
      vi.mocked(authActions.isLoggedIn).mockReturnValue(false)

      await expect(outcome(requireLoggedOut)).resolves.toBeNull()
    })

    it('sends an already signed-in user home', async () => {
      configure()
      vi.mocked(authActions.isLoggedIn).mockReturnValue(true)

      await expect(outcome(requireLoggedOut)).resolves.toBe('/')
    })

    it('sends a fresh install to the setup wizard', async () => {
      configure({ settings: { env: { setupWizardComplete: false } } })

      await expect(outcome(requireLoggedOut)).resolves.toBe('/setup')
    })

    it('has nothing to show when the ui has no login', async () => {
      configure({ settings: { formAuth: false } })
      vi.mocked(authActions.isLoggedIn).mockReturnValue(false)

      await expect(outcome(requireLoggedOut)).resolves.toBe('/')
    })
  })

  describe('setupWizardGuard', () => {
    it('opens the wizard on a fresh install', async () => {
      configure({ settings: { env: { setupWizardComplete: false } } })

      await expect(outcome(setupWizardGuard)).resolves.toBeNull()
    })

    it('sends everyone else home', async () => {
      configure({ settings: { env: { setupWizardComplete: true } } })

      await expect(outcome(setupWizardGuard)).resolves.toBe('/')
    })
  })

  describe('logsGuard', () => {
    it('lets any signed-in user read the log by default', async () => {
      configure({ authenticated: true, settings: { env: { restrictLogsToAdmins: false } }, user: { admin: false } })

      await expect(outcome(logsGuard)).resolves.toBeNull()
    })

    it('requires an admin once the log is restricted', async () => {
      configure({ authenticated: true, settings: { env: { restrictLogsToAdmins: true } }, user: { admin: false } })

      await expect(outcome(logsGuard)).resolves.toBe('/')
    })

    it('still admits an admin when the log is restricted', async () => {
      configure({ authenticated: true, settings: { env: { restrictLogsToAdmins: true } }, user: { admin: true } })

      await expect(outcome(logsGuard)).resolves.toBeNull()
      expect(authActions.refreshSession).toHaveBeenCalledWith('admin-guard')
    })

    it('reads the restriction only after the token has loaded', async () => {
      // `restrictLogsToAdmins` is only sent to an authorised caller, so the
      // flag is not there yet when the guard starts. Reading it any earlier
      // silently falls back to the permissive guard on every page load.
      let tokenLoaded: () => void = () => {}
      const tokenReady = new Promise<void>((resolve) => {
        tokenLoaded = resolve
      })
      configure({
        authenticated: true,
        settings: { env: { restrictLogsToAdmins: undefined } },
        user: { admin: false },
        tokenReady,
      })

      const decision = outcome(logsGuard)
      useSettingsStore.setState(state => ({ env: { ...state.env, restrictLogsToAdmins: true } }))
      tokenLoaded()

      await expect(decision).resolves.toBe('/')
    })
  })

  describe('the remembered url', () => {
    it('keeps the query and hash', () => {
      expect(routeUrl(new Request('http://localhost/plugins?search=hue#top'))).toBe('/plugins?search=hue#top')
    })

    it('drops the base href prefix when served from a subpath', () => {
      const base = document.createElement('base')
      base.setAttribute('href', '/homebridge/')
      document.head.appendChild(base)
      try {
        expect(routeUrl(new Request('http://localhost/homebridge/logs'))).toBe('/logs')
        expect(routeUrl(new Request('http://localhost/homebridge'))).toBe('/')
      } finally {
        base.remove()
      }
    })
  })
})
