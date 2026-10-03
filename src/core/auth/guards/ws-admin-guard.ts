import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { WsException } from '@nestjs/websockets'

import { ConfigService } from '../../config/config.service.js'
import { AuthService } from '../auth.service.js'
import { authorizeWsGuardClient } from './ws-auth.js'

@Injectable()
export class WsAdminGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    // ⚠️ Explicit @Inject: the dev server runs TypeScript through tsx (esbuild),
    // which does not emit `design:paramtypes`. Without the decorator Nest has no
    // type to resolve and injects undefined, so every socket message threw and
    // disconnected the client — a status page stuck on its spinner under
    // `npm run watch`, while a tsc-built release worked.
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Resolved from the whole application context rather than injected: this
   * guard is built inside each gateway's own module, and those do not import
   * AuthModule. See the note in WsGuard.
   */
  private get authService(): AuthService {
    return this.moduleRef.get(AuthService, { strict: false })
  }

  async canActivate(context: ExecutionContext) {
    const client = context.switchToWs().getClient()
    try {
      // The payload's `admin` flag is a snapshot from when the token was
      // minted, so verifyWsClient checks it against the stored user too —
      // otherwise a demoted administrator would keep admin sockets until
      // their token expired. Live setup-wizard tokens are allowed *only*
      // while the wizard is in progress.
      const user = await authorizeWsGuardClient(client, this.configService, this.authService, { admin: () => true })
      return user.admin
    } catch (e) {
      client.disconnect()
      throw new WsException('Unauthorized')
    }
  }
}
