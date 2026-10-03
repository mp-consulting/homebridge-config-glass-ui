import { randomInt } from 'node:crypto'

import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import { readJson } from 'fs-extra/esm'
import NodeCache from 'node-cache'

import { UserDto } from '../../modules/users/users.dto.js'
import { ConfigService } from '../config/config.service.js'
import { JsonFileStoreService } from '../fs/json-file-store.service.js'
import { Logger } from '../logger/logger.service.js'
import { revalidateWsClients } from './guards/ws-auth.js'
import { PasswordHasher } from './password-hasher.js'

// How long the auth file is cached for per-request token validation. Writes
// that change a user's identity or role clear it immediately, so this is only
// the ceiling for changes made outside this process (e.g. editing auth.json by
// hand).
const USER_CACHE_TTL_SECONDS = 5

/**
 * Clean the user profile of sensitive fields (salt, hash, OTP secret)
 */
export function desensitiseUserProfile(user: UserDto): UserDto {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    admin: user.admin,
    otpActive: user.otpActive || false,
    otpLegacySecret: user.otpLegacySecret || false,
  }
}

/**
 * The users in auth.json: reads, the short-lived token-validation cache, and
 * every write, each one a locked read-modify-write through withAuthFile.
 */
@Injectable()
export class UserRepository {
  // Short-lived cache of the auth file, so validating a token on every request
  // is not a file read each time. Cleared by invalidateUserCache() on writes.
  private userCache = new NodeCache({ stdTTL: USER_CACHE_TTL_SECONDS })

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Executed on startup to see if the auth file is set up yet
   */
  async checkAuthFile() {
    let authfile: unknown
    try {
      authfile = await readJson(this.configService.authPath)
    } catch (e) {
      // Only a missing file means "no users yet". Anything else - unreadable,
      // half-written, corrupt - must fail closed: opening the wizard would let
      // whoever reaches the page first create an administrator.
      if (e?.code === 'ENOENT') {
        this.configService.setupWizardComplete = false
        return
      }
      this.failAuthFileClosed(`it could not be read (${e?.message ?? e})`)
      return
    }
    if (!Array.isArray(authfile)) {
      this.failAuthFileClosed('it does not contain a list of users')
      return
    }
    // There must be at least one admin user
    if (!authfile.some(x => x?.admin === true)) {
      this.configService.setupWizardComplete = false
    }
  }

  /**
   * Keep the setup wizard closed when auth.json exists but is not usable, and
   * say how to recover.
   */
  private failAuthFileClosed(reason: string) {
    this.configService.setupWizardComplete = true
    this.logger.error(`The users file ${this.configService.authPath} exists but ${reason}. Nobody can sign in until it is fixed. `
      + 'To start again with the setup wizard, delete the file and restart Homebridge.')
  }

  /**
   * Returns all the users
   * @param strip - if true, remove the users salt and hashed password from the response
   */
  async getUsers(strip?: boolean): Promise<UserDto[]> {
    const users: UserDto[] = await readJson(this.configService.authPath)

    if (strip) {
      return users.map(desensitiseUserProfile)
    }

    return users
  }

  /**
   * Return a user by username
   * @param username
   */
  async findByUsername(username: string): Promise<UserDto> {
    const users = await this.getUsers()
    return users.find(x => x.username === username)
  }

  /**
   * Look up a user for token validation. This runs on every authenticated
   * request, so the auth file is cached briefly rather than read each time;
   * revocation therefore takes effect within USER_CACHE_TTL_SECONDS.
   */
  async findCurrentUser(username?: string): Promise<UserDto | undefined> {
    if (!username) {
      return undefined
    }
    let users = this.userCache.get<UserDto[]>('users')
    if (!users) {
      users = await this.getUsers()
      this.userCache.set('users', users)
    }
    return users.find(x => x.username === username)
  }

  /**
   * Drop the cached auth file. Called after any write that changes who a user
   * is or what they may do, so revocation is immediate rather than waiting for
   * the cache to expire.
   */
  private invalidateUserCache() {
    this.userCache.del('users')
  }

