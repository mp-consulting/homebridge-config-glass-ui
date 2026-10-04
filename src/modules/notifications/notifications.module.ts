import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../../core/config/config.module.js'
import { AppEventsModule } from '../../core/events/app-events.module.js'
import { FsModule } from '../../core/fs/fs.module.js'
import { HomebridgeIpcModule } from '../../core/homebridge-ipc/homebridge-ipc.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { ChildBridgesModule } from '../child-bridges/child-bridges.module.js'
import { PluginsModule } from '../plugins/plugins.module.js'
import { NotificationsController } from './notifications.controller.js'
import { NotificationsService } from './notifications.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    LoggerModule,
    FsModule,
    HomebridgeIpcModule,
    AppEventsModule,
    ChildBridgesModule,
    PluginsModule,
  ],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
