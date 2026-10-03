import { isIPv4, isIPv6 } from 'node:net'

import { HttpException, Inject, Injectable } from '@nestjs/common'
import NodeCache from 'node-cache'

import { Logger } from '../logger/logger.service.js'

// Login throttling: after this many failed attempts for a given key the account
// is locked out for LOGIN_LOCKOUT_SECONDS. Guards against online password and
// 2FA guessing, which was otherwise unlimited.
const MAX_LOGIN_FAILURES = 10
const LOGIN_LOCKOUT_SECONDS = 300

// Per-username budget across every source address. The per-source limit above
// does nothing against guesses spread over many addresses (or IPv6 networks),
// so once a username has this many failures from anywhere, further attempts
// for it are slowed by a cooldown that doubles on each further failure, from
// USERNAME_COOLDOWN_MIN_SECONDS up to USERNAME_COOLDOWN_MAX_SECONDS. It is
// never a permanent lock: the cooldown is bounded, the count is forgotten
// after USERNAME_FAILURE_WINDOW_SECONDS without a failure, and a source that
// has signed in as that user before (KNOWN_SOURCE_SECONDS) is exempt - so an
// attacker hammering the admin username cannot keep the admin out from their
// usual address. The per-source limit still applies to everyone.
const USERNAME_MAX_FAILURES = 50
const USERNAME_FAILURE_WINDOW_SECONDS = 3600
const USERNAME_COOLDOWN_MIN_SECONDS = 60
const USERNAME_COOLDOWN_MAX_SECONDS = 900
const KNOWN_SOURCE_SECONDS = 30 * 24 * 60 * 60
// Bounds the memory a flood of made-up usernames can take; past it, only
// usernames already being counted are tracked (the per-source limit still applies)
const USERNAME_FAILURE_MAX_ENTRIES = 10_000

// Per-source budget across every username. The per-key limit above is keyed
// on `username|source`, so a single address rotating through made-up
// usernames was never slowed down - and every attempt costs a full-strength
// password hash. Once a source has this many failures within the window
// (refreshed on each failure), it is refused before any hashing is done.
// A source that has signed in as the named user before is exempt, as above.
const SOURCE_MAX_FAILURES = 20
const SOURCE_FAILURE_WINDOW_SECONDS = 900
// Bounds the memory a flood from many addresses can take, as above. Past it,
// new sources are not counted - the hash concurrency limit (PasswordHasher)
// still holds.
const SOURCE_FAILURE_MAX_ENTRIES = 10_000

interface UsernameFailureState {
  failures: number
  // Cooldowns started so far, for the doubling
  cooldowns: number
  // Epoch ms until which attempts from unknown sources are refused
  lockedUntil: number
}

/** The keys one sign-in attempt is throttled on. */
export interface LoginAttempt {
  /** The username as typed, for log lines */
  username: string
  normalisedUsername: string
  /** See loginThrottleSource */
  source: string
  /** `normalisedUsername|source` */
  throttleKey: string
}

/**
 * The source part of a login throttle key. An IPv6 client usually controls a
 * whole /64 and could rotate through addresses in it for fresh guesses, so it
 * is throttled per /64. IPv4 (including IPv4-mapped IPv6) is kept as is.
 */
export function loginThrottleSource(clientId?: string): string {
  const address = (clientId || '').split('%')[0]
  if (!isIPv6(address)) {
    return address
  }
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : ''
  if (isIPv4(mapped)) {
    return mapped
  }
  const countGroups = (part: string) => part ? part.split(':').reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0) : 0
  const [head, tail] = address.split('::')
  const groups = head ? head.split(':') : []
  if (tail !== undefined) {
    groups.push(...Array.from<string>({ length: 8 - countGroups(head) - countGroups(tail) }).fill('0'))
    groups.push(...(tail ? tail.split(':') : []))
  }
  return `${groups.slice(0, 4).map(g => Number.parseInt(g, 16).toString(16)).join(':')}::/64`
}

/**
 * The failed-login budgets: per `username|source`, per source across every
 * username, and per username across every source. In memory only.
 */
@Injectable()
export class LoginThrottle {
  // Counts recent failed logins per key (normalised username + client address).
  // A failed attempt refreshes the TTL, so sustained guessing keeps the account
  // locked; the count clears after LOGIN_LOCKOUT_SECONDS of no attempts.
  private loginFailureCache = new NodeCache({ stdTTL: LOGIN_LOCKOUT_SECONDS })

  // Failed logins per normalised username, from every source (see
  // USERNAME_MAX_FAILURES). Refreshed on each failure.
  private usernameFailureCache = new NodeCache({ stdTTL: USERNAME_FAILURE_WINDOW_SECONDS, useClones: false })

  // `username|source` pairs that have completed a sign-in, exempt from the
  // per-username cooldown. In memory only, so a restart forgets them and the
  // worst case for a legitimate user is one bounded cooldown.
  private knownLoginSources = new NodeCache({ stdTTL: KNOWN_SOURCE_SECONDS, useClones: false })

  // Failed logins per source address (IPv6 per /64), for every username. See
  // SOURCE_MAX_FAILURES. Refreshed on each failure.
  private sourceFailureCache = new NodeCache({ stdTTL: SOURCE_FAILURE_WINDOW_SECONDS })

