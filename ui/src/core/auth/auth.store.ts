import type { UserInterface } from '@/core/auth/auth.interfaces'

import { create } from 'zustand'

import { api, setUnauthorizedHandler } from '@/core/api'
import { decodeToken, isTokenExpired } from '@/core/auth/jwt'
import { getStoredToken, setStoredToken } from '@/core/auth/token-store'
import { notifications } from '@/core/notifications'
import { settingsActions, useSettingsStore } from '@/core/settings'

/**
 * The signed-in user and their token. Replaces AuthService (+ AuthHelperService):
 * read with `useAuthStore(s => s.user)`, act through `authActions`.
 */
export interface AuthState {
  token: string | null
  user: UserInterface
}

export const useAuthStore = create<AuthState>()(() => ({
  token: null,
  user: {} as UserInterface,
}))

const get = () => useAuthStore.getState()
const set = (partial: Partial<AuthState>) => useAuthStore.setState(partial)
const settings = () => useSettingsStore.getState()

/** Where the inactivity-reload budget is kept for this tab. */
const NOAUTH_RELOAD_COUNTER_KEY = 'uix.noauthReloadCount'
const NOAUTH_RELOAD_BUDGET = 3

/** setTimeout accepts a signed 32-bit ms count (max ≈ 24.8 days). */
const TIMER_MAX_MS = 2147483647

let logoutTimer: ReturnType<typeof setTimeout> | undefined
let lastRefreshTime = Date.now()
let isRefreshing = false
let tokenReady: Promise<void> | null = null

