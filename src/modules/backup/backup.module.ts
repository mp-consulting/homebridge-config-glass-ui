import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../../core/config/config.module.js'
import { AppEventsModule } from '../../core/events/app-events.module.js'
import { FsModule } from '../../core/fs/fs.module.js'
import { HomebridgeIpcModule } from '../../core/homebridge-ipc/homebridge-ipc.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { SchedulerModule } from '../../core/scheduler/scheduler.module.js'
import { PluginsModule } from '../plugins/plugins.module.js'
import { BackupRestoreService } from './backup-restore.service.js'
import { BackupScheduler } from './backup-scheduler.js'
import { BackupController } from './backup.controller.js'
import { BackupGateway } from './backup.gateway.js'
import { BackupService } from './backup.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    PluginsModule,
    SchedulerModule,
    LoggerModule,
    HomebridgeIpcModule,
    FsModule,
    AppEventsModule,
  ],
  providers: [
    BackupService,
    BackupScheduler,
    BackupRestoreService,
    BackupGateway,
  ],
  controllers: [
    BackupController,
  ],
  exports: [
    BackupService,
  ],
})
export class BackupModule {}
