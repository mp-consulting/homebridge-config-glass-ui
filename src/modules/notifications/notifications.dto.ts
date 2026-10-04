import type { ChannelName, NotificationEvent } from './notification-channels.js'

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { Allow, IsBoolean, IsDefined, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator'

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

/** Web Push to the devices subscribed under `/notifications/web-push`: only the switch. */
export class BrowserChannelDto extends ChannelBaseDto {}

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

  @ApiPropertyOptional({ type: BrowserChannelDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BrowserChannelDto)
  browser?: BrowserChannelDto
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

  @ApiPropertyOptional({ description: 'Homebridge crash loops soon after plugins on the main bridge were updated (offers a rollback).' })
  @IsOptional()
  @IsBoolean()
  rollbackSuggested?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  updatesAvailable?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  backupFailed?: boolean

  @ApiPropertyOptional({ description: 'A scheduled backup was saved (and uploaded): off by default.' })
  @IsOptional()
  @IsBoolean()
  backupSucceeded?: boolean

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

/** A browser's `PushSubscription.toJSON()` keys. */
export class PushSubscriptionKeysDto {
  @ApiProperty({ description: 'The browser\'s P-256 public key, base64url.' })
  @IsDefined({ message: 'Invalid push subscription keys.' })
  @IsString({ message: 'Invalid push subscription keys.' })
  @MaxLength(256, { message: 'Invalid push subscription keys.' })
  p256dh!: string

  @ApiProperty({ description: 'The 16-byte auth secret, base64url.' })
  @IsDefined({ message: 'Invalid push subscription keys.' })
  @IsString({ message: 'Invalid push subscription keys.' })
  @MaxLength(64, { message: 'Invalid push subscription keys.' })
  auth!: string
}

/** POST /notifications/web-push/subscriptions: `PushSubscription.toJSON()`, plus a name for the device. */
export class PushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/…' })
  @IsDefined({ message: 'The push endpoint must be an https URL.' })
  @IsString({ message: 'The push endpoint must be an https URL.' })
  @MaxLength(2048, { message: 'The push endpoint must be an https URL.' })
  endpoint!: string

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @IsDefined({ message: 'Invalid push subscription keys.' })
  @IsObject({ message: 'Invalid push subscription keys.' })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto

  @ApiPropertyOptional({ example: 'Safari on iPhone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string

  /** The browser sends it; it is not used. */
  @IsOptional()
  @Allow()
  expirationTime?: number | null
}

/** POST /notifications/web-push/unsubscribe */
export class PushEndpointDto {
  @ApiProperty()
  @IsDefined({ message: 'endpoint is required.' })
  @IsString({ message: 'endpoint is required.' })
  @MaxLength(2048)
  endpoint!: string
}

/** POST /notifications/web-push/test: this device's endpoint, or none for every device. */
export class PushTestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string
}
