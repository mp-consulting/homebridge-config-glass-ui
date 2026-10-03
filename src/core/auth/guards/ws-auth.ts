import type { EventEmitter } from 'node:events'
import type { Socket } from 'socket.io'

import type { UserDto } from '../../../modules/users/users.dto.js'
import type { ConfigService } from '../../config/config.service.js'
import type { AuthService } from '../auth.service.js'

import { JwtService } from '@nestjs/jwt'

import { isLiveSetupWizardToken, isSetupWizardToken, isSetupWizardTokenNamespace } from '../setup-wizard-token.js'
import { extractWsToken } from './ws-token.js'

export type WsUser = UserDto & { instanceId?: string, exp?: number }

/** What the WS guards keep on `client.data` for an authorised socket */
export interface WsClientData {
  /** The verified user, re-checked by `revalidateUser` */
  user?: WsUser
  /** Epoch ms of the last successful check */
  verifiedAt?: number
  /** Re-checks the user - see WsRevalidate */
  revalidateUser?: WsRevalidate
  /** Whether the socket's namespace requires an admin (re-read on every sweep) */
  adminRequired?: () => boolean
  /** The refreshed access token the client last re-authenticated with */
  wsToken?: string
}

/** A socket.io socket carrying WsClientData */
export type WsClient = Socket<any, any, any, WsClientData>

/**
 * What services with raw listeners hand in: the gateway's socket, which
 * several of them type as a plain EventEmitter. At runtime it is a WsClient.
 */
export type WsClientLike = WsClient | EventEmitter

/**
 * How long past its token's `exp` an open socket stays authorised. The UI
 * refreshes its access token before it expires and hands the new one to every
 * open socket (the `reauth` message below), so a socket is only ever cut once
 * its browser has stopped refreshing - which is when the UI signs itself out
 * anyway. The margin covers clock skew and a refresh still in flight.
 */
export const WS_TOKEN_GRACE_SECONDS = 5 * 60

/** How often every authorised socket is re-checked, so an expired one closes even when it is idle. */
const WS_SWEEP_INTERVAL_MS = 60 * 1000

/** The event a client sends with a refreshed access token. */
export const WS_REAUTH_EVENT = 'reauth'

/**
 * Verifies socket tokens through @nestjs/jwt, as JwtModule does for HTTP. The
 * secret is passed on every call (the configured one can change between calls
 * in specs), so this instance needs no options of its own.
 */
const wsJwt = new JwtService()

/** The token a socket currently stands on: the last one it re-authenticated with, else its handshake's. */
export function currentWsToken(client: WsClient): string | undefined {
  return client?.data?.wsToken || extractWsToken(client?.handshake)
}

/**
 * Verify the token a socket connected with and check it against the stored
 * user. Throws if the token is invalid, stale or its user no longer matches.
 *
 * Mirrors JwtStrategy.validate: a mismatched instanceId is rejected, the
 * setup-wizard token (intentionally signed with a wrong instanceId) is only
 * accepted on the backup namespace while the wizard is in progress, and
 * validateUser catches a deleted or demoted user, or changed credentials.
 */
export async function verifyWsClient(
  client: WsClient,
  configService: ConfigService,
  authService: AuthService,
  options: { ignoreExpiration?: boolean, token?: string } = {},
): Promise<WsUser> {
  const payload = wsJwt.verify<WsUser>(options.token ?? currentWsToken(client), {
    secret: configService.secrets.secretKey,
    ignoreExpiration: options.ignoreExpiration,
  })

  // Revalidation tolerates an expired token for a short while only - see
  // WS_TOKEN_GRACE_SECONDS. Without this cap a socket outlived its session for
  // ever, as long as the user still existed. Service tokens are exempt: their
  // holder minted them from the signing key itself, so cutting the socket would
  // protect nothing, and plugins hold sockets open past a short token's expiry.
  const isServiceToken = typeof (payload as { service?: unknown })?.service === 'string'
  if (options.ignoreExpiration && !isServiceToken && typeof payload?.exp === 'number'
    && Date.now() / 1000 > payload.exp + WS_TOKEN_GRACE_SECONDS) {
    throw new Error('Token expired')
  }

  if (isSetupWizardToken(payload)) {
    // Only while the wizard runs, and only on the namespace its restore step uses
    if (!isLiveSetupWizardToken(payload, configService) || !isSetupWizardTokenNamespace(client?.nsp?.name)) {
      throw new Error('Setup wizard token not allowed here')
    }
  } else if (payload?.instanceId !== configService.instanceId) {
    throw new Error('Stale token')
  }

  if (!await authService.validateUser(payload)) {
    throw new Error('User no longer valid')
  }

  return payload
}

