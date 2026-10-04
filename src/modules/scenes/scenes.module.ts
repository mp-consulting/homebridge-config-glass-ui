import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../../core/config/config.module.js'
import { FsModule } from '../../core/fs/fs.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { SchedulerModule } from '../../core/scheduler/scheduler.module.js'
import { AccessoriesModule } from '../accessories/accessories.module.js'
import { ScenesController } from './scenes.controller.js'
import { ScenesService } from './scenes.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    LoggerModule,
    FsModule,
    SchedulerModule,
    AccessoriesModule,
  ],
  providers: [ScenesService],
  controllers: [ScenesController],
  exports: [ScenesService],
})
export class ScenesModule {}
