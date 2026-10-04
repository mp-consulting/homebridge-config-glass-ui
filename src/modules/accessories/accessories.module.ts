import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../../core/config/config.module.js'
import { FsModule } from '../../core/fs/fs.module.js'
import { HomebridgeIpcModule } from '../../core/homebridge-ipc/homebridge-ipc.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { AccessoriesController } from './accessories.controller.js'
import { AccessoriesGateway } from './accessories.gateway.js'
import { AccessoriesService } from './accessories.service.js'
import { AccessoryHistoryController } from './accessory-history.controller.js'
import { AccessoryHistoryService } from './accessory-history.service.js'
import { MatterAccessoriesService } from './matter-accessories.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    LoggerModule,
    HomebridgeIpcModule,
    FsModule,
  ],
  providers: [
    AccessoriesService,
    MatterAccessoriesService,
    AccessoriesGateway,
    AccessoryHistoryService,
  ],
  exports: [
    AccessoriesService,
    AccessoryHistoryService,
  ],
  controllers: [
    AccessoriesController,
    AccessoryHistoryController,
  ],
})
export class AccessoriesModule {}
