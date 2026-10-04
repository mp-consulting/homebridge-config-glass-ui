import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'

/**
 * Lets a request through only when it was authenticated by a person's own
 * session token. API tokens (`hbg_…`, `req.user.apiTokenId`) and service
 * tokens (`req.user.service`) are refused with 403, whatever their scope, so a
 * leaked token cannot mint or revoke tokens.
 */
@Injectable()
export class UserSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user
    if (user?.apiTokenId !== undefined) {
      throw new ForbiddenException('API tokens cannot manage API tokens. Sign in to Glass UI to list, create or revoke them.')
    }
    if (user?.service !== undefined) {
      throw new ForbiddenException('Service tokens cannot manage API tokens. Sign in to Glass UI to list, create or revoke them.')
    }
    return true
  }
}