export const authActions = {
  /**
   * Restore the session on page load (what AuthService's constructor did): starts
   * the settings load, waits for it, then exchanges the refresh cookie. The
   * returned promise is `tokenReady` - guards that check `isLoggedIn()` at
   * startup await it so they don't see the pre-load empty state. Idempotent.
   */
  init(): Promise<void> {
    if (!tokenReady) {
      lastRefreshTime = Date.now()
      settingsActions.start()
      tokenReady = authActions.loadToken()
    }
    return tokenReady
  },

  /** Resolves once the session restore has finished (starting it if needed). */
  tokenReady(): Promise<void> {
    return authActions.init()
  },

  async login(form: { username: string, password: string, otp?: string }): Promise<void> {
    const resp = await api.post('/auth/login', form, { withCredentials: true })
    if (!validateToken(resp.access_token)) {
      throw new Error('Invalid username or password.')
    }
    setStoredToken(resp.access_token)
    await settingsActions.getAppSettings() // update settings to get full settings object
  },

  async noauth(): Promise<void> {
    const resp = await api.post('/auth/noauth', {}, { withCredentials: true })
    if (!validateToken(resp.access_token)) {
      throw new Error('Invalid username or password.')
    }
    setStoredToken(resp.access_token)
    await settingsActions.getAppSettings() // update settings to get full settings
  },

  /**
   * @param options - how far the logout reaches
   * @param options.scope - `'local'` signs out this browser only. The inactivity
   * timer uses it because it fires while the token is still valid, and a full
   * logout revokes the account's sessions everywhere - so without it, one idle
   * tab forgotten on another machine ends the user's active session here.
   * A logout the user actually asked for stays account-wide.
   */
  logout(options?: { scope?: 'local' }): void {
    clearTimeout(logoutTimer)
    // Clear the HttpOnly cookies server-side before reloading. Without this the
    // browser would still hold a valid hb-refresh cookie and the reload would
    // silently restore the session the user just ended.
    // Start the request while the bearer token is still available, then clear
    // local authentication immediately. The server cleanup is best-effort and
    // must not leave the UI signed in if it stalls.
    const logoutRequest = api.post('/auth/logout', options?.scope ? { scope: options.scope } : {}, { withCredentials: true })
    set({ user: {} as UserInterface, token: null })
    setStoredToken(null)
    Promise.resolve(logoutRequest)
      .catch(() => { /* logging out regardless */ })
      .finally(() => {
        window.location.reload()
      })
  },

  async loadToken(): Promise<void> {
    await settingsActions.whenLoaded()
    // The access token is only ever held in memory, so a page load starts with
    // nothing. Exchange the HttpOnly hb-refresh cookie for a fresh token.
    // Plugin UIs use their own short-lived, single-use tickets (#2893).
    //
    // A failure here is the normal "not signed in" case — the route guards send
    // the user to /login — so it must never throw and block boot.
    try {
      const resp = await api.post('/auth/session', {}, { withCredentials: true })
      if (resp?.access_token) {
        setStoredToken(resp.access_token)
        validateToken(resp.access_token)
        // ⚠️ Re-read the settings now that a token exists. GET /auth/settings
        // returns a REDUCED object to unauthenticated callers — `enableAccessories`,
        // `enableTerminalAccess`, `restrictLogsToAdmins` and friends are only sent
        // to an authorised request (see ConfigService.uiSettings). The first
        // settings fetch runs before there is a token, so without this second
        // fetch the whole session ran on the pre-login subset. login()/noauth()
        // do the same thing for the same reason.
        //
        // Awaited deliberately: tokenReady must not resolve until the authorised
        // settings are in place, because the route guards gate on it.
        await settingsActions.getAppSettings()
      }
    } catch {
      setStoredToken(null)
      set({ token: null })
    }
  },

  async checkToken(): Promise<any> {
    const { token } = get()
    // First do a quick client-side check if token is expired to avoid API call
    if (!token || isTokenExpired(token, settings().serverTimeOffset)) {
      console.warn('Token expired on client side, logging out immediately')
      authActions.logout()
      return undefined
    }

    try {
      return await api.get('/auth/check')
    } catch (err: any) {
      if (err?.status === 401) {
        // Token is no longer valid on server side, perform logout
        console.warn('Current token is not valid on server')
        authActions.logout()
      }
      throw err
    }
  },

  isLoggedIn(): boolean {
    const { user, token } = get()
    if (settings().env.instanceId !== user.instanceId) {
      console.error('Token does not match instance')
      return false
    }
    return !!(user && token && !isTokenExpired(token, settings().serverTimeOffset))
  },

  /**
   * Whether the user is signed in, clearing the auth state when they are not
   * (AuthHelperService.isAuthenticated).
   */
  async isAuthenticated(): Promise<boolean> {
    const token = getStoredToken()
    if (!token) {
      set({ token: null, user: {} as UserInterface })
      return false
    }

    try {
      const loggedIn = authActions.isLoggedIn()
      // If token is expired on client side, clear it immediately
      if (!loggedIn) {
        set({ token: null, user: {} as UserInterface })
      }
      return loggedIn
    } catch {
      console.warn('Token validation error, clearing auth state')
      authActions.logout()
      return false
    }
  },

  /**
   * Check if the session needs to be refreshed and do so if needed.
   * Called on user navigation/interaction.
   */
  async checkAndRefreshIfNeeded(): Promise<void> {
    const { formAuth, sessionTimeoutInactivityBased, sessionTimeout } = settings()
    // Only perform refresh if form auth is enabled and the feature is enabled
    if (!formAuth || !sessionTimeoutInactivityBased) {
      return
    }

    if (!get().token || !authActions.isLoggedIn() || isRefreshing) {
      return
    }

    const timeSinceLastRefresh = Date.now() - lastRefreshTime
    const refreshThreshold = sessionTimeout * 1000 * 0.7 // Refresh when 70% of timeout has elapsed

    if (timeSinceLastRefresh > refreshThreshold) {
      try {
        await authActions.refreshSession('session-extension')
      } catch (err) {
        console.error('Failed to refresh session:', err)
        // On error, the user will be logged out when the timer expires
      }
    }
  },

  /**
   * Refresh the current session by getting a new token.
   *
   * A refusal signs THIS browser out and nothing else. Every reason the server
   * refuses a refresh - the user is gone, permissions changed, credentials
   * changed, wrong instance - already invalidates that token everywhere, so a
   * wider logout gains nothing. The exception is the 30-day renewal cap, where
   * the user's other devices are legitimately still signed in and an
   * account-wide logout would end them (#2981).
   * @param reason - optional allowlisted reason for distinct server log lines
   */
  async refreshSession(reason?: 'admin-guard' | 'session-extension' | 'profile-update'): Promise<void> {
    if (isRefreshing) {
      return
    }
    isRefreshing = true

    try {
      const resp = await api.post('/auth/refresh', reason ? { reason } : {}, { withCredentials: true })
      if (resp?.access_token) {
        setStoredToken(resp.access_token)
        // Re-decode the user from the new payload. Otherwise admin demotion /
        // OTP-legacy state would persist in memory until a full reload. This
        // also resets the logout timer.
        if (!validateToken(resp.access_token)) {
          throw new Error('Refreshed access token failed validation')
        }
        lastRefreshTime = Date.now()
      }
    } catch (error: any) {
      // Only a refusal, never a connection problem - a blip on the way to the
      // server must not sign anybody out.
      if (error?.status === 401) {
        authActions.logout({ scope: 'local' })
      }
      throw error
    } finally {
      isRefreshing = false
    }
  },
}

