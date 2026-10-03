import type { FakeApi } from '@/testing/fakes/api.fake'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, resetAuthStore, useAuthStore } from '@/core/auth/auth.store'
import { makeJwt, stubLocationReload, TEST_INSTANCE_ID } from '@/core/auth/auth.testing'
import { getStoredToken } from '@/core/auth/token-store'
import { notifications } from '@/core/notifications'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import { fakeApi } from '@/testing/fakes/api.fake'

vi.mock('@/core/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key), changeLanguage: vi.fn(async () => {}) },
}))

describe('auth store', () => {
  let api: FakeApi
  let getAppSettings: ReturnType<typeof vi.spyOn>
  let locationReload: ReturnType<typeof vi.fn>
  const state = () => useAuthStore.getState()

  /**
   * Start a page load. The session restore immediately exchanges the refresh
   * cookie for a token, so a spec that wants to start signed out registers a
   * failure for `/auth/session` before calling this.
   * @param overrides - settings fields the spec cares about
   */
  async function create(overrides: Record<string, any> = {}): Promise<void> {
    resetAuthStore()
    resetSettingsStore()
    notifications.reset()
    useSettingsStore.setState({
      env: { instanceId: TEST_INSTANCE_ID } as any,
      formAuth: true,
      sessionTimeout: 28800,
      sessionTimeoutInactivityBased: false,
      serverTimeOffset: 0,
      settingsLoaded: true,
      ...overrides,
    })
    getAppSettings = vi.spyOn(settingsActions, 'getAppSettings').mockResolvedValue(undefined)
    await authActions.init()
  }

  beforeEach(() => {
    locationReload = stubLocationReload()
    api = fakeApi()
      .respond('post', '/auth/session', {})
      .respond('post', '/auth/logout', {})
  })

  afterEach(() => {
    resetAuthStore()
    resetSettingsStore()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('signing in', () => {
    it('keeps the token and the decoded user', async () => {
      await create()
      api.respond('post', '/auth/login', { access_token: makeJwt({ username: 'bwp91' }) })

      await authActions.login({ username: 'bwp91', password: 'secret' })

      expect(state().user.username).toBe('bwp91')
      expect(getStoredToken()).toBe(state().token)
    })

    it('re-reads the settings once signed in', async () => {
      await create()
      api.respond('post', '/auth/login', { access_token: makeJwt() })

      await authActions.login({ username: 'admin', password: 'secret' })

      // An unauthenticated GET /auth/settings returns a reduced object, so the
      // whole session would run on the pre-login subset without this
      expect(getAppSettings).toHaveBeenCalled()
    })

    it('rejects a token that is already expired', async () => {
      await create()
      api.respond('post', '/auth/login', { access_token: makeJwt({}, -60) })

      await expect(authActions.login({ username: 'admin', password: 'secret' })).rejects.toThrow('Invalid username or password.')
    })
  })

  describe('restoring a session on page load', () => {
    it('exchanges the refresh cookie for a token', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt({ username: 'restored' }) })

      await create()

      expect(state().user.username).toBe('restored')
      expect(api.lastCall('post', '/auth/session')?.options).toMatchObject({ withCredentials: true })
    })

    it('settles as signed out when there is no session', async () => {
      api.fail('post', '/auth/session', { status: 401 })

      // Not being signed in is the ordinary case, so this must resolve rather
      // than reject - the guards decide what happens next, and a rejection
      // here would block the whole boot
      await create()

      expect(state().token).toBeNull()
    })
  })

  describe('a user still on the old two-factor secret', () => {
    it('raises the notification so the ui can prompt them to move over', async () => {
      // ⚠️ The old secret still works, so nothing else would tell the user their
      // second factor is on a format that is going away.
      //
      // ⚠️ Registered before `create()`: the token is read and decoded as the
      // page loads, so a response arranged afterwards is never seen
      api.respond('post', '/auth/session', { access_token: makeJwt({ otpLegacySecret: 'OLDSECRET' }) })

      await create()

      expect(notifications.get('legacyOtpDetected')).toBe(true)
    })

    it('says nothing for a user who has already moved over', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })

      await create()

      expect(notifications.get('legacyOtpDetected')).toBe(false)
    })
  })

  describe('isLoggedIn', () => {
    it('is true for a valid token from this instance', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create()

      expect(authActions.isLoggedIn()).toBeTruthy()
    })

    it('is false when the token was issued by another homebridge instance', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt({ instanceId: 'a-different-instance' }) })
      await create()

      expect(authActions.isLoggedIn()).toBe(false)
    })

    it('is false with no token at all', async () => {
      await create()

      expect(authActions.isLoggedIn()).toBeFalsy()
    })
  })

  describe('logging out', () => {
    it('clears the session and reloads the page', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create()

      authActions.logout()

      // Cleared synchronously: the server cleanup is best effort and must not
      // leave the ui signed in if it stalls
      expect(state().token).toBeNull()
      expect(getStoredToken()).toBeNull()
      expect(state().user).toEqual({})

      await vi.waitFor(() => expect(locationReload).toHaveBeenCalledTimes(1))
    })

    it('still reloads when the server cannot be reached', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      api.fail('post', '/auth/logout', new Error('offline'))
      await create()

      authActions.logout()

      await vi.waitFor(() => expect(locationReload).toHaveBeenCalledTimes(1))
    })

    it('asks the server to clear the cookies', async () => {
      await create()

      authActions.logout()

      // Without this the browser keeps a usable refresh cookie and the reload
      // silently restores the session the user just ended
      expect(api.lastCall('post', '/auth/logout')?.options).toMatchObject({ withCredentials: true })
    })
  })

  describe('checkToken', () => {
    it('logs out without asking the server when the token has expired', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt({}, 3600) })
      await create()
      useAuthStore.setState({ token: makeJwt({}, -60) })

      await authActions.checkToken()

      expect(api.callsTo('get', '/auth/check')).toHaveLength(0)
      expect(state().token).toBeNull()
    })

    it('logs out and rethrows when the server rejects the token', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      api.fail('get', '/auth/check', { status: 401 })
      await create()

      await expect(authActions.checkToken()).rejects.toEqual({ status: 401 })
      expect(state().token).toBeNull()
    })

    it('rethrows other failures without logging out', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      api.fail('get', '/auth/check', { status: 500 })
      await create()

      await expect(authActions.checkToken()).rejects.toEqual({ status: 500 })
      // A server hiccup is not a reason to end the session
      expect(state().token).not.toBeNull()
    })
  })

  describe('refreshing the session', () => {
    it('re-decodes the user from the new token', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt({ admin: true }) })
      await create()
      api.respond('post', '/auth/refresh', { access_token: makeJwt({ admin: false }) })

      await authActions.refreshSession('admin-guard')

      // Otherwise an admin who was just demoted keeps their admin menus until
      // the page is reloaded
      expect(state().user.admin).toBe(false)
    })

    it('sends the reason so the server log says why', async () => {
      await create()
      api.respond('post', '/auth/refresh', { access_token: makeJwt() })

      await authActions.refreshSession('session-extension')

      expect(api.lastCall('post', '/auth/refresh')?.body).toEqual({ reason: 'session-extension' })
    })

    it('signs the user out when the new token is not usable', async () => {
      // ⚠️ Whatever came back is not a token this instance can read. Carrying on
      // would leave the app signed in against a token it cannot decode, so the
      // session is dropped and the failure passed to the caller
      await create()
      api.respond('post', '/auth/refresh', { access_token: 'not-a-jwt-at-all' })

      await expect(authActions.refreshSession('admin-guard')).rejects.toThrow()
      expect(authActions.isLoggedIn()).toBe(false)
    })

    it('signs out this browser only when the server refuses the refresh', async () => {
      // ⚠️ #2981. `validateUser()` never checks `sessionStartedAt`, so a token
      // past the 30-day renewal cap still authorises - only `refreshToken()`
      // rejects it. An account-wide logout here would hand the server a token
      // it honours and end the user's sessions on every other device, for a
      // logout nobody asked for.
      await create()
      api.fail('post', '/auth/refresh', { status: 401 })

      await expect(authActions.refreshSession('admin-guard')).rejects.toEqual({ status: 401 })

      expect(api.lastCall('post', '/auth/logout')?.body).toEqual({ scope: 'local' })
    })

    it('leaves the session alone when the refresh merely fails to arrive', async () => {
      // A server hiccup or a dropped connection is not a refusal
      await create()
      api.fail('post', '/auth/refresh', { status: 500 })

      await expect(authActions.refreshSession('admin-guard')).rejects.toEqual({ status: 500 })

      expect(api.callsTo('post', '/auth/logout')).toHaveLength(0)
    })

    it('makes one request when called twice at once', async () => {
      await create()
      let release: (value: any) => void = () => {}
      api.respond('post', '/auth/refresh', () => new Promise((resolve) => {
        release = resolve
      }))

      const first = authActions.refreshSession()
      const second = authActions.refreshSession()
      release({ access_token: makeJwt() })
      await Promise.all([first, second])

      expect(api.callsTo('post', '/auth/refresh')).toHaveLength(1)
    })
  })

  describe('a token that cannot be read at all', () => {
    it('settles signed out rather than throwing on page load', async () => {
      // ⚠️ Unlike a sign-in, a failed session restore must not throw: it runs from
      // the constructor, and a rejection there leaves the whole app unbootable
      // instead of showing the login page
      api.respond('post', '/auth/session', { access_token: 'header.not-valid-base64.signature' })

      await create()

      expect(authActions.isLoggedIn()).toBe(false)
      expect(state().token).toBeNull()
    })

    it('refuses a sign-in whose token cannot be read', async () => {
      await create()
      api.respond('post', '/auth/login', { access_token: 'header.not-valid-base64.signature' })

      await expect(authActions.login({ username: 'admin', password: 'x' })).rejects.toThrow()
      expect(authActions.isLoggedIn()).toBe(false)
    })
  })

  describe('the inactivity timer', () => {
    it('signs the user out when the session expires', async () => {
      vi.useFakeTimers()
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: true, sessionTimeout: 60 })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(state().token).toBeNull()
    })

    it('asks the server for a local sign-out, not an account-wide one', async () => {
      // Since the server revokes every session on a normal logout, an idle tab
      // here would otherwise end the user's active sessions on every other
      // device. Nobody chose this logout, so it reaches only this browser.
      vi.useFakeTimers()
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: true, sessionTimeout: 60 })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(state().token).toBeNull()
      expect(api.lastCall('post', '/auth/logout')?.body).toMatchObject({ scope: 'local' })
    })

    it('keeps a logout the user chose account-wide', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: true })

      authActions.logout()

      expect(api.lastCall('post', '/auth/logout')?.body ?? {}).not.toHaveProperty('scope')
    })

    it('quietly signs back in when the ui has no login', async () => {
      vi.useFakeTimers()
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      api.respond('post', '/auth/noauth', { access_token: makeJwt() })
      await create({ formAuth: false, sessionTimeout: 60 })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(api.callsTo('post', '/auth/noauth')).toHaveLength(1)
      expect(locationReload).toHaveBeenCalledTimes(1)
    })

    it('gives up reloading after a few attempts in one session', async () => {
      vi.useFakeTimers()
      window.sessionStorage.setItem('uix.noauthReloadCount', '3')
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      api.respond('post', '/auth/noauth', { access_token: makeJwt() })
      await create({ formAuth: false, sessionTimeout: 60 })

      await vi.advanceTimersByTimeAsync(60_000)

      // The budget is what stops a bouncing server trapping the tab in an
      // endless reload loop
      expect(locationReload).not.toHaveBeenCalled()
    })

    it('clamps a session timeout that a browser timer cannot hold', async () => {
      vi.useFakeTimers()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.respond('post', '/auth/session', { access_token: makeJwt({}, 60 * 60 * 24 * 365) })

      // setTimeout takes a signed 32-bit millisecond count, so anything past
      // ~24.8 days silently never fires
      await create({ sessionTimeout: 60 * 60 * 24 * 30 })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('clamped'))
    })
  })

  describe('extending the session on activity', () => {
    it('does nothing when inactivity based sessions are off', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: true, sessionTimeoutInactivityBased: false })

      await authActions.checkAndRefreshIfNeeded()

      expect(api.callsTo('post', '/auth/refresh')).toHaveLength(0)
    })

    it('does nothing when the ui has no login', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: false, sessionTimeoutInactivityBased: true })

      await authActions.checkAndRefreshIfNeeded()

      expect(api.callsTo('post', '/auth/refresh')).toHaveLength(0)
    })

    it('waits until most of the session has passed', async () => {
      vi.useFakeTimers()
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: true, sessionTimeoutInactivityBased: true, sessionTimeout: 100 })
      api.respond('post', '/auth/refresh', { access_token: makeJwt() })

      // 69% through - still plenty of time left, so no request
      await vi.advanceTimersByTimeAsync(69_000)
      await authActions.checkAndRefreshIfNeeded()
      expect(api.callsTo('post', '/auth/refresh')).toHaveLength(0)

      // past 70%, so the session is topped up
      await vi.advanceTimersByTimeAsync(2_000)
      await authActions.checkAndRefreshIfNeeded()
      expect(api.callsTo('post', '/auth/refresh')).toHaveLength(1)
    })

    it('survives a failed refresh', async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create({ formAuth: true, sessionTimeoutInactivityBased: true, sessionTimeout: 100 })
      api.fail('post', '/auth/refresh', new Error('offline'))

      await vi.advanceTimersByTimeAsync(71_000)

      // The user is signed out by the timer if this keeps failing, which is
      // the intended fallback - it must not throw at the call site
      await expect(authActions.checkAndRefreshIfNeeded()).resolves.toBeUndefined()
    })
  })

  /**
   * The single question every guard asks (AuthHelperService). It also tidies
   * up: a token that has gone or stopped being valid is cleared here, so the
   * rest of the app does not keep a half-signed-in state around.
   */
  describe('isAuthenticated', () => {
    it('confirms a signed-in user', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create()

      await expect(authActions.isAuthenticated()).resolves.toBe(true)
    })

    it('reports a missing token and clears what is left behind', async () => {
      await create()
      useAuthStore.setState({ token: 'left-behind', user: { username: 'admin' } })

      await expect(authActions.isAuthenticated()).resolves.toBe(false)
      expect(state().token).toBeNull()
      expect(state().user).toEqual({})
    })

    it('clears the session when the token is no longer valid', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create()
      vi.spyOn(authActions, 'isLoggedIn').mockReturnValue(false)

      await expect(authActions.isAuthenticated()).resolves.toBe(false)
      expect(state().token).toBeNull()
      expect(state().user).toEqual({})
    })

    it('signs the user out when the check itself fails', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create()
      vi.spyOn(authActions, 'isLoggedIn').mockImplementation(() => {
        throw new Error('malformed token')
      })

      await expect(authActions.isAuthenticated()).resolves.toBe(false)
      expect(api.callsTo('post', '/auth/logout')).toHaveLength(1)
    })
  })

  /**
   * The 401 rule of the old auth error interceptor, as the auth store wires it
   * into the api wrapper.
   */
  describe('an unexpected 401 from any request', () => {
    async function reject401(path: string) {
      // The real api wrapper this time, over a fetch that refuses everything
      vi.mocked(api.get).mockRestore()
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401, statusText: 'Unauthorized' })))
      const { api: realApi } = await import('@/core/api')
      await realApi.get(path).catch(() => {})
    }

    it('signs the user out', async () => {
      api.respond('post', '/auth/session', { access_token: makeJwt() })
      await create()

      await reject401('/plugins')

      expect(state().token).toBeNull()
      expect(api.callsTo('post', '/auth/logout')).toHaveLength(1)
    })

    it('does nothing when there is no session to end', async () => {
      // Guards against a logout loop while the app is still starting up
      await create()

      await reject401('/plugins')

      expect(api.callsTo('post', '/auth/logout')).toHaveLength(0)
    })
  })
})