  constructor(
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * The throttle keys for a sign-in attempt
   * @param username - as typed
   * @param clientId - optional client identifier (e.g. source address)
   */
  attempt(username: string, clientId?: string): LoginAttempt {
    const normalisedUsername = String(username || '').toLowerCase()
    const source = loginThrottleSource(clientId)
    return { username, normalisedUsername, source, throttleKey: `${normalisedUsername}|${source}` }
  }

  /**
   * Throw a 429 when any budget for this attempt is spent. Runs before any
   * work, so password and 2FA guessing cannot run unbounded.
   */
  assertLoginAllowed(attempt: LoginAttempt): void {
    this.assertNotLockedOut(attempt.throttleKey, attempt.username)
    this.assertSourceNotLockedOut(attempt.source, attempt.throttleKey)
    this.assertUsernameNotCoolingDown(attempt.normalisedUsername, attempt.throttleKey, attempt.username)
  }

  /**
   * Success clears the failure count for this key, and exempts this source
   * from the per-username cooldown. The per-username and per-source counts
   * are left alone: they count guesses at other usernames, or from elsewhere,
   * as well.
   */
  recordLoginSuccess(attempt: LoginAttempt): void {
    this.loginFailureCache.del(attempt.throttleKey)
    this.knownLoginSources.set(attempt.throttleKey, true)
  }

  /** Count a failed sign-in against every budget it falls under. */
  recordLoginFailure(attempt: LoginAttempt): void {
    this.recordFailedAttempt(attempt.throttleKey)
    this.recordSourceFailure(attempt.source)
    this.recordUsernameFailure(attempt.normalisedUsername)
  }

  /**
   * Run a signed-in user's current-password check, throttled like a login -
   * otherwise a stolen session could guess the password without limit. Only
   * the session's own user can reach this, so keying on the username alone
   * cannot be used to lock anyone else out.
   */
  async checkCurrentPassword(username: string, check: () => Promise<unknown>): Promise<void> {
    const throttleKey = `${username.toLowerCase()}|current-password`
    this.assertNotLockedOut(throttleKey, username)
    try {
      await check()
    } catch (e) {
      this.recordFailedAttempt(throttleKey)
      throw e
    }
    this.loginFailureCache.del(throttleKey)
  }

  /**
   * Throw a 429 once a source address has failed too often, whichever
   * usernames it tried (see SOURCE_MAX_FAILURES). A source that has signed
   * in as the named user before is exempt.
   */
  private assertSourceNotLockedOut(source: string, throttleKey: string) {
    // No source (an internal caller) - nothing to key on
    if (!source || this.knownLoginSources.has(throttleKey)) {
      return
    }
    if ((this.sourceFailureCache.get<number>(source) || 0) >= SOURCE_MAX_FAILURES) {
      this.logger.warn(`Too many failed login attempts from ${source} - temporarily refusing sign-in attempts from this address.`)
      throw new HttpException('Too many failed attempts. Please wait a few minutes and try again.', 429)
    }
  }

  private recordSourceFailure(source: string) {
    if (!source) {
      return
    }
    const existing = this.sourceFailureCache.get<number>(source)
    if (existing === undefined && this.sourceFailureCache.getStats().keys >= SOURCE_FAILURE_MAX_ENTRIES) {
      return
    }
    // Re-set to refresh the window
    this.sourceFailureCache.set(source, (existing || 0) + 1)
  }

  /**
   * Throw a 429 once a throttle key has reached the failure threshold
   */
  private assertNotLockedOut(throttleKey: string, username: string) {
    if ((this.loginFailureCache.get<number>(throttleKey) || 0) >= MAX_LOGIN_FAILURES) {
      this.logger.warn(`Too many failed login attempts for '${username}' - temporarily locked out.`)
      throw new HttpException('Too many failed attempts. Please wait a few minutes and try again.', 429)
    }
  }

  private recordFailedAttempt(throttleKey: string) {
    this.loginFailureCache.set(throttleKey, (this.loginFailureCache.get<number>(throttleKey) || 0) + 1)
  }

  /**
   * Throw a 429 while a username's cooldown runs, unless this source has
   * signed in as that user before (see USERNAME_MAX_FAILURES)
   */
  private assertUsernameNotCoolingDown(normalisedUsername: string, throttleKey: string, username: string) {
    const state = this.usernameFailureCache.get<UsernameFailureState>(normalisedUsername)
    if (!state || state.lockedUntil <= Date.now() || this.knownLoginSources.has(throttleKey)) {
      return
    }
    const seconds = Math.ceil((state.lockedUntil - Date.now()) / 1000)
    this.logger.warn(`Too many failed login attempts for '${username}' from several addresses - slowing down sign-in attempts for ${seconds}s.`)
    throw new HttpException(`Too many failed attempts. Please wait ${seconds} seconds and try again.`, 429)
  }

  /**
   * Count a failure against the username. From the threshold on, every
   * further failure starts a cooldown twice as long as the one before, up to
   * the cap - roughly one guess per USERNAME_COOLDOWN_MAX_SECONDS at worst.
   */
  private recordUsernameFailure(normalisedUsername: string) {
    const existing = this.usernameFailureCache.get<UsernameFailureState>(normalisedUsername)
    if (!existing && this.usernameFailureCache.getStats().keys >= USERNAME_FAILURE_MAX_ENTRIES) {
      return
    }
    const state = existing ?? { failures: 0, cooldowns: 0, lockedUntil: 0 }
    state.failures++
    if (state.failures >= USERNAME_MAX_FAILURES) {
      const seconds = Math.min(USERNAME_COOLDOWN_MAX_SECONDS, USERNAME_COOLDOWN_MIN_SECONDS * 2 ** state.cooldowns)
      state.cooldowns++
      state.lockedUntil = Date.now() + seconds * 1000
    }
    // Re-set to refresh the window
    this.usernameFailureCache.set(normalisedUsername, state)
  }
}