  /**
   * Start the auth file again with no users (first-run setup)
   */
  async reset(): Promise<void> {
    await this.jsonStore.write<UserDto[]>(this.configService.authPath, [], { spaces: 4 })
  }

  /**
   * Run a read-modify-write transaction against auth.json under the
   * shared per-path mutex. The callback receives the parsed users
   * array (fresh from disk under the lock), mutates it in place, and
   * may optionally return a side value for the outer caller (e.g. the
   * newly-added user). The mutated array is then atomically persisted
   * via write-temp/fsync/rename.
   *
   * Closes the long-standing race where two concurrent /users requests
   * each read the same baseline (`Math.max(...ids) + 1` produced
   * duplicate IDs; the second write wiped the first add/delete).
   */
  async withAuthFile<R>(
    mutator: (users: UserDto[]) => R | Promise<R>,
  ): Promise<R> {
    let result: R | undefined
    await this.jsonStore.mutate<UserDto[]>(
      this.configService.authPath,
      async (current) => {
        const users = current ?? []
        result = await mutator(users)
        return users
      },
      { spaces: 4 },
    )
    // Every write to the auth file goes through here, so this is the one place
    // that has to drop the token-validation cache. Without it a deletion or
    // demotion would not take effect until the cache expired.
    this.invalidateUserCache()
    // ...and the one place to cut off open sockets whose user this write
    // deleted, demoted or revoked. Guards only run when a socket sends a
    // message, so server-pushed streams (terminal output, the log tail) would
    // otherwise keep flowing to a revoked user.
    void revalidateWsClients()
    return result as R
  }

  /**
   * Run a mutation on one user, failing with `notFound` when there is no such
   * user
   */
  async withUser<R>(username: string, notFound: () => Error, mutator: (user: UserDto) => R | Promise<R>): Promise<R> {
    return this.withAuthFile((authfile) => {
      const user = authfile.find(x => x.username === username)
      if (!user) {
        throw notFound()
      }
      return mutator(user)
    })
  }

  /**
   * Add a new user
   * @param user
   */
  async addUser(user: UserDto) {
    // Salt + password hashing are computed *outside* the auth.json
    // lock so a slow PBKDF2 doesn't block other callers waiting on
    // the file. The duplicate-username check + id derivation + push
    // run inside the lock, against a fresh read.
    const credentials = await this.hasher.createCredentials(user.password)

    return this.withAuthFile((authfile) => {
      if (authfile.some(x => x.username.toLowerCase() === user.username.toLowerCase())) {
        throw new ConflictException(`User with username '${user.username}' already exists.`)
      }
      const newUser: UserDto = {
        id: authfile.length ? Math.max(...authfile.map(x => x.id)) + 1 : 1,
        username: user.username,
        name: user.name,
        hashedPassword: credentials.hashedPassword,
        salt: credentials.salt,
        passwordIterations: credentials.passwordIterations,
        // Random rather than 0: tokens are matched on username and session
        // version, so a deleted user's tokens would otherwise come back to
        // life when the same username is created again
        sessionVersion: randomInt(1, 2 ** 31),
        admin: user.admin,
      }
      authfile.push(newUser)
      this.logger.warn(`Added new user: ${user.username}.`)
      return desensitiseUserProfile(newUser)
    })
  }

  /**
   * Remove a user
   * @param id
   * @returns the deleted user's username
   */
  async deleteUser(id: number): Promise<string> {
    let deletedUsername: string | undefined
    await this.withAuthFile((authfile) => {
      const index = authfile.findIndex(x => x.id === id)
      if (index < 0) {
        throw new BadRequestException('User Not Found')
      }
      // Prevent deleting the only admin user
      if (authfile[index].admin && authfile.filter(x => x.admin === true).length < 2) {
        throw new BadRequestException('Cannot delete only admin user')
      }
      deletedUsername = authfile[index].username
      authfile.splice(index, 1)
      this.logger.warn(`Deleted user with ID ${id}.`)
    })
    return deletedUsername!
  }

