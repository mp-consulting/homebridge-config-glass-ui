import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { NotificationsService } from './notifications.service.js'

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard(), AdminGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService,
  ) {}

  @ApiOperation({ summary: 'Return the notification settings. Stored secrets read as `********`.' })
  @Get('settings')
  getSettings() {
    return this.notificationsService.getSettings()
  }

  @ApiOperation({
    summary: 'Replace the notification settings.',
    description: 'A secret sent back as `********` keeps the stored value; an empty string clears it.',
  })
  @ApiBody({ schema: { type: 'object' } })
  @Put('settings')
  updateSettings(@Body() body: unknown) {
    return this.notificationsService.updateSettings(body)
  }

  @ApiOperation({ summary: 'Send a test notification to one channel, or to every enabled one.' })
  @ApiBody({ schema: { type: 'object', properties: { channel: { type: 'string', enum: ['webhook', 'ntfy', 'pushover', 'telegram'] } } } })
  @Post('test')
  sendTest(@Body() body: { channel?: string } | undefined) {
    return this.notificationsService.sendTest(body?.channel)
  }
}
