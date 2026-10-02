import type { Guard } from './guard-utils'

import { authActions, useAuthStore } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'

import { redirect, rememberTargetRoute } from './guard-utils'

/** Signed-in admins only (Angular `adminGuard`). */
export const requireAdmin: Guard = async ({ request }) => {
  // Ensure app settings are loaded
  await settingsActions.whenLoaded()

  // Wait for the bootstrap token load before the admin refresh below so the
  // admin-demotion check never races initial token validation.
  await authActions.tokenReady()

  // If not using form auth, get a token automatically
  if (useSettingsStore.getState().formAuth === false) {
    await authActions.noauth()
    return null
  }

  if (!await authActions.isAuthenticated()) {
    rememberTargetRoute(request)
    return redirect('/login')
  }

  // Force a server roundtrip so admin-demoted users lose UI access within one
  // navigation instead of waiting for the JWT to expire. The backend rejects
  // /auth/refresh when the user's admin flag has changed; refreshSession()
  // then logs the user out via the rejection path.
  try {
    await authActions.refreshSession('admin-guard')
  } catch {
    rememberTargetRoute(request)
    return redirect('/login')
  }

  if (useAuthStore.getState().user?.admin) {
    return null
  }

  // User is authenticated but not admin - show error and redirect to home
  toast.error(i18n.t('toast.no_auth'), i18n.t('toast.title_error'))
  return redirect('/')
}
