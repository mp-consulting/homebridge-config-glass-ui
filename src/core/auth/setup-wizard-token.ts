/**
 * The setup-wizard token: what the first-run wizard uses to restore a backup
 * before any user exists. It carries `admin: true` (the restore endpoints are
 * admin-only), so it is confined to exactly the calls that flow makes - it is
 * not a general administrator credential for its five minutes.
 */

import { API_PREFIX } from '../api.constants.js'

export const SETUP_WIZARD_USERNAME = 'setup-wizard'

/** The claim that marks a token as the setup wizard's */
export const SETUP_WIZARD_CLAIM = 'setupWizard'

/**
 * The HTTP routes the wizard's "restore a backup" step calls with the token
 * (ui/src/modules/setup-wizard/SetupWizard.tsx). The `/setup-wizard/*` routes
 * themselves need no token - they are gated by SetupWizardGuard alone.
 */
const SETUP_WIZARD_TOKEN_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['POST', '/backup/restore'],
  ['PUT', '/backup/restart'],
]

/** The socket namespaces the restore step uses (`do-restore`) */
const SETUP_WIZARD_TOKEN_NAMESPACES: readonly string[] = ['/backup']

/**
 * Whether a verified token payload claims to be the setup wizard's. Whether
 * it is still usable, and where, is up to the functions below.
 */
export function isSetupWizardToken(payload: unknown): boolean {
  const claims = payload as Record<string, unknown> | null | undefined
  return claims?.username === SETUP_WIZARD_USERNAME && claims?.[SETUP_WIZARD_CLAIM] === true
}

/**
 * Whether a verified payload is a setup-wizard token and the wizard is still
 * in progress. Once the first user exists, the token is dead everywhere.
 */
export function isLiveSetupWizardToken(payload: unknown, configService: { setupWizardComplete: boolean }): boolean {
  return isSetupWizardToken(payload) && configService.setupWizardComplete === false
}

/**
 * Whether the setup-wizard token may call this route. `routePath` is the
 * matched route's pattern (Fastify `routeOptions.url`), with or without the
 * global `/api` prefix; a trailing slash is ignored.
 */
export function isSetupWizardTokenRoute(method: string | undefined, routePath: string | undefined): boolean {
  if (!method || !routePath) {
    return false
  }
  let path = routePath.split('?')[0]
  if (path.startsWith(`${API_PREFIX}/`)) {
    path = path.slice(API_PREFIX.length)
  }
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return SETUP_WIZARD_TOKEN_ROUTES.some(([m, p]) => m === method.toUpperCase() && p === path)
}

/** Whether the setup-wizard token may be used on this socket namespace */
export function isSetupWizardTokenNamespace(namespace: string | undefined): boolean {
  return typeof namespace === 'string' && SETUP_WIZARD_TOKEN_NAMESPACES.includes(namespace)
}
