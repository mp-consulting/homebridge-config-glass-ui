import { i18n } from '@/core/ui/i18n'

/**
 * Build a user-facing toast message for a caught error.
 *
 * One rule across the whole app: surface a server-supplied `error.error.message`
 * when the backend provided one (these are short, contextual strings — e.g.
 * "Username already taken", "Plugin not found" — that the user actually
 * benefits from). Every other case (an ApiError without a server message, a
 * locally thrown Error with a developer-oriented `.message`, anything else)
 * collapses onto the same translated generic key so the UI never leaks the
 * auto-generated HTTP string ("Http failure response for /api/users: 500
 * Internal Server Error", always English), never leaks internal API paths, and
 * never surfaces developer-only thrown strings like "LevelControl cluster not
 * found".
 *
 * Callers should still log the raw error to console for debugging.
 * @param err - whatever was caught
 */
export function toToastMessage(err: unknown): string {
  const candidate = err as { error?: { message?: unknown } } | null
  const serverMessage = candidate?.error?.message
  if (typeof serverMessage === 'string' && serverMessage.trim().length > 0) {
    return serverMessage
  }
  return i18n.t('toast.api_error_generic')
}

/** The same function under the old service's shape, so ported call sites read the same. */
export const httpError = { toToastMessage }
