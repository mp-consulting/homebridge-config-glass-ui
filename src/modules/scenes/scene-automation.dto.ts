/**
 * Request shapes for the scene triggers and conditions (scenes v2), for a
 * scene DTO to nest. They only describe the fields so the global
 * ValidationPipe (`whitelist: true`) keeps them; ScenesService validates
 * each kind strictly (parseTriggers / parseConditions in scene-automation.ts).
 *
 * In a scene body DTO:
 *
 *     @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SceneTriggerDto)
 *     triggers?: SceneTriggerDto[]
 *     @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SceneConditionDto)
 *     conditions?: SceneConditionDto[]
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Allow, IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator'

export class SceneTriggerDto {
  @IsIn(['cron', 'sun', 'characteristic'])
  @ApiProperty({ enum: ['cron', 'sun', 'characteristic'] })
  type: 'cron' | 'sun' | 'characteristic'

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ default: true })
  enabled?: boolean

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'cron: the expression (node-schedule, 5 or 6 fields)', example: '0 19 * * *' })
  cron?: string

  @IsOptional()
  @IsIn(['sunrise', 'sunset'])
  @ApiPropertyOptional({ enum: ['sunrise', 'sunset'], description: 'sun: which event' })
  event?: 'sunrise' | 'sunset'

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ description: 'sun: minutes after (or, negative, before) the event, -720 to 720', example: -30 })
  offsetMinutes?: number

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'characteristic: the accessory uniqueId' })
  uniqueId?: string

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'characteristic: the characteristic type', example: 'MotionDetected' })
  characteristicType?: string

  @IsOptional()
  @IsIn(['changes', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'])
  @ApiPropertyOptional({ enum: ['changes', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'], default: 'changes' })
  operator?: string

  @Allow()
  @ApiPropertyOptional({ description: 'characteristic: the value to compare with (not for `changes`)' })
  value?: number | boolean | string
}

export class SceneConditionDto {
  @IsIn(['time', 'characteristic'])
  @ApiProperty({ enum: ['time', 'characteristic'] })
  type: 'time' | 'characteristic'

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'time: from (inclusive), HH:mm, sunrise or sunset', example: 'sunset' })
  after?: string

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'time: until (exclusive); before `after` spans midnight', example: '23:00' })
  before?: string

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  uniqueId?: string

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  characteristicType?: string

  @IsOptional()
  @IsIn(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'])
  @ApiPropertyOptional({ enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] })
  operator?: string

  @Allow()
  @ApiPropertyOptional()
  value?: number | boolean | string
}
