import type { UserDto } from '../../modules/users/users.dto.js'

import { Buffer } from 'node:buffer'
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'

import { ForbiddenException, HttpException, Injectable } from '@nestjs/common'

// OWASP-recommended PBKDF2-HMAC-SHA512 work factor. New and changed passwords
// are hashed at this strength.
export const PBKDF2_ITERATIONS = 210000
// Records created before versioned hashing carry no iteration count and were
// hashed at 1,000. They verify at this count and are transparently upgraded to
// PBKDF2_ITERATIONS on the owner's next successful login.
export const LEGACY_PBKDF2_ITERATIONS = 1000

// How many sign-in attempts may hash a password at the same time. Each one is
// a 210,000-iteration PBKDF2 on the libuv thread pool, so without a limit a
// flood of attempts (from as many addresses as an attacker has) starves the
// server. Past it, an attempt is refused with a 429 before any work, and does
// not count as a failure.
const MAX_CONCURRENT_LOGIN_HASHES = 2

/**
 * Salt for the hash computed when a login names a user that does not exist,
 * so that failure costs the same time as a wrong password (no username
 * enumeration by timing).
 */
const MISSING_USER_SALT = randomBytes(32).toString('hex')

/** What a user record stores for its password. */
export interface PasswordCredentials {
  salt: string
  hashedPassword: string
  passwordIterations: number
}

/**
 * PBKDF2 password hashing: new credentials, timing-safe verification, the
 * legacy work-factor upgrade check, and the limit on concurrent sign-in hashes.
 */
@Injectable()
export class PasswordHasher {
  // Sign-in attempts currently hashing a password (see MAX_CONCURRENT_LOGIN_HASHES)
  private activeLoginHashes = 0

  /**
   * Hash a password
   * @param password
   * @param salt
   * @param iterations
   */
  async hash(password: string, salt: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
    return new Promise((resolve, reject) => {
      pbkdf2(password, salt, iterations, 64, 'sha512', (err, derivedKey) => {
        if (err) {
          return reject(err)
        }
        return resolve(derivedKey.toString('hex'))
      })
    })
  }

  /**
   * Generate a salt
   */
  async genSalt(): Promise<string> {
    return new Promise((resolve, reject) => {
      randomBytes(32, (err, buf) => {
        if (err) {
          return reject(err)
        }
        return resolve(buf.toString('hex'))
      })
    })
  }

  /**
   * A fresh salt and hash for a password, at the current work factor
   */
  async createCredentials(password: string): Promise<PasswordCredentials> {
    const salt = await this.genSalt()
    const hashedPassword = await this.hash(password, salt)
    return { salt, hashedPassword, passwordIterations: PBKDF2_ITERATIONS }
  }

  /**
   * Verify a user's password. Throws a ForbiddenException if it is wrong.
   */
  async verify(user: UserDto, password: string): Promise<UserDto> {
    // Verify against the strength this record was hashed at. Legacy records
    // carry no count and were hashed at 1,000 iterations.
    const iterations = user.passwordIterations ?? LEGACY_PBKDF2_ITERATIONS
    const passwordAttemptHash = await this.hash(password, user.salt, iterations)
    const passwordAttemptHashBuff = Buffer.from(passwordAttemptHash, 'hex')
    const knownPasswordHashBuff = Buffer.from(user.hashedPassword, 'hex')

    if (timingSafeEqual(passwordAttemptHashBuff, knownPasswordHashBuff)) {
      return user
    } else {
      throw new ForbiddenException()
    }
  }

  /**
   * Spend the same time a wrong password would, so response timing does not
   * reveal which usernames exist
   */
  async hashForMissingUser(password: unknown): Promise<void> {
    await this.hash(String(password ?? ''), MISSING_USER_SALT)
  }

  /**
   * Whether the stored hash is weaker than the current work factor
   */
  needsUpgrade(user: UserDto): boolean {
    return (user.passwordIterations ?? LEGACY_PBKDF2_ITERATIONS) < PBKDF2_ITERATIONS
  }

  /**
   * Take one of the sign-in hashing slots, or throw a 429 when they are all
   * busy. Synchronous, so it must be called before the attempt's first
   * `await`: concurrent attempts then cannot all pass the check together.
   * Every successful call must be paired with releaseLoginHash().
   */
  reserveLoginHash(): void {
    if (this.activeLoginHashes >= MAX_CONCURRENT_LOGIN_HASHES) {
      throw new HttpException('Too many sign-in attempts in progress. Please try again in a moment.', 429)
    }
    this.activeLoginHashes++
  }

  releaseLoginHash(): void {
    this.activeLoginHashes--
  }
}