  /**
   * Updates a user
   * @param id
   * @param update
   * @returns the updated profile, and the username the user had before
   */
  async updateUser(id: number, update: UserDto): Promise<{ user: UserDto, previousUsername: string }> {
    // Pre-compute the new salt + hash outside the lock so PBKDF2 isn't
    // serialised against unrelated auth-file mutations.
    const credentials = update.password ? await this.hasher.createCredentials(update.password) : undefined

    let previousUsername: string | undefined
    const result = await this.withAuthFile((authfile) => {
      const user = authfile.find(x => x.id === id)
      if (!user) {
        throw new BadRequestException('User Not Found')
      }
      previousUsername = user.username
      if (user.username !== update.username) {
        if (authfile.some(x => x.username.toLowerCase() === update.username.toLowerCase())) {
          throw new ConflictException(`User with username '${update.username}' already exists.`)
        }
        this.logger.log(`Updated user: changed username from ${user.username} to ${update.username}.`)
        user.username = update.username
      }
      user.name = update.name || user.name
      const adminChanged = update.admin !== undefined && !!update.admin !== !!user.admin
      // Demoting the only administrator would leave nobody able to manage
      // users (and with auth set to "none", no admin to mint tokens for at
      // all) - the same lockout deleteUser already refuses.
      if (adminChanged && !update.admin && authfile.filter(x => x.admin === true).length < 2) {
        throw new BadRequestException('Cannot remove admin from only admin user')
      }
      user.admin = (update.admin === undefined) ? user.admin : update.admin
      if (credentials) {
        Object.assign(user, credentials)
      }
      // Changing the password or the admin role must invalidate tokens already
      // issued to this user, which carry the old values in their payload.
      if (credentials || adminChanged) {
        user.sessionVersion = (user.sessionVersion ?? 0) + 1
      }
      this.logger.log(`Updated user: ${user.username}.`)
      return desensitiseUserProfile(user)
    })
    return { user: result, previousUsername: previousUsername! }
  }

  /**
   * Revoke every token issued for a user. Used by logout so deleting the
   * browser cookie also invalidates any copy that may have been captured.
   */
  async revokeUserSessions(username: string): Promise<void> {
    await this.withAuthFile((authfile) => {
      const user = authfile.find(x => x.username === username)
      if (user) {
        user.sessionVersion = (user.sessionVersion ?? 0) + 1
      }
    })
  }

  /**
   * Re-hash a user's password at the current work factor if it is stored at a
   * weaker one. Called after a successful login (outside the auth-file lock) so
   * legacy 1,000-iteration hashes are upgraded transparently the next time the
   * owner signs in.
   */
  async upgradePasswordHashIfNeeded(user: UserDto, password: string) {
    if (!this.hasher.needsUpgrade(user)) {
      return
    }
    try {
      const credentials = await this.hasher.createCredentials(password)
      await this.withAuthFile((authfile) => {
        const stored = authfile.find(x => x.username === user.username)
        if (stored) {
          Object.assign(stored, credentials)
        }
      })
      this.logger.log(`Upgraded stored password hash strength for ${user.username}.`)
    } catch (e) {
      // Never fail a valid login because the upgrade write failed; it will be
      // retried on the next login.
      this.logger.warn(`Could not upgrade password hash for ${user.username}: ${e.message}`)
    }
  }

  /**
   * Mark a user as having a legacy OTP secret
   */
  async markUserAsLegacyOtp(username: string) {
    await this.jsonStore.mutate<UserDto[]>(
      this.configService.authPath,
      (current) => {
        const authfile = current ?? []
        const user = authfile.find(x => x.username === username)
        if (!user || user.otpLegacySecret) {
          // No-op: nothing to update, skip the write.
          return null
        }
        user.otpLegacySecret = true
        this.logger.warn(`Marked ${username} as having legacy OTP secret.`)
        return authfile
      },
      { spaces: 4 },
    )
  }
}
