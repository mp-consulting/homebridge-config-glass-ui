import type { FastifyRequest } from 'fastify'

import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { ConfigService } from '../config/config.service.js'
import { isApiToken } from './api-token.constants.js'
import { AuthService } from './auth.service.js'
import { isLiveSetupWizardToken, isSetupWizardToken, isSetupWizardTokenRoute } from './setup-wizard-token.js'

const READ_ONLY_METHODS = new Set(['GET', 'HEAD'])

function readBearerToken(authorization: unknown): string | undefined {
  if (typeof authorization !== 'string') {
    return undefined
  }
  const [scheme, token] = authorization.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

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

  /**
   * API tokens (`Bearer hbg_…`) are not JWTs, so they are resolved here before
   * passport-jwt would reject them. A `read` token may only make GET/HEAD
   * requests. Everything else goes through passport-jwt as before.
   */
  override authenticate(req: any, options?: any): void {
    const token = readBearerToken(req?.headers?.authorization)
    if (!isApiToken(token)) {
      super.authenticate(req, options)
      return
    }
    this.authService.validateApiToken(token).then((user) => {
      if (!user) {
        this.fail('Invalid API token', 401)
        return
      }
      if (user.apiTokenScope === 'read' && !READ_ONLY_METHODS.has(String(req?.method).toUpperCase())) {
        this.error(new ForbiddenException('This API token is read-only.'))
        return
      }
      this.success(user)
    }, (e) => {
      this.error(e)
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
