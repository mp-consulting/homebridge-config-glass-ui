import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger'
import { IsDefined, IsNotEmpty, IsString, Matches } from 'class-validator'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { PluginJobsService } from './plugin-jobs.service.js'
import { PluginRollbackService, ROLLBACK_DAYS } from './plugin-rollback.service.js'

export class PluginRollbackRequestDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^(@[\w-]+(\.[\w-]+)*\/)?homebridge-[\w-]+$/)
  @ApiProperty({ type: String, example: 'homebridge-example-plugin' })
  name: string
}

const ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    fromVersion: { type: 'string' },
    toVersion: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    suspect: {
      type: 'object',
      nullable: true,
      properties: {
        reason: { type: 'string', enum: ['childBridgeCrashLoop', 'homebridgeCrashLoop'] },
        at: { type: 'string', format: 'date-time' },
        bridge: { type: 'string' },
      },
    },
  },
}

@ApiTags('Plugins')
@ApiBearerAuth()
@UseGuards(AuthGuard(), AdminGuard)
@Controller('plugins/rollback')
export class PluginRollbackController {
  constructor(
    @Inject(PluginRollbackService) private readonly rollback: PluginRollbackService,
    @Inject(PluginJobsService) private readonly pluginJobs: PluginJobsService,
  ) {}

  @ApiOperation({
    summary: 'List the plugins that can be rolled back to the version they had before their last update.',
    description: `Kept for ${ROLLBACK_DAYS} days after the update. \`suspect\` is set when the plugin's bridge (its child bridge, or Homebridge for a plugin on the main bridge) crash looped soon after the update.`,
  })
  @ApiResponse({ status: 200, schema: { type: 'array', items: ENTRY_SCHEMA } })
  @Get()
  list() {
    return this.rollback.list()
  }

  @ApiOperation({
    summary: 'Roll a plugin back to the version it had before its last update, as a background job.',
    description: 'Answers 202 with the job id and the version being installed; poll `GET /plugins/jobs/:jobId`. Restart Homebridge (or the child bridge) afterwards.',
  })
  @ApiBody({ type: PluginRollbackRequestDto })
  @ApiResponse({ status: 202, schema: { type: 'object', properties: { jobId: { type: 'string' }, version: { type: 'string' } } } })
  @ApiResponse({ status: 404, description: 'Nothing to roll back for that plugin.' })
  @HttpCode(202)
  @Post()
  async start(@Body() body: PluginRollbackRequestDto) {
    const entry = await this.rollback.require(body.name)
    return { jobId: this.pluginJobs.start('install', { name: entry.name, version: entry.fromVersion }).id, version: entry.fromVersion }
  }
}
