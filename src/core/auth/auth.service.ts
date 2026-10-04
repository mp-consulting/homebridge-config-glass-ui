import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PluginsSettingsUiTicketService } from '../../modules/custom-plugins/plugins-settings-ui/plugins-settings-ui-ticket.service.js'
import { UserDto } from '../../modules/users/users.dto.js'
import { HomebridgeConfig } from '../config/config.interfaces.js'
import { ConfigService } from '../config/config.service.js'
import { JsonFileStoreService } from '../fs/json-file-store.service.js'
import { Logger } from '../logger/logger.service.js'
import { ApiTokenService, ApiTokenUser } from './api-token.service.js'
import { LoginThrottle } from './login-throttle.js'
import { OtpService } from './otp.service.js'
import { PasswordHasher } from './password-hasher.js'
import { TokenService } from './token.service.js'
import { desensitiseUserProfile, UserRepository } from './user.repository.js'

export { loginThrottleSource } from './login-throttle.js'

/**
 * The authentication facade the controllers, guards and strategies use. The
 * work is done by focused providers: LoginThrottle (failed-login budgets),
 * PasswordHasher (PBKDF2), TokenService (JWTs), UserRepository (auth.json)
 * and OtpService (2FA). This class sequences them, and revokes the custom
 * plugin UI tickets of a user whose credentials change.
 */
