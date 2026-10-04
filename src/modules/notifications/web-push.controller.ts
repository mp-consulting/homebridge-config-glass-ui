import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { NotificationsService } from './notifications.service.js'
import { WebPushService } from './web-push.service.js'

const SUBSCRIPTION_SCHEMA = {
  type: 'object',
  required: ['endpoint', 'keys'],
  properties: {
    endpoint: { type: 'string', example: 'https://fcm.googleapis.com/fcm/send/…' },
    keys: { type: 'object', properties: { p256dh: { type: 'string' }, auth: { type: 'string' } } },
    label: { type: 'string', example: 'Safari on iPhone' },
  },
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard(), AdminGuard)
@Controller('notifications/web-push')
export class WebPushController {
  constructor(
    @Inject(WebPushService) private readonly webPush: WebPushService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @ApiOperation({
    summary: 'Return the VAPID public key browsers subscribe with, and the subscribed devices.',
    description: 'The key pair is generated and stored the first time it is asked for.',
  })
  @Get()
  async getState() {
    return { publicKey: await this.webPush.getPublicKey(), subscriptions: await this.webPush.listSubscriptions() }
  }

  @ApiOperation({ summary: 'Subscribe this browser to the Browser notification channel (its `PushSubscription.toJSON()`).' })
  @ApiBody({ schema: SUBSCRIPTION_SCHEMA })
  @Post('subscriptions')
  subscribe(@Body() body: unknown, @Request() req: { user?: { username?: string } }) {
    return this.webPush.subscribe(body, req.user?.username)
  }

  @ApiOperation({ summary: 'Unsubscribe the browser with this endpoint.' })
  @ApiBody({ schema: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string' } } } })
  @Post('unsubscribe')
  unsubscribe(@Body() body: { endpoint?: unknown } | undefined) {
    if (typeof body?.endpoint !== 'string') {
      throw new BadRequestException('endpoint is required.')
    }
    return this.webPush.unsubscribe({ endpoint: body.endpoint })
  }

  @ApiOperation({ summary: 'Remove a subscribed device by its id.' })
  @ApiParam({ name: 'id' })
  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.webPush.unsubscribe({ id })
  }

  @ApiOperation({ summary: 'Send a test notification to the browser with this endpoint, or to every subscribed device.' })
  @ApiBody({ schema: { type: 'object', properties: { endpoint: { type: 'string' } } } })
  @Post('test')
  test(@Body() body: { endpoint?: unknown } | undefined) {
    return this.notifications.sendBrowserTest(typeof body?.endpoint === 'string' ? body.endpoint : undefined)
  }
}
