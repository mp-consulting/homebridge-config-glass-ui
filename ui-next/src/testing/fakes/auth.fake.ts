import { TEST_INSTANCE_ID } from '../constants'

/** The logged-in user as the token decodes it (Angular's UserInterface). */
export interface FakeUser {
  username: string
  name: string
  admin: boolean
  instanceId: string
  [key: string]: unknown
}

/**
 * A signed-in admin. `instanceId` matches `makeEnv()`, or `isLoggedIn()`
 * fails for the wrong reason.
 * @param overrides - fields to change
 */
export function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    username: 'admin',
    name: 'Test Admin',
    admin: true,
    instanceId: TEST_INSTANCE_ID,
    ...overrides,
  }
}

/**
 * The data half of the auth store, signed in: seed it with
 * `useAuthStore.setState(makeAuthState())`, or pass `{ token: null, user: null }`
 * for the signed-out case.
 * @param overrides - fields to change
 * @param overrides.token - the access token, or null
 * @param overrides.user - merged over the default user, or null
 */
export function makeAuthState(overrides: { token?: string | null, user?: Partial<FakeUser> | null, [key: string]: unknown } = {}) {
  const { user, ...rest } = overrides
  return {
    token: 'test-access-token' as string | null,
    user: user === null ? null : makeUser(user),
    ...rest,
  }
}
