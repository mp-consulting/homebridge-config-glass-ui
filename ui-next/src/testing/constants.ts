/**
 * Shared identity used by the settings and auth fakes.
 *
 * `isLoggedIn()` in the auth store compares `settings.env.instanceId` with
 * `user.instanceId` and returns false when they differ, so both fakes must
 * agree or every guard spec fails for the wrong reason.
 */
export const TEST_INSTANCE_ID = 'test-instance-id'
