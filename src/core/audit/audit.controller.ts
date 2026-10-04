import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../auth/guards/admin.guard.js'
import { AuditQueryDto } from './audit.dto.js'
import { AuditService } from './audit.service.js'

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(AuthGuard(), AdminGuard)
@Controller('audit')
export class AuditController {
  constructor(
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  @ApiOperation({
    summary: 'The audit log, newest first.',
    description: 'Security-relevant actions: Assistant tool calls, API token creation and revocation, writes made with an API token, config saves, plugin installs, updates and removals, restarts and backup restores. Administrators only.',
  })
  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.auditService.list(query)
  }
}
