import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { ScenesService } from './scenes.service.js'

@ApiTags('Scenes')
@ApiBearerAuth()
@UseGuards(AuthGuard(), AdminGuard)
@Controller('scenes/automation')
export class SceneAutomationController {
  constructor(
    @Inject(ScenesService) private readonly scenesService: ScenesService,
  ) {}

  @ApiOperation({
    summary: 'What scene triggers can use: the location for sunrise and sunset, the next of each, and whether characteristic triggers work.',
    description: 'The location is the first weather widget\'s city on the dashboard. Characteristic triggers and conditions need Homebridge in insecure mode.',
  })
  @Get()
  getInfo() {
    return this.scenesService.getAutomationInfo()
  }
}