/**
 * Re-checks the socket's user. Called with a token, it verifies that token
 * strictly (a client re-authenticating with a refreshed one); without, it
 * re-verifies the socket's current token, tolerating expiry for
 * WS_TOKEN_GRACE_SECONDS only.
 */
export type WsRevalidate = (token?: string) => Promise<WsUser>

/**
 * Every socket a guard has authorised, across all namespaces, so a revoked
 * session can be cut off everywhere at once rather than only when the socket
 * next sends something. Entries leave on disconnect.
 */
const authorizedClients = new Set<WsClient>()
let sweepTimer: ReturnType<typeof setInterval> | undefined

/**
 * Remember the verified user on the socket, with a way to re-check it later.
 *
 * Guards only run on `@SubscribeMessage` handlers. Services that bind raw
 * `client.on(...)` listeners after a guarded message (terminal stdin, custom
 * plugin UI requests, accessory control) must call `isWsClientAuthorized`
 * before acting, or a user who is deleted, demoted or has their password
 * changed keeps that access for as long as the socket stays open.
 *
 * The socket is also registered for `revalidateWsClients` (run on every
 * auth-file write and once a minute) and given a `reauth` listener, through
 * which the UI hands over its refreshed access token.
 *
 * `options.admin` says whether the socket's namespace requires an admin. It is
 * re-read on every sweep, as the log namespace's answer follows a setting.
 */
export function rememberWsUser(client: WsClient, user: WsUser, revalidate: WsRevalidate, options: { admin?: () => boolean } = {}): void {
  if (!client.data) {
    return
  }
  client.data.user = user
  client.data.verifiedAt = Date.now()
  client.data.revalidateUser = revalidate
  if (options.admin) {
    client.data.adminRequired = options.admin
  }

  if (!authorizedClients.has(client)) {
    authorizedClients.add(client)
    client.once?.('disconnect', () => authorizedClients.delete(client))
    client.on?.(WS_REAUTH_EVENT, (payload: any, ack: unknown) => {
      void reauthenticateWsClient(client, payload, typeof ack === 'function' ? ack as (resp: any) => void : () => {})
    })
    startSweep()
  }
}

/**
 * Verify a socket's token and remember its user - what every WS guard does.
 */
export async function authorizeWsGuardClient(
  clientLike: WsClientLike,
  configService: ConfigService,
  authService: AuthService,
  options: { admin?: () => boolean } = {},
): Promise<WsUser> {
  const client = clientLike as WsClient
  const user = await verifyWsClient(client, configService, authService)
  // A requirement the user fails right now is the guard's to refuse, for this
  // one message. Recording it would have the sweep drop the whole socket - a
  // non-admin's status socket for trying one admin-only status message.
  const admin = options.admin?.() && !user.admin ? undefined : options.admin
  rememberWsUser(
    client,
    user,
    token => verifyWsClient(client, configService, authService, token ? { token } : { ignoreExpiration: true }),
    { admin },
  )
  return user
}

/**
 * Swap a socket onto a refreshed access token. The new token must verify
 * strictly and belong to the same user: a socket never changes hands.
 */
