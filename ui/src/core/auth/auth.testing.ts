import { vi } from 'vitest'

/**
 * Test helpers for the auth specs. Kept next to the code they serve until the
 * shared `src/testing` fakes absorb them.
 */

/** Must match `env.instanceId` or `isLoggedIn()` is false for the wrong reason. */
export const TEST_INSTANCE_ID = 'test-instance-id'

/**
 * A real JSON web token, so a spec exercises the same decode and expiry path as
 * production rather than a stubbed helper that always agrees.
 * @param payload - the claims to put in the token
 * @param expiresInSeconds - lifetime; pass a negative number for an expired token
 */
export function makeJwt(payload: Record<string, any> = {}, expiresInSeconds = 3600): string {
  const encode = (value: object) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      username: 'admin',
      name: 'Test Admin',
      admin: true,
      instanceId: TEST_INSTANCE_ID,
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
    'signature',
  ].join('.')
}

/**
 * Swap `window.location` for a copy whose `reload` is a spy. The members of a
 * jsdom Location cannot be redefined, but the object itself can be replaced.
 * Undo with `vi.unstubAllGlobals()`.
 */
export function stubLocationReload() {
  const reload = vi.fn()
  const real = window.location
  vi.stubGlobal('location', {
    href: real.href,
    origin: real.origin,
    protocol: real.protocol,
    host: real.host,
    hostname: real.hostname,
    port: real.port,
    pathname: real.pathname,
    search: real.search,
    hash: real.hash,
    reload,
    assign: vi.fn(),
    replace: vi.fn(),
  })
  return reload
}
