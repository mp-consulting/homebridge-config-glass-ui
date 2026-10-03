import type { Guard } from './guard-utils'

import { authActions } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'

import { redirect } from './guard-utils'

/** The login page, for signed-out users only (Angular `loginGuard`). */
export const requireLoggedOut: Guard = async () => {
  // Ensure app settings are loaded
  await settingsActions.whenLoaded()

  // Wait for the bootstrap token load so isLoggedIn() reflects the restored
  // session rather than the pre-load empty state.
  await authActions.tokenReady()

  const settings = useSettingsStore.getState()
  if (settings.env.setupWizardComplete === false) {
    return redirect('/setup')
  }

  // Not using auth, or already logged in: back to the home screen
  if (settings.formAuth === false || authActions.isLoggedIn()) {
    return redirect('/')
  }

  return null
}
