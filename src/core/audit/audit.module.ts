import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../config/config.module.js'
import { LoggerModule } from '../logger/logger.module.js'
import { AuditController } from './audit.controller.js'
import { ApiTokenWriteAuditInterceptor, AuditInterceptor } from './audit.interceptor.js'
import { AuditService } from './audit.service.js'

/**
 * The audit log (AuditService), the `@Audited` interceptor, the global
 * interceptor for API token writes, and `GET /api/audit`. A module with
 * `@Audited` handlers imports this one.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    LoggerModule,
  ],
  providers: [
    AuditService,
    AuditInterceptor,
    { provide: APP_INTERCEPTOR, useClass: ApiTokenWriteAuditInterceptor },
  ],
  controllers: [AuditController],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
