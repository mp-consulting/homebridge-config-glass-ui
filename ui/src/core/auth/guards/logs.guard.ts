import type { Guard } from './guard-utils'

import { authActions } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'

import { requireAdmin } from './admin.guard'
import { requireAuth } from './auth.guard'

/**
 * Guards the log viewer.
 *
 * The Homebridge log is readable by any signed-in user by default, which is the
 * long-standing behaviour. When an admin sets `restrictLogsToAdmins` in the UI
 * config, this defers to the admin guard instead — matching the backend, which
 * enforces the same rule on the log websocket (WsLogGuard). Without the route
 * guard a non-admin could still open /logs directly and get an empty terminal.
 */
export const logsGuard: Guard = async (args) => {
  // The delegates wait for these too, but the flag has to be read before
  // choosing which one to defer to.
  await settingsActions.whenLoaded()

  // ⚠️ Also wait for the bootstrap token load. `restrictLogsToAdmins` is only
  // sent to an authorised caller, and the first settings fetch runs before a
  // token exists — so reading the flag any earlier sees `undefined` on every
  // page load and silently falls back to the permissive guard.
  await authActions.tokenReady()

  const delegate = useSettingsStore.getState().env?.restrictLogsToAdmins ? requireAdmin : requireAuth
  return delegate(args)
}
