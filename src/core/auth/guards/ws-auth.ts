import type { UserDto } from '../../../modules/users/users.dto.js'
import type { ConfigService } from '../../config/config.service.js'
import type { AuthService } from '../auth.service.js'

import jwt from 'jsonwebtoken'

import { extractWsToken } from './ws-token.js'

export type WsUser = UserDto & { instanceId?: string }

/**
 * Verify the token a socket connected with and check it against the stored
 * user. Throws if the token is invalid, stale or its user no longer matches.
 *
 * Mirrors JwtStrategy.validate: a mismatched instanceId is rejected so the
 * setup-wizard token (intentionally signed with a wrong instanceId) cannot
 * reach socket endpoints once the wizard has completed, and validateUser
 * catches a deleted or demoted user, or changed credentials.
 */
export async function verifyWsClient(
  client: any,
  configService: ConfigService,
  authService: AuthService,
  options: { ignoreExpiration?: boolean } = {},
): Promise<WsUser> {
  const payload = jwt.verify(extractWsToken(client.handshake), configService.secrets.secretKey, {
    ignoreExpiration: options.ignoreExpiration,
  }) as WsUser

  if (payload?.instanceId !== configService.instanceId) {
    const isLiveWizardToken = payload?.username === 'setup-wizard'
      && configService.setupWizardComplete === false
    if (!isLiveWizardToken) {
      throw new Error('Stale token')
    }
  }

  if (!await authService.validateUser(payload)) {
    throw new Error('User no longer valid')
  }

  return payload
}

/**
 * Remember the verified user on the socket, with a way to re-check it later.
 *
 * Guards only run on `@SubscribeMessage` handlers. Services that bind raw
 * `client.on(...)` listeners after a guarded message (terminal stdin, custom
 * plugin UI requests, accessory control) must call `isWsClientAuthorized`
 * before acting, or a user who is deleted, demoted or has their password
 * changed keeps that access for as long as the socket stays open.
 */
export function rememberWsUser(client: any, user: WsUser, revalidate: () => Promise<WsUser>): void {
  if (client.data) {
    client.data.user = user
    client.data.verifiedAt = Date.now()
    client.data.revalidateUser = revalidate
  }
}

/**
 * Re-check the socket's user before acting on a raw listener's event.
 * Disconnects the socket when the user is no longer allowed.
 *
 * The token's expiry is not re-checked here: a socket keeps the token it
 * connected with, which can expire while the session is still legitimately in
 * use (the UI refreshes its token over HTTP). What matters is whether its user
 * is still current - validateUser, which is cached for a few seconds.
 */
export async function isWsClientAuthorized(client: any, options: { admin: boolean }): Promise<boolean> {
  try {
    const revalidate = client.data?.revalidateUser as (() => Promise<WsUser>) | undefined
    if (!revalidate) {
      throw new Error('Socket was never authorised')
    }
    const user = await revalidate()
    if (options.admin && !user.admin) {
      throw new Error('Not an administrator')
    }
    client.data.user = user
    client.data.verifiedAt = Date.now()
    return true
  } catch {
    client.disconnect(true)
    return false
  }
}

/**
 * How long a successful check stays good for. Matches the auth service's user
 * cache, so a revocation takes effect no later than it would on HTTP.
 */
const WS_RECHECK_INTERVAL_MS = 5000

function isRecentlyAuthorized(client: any, options: { admin: boolean }): boolean {
  return Date.now() - (client.data?.verifiedAt ?? 0) < WS_RECHECK_INTERVAL_MS
    && (!options.admin || client.data?.user?.admin === true)
}

/**
 * Build a runner that re-checks the socket's user before acting on a raw
 * listener's event.
 *
 * While the last successful check is fresh the action runs synchronously, as
 * it did before the check existed. Otherwise the check runs first, and actions
 * wait behind it strictly in arrival order - terminal input must never be
 * reordered, even when one check has to re-read the auth file.
 */
export function createAuthorizedRunner(client: any, options: { admin: boolean }): (action: () => unknown) => void {
  let queue: Promise<unknown> = Promise.resolve()
  let queued = 0

  return (action) => {
    if (queued === 0 && isRecentlyAuthorized(client, options)) {
      action()
      return
    }

    queued++
    queue = queue
      .then(async () => {
        // An earlier action in the queue may have just re-checked the user
        if (isRecentlyAuthorized(client, options) || await isWsClientAuthorized(client, options)) {
          await action()
        }
      })
      .catch(() => {
        // The action reports its own failures - keep the queue going
      })
      .finally(() => {
        queued--
      })
  }
}
