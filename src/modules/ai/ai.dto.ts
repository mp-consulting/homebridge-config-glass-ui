import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
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
  @ApiProperty({ description: 'Accessories: uniqueId, serviceName, type, manufacturer, room…' })
  @IsArray()
  @ArrayMaxSize(2000)
  accessories: Record<string, unknown>[]

  @ApiPropertyOptional({ description: 'The current room layout.' })
  @IsOptional()
  rooms?: unknown
}
