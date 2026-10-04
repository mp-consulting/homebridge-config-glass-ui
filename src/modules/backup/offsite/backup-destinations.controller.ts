import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Audited } from '../../../core/audit/audit.interceptor.js'
import { AdminGuard } from '../../../core/auth/guards/admin.guard.js'
import { BackupDestinationsDto, BackupDestinationTestDto } from './backup-destinations.dto.js'
import { BackupDestinationsService } from './backup-destinations.service.js'

/** What changed, without the endpoints' credentials: the switches, retention and where the copies go. */
function auditDestinations(body: unknown): Record<string, unknown> {
  const input = (body ?? {}) as { keepLocal?: unknown, webdav?: Record<string, unknown>, s3?: Record<string, unknown> }
  const where = (part: Record<string, unknown> | undefined, keys: string[]) => (part ? Object.fromEntries(keys.filter(key => part[key] !== undefined).map(key => [key, part[key]])) : undefined)
  return {
    keepLocal: input.keepLocal,
    webdav: where(input.webdav, ['enabled', 'url', 'keep']),
    s3: where(input.s3, ['enabled', 'endpoint', 'bucket', 'prefix', 'keep']),
  }
}

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
  @Audited('backup.destinations.update', { details: ({ body }) => auditDestinations(body) })
  @Put()
  updateSettings(@Body() body: BackupDestinationsDto) {
    return this.destinations.updateSettings(body)
  }

  @ApiOperation({ summary: 'Check a destination can be reached, with its stored settings or the unsaved ones given.' })
  @Audited('backup.destinations.test', { target: ({ body }) => (body as { destination?: string } | undefined)?.destination })
  @Post('test')
  test(@Body() body: BackupDestinationTestDto) {
    return this.destinations.test(body.destination, body.settings)
  }
}
