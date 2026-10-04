import type { ExecutionContext } from '@nestjs/common'

import type { ApiTokenScope } from './api-token.constants.js'

import { createParamDecorator } from '@nestjs/common'

/**
 * The `req.user` the auth guards set: an auth.json account (from a session
 * JWT), an API token (`apiTokenId`, `apiTokenScope`), a service token
 * (`service`) or the setup-wizard token. Only `username` and `admin` are
 * common to all of them.
 */
export interface AuthUser {
  username?: string
  name?: string
  admin?: boolean
  instanceId?: string
  /** Set for a service token (a program, not a person). */
  service?: string
  /** Set when the request was made with an API token. */
  apiTokenId?: string
  apiTokenScope?: ApiTokenScope
  [key: string]: unknown
}

/** The authenticated user of an HTTP request (behind `AuthGuard()`). */
export const User = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user
})
