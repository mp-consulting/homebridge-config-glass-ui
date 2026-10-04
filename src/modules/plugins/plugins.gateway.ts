import type { EventEmitter } from 'node:events'

import { Inject, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common'
import { SubscribeMessage, WebSocketGateway, WsException } from '@nestjs/websockets'

import { Audited, auditPluginDetails, auditPluginTarget } from '../../core/audit/audit.interceptor.js'
import { WsAdminGuard } from '../../core/auth/guards/ws-admin-guard.js'
import { devServerCorsConfig } from '../../core/cors.config.js'
import { red } from '../../core/logger/colors.js'
import { Logger } from '../../core/logger/logger.service.js'
import { HomebridgeUpdateActionDto, PluginActionDto } from './plugins.dto.js'
import { PluginsService } from './plugins.service.js'

@UseGuards(WsAdminGuard)
@WebSocketGateway({
  namespace: '/plugins',
  allowEIO3: true,
  cors: devServerCorsConfig,
})
@UsePipes(new ValidationPipe({
  whitelist: true,
  exceptionFactory: (err) => {
    console.error(err)
    return new WsException(err)
  },
}))
export class PluginsGateway {
  constructor(
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @Audited('plugin.install', { target: auditPluginTarget, details: auditPluginDetails })
  @SubscribeMessage('install')
  async installPlugin(client: EventEmitter, pluginAction: PluginActionDto) {
    try {
      return await this.pluginsService.runPluginAction('install', pluginAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }

  @Audited('plugin.uninstall', { target: auditPluginTarget })
  @SubscribeMessage('uninstall')
  async uninstallPlugin(client: EventEmitter, pluginAction: PluginActionDto) {
    try {
      return await this.pluginsService.runPluginAction('uninstall', pluginAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }

  @Audited('plugin.update', { target: auditPluginTarget, details: auditPluginDetails })
  @SubscribeMessage('update')
  async updatePlugin(client: EventEmitter, pluginAction: PluginActionDto) {
    try {
      return await this.pluginsService.runPluginAction('update', pluginAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }

  @Audited('homebridge.update', { details: auditPluginDetails })
  @SubscribeMessage('homebridge-update')
  async homebridgeUpdate(client: EventEmitter, homebridgeUpdateAction: HomebridgeUpdateActionDto) {
    try {
      return await this.pluginsService.updateHomebridgePackage(homebridgeUpdateAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }
}
