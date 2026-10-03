import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createGuardrails } from '@otplib/core'
import NodeCache from 'node-cache'
import { generateSecret, generateURI, verify } from 'otplib'

import { UserDto } from '../../modules/users/users.dto.js'
import { ConfigService } from '../config/config.service.js'
import { Logger } from '../logger/logger.service.js'
import { desensitiseUserProfile, UserRepository } from './user.repository.js'

/**
 * Two-factor authentication: setting up and activating a TOTP secret, and
 * verifying codes at sign-in, each one usable once.
 */
@Injectable()
export class OtpService {
  private otpUsageCache = new NodeCache({ stdTTL: 90 })

  // Custom guardrails for legacy 16-character OTP secrets (10 bytes when decoded)
  private legacyOtpGuardrails = createGuardrails({
    MIN_SECRET_BYTES: 10, // allow legacy 16-character Base32 secrets from otplib v12
    MAX_SECRET_BYTES: 64,
  })

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(UserRepository) private readonly users: UserRepository,
  ) {}

  /**
   * Generate an OTP secret for a user
   */
  async setupOtp(username: string) {
    return this.users.withUser(username, () => new NotFoundException('User not found.'), (user) => {
      if (user.otpActive) {
        throw new ForbiddenException('2FA has already been activated.')
      }
      user.otpSecret = generateSecret()
      const appName = `Homebridge Glass UI (${this.configService.instanceId.slice(0, 7)})`
      return {
        timestamp: new Date(),
        otpauth: generateURI({
          issuer: appName,
          label: user.username,
          secret: user.otpSecret,
        }),
      }
    })
  }

  /**
   * Activates the OTP requirement for a user after verifying the otp code
   */
  async activateOtp(username: string, code: string) {
    return this.users.withUser(username, () => new NotFoundException('User not found.'), async (user) => {
      if (!user.otpSecret) {
        throw new BadRequestException('2FA has not been setup.')
      }

      let valid = false
      try {
        // Try with v13 (for 32-character secrets)
        const result = await verify({
          token: code,
          secret: user.otpSecret,
          epochTolerance: 30,
        })
        valid = result.valid
      } catch (error: unknown) {
        // If SecretTooShortError, use custom guardrails (shouldn't happen for new setups, but handle it)
        if (error instanceof Error && error.name === 'SecretTooShortError' && user.otpSecret.length === 16) {
          this.logger.warn(`${user.username} is attempting to activate a legacy 16-character OTP secret.`)

          const result = await verify({
            token: code,
            secret: user.otpSecret,
            epochTolerance: 30,
            guardrails: this.legacyOtpGuardrails,
          })
          valid = result.valid

          if (valid) {
            user.otpLegacySecret = true
          }
        } else {
          throw error
        }
      }

      if (!valid) {
        throw new BadRequestException('2FA code is not valid.')
      }
      user.otpActive = true
      // Turning 2FA on invalidates sessions established before it was required.
      user.sessionVersion = (user.sessionVersion ?? 0) + 1
      this.logger.warn(`Activated 2FA for ${user.username}.`)
      return desensitiseUserProfile(user)
    })
  }

  /**
   * Verify an OTP token for a user and prevent it being used more than once
   */
  async verifyOtpToken(user: UserDto, otp: string): Promise<boolean> {
    const otpCacheKey = user.username + otp

    if (this.otpUsageCache.get(otpCacheKey)) {
      this.logger.warn(`${user.username} attempted to reuse one-time-password.`)
      return false
    }

    // Reserve the slot BEFORE awaiting verify(). Otherwise two parallel
    // requests with the same captured code would both pass the cache
    // check, both call verify(), and both succeed — defeating the
    // single-use protection. The reservation is rolled back if the code
    // turns out to be invalid so the user can correct a typo and retry.
    this.otpUsageCache.set(otpCacheKey, 'pending')

    try {
      // Try with v13 (for 32-character secrets)
      const { valid } = await verify({
        token: otp,
        secret: user.otpSecret,
        epochTolerance: 30,
      })

      if (valid) {
        this.otpUsageCache.set(otpCacheKey, 'true')
        return true
      }
    } catch (error: unknown) {
      // If SecretTooShortError, this is a legacy 16-character secret from otplib v12
      if (error instanceof Error && error.name === 'SecretTooShortError' && user.otpSecret.length === 16) {
        this.logger.warn(`${user.username} is using a legacy 16-character OTP secret. They should re-setup 2FA for better security.`)

        // Use custom guardrails to allow legacy 10-byte (16-character) secrets
        const { valid } = await verify({
          token: otp,
          secret: user.otpSecret,
          epochTolerance: 30,
          guardrails: this.legacyOtpGuardrails,
        })

        if (valid) {
          this.otpUsageCache.set(otpCacheKey, 'true')

          // Set the flag on the user object immediately so it's included in the JWT
          user.otpLegacySecret = true

          // Persist the flag to the auth file (async, don't block login)
          this.users.markUserAsLegacyOtp(user.username).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unknown error'
            this.logger.error(`Failed to mark user ${user.username} as having legacy OTP: ${message}`)
          })

          return true
        }
      } else {
        // Re-throw if it's a different error — but first roll back the
        // reservation so a transient failure doesn't lock the user out.
        this.otpUsageCache.del(otpCacheKey)
        throw error
      }
    }

    // verify() returned !valid. Roll back the reservation so a typed
    // typo doesn't burn the code for the user's next attempt.
    this.otpUsageCache.del(otpCacheKey)
    return false
  }
}
