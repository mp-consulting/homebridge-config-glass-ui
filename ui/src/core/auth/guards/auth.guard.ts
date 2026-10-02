import type { Guard } from './guard-utils'

import { authActions } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'

import { redirect, rememberTargetRoute } from './guard-utils'

/** Signed-in users only (Angular `authGuard`). */
export const requireAuth: Guard = async ({ request }) => {
  // Ensure app settings are loaded
  await settingsActions.whenLoaded()

  // Wait for the bootstrap token load so a fast first navigation does not make
  // authentication decisions before the stored token has been validated.
  await authActions.tokenReady()

  const settings = useSettingsStore.getState()

  // Fresh install: short-circuit straight to the setup wizard instead of
  // bouncing through /login first
  if (settings.env.setupWizardComplete === false) {
    return redirect('/setup')
  }

  // If not using form auth, get a token automatically
  if (settings.formAuth === false) {
    await authActions.noauth()
    return null
  }

  if (await authActions.isAuthenticated()) {
    // Refresh token if needed on navigation
    await authActions.checkAndRefreshIfNeeded()
    return null
  }

  // Not authenticated - redirect to login page
  rememberTargetRoute(request)
  return redirect('/login')
}
