import { Inject, UseGuards } from '@nestjs/common'
import { SubscribeMessage, WebSocketGateway, WsException } from '@nestjs/websockets'

import { WsGuard } from '../../core/auth/guards/ws.guard.js'
import { devServerCorsConfig } from '../../core/cors.config.js'
import { AccessoriesService } from './accessories.service.js'

@UseGuards(WsGuard)
@WebSocketGateway({
  namespace: 'accessories',
  allowEIO3: true,
  cors: devServerCorsConfig,
})
export class AccessoriesGateway {
  constructor(
    @Inject(AccessoriesService) private readonly accessoriesService: AccessoriesService,
  ) {}

  @SubscribeMessage('get-accessories')
  connect(client: any, payload: any) {
    // Deliberately not awaited - but it must not be left to reject unhandled
    // either: there is no global unhandledRejection handler, so a rejection
    // here would take the whole UI process down.
    this.accessoriesService.connect(client).catch((e) => {
      client.emit('accessory-control-failure', e.message)
    })
  }

  // The layout belongs to the user the socket's token was verified for (set
  // by WsGuard) - never a username from the payload, which would let any user
  // read or overwrite another user's layout

  @SubscribeMessage('get-layout')
  async getAccessoryLayout(client: any) {
    return await this.accessoriesService.getAccessoryLayout(client.data.user.username)
  }

  @SubscribeMessage('save-layout')
  async saveAccessoryLayout(client: any, payload: any) {
    try {
      return await this.accessoriesService.saveAccessoryLayout(client.data.user.username, payload.layout)
    } catch (e) {
      return new WsException(e)
    }
  }
}