@Injectable()
export class AuthService {
  // Synchronous reservation flag for first-user setup, so two concurrent
  // onboarding requests cannot both create an administrator. See setupFirstUser.
  private firstUserSetupInProgress = false

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(PluginsSettingsUiTicketService) private readonly pluginUiTicketService: PluginsSettingsUiTicketService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(ApiTokenService) private readonly apiTokens: ApiTokenService,
  ) {
    this.checkAuthFile()
  }

  /**
   * Authenticate a user with their credentials
   * @param username
   * @param password
   * @param otp
   * @param clientId - optional client identifier (e.g. source address) mixed into
   * the throttle key alongside the username
   */
  async authenticate(username: string, password: string, otp?: string, clientId?: string): Promise<any> {
    const attempt = this.throttle.attempt(username, clientId)

    // Reject before doing any work once the failure threshold is reached, so
    // password and 2FA guessing cannot run unbounded.
    this.throttle.assertLoginAllowed(attempt)

    // Taken synchronously, before the first `await`, so concurrent attempts
    // cannot all pass the check together
    this.hasher.reserveLoginHash()

    try {
      const user = await this.findByUsername(username)

      if (!user) {
        // Spend the same time a wrong password would, so response timing
        // does not reveal which usernames exist
        await this.hasher.hashForMissingUser(password)
        throw new ForbiddenException()
      }

      await this.hasher.verify(user, password)

      if (user.otpActive && !otp) {
        throw new HttpException('2FA Code Required', 412)
      }

      if (user.otpActive && !await this.verifyOtpToken(user, otp)) {
        throw new HttpException('2FA Code Invalid', 412)
      }

      // Credentials (and OTP, if enabled) are valid: upgrade a legacy weak
      // password hash to the current work factor before returning.
      await this.users.upgradePasswordHashIfNeeded(user, password)

      this.throttle.recordLoginSuccess(attempt)

      return {
        username: user.username,
        name: user.name,
        admin: user.admin,
        instanceId: this.configService.instanceId,
        sessionVersion: user.sessionVersion ?? 0,
        otpLegacySecret: user.otpLegacySecret || false,
      }
    } catch (e) {
      // "2FA Code Required" is a prompt for more input, not a failed attempt,
      // so it must not count towards the lockout.
      const is2faPrompt = e instanceof HttpException && e.getStatus() === 412 && e.message === '2FA Code Required'
      if (!is2faPrompt) {
        this.throttle.recordLoginFailure(attempt)
      }

      if (e instanceof ForbiddenException) {
        this.logger.warn('Failed login attempt.')
        this.logger.warn('If you have forgotten your password, you can reset to the default '
          + `of admin/admin by deleting the "auth.json" file at ${this.configService.authPath} and then restarting Homebridge.`)
        throw e
      }

      if (e instanceof HttpException) {
        throw e
      }

      throw new ForbiddenException()
    } finally {
      this.hasher.releaseLoginHash()
    }
  }

  /**
   * Check a signed-in user's current password before a sensitive change,
   * throttled like a login (see LoginThrottle.checkCurrentPassword)
   */
  private async checkCurrentPassword(user: UserDto, password: string) {
    await this.throttle.checkCurrentPassword(user.username, () => this.hasher.verify(user, password))
  }

  /**
   * Authenticate and provide a JWT response
   * @param username
   * @param password
   * @param otp
   * @param clientId - optional client identifier (e.g. source address) for login throttling
   */
  async signIn(username: string, password: string, otp?: string, clientId?: string): Promise<any> {
    const user = await this.authenticate(username, password, otp, clientId)
    return this.tokens.issueSessionToken(user)
  }

  /**
   * Returns a token for use when authentication is disabled
   */
  async generateNoAuthToken() {
    return this.tokens.generateNoAuthToken()
  }

  /**
   * Refresh an existing token to extend the session
   * @param user - the current user payload from the JWT
   * @param reason - optional client reason for distinct log lines (allowlisted)
   */
  async refreshToken(user: any, reason?: string): Promise<any> {
    return this.tokens.refreshToken(user, reason)
  }

  /**
   * Validate a decoded, verified JWT payload against the user's current state
   * (see TokenService.validateUser)
   */
  async validateUser(payload: any): Promise<any> {
    return this.tokens.validateUser(payload)
  }

  /**
   * Resolve an API token (`hbg_…`) to the user it authenticates as, or null
   * when it is unknown, revoked or expired (see ApiTokenService)
   */
  async validateApiToken(token: string): Promise<ApiTokenUser | null> {
    return this.apiTokens.validate(token)
  }

  /**
   * Mint a short-lived access token for a signed-in user, e.g. for the
   * Assistant to call the api on that user's behalf. It is an ordinary session
   * JWT (same claims, same validation) that expires after `ttlSeconds` and
   * cannot be refreshed past the user's own session rules.
   * @param user - the authenticated user (a validated JWT payload or auth.json record)
   * @param ttlSeconds - lifetime in seconds, 300 by default
   */
  mintShortLivedToken(user: any, ttlSeconds = 300): string {
    return this.tokens.mintShortLivedToken(user, ttlSeconds)
  }

  /**
   * Set up the first user
   */
  async setupFirstUser(user: UserDto) {
    if (this.configService.setupWizardComplete) {
      throw new ForbiddenException()
    }

    if (!user.password) {
      throw new BadRequestException('Password missing.')
    }

    // Reserve the setup synchronously, before the first `await` below.
    // `setupWizardComplete` is only flipped true after both async writes
    // finish, so without this reservation two requests arriving together
    // could both pass the check above and each create an administrator during
    // first-run onboarding. The flag is released in `finally`, so a failed
    // attempt (e.g. a write error) still allows a genuine retry.
    if (this.firstUserSetupInProgress) {
      throw new ConflictException('First user setup is already in progress.')
    }
    this.firstUserSetupInProgress = true

    try {
      // First user must be admin
      user.admin = true

      // Start with an empty auth file; addUser() below acquires the same
      // lock to push the first user, so both writes serialise correctly.
      await this.users.reset()

      const createdUser = await this.addUser(user)

      this.configService.setupWizardComplete = true

      await this.restrictLogsForNewInstall()

      return createdUser
    } finally {
      this.firstUserSetupInProgress = false
    }
  }

  /**
   * Plugin output in the Homebridge log routinely contains credentials, so a
   * new install restricts the log viewer to administrators. Existing installs
   * keep the long-standing behaviour (any signed-in user may read it): this
   * only runs when the setup wizard creates the first user, and only sets the
   * option when the UI config does not already have a value for it.
   */
  private async restrictLogsForNewInstall() {
    try {
      let changed = false
      await this.jsonStore.mutate<HomebridgeConfig>(this.configService.configPath, (config) => {
        const ui = Array.isArray(config?.platforms) ? config.platforms.find(x => x?.platform === 'config') : undefined
        if (!ui || ui.restrictLogsToAdmins !== undefined) {
          return null
        }
        ui.restrictLogsToAdmins = true
        changed = true
        return config
      }, { spaces: 4 })
      if (changed) {
        this.configService.ui.restrictLogsToAdmins = true
        this.configService.restrictLogsToAdmins = true
        this.logger.log('Restricted the Homebridge log to administrators (restrictLogsToAdmins), the default for new installs.')
      }
    } catch (e) {
      // The user exists; failing setup over a default would be worse
      this.logger.warn(`Could not set restrictLogsToAdmins for the new install: ${e.message}`)
    }
  }

  /**
   * Generates a token for the setup wizard
   */
  async generateSetupWizardToken() {
    // Only while the setup wizard is still open
    if (this.configService.setupWizardComplete !== false) {
      throw new ForbiddenException()
    }
    return this.tokens.generateSetupWizardToken()
  }

  /**
   * Executed on startup to see if the auth file is set up yet
   */
  async checkAuthFile() {
    return this.users.checkAuthFile()
  }

  /**
   * Clean the user profile of sensitive fields
   */
  desensitiseUserProfile(user: UserDto): UserDto {
    return desensitiseUserProfile(user)
  }

  /**
   * Returns all the users
   * @param strip - if true, remove the users salt and hashed password from the response
   */
  async getUsers(strip?: boolean): Promise<UserDto[]> {
    return this.users.getUsers(strip)
  }

  /**
   * Return a user by username
   * @param username
   */
  async findByUsername(username: string): Promise<UserDto> {
    return this.users.findByUsername(username)
  }

  /**
   * Add a new user
   * @param user
   */
  async addUser(user: UserDto) {
    return this.users.addUser(user)
  }

  /**
   * Remove a user
   * @param id
   */
  async deleteUser(id: number) {
    const deletedUsername = await this.users.deleteUser(id)
    this.pluginUiTicketService.revokeUser(deletedUsername)
  }

  /**
   * Revoke every token issued for a user. Used by logout so deleting the
   * browser cookie also invalidates any copy that may have been captured.
   */
  async revokeUserSessions(username: string): Promise<void> {
    await this.users.revokeUserSessions(username)
  }

  /**
   * Updates a user
   * @param id
   * @param update
   */
  async updateUser(id: number, update: UserDto) {
    const { user, previousUsername } = await this.users.updateUser(id, update)
    this.pluginUiTicketService.revokeUser(previousUsername)
    return user
  }

  /**
   * Change a users own password
   */
  async updateOwnPassword(username: string, currentPassword: string, newPassword: string) {
    // The current-password check has to run against the on-disk value
    // (otherwise a stale-but-just-changed password would be accepted).
    // Do it inside the lock against a fresh read; the new salt and
    // hash are computed inside too, after the check, so the
    // validate→update window can't be interleaved by another /password
    // call for the same user - and a wrong guess costs one hash, not two.
    const result = await this.users.withUser(username, () => new NotFoundException('User not found.'), async (user) => {
      // This will throw an error if the password is wrong
      await this.checkCurrentPassword(user, currentPassword)
      Object.assign(user, await this.hasher.createCredentials(newPassword))
      // Invalidate tokens issued against the old password.
      user.sessionVersion = (user.sessionVersion ?? 0) + 1
      return desensitiseUserProfile(user)
    })
    this.pluginUiTicketService.revokeUser(username)
    return result
  }

  /**
   * Generate an OTP secret for a user
   */
  async setupOtp(username: string) {
    return this.otp.setupOtp(username)
  }

  /**
   * Activates the OTP requirement for a user after verifying the otp code
   */
  async activateOtp(username: string, code: string) {
    const result = await this.otp.activateOtp(username, code)
    this.pluginUiTicketService.revokeUser(username)
    return result
  }

  /**
   * Deactivates the OTP requirement for a user after verifying their password
   */
  async deactivateOtp(username: string, password: string) {
    const result = await this.users.withUser(username, () => new NotFoundException('User not found.'), async (user) => {
      // This will throw an error if the password is not valid
      await this.checkCurrentPassword(user, password)
      user.otpActive = false
      delete user.otpSecret
      delete user.otpLegacySecret
      user.sessionVersion = (user.sessionVersion ?? 0) + 1
      this.logger.warn(`Deactivated 2FA for ${username}.`)
      return desensitiseUserProfile(user)
    })
    this.pluginUiTicketService.revokeUser(username)
    return result
  }

  /**
   * Verify an OTP token for a user and prevent it being used more than once
   */
  async verifyOtpToken(user: UserDto, otp: string): Promise<boolean> {
    return this.otp.verifyOtpToken(user, otp)
  }
}
