import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

import { ConfigService } from '../config/config.service.js'
import { Logger } from '../logger/logger.service.js'
import { isLiveSetupWizardToken, SETUP_WIZARD_CLAIM, SETUP_WIZARD_USERNAME } from './setup-wizard-token.js'
import { UserRepository } from './user.repository.js'

// The longest a service token may be valid for, from `iat` to `exp`. Minting
// one already requires the secret key, so this is not a barrier to an attacker
// who has that - it bounds how long a token stays usable if one leaks (plugins
// have been known to print their own requests at debug level).
const MAX_SERVICE_TOKEN_LIFETIME_SECONDS = 300

/**
 * Each refresh renews the session cookie with a full Max-Age, so a chain of
 * renewals never ends on its own. This caps the total lifetime of one
 * signed-in session: past it, the next refresh returns 401 and the user signs
 * in again. Revocation (password change, 2FA, logout) still ends a session
 * immediately - this is only the backstop for sessions nothing ever revokes.
 */
const MAX_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60

/** What the token endpoints return */
export interface AccessTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
}

/**
 * Session tokens: minting, refreshing and validating them against the stored
 * user's current role and session version, plus service and setup-wizard
 * tokens.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(UserRepository) private readonly users: UserRepository,
  ) {}

  /**
   * Mint a session token for an authenticated user's payload
   */
  issueSessionToken(user: Record<string, unknown>): AccessTokenResponse {
    // When this sign-in happened. Refreshes carry it forward unchanged, so the
    // renewal chain as a whole has an age that can be capped.
    return this.tokenResponse(this.jwtService.sign({ ...user, sessionStartedAt: Math.floor(Date.now() / 1000) }))
  }

  /**
   * Sign an ordinary session token for a user that expires after `ttlSeconds`
   * (see AuthService.mintShortLivedToken). Only for real accounts: service and
   * API-token users have no auth.json record the token could be validated
   * against.
   */
  mintShortLivedToken(user: any, ttlSeconds = 300): string {
    if (!user?.username || user.service !== undefined || user.apiTokenId !== undefined) {
      throw new UnauthorizedException('A short-lived token can only be minted for a user account.')
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new RangeError('ttlSeconds must be a positive whole number of seconds.')
    }
    const now = Math.floor(Date.now() / 1000)
    return this.jwtService.sign({
      username: user.username,
      name: user.name,
      admin: !!user.admin,
      instanceId: this.configService.instanceId,
      sessionVersion: user.sessionVersion ?? 0,
      otpLegacySecret: user.otpLegacySecret || false,
      sessionStartedAt: typeof user.sessionStartedAt === 'number' ? user.sessionStartedAt : now,
    }, { expiresIn: ttlSeconds })
  }

  private tokenResponse(token: string): AccessTokenResponse {
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: this.configService.ui.sessionTimeout,
    }
  }

  /**
   * Returns a token for use when authentication is disabled
   */
  async generateNoAuthToken() {
    // Prevent access if auth is not disabled
    if (this.configService.ui.auth !== 'none') {
      throw new UnauthorizedException()
    }

    // Load the first admin we can find
    const users = await this.users.getUsers()
    const user = users.find(x => x.admin === true)

    // Generate a token
    const token = this.jwtService.sign({
      username: user.username,
      name: user.name,
      admin: user.admin,
      instanceId: this.configService.instanceId,
      sessionVersion: user.sessionVersion ?? 0,
      otpLegacySecret: user.otpLegacySecret || false,
      sessionStartedAt: Math.floor(Date.now() / 1000),
    })

    return this.tokenResponse(token)
  }

  /**
   * Refresh an existing token to extend the session
   * @param user - the current user payload from the JWT
   * @param reason - optional client reason for distinct log lines (allowlisted)
   */
  async refreshToken(user: any, reason?: string): Promise<any> {
    // Service tokens are deliberately short-lived credentials minted by local
    // programs. They must not be exchangeable for a normal user session.
    if (user?.service !== undefined) {
      this.rejectRefresh(user.username ?? 'a service token', 'Service tokens cannot be refreshed')
    }

    // An API token is its own long-lived credential, not a session
    if (user?.apiTokenId !== undefined) {
      this.rejectRefresh(user.username, 'API tokens cannot be refreshed')
    }

    // Validate that the user still exists and has the same permissions
    const currentUser = await this.users.findByUsername(user.username)
    if (!currentUser) {
      this.rejectRefresh(user.username, 'User no longer exists')
    }

    this.logger.debug(this.refreshTokenLogMessage(user.username, reason))

    // Verify the user's admin status hasn't changed
    if (currentUser.admin !== user.admin) {
      this.rejectRefresh(user.username, 'User permissions have changed, please log in again')
    }

    // Password and 2FA changes increment this value. Refreshing must reject
    // the old credential rather than copying the current value into a new
    // token and making the revoked session valid again.
    if ((currentUser.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      this.rejectRefresh(user.username, 'User credentials have changed, please log in again')
    }

    // Check if the instance ID matches (prevents cross-instance token reuse)
    if (user.instanceId !== this.configService.instanceId) {
      this.rejectRefresh(user.username, 'Token is not valid for this instance')
    }

    // Cap the total lifetime of a renewal chain: carried forward unchanged on
    // every refresh, so one request per window can no longer renew for ever.
    // A token minted before this field existed is grandfathered in - the cap
    // starts counting from the first refresh that sees it.
    const sessionStartedAt = typeof user.sessionStartedAt === 'number'
      ? user.sessionStartedAt
      : Math.floor(Date.now() / 1000)
    if (Math.floor(Date.now() / 1000) - sessionStartedAt > MAX_SESSION_LIFETIME_SECONDS) {
      this.rejectRefresh(user.username, 'Session has reached its maximum age, please log in again')
    }

    // Generate a new token with the same user data but updated expiration
    const token = this.jwtService.sign({
      username: user.username,
      name: user.name,
      admin: user.admin,
      instanceId: user.instanceId,
      sessionVersion: currentUser.sessionVersion ?? 0,
      otpLegacySecret: currentUser.otpLegacySecret || false,
      sessionStartedAt,
    })

    return this.tokenResponse(token)
  }

  /**
   * Refuse a token refresh, saying why in the log before throwing.
   *
   * ⚠️ **Every rejection below goes through here, and new ones must too.** The
   * routine "refreshing" lines are debug, because they are a consequence of the
   * user having a browser open rather than a decision anyone made (#2978). That
   * only works if the interesting half is visible: before this, a refresh
   * refused because the account was deleted, demoted or had its credentials
   * revoked logged nothing at all, while the successful ones announced
   * themselves on every page load. Failed logins, lockouts and rejected service
   * tokens already warn - this is the same event class.
   *
   * @param username - whose refresh was refused.
   * @param reason - the client-facing message, reused verbatim in the log.
   */
  private rejectRefresh(username: string, reason: string): never {
    this.logger.warn(`Refused to refresh the session for ${username}: ${reason.toLowerCase()}`)
    throw new UnauthorizedException(reason)
  }

  /**
   * Distinct log lines per refresh caller so admin checks and inactivity
   * extension are not identical (and look like accidental duplicates).
   */
  private refreshTokenLogMessage(username: string, reason?: string): string {
    switch (reason) {
      case 'admin-guard':
        return `Verifying admin session for ${username} (admin-guard token refresh).`
      case 'session-extension':
        return `Extending session for ${username} (inactivity-based token refresh).`
      case 'profile-update':
        return `Refreshing token for ${username} after profile/auth change.`
      case 'session-restore':
        return `Restoring session for ${username} (page load, token held in memory).`
      default:
        return `Request received to refresh token for ${username}.`
    }
  }

  /**
   * Validate a decoded, verified JWT payload against the user's current state.
   *
   * A valid signature alone is not enough: the payload is a snapshot from when
   * the token was minted, so without this check a deleted user, a demoted
   * administrator, or a user whose password was just changed kept full access
   * until the token expired (eight hours by default).
   *
   * @param payload - the decoded, verified jwt payload
   * @returns the payload if it still matches the stored user, otherwise null
   */
  async validateUser(payload: any): Promise<any> {
    // The setup-wizard token deliberately has no user record behind it. It is
    // already constrained to the live wizard, and to the restore routes, by
    // JwtStrategy and the websocket guards.
    if (isLiveSetupWizardToken(payload, this.configService)) {
      return payload
    }

    // A service token stands for a program, not a person, so the user checks
    // below cannot apply to it.
    if (payload?.service !== undefined) {
      return this.validateServiceToken(payload)
    }

    const user = await this.users.findCurrentUser(payload?.username)

    // Deleted (or renamed) since the token was issued
    if (!user) {
      // Named because the alternative is a bare 401 with nothing behind it:
      // this is what a plugin minting its own token sees if it has not
      // declared itself with a `service` claim.
      this.logger.debug(`Rejected a correctly signed token for '${payload?.username}': no such user. A plugin authenticating with its own token must set the "service" claim.`)
      return null
    }

    // Role changed since the token was issued
    if (!!user.admin !== !!payload.admin) {
      return null
    }

    // Credentials changed since the token was issued (password, OTP, ...)
    if ((user.sessionVersion ?? 0) !== (payload.sessionVersion ?? 0)) {
      return null
    }

    return payload
  }

  /**
   * Validate a service token: one a program on this machine mints for itself
   * by reading the secret key out of `.uix-secrets`, rather than logging in as
   * a person. Homebridge plugins that call this api use these.
   *
   * The contract, for anyone writing one:
   *
   * - sign with `secrets.secretKey` from `<storagePath>/.uix-secrets`
   * - `service`: a non-empty string naming the caller, e.g. the plugin name.
   *   Its presence is what marks the token as a service token
   * - `instanceId`: `sha256(secretKey)` as hex, checked like any other token
   * - `admin`: true if the token needs administrator endpoints
   * - expire it within MAX_SERVICE_TOKEN_LIFETIME_SECONDS; mint a fresh one
   *   as needed rather than holding a long-lived token
   *
   * Why these are exempt from the user checks: those exist to revoke a person
   * whose account was deleted, demoted, or had its password changed, and a
   * service token has no account behind it to revoke. It must therefore say so
   * explicitly - treating any unknown username as a service would hand a
   * deleted user's token the access that deleting them was meant to remove.
   */
  private validateServiceToken(payload: any): any {
    if (typeof payload.service !== 'string' || payload.service.trim() === '') {
      this.logger.warn('Rejected a service token: the "service" claim must name the caller.')
      return null
    }

    // jwt.verify has already rejected an expired token; this bounds how long a
    // valid one lives. A token with no issued-at cannot be bounded at all.
    const { iat, exp, service } = payload
    if (typeof iat !== 'number' || typeof exp !== 'number') {
      this.logger.warn(`Rejected a service token from '${service}': it must carry an expiry.`)
      return null
    }
    if (exp - iat > MAX_SERVICE_TOKEN_LIFETIME_SECONDS) {
      this.logger.warn(`Rejected a service token from '${service}': valid for ${exp - iat} seconds, the maximum is ${MAX_SERVICE_TOKEN_LIFETIME_SECONDS}.`)
      return null
    }

    return payload
  }

  /**
   * Generates a token for the setup wizard
   */
  generateSetupWizardToken(): AccessTokenResponse {
    // Only usable for the wizard's restore step - see setup-wizard-token.ts
    const token = this.jwtService.sign({
      username: SETUP_WIZARD_USERNAME,
      name: SETUP_WIZARD_USERNAME,
      admin: true,
      [SETUP_WIZARD_CLAIM]: true,
      instanceId: 'xxxxx', // intentionally wrong
    }, { expiresIn: '5m' })

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 300,
    }
  }
}
