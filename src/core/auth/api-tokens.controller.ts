import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import { ApiTokenService } from './api-token.service.js'
import { CreateApiTokenDto } from './auth.dto.js'
import { AdminGuard } from './guards/admin.guard.js'
import { UserSessionGuard } from './guards/user-session.guard.js'

const API_TOKEN_VIEW_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    scope: { type: 'string', enum: ['read', 'admin'] },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
    createdBy: { type: 'string' },
  },
}

@ApiTags('Authentication')
@ApiBearerAuth()
@ApiResponse({ status: 403, description: 'Not an administrator, or authenticated with an API token rather than a signed-in session.' })
// API tokens and service tokens cannot manage API tokens, even with the admin scope
@UseGuards(AuthGuard(), UserSessionGuard, AdminGuard)
@Controller('auth/tokens')
export class ApiTokensController {
  constructor(
    @Inject(ApiTokenService) private readonly apiTokens: ApiTokenService,
  ) {}

  @ApiOperation({ summary: 'List the API tokens (never their values).' })
  @ApiResponse({ status: 200, schema: { type: 'array', items: API_TOKEN_VIEW_SCHEMA } })
  @Get()
  listTokens() {
    return this.apiTokens.list()
  }

  @ApiOperation({
    summary: 'Create an API token.',
    description: 'The token (`hbg_…`) is returned once and only its hash is stored. Send it as `Authorization: Bearer hbg_…`, or as the socket.io handshake `auth.token`. A `read` token is a non-admin user limited to GET/HEAD requests.',
  })
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        scope: { type: 'string', enum: ['read', 'admin'] },
        token: { type: 'string', example: 'hbg_…' },
        createdAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @Post()
  createToken(@Body() body: CreateApiTokenDto, @Request() req: any) {
    return this.apiTokens.create(body, req.user?.username)
  }

  @ApiOperation({ summary: 'Revoke an API token.' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 204, description: 'Revoked.' })
  @ApiResponse({ status: 404, description: 'No such token.' })
  @HttpCode(204)
  @Delete(':id')
  async revokeToken(@Param('id') id: string) {
    await this.apiTokens.revoke(id)
  }
}
