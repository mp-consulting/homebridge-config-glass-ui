import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { AuditModule } from '../../core/audit/audit.module.js'
import { ConfigModule } from '../../core/config/config.module.js'
import { AppEventsModule } from '../../core/events/app-events.module.js'
import { FsModule } from '../../core/fs/fs.module.js'
import { HomebridgeIpcModule } from '../../core/homebridge-ipc/homebridge-ipc.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { SchedulerModule } from '../../core/scheduler/scheduler.module.js'
import { AiModule } from '../ai/ai.module.js'
import { ChildBridgesModule } from '../child-bridges/child-bridges.module.js'
import { PluginsModule } from '../plugins/plugins.module.js'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'
import { WebPushController } from './web-push.controller.js'
import { WebPushService } from './web-push.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuditModule,
    ConfigModule,
    LoggerModule,
    FsModule,
    HomebridgeIpcModule,
    AppEventsModule,
    ChildBridgesModule,
    PluginsModule,
    SchedulerModule,
    AiModule,
  ],
  providers: [NotificationsService, WebPushService],
  controllers: [NotificationsController, WebPushController],
  exports: [NotificationsService, WebPushService],
})
export class NotificationsModule {}
