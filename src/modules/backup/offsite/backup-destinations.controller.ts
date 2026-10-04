import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../../core/auth/guards/admin.guard.js'
import { BackupDestinationsService } from './backup-destinations.service.js'

@ApiTags('Backup & Restore')
@ApiBearerAuth()
@UseGuards(AuthGuard(), AdminGuard)
@Controller('backup/destinations')
export class BackupDestinationsController {
  constructor(
    @Inject(BackupDestinationsService) private readonly destinations: BackupDestinationsService,
  ) {}

  @ApiOperation({
    summary: 'Return the off-site backup destinations (WebDAV, S3), the local retention and the last upload results.',
    description: 'The WebDAV password and S3 secret key read as `********`.',
  })
  @Get()
  getSettings() {
    return this.destinations.getSettings()
  }

  @ApiOperation({
    summary: 'Change the off-site backup destinations and retention.',
    description: 'Partial: only the fields given change. A secret sent back as `********` keeps the stored value. `keepLocal`: null keeps 7 days of scheduled backups, a number keeps that many.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        keepLocal: { type: 'integer', nullable: true, minimum: 1, maximum: 365 },
        webdav: { type: 'object', properties: { enabled: { type: 'boolean' }, url: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' }, keep: { type: 'integer' } } },
        s3: { type: 'object', properties: { enabled: { type: 'boolean' }, endpoint: { type: 'string' }, region: { type: 'string' }, bucket: { type: 'string' }, prefix: { type: 'string' }, accessKeyId: { type: 'string' }, secretAccessKey: { type: 'string' }, forcePathStyle: { type: 'boolean' }, keep: { type: 'integer' } } },
      },
    },
  })
  @Put()
  updateSettings(@Body() body: unknown) {
    return this.destinations.updateSettings(body)
  }

  @ApiOperation({ summary: 'Check a destination can be reached, with its stored settings or the unsaved ones given.' })
  @ApiBody({ schema: { type: 'object', required: ['destination'], properties: { destination: { type: 'string', enum: ['webdav', 's3'] }, settings: { type: 'object' } } } })
  @Post('test')
  test(@Body() body: { destination?: unknown, settings?: unknown } | undefined) {
    return this.destinations.test(body?.destination, body?.settings)
  }
}
