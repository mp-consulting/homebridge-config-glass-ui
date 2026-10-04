import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

import { RE_NPM_VERSION } from '../plugins/plugins.dto.js'

export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible'] as const

/** A plugin package name, scoped or not. */
const RE_PLUGIN_PACKAGE = /^(@[\w-]+(\.[\w-]+)*\/)?homebridge-[\w.-]+$/

/** Daily and monthly limits, server local time. Null (or 0) removes one; a field left out keeps it. */
export class AiBudgetDto {
  @ApiPropertyOptional({ nullable: true, description: 'Input plus output tokens a day, all users together.', example: 200000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  dailyTokens?: number | null

  @ApiPropertyOptional({ nullable: true, description: 'Input plus output tokens a calendar month.', example: 5000000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000_000)
  monthlyTokens?: number | null

  @ApiPropertyOptional({ nullable: true, description: 'USD a day, counted for models with a known price only.', example: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  dailyUsd?: number | null

  @ApiPropertyOptional({ nullable: true, description: 'USD a calendar month, counted for models with a known price only.', example: 20 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  monthlyUsd?: number | null
}

export class AiSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ enum: AI_PROVIDERS })
  @IsOptional()
  @IsIn(AI_PROVIDERS)
  provider?: typeof AI_PROVIDERS[number]

  @ApiPropertyOptional({ description: 'Empty for the provider\'s default model.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string

  @ApiPropertyOptional({ description: 'Write-only. Empty or missing keeps the stored key.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  apiKey?: string

  @ApiPropertyOptional({ description: 'Remove the stored API key.' })
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean

  @ApiPropertyOptional({ description: 'For openai-compatible servers (Ollama, LM Studio). Empty removes it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^$|^https?:\/\/\S+$/, { message: 'baseUrl must be an http(s) URL' })
  baseUrl?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(64000)
  maxOutputTokens?: number

  @ApiPropertyOptional({ type: AiBudgetDto, description: 'Usage budgets: a request is refused (429) once one is used up. Stored by Glass UI, not in config.json.' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiBudgetDto)
  budget?: AiBudgetDto
}

export class AiDiagnoseLogsDto {
  @ApiPropertyOptional({ description: 'What to look at, e.g. a plugin name or a symptom.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  focus?: string
}

export class AiPluginConfigDto {
  @ApiProperty()
  @IsString()
  @Matches(RE_PLUGIN_PACKAGE)
  pluginName: string

  @ApiProperty({ description: 'What the user wants, in plain words.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  request: string

  @ApiPropertyOptional({ description: 'Which of the plugin\'s config blocks to edit (default 0).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  index?: number

  @ApiPropertyOptional({ description: 'The block as currently edited, instead of the saved one.' })
  @IsOptional()
  @IsObject()
  current?: Record<string, unknown>
}

export class AiChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant'

  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  content: string
}

export class AiChatDto {
  @ApiProperty({ type: [AiChatMessageDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AiChatMessageDto)
  messages: AiChatMessageDto[]
}

export class AiUpdateRiskDto {
  @ApiProperty()
  @IsString()
  @Matches(RE_PLUGIN_PACKAGE)
  pluginName: string

  @ApiPropertyOptional({ description: 'Default: the installed version.' })
  @IsOptional()
  @IsString()
  @Matches(RE_NPM_VERSION)
  currentVersion?: string

  @ApiPropertyOptional({ description: 'Default: the latest version.' })
  @IsOptional()
  @IsString()
  @Matches(RE_NPM_VERSION)
  targetVersion?: string
}

export class AiOrganizeDto {
  @ApiPropertyOptional({
    description: 'Only suggest for the accessories currently in these rooms. The accessories and rooms themselves are read on the server from Homebridge and your saved layout; lists sent by the client are ignored.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  onlyRooms?: string[]
}

/** A host name, IPv4 or IPv6 address (no scheme, port or path). */
const RE_HOST = /^(?:[\w-]+(?:\.[\w-]+)*|[\d.]+|[\da-f:.]+)$/i

export class AiMcpSettingsDto {
  @ApiPropertyOptional({ description: 'Serve MCP over HTTP (the Homebridge AI Kit plugin runs the server).' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ description: 'Bind address. 127.0.0.1 keeps it on this machine; 0.0.0.0 opens it to the network.' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  @Matches(RE_HOST, { message: 'host must be a host name or an IP address' })
  host?: string

  @ApiPropertyOptional({ minimum: 1, maximum: 65535 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number

  @ApiPropertyOptional({ description: 'The Glass UI address the MCP server calls. Empty for this UI\'s local address.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^$|^https?:\/\/[^\s/?#@]+(?:\/\S*)?$/, { message: 'homebridgeUrl must be an http(s) URL' })
  homebridgeUrl?: string

  @ApiPropertyOptional({ description: 'Write-only: a client token of your own (at least 16 characters). Use POST /ai/mcp/token to generate one instead.' })
  @IsOptional()
  @IsString()
  @Matches(/^[\x21-\x7E]{16,512}$/, { message: 'token must be 16 to 512 printable characters without spaces' })
  token?: string
}

export class AiMcpHomebridgeTokenDto {
  @ApiProperty({ enum: ['read', 'admin'], description: '`read` lets MCP clients look but not change anything.' })
  @IsIn(['read', 'admin'])
  scope!: 'read' | 'admin'
}
