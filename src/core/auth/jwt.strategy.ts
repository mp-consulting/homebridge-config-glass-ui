import type { FastifyRequest } from 'fastify'

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { ConfigService } from '../config/config.service.js'
import { AuthService } from './auth.service.js'
import { isLiveSetupWizardToken, isSetupWizardToken, isSetupWizardTokenRoute } from './setup-wizard-token.js'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.secrets.secretKey,
      passReqToCallback: true,
    })
  }

  async validate(req: FastifyRequest, payload: any) {
    // The setup-wizard token is signed with a sentinel `instanceId: 'xxxxx'`
    // and carries `admin: true`. It must only unlock requests while the
    // wizard is still in progress (otherwise its 5-minute window would grant
    // admin access after first-user setup), and even then only the few routes
    // the wizard's restore step calls - it is not an administrator session.
    if (isSetupWizardToken(payload)) {
      if (!isLiveSetupWizardToken(payload, this.configService) || !isSetupWizardTokenRoute(req?.method, req?.routeOptions?.url)) {
        throw new UnauthorizedException()
      }
    } else if (payload?.instanceId !== this.configService.instanceId) {
      // A token minted for a different instance
      throw new UnauthorizedException()
    }
    const user = await this.authService.validateUser(payload)
    if (!user) {
      throw new UnauthorizedException()
    }
    return user
  }
}