/**
 * Decode and keep a token, arming the inactivity timer. Returns true when the
 * token is usable; an expired one triggers a logout, an unreadable one clears
 * the session.
 * @param token - the access token
 */
function validateToken(token: string): boolean | undefined {
  try {
    if (isTokenExpired(token, settings().serverTimeOffset)) {
      authActions.logout()
      return undefined
    }
    set({
      user: decodeToken<UserInterface>(token) ?? ({} as UserInterface),
      token,
    })
    setLogoutTimer()

    // Check if user has legacy OTP secret and emit notification
    if (get().user.otpLegacySecret) {
      notifications.set('legacyOtpDetected', true)
    }

    return true
  } catch {
    setStoredToken(null)
    set({ token: null })
    return false
  }
}

function setLogoutTimer() {
  clearTimeout(logoutTimer)
  const { token } = get()
  if (!token || isTokenExpired(token, settings().serverTimeOffset)) {
    return
  }

  // sessionTimeout is admin-configurable seconds; values that produce a larger
  // ms count than setTimeout can hold silently never time out — and silently is
  // the problem. Clamp so the timer always arms, and say so.
  const { sessionTimeout } = settings()
  const requested = sessionTimeout * 1000
  const inactivityTimeout = Math.min(requested, TIMER_MAX_MS)
  if (requested > TIMER_MAX_MS) {
    console.warn(`Inactivity timeout ${sessionTimeout}s exceeds the browser setTimeout limit; clamped to ~24.8 days.`)
  }

  logoutTimer = setTimeout(async () => {
    if (settings().formAuth === false) {
      // Guard the auto-reload with a per-session budget so a recurring
      // failure (network down, server bouncing) can't trap the tab in an
      // endless reload loop.
      const count = Number(window.sessionStorage.getItem(NOAUTH_RELOAD_COUNTER_KEY) ?? '0') + 1
      if (count > NOAUTH_RELOAD_BUDGET) {
        console.warn('Skipping noauth re-login reload — retry budget exhausted this session.')
        return
      }
      try {
        await authActions.noauth()
        window.sessionStorage.setItem(NOAUTH_RELOAD_COUNTER_KEY, String(count))
        window.location.reload()
      } catch (e) {
        console.warn('noauth re-login failed:', e)
      }
    } else {
      // Nobody chose this logout - end this browser's session, not the
      // account's sessions on every other device
      authActions.logout({ scope: 'local' })
    }
  }, inactivityTimeout)
}

// The 401 rule of the old auth error interceptor: an authorised request that
// comes back 401 ends the session - but only when there is one, which guards
// against a logout loop while the app is still starting up.
setUnauthorizedHandler(() => {
  if (get().token) {
    authActions.logout()
  }
})

/** Put the store back to a fresh page load. For specs. */
export function resetAuthStore(): void {
  clearTimeout(logoutTimer)
  logoutTimer = undefined
  lastRefreshTime = Date.now()
  isRefreshing = false
  tokenReady = null
  setStoredToken(null)
  useAuthStore.setState({ token: null, user: {} as UserInterface }, true)
}
