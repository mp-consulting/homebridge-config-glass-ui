import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { SceneDto } from './scenes.dto.js'
import { ScenesService } from './scenes.service.js'

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
  @Post()
  create(@Body() body: SceneDto) {
    return this.scenesService.create(body)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Replace a scene\'s name, actions and schedules.' })
  @ApiParam({ name: 'id' })
  @Put(':id')
  update(@Param('id') id: string, @Body() body: SceneDto) {
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
