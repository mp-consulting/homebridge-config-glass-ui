import type { EventEmitter } from 'node:events'

import { Inject, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common'
import { SubscribeMessage, WebSocketGateway, WsException } from '@nestjs/websockets'

import { WsAdminGuard } from '../../core/auth/guards/ws-admin-guard.js'
import { ConfigService } from '../../core/config/config.service.js'
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
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Install or update a package for a browser. After the UI updates itself the
   * browser normally asks for the restart, but it can lose the connection (the
   * update replaces the running server) or be closed first, which left the old
   * version running indefinitely. Restart regardless, as the REST update and
   * Update All already do; a restart the browser also asks for is harmless.
   */
  private async installForClient(pluginAction: PluginActionDto, client: EventEmitter) {
    const result = await this.pluginsService.managePlugin('install', pluginAction, client)
    if (pluginAction.name === this.configService.name) {
      this.logger.warn(`${this.configService.name} has been updated, the server will restart shortly...`)
      this.pluginsService.scheduleUiRestart()
    }
    return result
  }

  @SubscribeMessage('install')
  async installPlugin(client: EventEmitter, pluginAction: PluginActionDto) {
    try {
      return await this.installForClient(pluginAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }

  @SubscribeMessage('uninstall')
  async uninstallPlugin(client: EventEmitter, pluginAction: PluginActionDto) {
    try {
      return await this.pluginsService.managePlugin('uninstall', pluginAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }

  @SubscribeMessage('update')
  async updatePlugin(client: EventEmitter, pluginAction: PluginActionDto) {
    try {
      return await this.installForClient(pluginAction, client)
    } catch (e) {
      this.logger.error(e)
      client.emit('stdout', `\n\r${red(e.toString())}\n\r`)
      return new WsException(e)
    }
  }

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
