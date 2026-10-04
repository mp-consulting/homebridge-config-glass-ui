import { Agent } from 'node:https'

import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { ConfigModule } from '../../core/config/config.module.js'
import { HomebridgeIpcModule } from '../../core/homebridge-ipc/homebridge-ipc.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { NodePtyModule } from '../../core/node-pty/node-pty.module.js'
import { ChildBridgesModule } from '../child-bridges/child-bridges.module.js'
import { InstalledPluginsService } from './installed-plugins.service.js'
import { PluginInstallerService } from './plugin-installer.service.js'
import { PluginJobsService } from './plugin-jobs.service.js'
import { PluginMetadataService } from './plugin-metadata.service.js'
import { PluginRegistryService } from './plugin-registry.service.js'
import { PluginsController } from './plugins.controller.js'
import { PluginsGateway } from './plugins.gateway.js'
import { PluginsService } from './plugins.service.js'
import { UiUpdateService } from './ui-update.service.js'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    HttpModule.register({
      headers: {
        'User-Agent': '@mp-consulting/homebridge-config-glass-ui',
      },
      timeout: 30000,
      httpsAgent: new Agent({ keepAlive: true }),
    }),
    NodePtyModule,
    ConfigModule,
    LoggerModule,
    HomebridgeIpcModule,
    ChildBridgesModule,
  ],
  providers: [
    PluginRegistryService,
    InstalledPluginsService,
    PluginInstallerService,
    PluginMetadataService,
    UiUpdateService,
    PluginsService,
    PluginJobsService,
    PluginsGateway,
  ],
  exports: [
    PluginsService,
  ],
  controllers: [
    PluginsController,
  ],
})
export class PluginsModule {}
