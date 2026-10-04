import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { NotificationSettingsDto, NotificationTestDto } from './notifications.dto.js'
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
  @Put('settings')
  updateSettings(@Body() body: NotificationSettingsDto) {
    return this.notificationsService.updateSettings(body)
  }

  @ApiOperation({ summary: 'Send a test notification to one channel, or to every enabled one.' })
  @Post('test')
  sendTest(@Body() body: NotificationTestDto) {
    return this.notificationsService.sendTest(body?.channel)
  }
}
