import { Body, Controller, Get, HttpCode, Inject, Post, Put, Query, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { AiChatDto, AiDiagnoseLogsDto, AiOrganizeDto, AiPluginConfigDto, AiSettingsDto, AiUpdateRiskDto } from './ai.dto.js'
import { AiService } from './ai.service.js'

const DISABLED = { status: 409, description: 'The Assistant is not enabled.' }
const RATE_LIMITED = { status: 429, description: 'Too many Assistant requests from this user.' }
const PROVIDER_FAILED = { status: 502, description: 'The AI provider failed.' }

@ApiTags('Assistant')
@ApiBearerAuth()
@UseGuards(AuthGuard())
@Controller('ai')
export class AiController {
  constructor(
    @Inject(AiService) private readonly aiService: AiService,
  ) {}

  @ApiOperation({
    summary: 'Whether the Assistant is enabled, with which provider and model, and the token usage since the UI started.',
    description: 'Any signed-in user. Administrators also get `settings` (never the API key itself: `hasApiKey`).',
  })
  @Get('status')
  getStatus(@Request() req: any) {
    return this.aiService.getStatus(req.user)
  }

  @ApiOperation({ summary: 'Update the `HomebridgeAiKit` block of config.json (created when missing). An empty `apiKey` keeps the stored one.' })
  @UseGuards(AdminGuard)
  @Put('settings')
  updateSettings(@Body() body: AiSettingsDto, @Request() req: any) {
    return this.aiService.updateSettings(body, req.user)
  }

  @ApiOperation({ summary: 'Send a one-word prompt with the saved settings.' })
  @ApiResponse(DISABLED)
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('test')
  test(@Request() req: any) {
    return this.aiService.testConnection(req.user)
  }

  @ApiOperation({ summary: 'Log Doctor: explain the recent Homebridge log.' })
  @ApiResponse(DISABLED)
  @ApiResponse(RATE_LIMITED)
  @ApiResponse(PROVIDER_FAILED)
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('diagnose-logs')
  diagnoseLogs(@Body() body: AiDiagnoseLogsDto, @Request() req: any) {
    return this.aiService.diagnoseLogs(req.user, body?.focus)
  }

  @ApiOperation({ summary: 'Config Copilot: a plugin config block from a plain-language request, valid against the plugin\'s schema.' })
  @ApiResponse(DISABLED)
  @ApiResponse(RATE_LIMITED)
  @ApiResponse(PROVIDER_FAILED)
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('plugin-config')
  pluginConfig(@Body() body: AiPluginConfigDto, @Request() req: any) {
    return this.aiService.pluginConfig(req.user, body)
  }

  @ApiOperation({
    summary: 'One Assistant chat turn.',
    description: 'Any signed-in user. Tools run with a short-lived token of the user, so their permissions apply; non-admins get the read-only tools. Over HTTP destructive tools are refused: use the `ai` socket namespace to confirm them.',
  })
  @ApiResponse(DISABLED)
  @ApiResponse(RATE_LIMITED)
  @ApiResponse(PROVIDER_FAILED)
  @HttpCode(200)
  @Post('chat')
  chat(@Body() body: AiChatDto, @Request() req: any) {
    return this.aiService.chat(req.user, body.messages)
  }

  @ApiOperation({ summary: 'Update risk briefing for a plugin update, from its release notes and changelog.' })
  @ApiResponse(DISABLED)
  @ApiResponse(RATE_LIMITED)
  @ApiResponse(PROVIDER_FAILED)
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('update-risk')
  updateRisk(@Body() body: AiUpdateRiskDto, @Request() req: any) {
    return this.aiService.updateRisk(req.user, body)
  }

  @ApiOperation({
    summary: 'Smart organiser: suggested rooms and names for the accessories.',
    description: 'The accessories (from Homebridge, which must run in insecure mode) and your saved rooms are read on the server. The body is optional: `onlyRooms` narrows it to the accessories in those rooms.',
  })
  @ApiResponse(DISABLED)
  @ApiResponse(RATE_LIMITED)
  @ApiResponse(PROVIDER_FAILED)
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('organize')
  organize(@Body() body: AiOrganizeDto, @Request() req: any) {
    return this.aiService.organize(req.user, body)
  }

  @ApiOperation({ summary: 'Daily digest of the setup: status, updates, warnings. Cached for a few hours.' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  @ApiResponse(DISABLED)
  @UseGuards(AdminGuard)
  @Get('digest')
  digest(@Query('refresh') refresh: string | undefined, @Request() req: any) {
    return this.aiService.digest(req.user, refresh === 'true' || refresh === '1')
  }
}