async function reauthenticateWsClient(client: WsClient, payload: any, respond: (resp: any) => void): Promise<void> {
  try {
    const token = typeof payload?.token === 'string' ? payload.token : ''
    const revalidate = client.data?.revalidateUser as WsRevalidate | undefined
    if (!token || !revalidate) {
      throw new Error('No token')
    }
    const user = await revalidate(token)
    if (user.username !== client.data.user?.username) {
      throw new Error('A socket cannot change user')
    }
    client.data.wsToken = token
    client.data.user = user
    client.data.verifiedAt = Date.now()
    respond({ ok: true })
  } catch {
    respond({ error: 'Unauthorized' })
  }
}

function startSweep(): void {
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      void revalidateWsClients()
    }, WS_SWEEP_INTERVAL_MS)
    sweepTimer.unref?.()
  }
}

/**
 * Re-check every authorised socket now, disconnecting each whose user was
 * deleted, demoted or had their credentials changed, whose token is past its
 * grace period, or which no longer meets its namespace's admin requirement.
 *
 * Called after every auth-file write and when `restrictLogsToAdmins` changes,
 * so server-pushed streams (terminal output, the log tail, status) stop at
 * the moment of revocation instead of whenever the socket next speaks.
 */
export async function revalidateWsClients(): Promise<void> {
  await Promise.all(Array.from(authorizedClients, client =>
    isWsClientAuthorized(client, { admin: Boolean(client.data?.adminRequired?.()) })))
}

/**
 * Disconnect every socket standing on this exact token - a browser's local
 * logout, which ends that browser's session without revoking the account's.
 */
export function disconnectWsClientsWithToken(token: string | undefined): void {
  if (!token) {
    return
  }
  for (const client of authorizedClients) {
    if (currentWsToken(client) === token) {
      authorizedClients.delete(client)
      client.disconnect(true)
    }
  }
}

/**
 * Re-check the socket's user before acting on a raw listener's event.
 * Disconnects the socket when the user is no longer allowed.
 *
 * The token's expiry is re-checked with a grace period only: a socket keeps
 * the token it last authenticated with, and the UI hands it each refreshed
 * one (`reauth`), so it is cut WS_TOKEN_GRACE_SECONDS after its browser
 * stopped refreshing. What matters beyond that is whether its user is still
 * current - validateUser, which is cached for a few seconds.
 */
export async function isWsClientAuthorized(clientLike: WsClientLike, options: { admin: boolean }): Promise<boolean> {
  const client = clientLike as WsClient
  try {
    const revalidate = client.data?.revalidateUser as WsRevalidate | undefined
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
    authorizedClients.delete(client)
    client.disconnect(true)
    return false
  }
}

/**
 * How long a successful check stays good for. Matches the auth service's user
 * cache, so a revocation takes effect no later than it would on HTTP.
 */
const WS_RECHECK_INTERVAL_MS = 5000

function isRecentlyAuthorized(client: WsClient, options: { admin: boolean }): boolean {
  return Date.now() - (client.data?.verifiedAt ?? 0) < WS_RECHECK_INTERVAL_MS
    && (!options.admin || client.data?.user?.admin === true)
}

/**
 * Build a runner that re-checks the socket's user before acting on a raw
 * listener's event, or before pushing it server-side output (terminal, log).
 *
 * While the last successful check is fresh the action runs synchronously, as
 * it did before the check existed. Otherwise the check runs first, and actions
 * wait behind it strictly in arrival order - terminal input must never be
 * reordered, even when one check has to re-read the auth file.
 */
export function createAuthorizedRunner(
  clientLike: WsClientLike,
  runnerOptions: { admin: boolean | (() => boolean) },
): (action: () => unknown) => void {
  const client = clientLike as WsClient
  let queue: Promise<unknown> = Promise.resolve()
  let queued = 0

  return (action) => {
    // Read per action: the log stream's requirement follows a setting
    const options = {
      admin: typeof runnerOptions.admin === 'function' ? runnerOptions.admin() : runnerOptions.admin,
    }
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
