/**
 * Request shapes for the scene triggers and conditions (scenes v2), nested in
 * SceneDto. Each field is checked for its kind (ValidateIf on `type`);
 * ScenesService then checks what needs the scheduler (a cron expression) and
 * normalises them (parseTriggers / parseConditions in scene-automation.ts).
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Allow, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'

import { COMPARISON_OPERATORS } from './scene-automation.js'

const RE_UNIQUE_ID = /^[\w:.-]{1,128}$/
const RE_CHARACTERISTIC = /^\w{1,64}$/
const RE_TIME_OF_DAY = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|sunrise|sunset)$/
const VALUE_MESSAGE = 'value must be a boolean, a number or a short text'

export class SceneTriggerDto {
  @ApiProperty({ enum: ['cron', 'sun', 'characteristic'] })
  @IsIn(['cron', 'sun', 'characteristic'], { message: 'the trigger type must be cron, sun or characteristic' })
  type!: 'cron' | 'sun' | 'characteristic'

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ description: 'cron: the expression (node-schedule, 5 or 6 fields)', example: '0 19 * * *' })
  @ValidateIf(o => o.type === 'cron')
  @IsString({ message: 'cron must be a cron expression' })
  @MaxLength(100, { message: 'cron must be a cron expression' })
  cron?: string

  @ApiPropertyOptional({ enum: ['sunrise', 'sunset'], description: 'sun: which event' })
  @ValidateIf(o => o.type === 'sun')
  @IsIn(['sunrise', 'sunset'], { message: 'the event must be sunrise or sunset' })
  event?: 'sunrise' | 'sunset'

  @ApiPropertyOptional({ description: 'sun: minutes after (or, negative, before) the event', minimum: -720, maximum: 720, default: 0 })
  @ValidateIf(o => o.type === 'sun' && o.offsetMinutes !== undefined)
  @IsInt({ message: 'the offset must be a whole number of minutes from -720 to 720' })
  @Min(-720, { message: 'the offset must be a whole number of minutes from -720 to 720' })
  @Max(720, { message: 'the offset must be a whole number of minutes from -720 to 720' })
  offsetMinutes?: number

  @ApiPropertyOptional({ description: 'characteristic: the accessory uniqueId' })
  @ValidateIf(o => o.type === 'characteristic')
  @IsString({ message: 'uniqueId must be an accessory unique id' })
  @Matches(RE_UNIQUE_ID, { message: 'uniqueId must be an accessory unique id' })
  uniqueId?: string

  @ApiPropertyOptional({ description: 'characteristic: the characteristic type', example: 'MotionDetected' })
  @ValidateIf(o => o.type === 'characteristic')
  @IsString({ message: 'characteristicType must be a characteristic name' })
  @Matches(RE_CHARACTERISTIC, { message: 'characteristicType must be a characteristic name' })
  characteristicType?: string

  @ApiPropertyOptional({ enum: ['changes', ...COMPARISON_OPERATORS], default: 'changes' })
  @ValidateIf(o => o.type === 'characteristic' && o.operator !== undefined)
  @IsIn(['changes', ...COMPARISON_OPERATORS], { message: 'invalid operator' })
  operator?: string

  @ApiPropertyOptional({ description: 'characteristic: the value to compare with (not for `changes`)' })
  @ValidateIf(o => o.type === 'characteristic' && o.operator !== undefined && o.operator !== 'changes')
  @IsDefined({ message: VALUE_MESSAGE })
  @Allow()
  value?: number | boolean | string
}

export class SceneConditionDto {
  @ApiProperty({ enum: ['time', 'characteristic'] })
  @IsIn(['time', 'characteristic'], { message: 'the condition type must be time or characteristic' })
  type!: 'time' | 'characteristic'

  @ApiPropertyOptional({ description: 'time: from (inclusive), HH:mm, sunrise or sunset', example: 'sunset' })
  @ValidateIf(o => o.type === 'time')
  @IsString({ message: 'a time must be HH:mm, sunrise or sunset' })
  @Matches(RE_TIME_OF_DAY, { message: 'a time must be HH:mm, sunrise or sunset' })
  after?: string

  @ApiPropertyOptional({ description: 'time: until (exclusive); before `after` spans midnight', example: '23:00' })
  @ValidateIf(o => o.type === 'time')
  @IsString({ message: 'a time must be HH:mm, sunrise or sunset' })
  @Matches(RE_TIME_OF_DAY, { message: 'a time must be HH:mm, sunrise or sunset' })
  before?: string

  @ApiPropertyOptional()
  @ValidateIf(o => o.type === 'characteristic')
  @IsString({ message: 'uniqueId must be an accessory unique id' })
  @Matches(RE_UNIQUE_ID, { message: 'uniqueId must be an accessory unique id' })
  uniqueId?: string

  @ApiPropertyOptional()
  @ValidateIf(o => o.type === 'characteristic')
  @IsString({ message: 'characteristicType must be a characteristic name' })
  @Matches(RE_CHARACTERISTIC, { message: 'characteristicType must be a characteristic name' })
  characteristicType?: string

  @ApiPropertyOptional({ enum: COMPARISON_OPERATORS })
  @ValidateIf(o => o.type === 'characteristic')
  @IsIn(COMPARISON_OPERATORS, { message: 'invalid operator' })
  operator?: string

  @ApiPropertyOptional()
  @ValidateIf(o => o.type === 'characteristic')
  @IsDefined({ message: VALUE_MESSAGE })
  @Allow()
  value?: number | boolean | string
}
