import type { ChannelName, NotificationEvent } from './notification-channels.js'

import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator'

import { CHANNEL_NAMES, RE_TIME_OF_DAY, SECRET_PLACEHOLDER } from './notification-channels.js'

const MAX_FIELD = 2048
const SECRET = `Write-only: stored values read as \`${SECRET_PLACEHOLDER}\`; send that back to keep it, or an empty string to clear it.`

class ChannelBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class WebhookChannelDto extends ChannelBaseDto {
  @ApiPropertyOptional({ description: `An http(s) URL that gets a JSON POST. ${SECRET}` })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  url?: string
}

export class NtfyChannelDto extends ChannelBaseDto {
  @ApiPropertyOptional({ example: 'https://ntfy.sh' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  server?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  topic?: string

  @ApiPropertyOptional({ description: SECRET })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  token?: string
}

export class PushoverChannelDto extends ChannelBaseDto {
  @ApiPropertyOptional({ description: SECRET })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  userKey?: string

  @ApiPropertyOptional({ description: SECRET })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  appToken?: string
}

export class TelegramChannelDto extends ChannelBaseDto {
  @ApiPropertyOptional({ description: SECRET })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  botToken?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD)
  chatId?: string
}

export class NotificationChannelsDto {
  @ApiPropertyOptional({ type: WebhookChannelDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookChannelDto)
  webhook?: WebhookChannelDto

  @ApiPropertyOptional({ type: NtfyChannelDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NtfyChannelDto)
  ntfy?: NtfyChannelDto

  @ApiPropertyOptional({ type: PushoverChannelDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PushoverChannelDto)
  pushover?: PushoverChannelDto

  @ApiPropertyOptional({ type: TelegramChannelDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TelegramChannelDto)
  telegram?: TelegramChannelDto
}

export class NotificationEventsDto implements Partial<Record<NotificationEvent, boolean>> {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  homebridgeDown?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  homebridgeUp?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  childBridgeCrashLoop?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  updatesAvailable?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  backupFailed?: boolean

  @ApiPropertyOptional({ description: 'Uses the Assistant: off by default.' })
  @IsOptional()
  @IsBoolean()
  dailyDigest?: boolean
}

/** PUT /notifications/settings: every part is optional; what is left out keeps its stored value. */
export class NotificationSettingsDto {
  @ApiPropertyOptional({ type: NotificationChannelsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NotificationChannelsDto)
  channels?: NotificationChannelsDto

  @ApiPropertyOptional({ type: NotificationEventsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NotificationEventsDto)
  events?: NotificationEventsDto

  @ApiPropertyOptional({ example: '08:00', description: 'When the daily digest is sent, HH:mm in the server\'s local time.' })
  @IsOptional()
  @IsString()
  @Matches(RE_TIME_OF_DAY, { message: 'dailyDigestTime must be a time of day as HH:mm.' })
  dailyDigestTime?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  explainCrashLoops?: boolean
}

export class NotificationTestDto {
  @ApiPropertyOptional({ enum: CHANNEL_NAMES, description: 'Leave out to send to every enabled channel.' })
  @IsOptional()
  @IsIn(CHANNEL_NAMES)
  channel?: ChannelName
}
