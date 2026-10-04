import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { ScenesService } from './scenes.service.js'

const SCENE_BODY = {
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      actions: { type: 'array', items: { type: 'object', properties: { uniqueId: { type: 'string' }, characteristicType: { type: 'string' }, value: {} } } },
      schedules: { type: 'array', items: { type: 'object', properties: { cron: { type: 'string', example: '0 7 * * 1-5' }, enabled: { type: 'boolean' } } } },
    },
  },
}

@ApiTags('Scenes')
@ApiBearerAuth()
@UseGuards(AuthGuard())
@Controller('scenes')
export class ScenesController {
  constructor(
    @Inject(ScenesService) private readonly scenesService: ScenesService,
  ) {}

  @ApiOperation({ summary: 'List the scenes.' })
  @Get()
  list() {
    return this.scenesService.list()
  }

  @ApiOperation({ summary: 'Run a scene now: set each of its values.', description: 'Any signed-in user can run a scene, as any user can control accessories.' })
  @ApiParam({ name: 'id' })
  @Post(':id/run')
  run(@Param('id') id: string) {
    return this.scenesService.run(id, 'manual')
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create a scene.' })
  @ApiBody(SCENE_BODY)
  @Post()
  create(@Body() body: unknown) {
    return this.scenesService.create(body)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Replace a scene\'s name, actions and schedules.' })
  @ApiParam({ name: 'id' })
  @ApiBody(SCENE_BODY)
  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.scenesService.update(id, body)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Delete a scene.' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scenesService.remove(id)
  }
}
