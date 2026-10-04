import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, HttpCode, Inject, Injectable, Post, Put, Query, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { AiMcpService } from './ai-mcp.service.js'
import { AiMcpHomebridgeTokenDto, AiMcpSettingsDto } from './ai.dto.js'

/** The browser's own address (scheme, host, port), for the client snippets. */
const RE_ORIGIN = /^https?:\/\/[^\s/?#@]+$/

function origin(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 300 && RE_ORIGIN.test(value) ? value : undefined
}

/**
 * Only a person's own session: these routes write and mint secrets, so an API
 * token (even an admin one, possibly the MCP server's own) or a service token
 * is refused.
 */
@Injectable()
export class McpSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user
    if (user?.apiTokenId !== undefined || user?.service !== undefined) {
      throw new ForbiddenException('API and service tokens cannot change the MCP server. Sign in to Glass UI to do it.')
    }
    return true
  }
}

const ORIGIN_QUERY = { name: 'origin', required: false, description: 'The address the browser reached Glass UI at (e.g. https://homebridge.local:8581), used in the client snippets.' }

@ApiTags('Assistant')
@ApiBearerAuth()
@ApiResponse({ status: 403, description: 'Not an administrator, or authenticated with an API or service token rather than a signed-in session.' })
@UseGuards(AuthGuard(), McpSessionGuard, AdminGuard)
@Controller('ai/mcp')
export class AiMcpController {
  constructor(
    @Inject(AiMcpService) private readonly mcpService: AiMcpService,
  ) {}

  @ApiOperation({
    summary: 'The HTTP MCP server\'s settings (run by the Homebridge AI Kit plugin) and client snippets.',
    description: 'Never returns the client token or the Homebridge API token: `hasToken` and `homebridgeToken.set` say whether they are stored.',
  })
  @ApiQuery(ORIGIN_QUERY)
  @Get()
  getStatus(@Query('origin') from?: string) {
    return this.mcpService.getStatus(origin(from))
  }

  @ApiOperation({ summary: 'Enable the HTTP MCP server, set its address and port, the Glass UI address it calls, or a client token of your own (write-only). Applies after Homebridge restarts.' })
  @ApiQuery(ORIGIN_QUERY)
  @Put()
  updateSettings(@Body() body: AiMcpSettingsDto, @Request() req: any, @Query('origin') from?: string) {
    return this.mcpService.updateSettings(body, req.user, origin(from))
  }

  @ApiOperation({ summary: 'Generate a new client token (replaces the stored one). The token, and snippets that contain it, are returned this once.' })
  @ApiQuery(ORIGIN_QUERY)
  @HttpCode(201)
  @Post('token')
  generateToken(@Request() req: any, @Query('origin') from?: string) {
    return this.mcpService.generateToken(req.user, origin(from))
  }

  @ApiOperation({ summary: 'Remove the client token. The server does not start without one.' })
  @ApiQuery(ORIGIN_QUERY)
  @Delete('token')
  clearToken(@Request() req: any, @Query('origin') from?: string) {
    return this.mcpService.clearToken(req.user, origin(from))
  }

  @ApiOperation({ summary: 'Create the Glass UI API token ("MCP server") the MCP server\'s tools act with, and store it in the settings. One created here before is revoked. The token is never returned.' })
  @ApiQuery(ORIGIN_QUERY)
  @HttpCode(201)
  @Post('homebridge-token')
  createHomebridgeToken(@Body() body: AiMcpHomebridgeTokenDto, @Request() req: any, @Query('origin') from?: string) {
    return this.mcpService.createHomebridgeToken(body.scope, req.user, origin(from))
  }

  @ApiOperation({ summary: 'Remove the MCP server\'s API token from the settings and revoke it.' })
  @ApiQuery(ORIGIN_QUERY)
  @Delete('homebridge-token')
  removeHomebridgeToken(@Request() req: any, @Query('origin') from?: string) {
    return this.mcpService.removeHomebridgeToken(req.user, origin(from))
  }
}
