import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../../core/config/config.module.js'
import { FsModule } from '../../core/fs/fs.module.js'
import { HomebridgeIpcModule } from '../../core/homebridge-ipc/homebridge-ipc.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { AccessoriesModule } from '../accessories/accessories.module.js'
import { ChildBridgesModule } from '../child-bridges/child-bridges.module.js'
import { ConfigEditorModule } from '../config-editor/config-editor.module.js'
import { ServerCachedAccessoriesService } from './server-cached-accessories.service.js'
import { ServerNetworkService } from './server-network.service.js'
import { ServerPairingsService } from './server-pairings.service.js'
import { ServerWallpaperService } from './server-wallpaper.service.js'
import { ServerController } from './server.controller.js'
import { ServerService } from './server.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    LoggerModule,
    ConfigEditorModule,
    AccessoriesModule,
    ChildBridgesModule,
    HomebridgeIpcModule,
    FsModule,
  ],
  providers: [
    ServerService,
    ServerPairingsService,
    ServerCachedAccessoriesService,
    ServerNetworkService,
    ServerWallpaperService,
  ],
  controllers: [
    ServerController,
  ],
  exports: [
    ServerService,
  ],
})
export class ServerModule {}
