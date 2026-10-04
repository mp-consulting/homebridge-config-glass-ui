import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { Audited } from '../../core/audit/audit.interceptor.js'
import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { AuthUser, User } from '../../core/auth/user.decorator.js'
import { PushEndpointDto, PushSubscriptionDto, PushTestDto } from './notifications.dto.js'
import { NotificationsService } from './notifications.service.js'
import { WebPushService } from './web-push.service.js'

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
  @Audited('web-push.subscribe', { target: ({ result }) => (result as { id?: string } | undefined)?.id, details: ({ body }) => ({ label: (body as PushSubscriptionDto)?.label }) })
  @Post('subscriptions')
  subscribe(@Body() body: PushSubscriptionDto, @User() user: AuthUser) {
    return this.webPush.subscribe(body, user?.username)
  }

  @ApiOperation({ summary: 'Unsubscribe the browser with this endpoint.' })
  @Audited('web-push.unsubscribe')
  @Post('unsubscribe')
  unsubscribe(@Body() body: PushEndpointDto) {
    return this.webPush.unsubscribe({ endpoint: body.endpoint })
  }

  @ApiOperation({ summary: 'Remove a subscribed device by its id.' })
  @ApiParam({ name: 'id' })
  @Audited('web-push.remove')
  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.webPush.unsubscribe({ id })
  }

  @ApiOperation({ summary: 'Send a test notification to the browser with this endpoint, or to every subscribed device.' })
  @Post('test')
  test(@Body() body: PushTestDto) {
    return this.notifications.sendBrowserTest(body?.endpoint)
  }
}
