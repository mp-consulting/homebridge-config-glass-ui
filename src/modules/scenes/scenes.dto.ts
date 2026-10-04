import type { ValidationArguments } from 'class-validator'

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator'

export const MAX_SCENE_ACTIONS = 50
export const MAX_SCENE_SCHEDULES = 10
export const RE_SCENE_UNIQUE_ID = /^[\w:.-]{1,128}$/
export const RE_SCENE_CHARACTERISTIC = /^\w{1,64}$/

/** A characteristic value: a boolean, a finite number or a text of at most 256 characters. */
export function isSceneValue(value: unknown): value is number | boolean | string {
  return typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= 256)
}

function IsSceneValue() {
  return ValidateBy({
    name: 'isSceneValue',
    validator: {
      validate: (value: unknown) => isSceneValue(value),
      defaultMessage: (args?: ValidationArguments) => `${args?.property ?? 'value'} must be a boolean, a number or a short text`,
    },
  })
}

export class SceneActionDto {
  @ApiProperty({ description: 'The accessory service\'s unique id.' })
  @IsDefined({ message: 'uniqueId must be an accessory unique id' })
  @IsString({ message: 'uniqueId must be an accessory unique id' })
  @Matches(RE_SCENE_UNIQUE_ID, { message: 'uniqueId must be an accessory unique id' })
  uniqueId!: string

  @ApiProperty({ example: 'On' })
  @IsDefined({ message: 'characteristicType must be a characteristic name' })
  @IsString({ message: 'characteristicType must be a characteristic name' })
  @Matches(RE_SCENE_CHARACTERISTIC, { message: 'characteristicType must be a characteristic name' })
  characteristicType!: string

  @ApiProperty({ oneOf: [{ type: 'boolean' }, { type: 'number' }, { type: 'string', maxLength: 256 }] })
  @IsDefined({ message: 'value must be a boolean, a number or a short text' })
  @IsSceneValue()
  value!: number | boolean | string
}

export class SceneScheduleDto {
  @ApiProperty({ example: '0 7 * * 1-5', description: 'Five or six cron fields (seconds optional).' })
  @IsDefined({ message: 'cron must be a cron expression' })
  @IsString({ message: 'cron must be a cron expression' })
  @MaxLength(100, { message: 'cron must be a cron expression' })
  cron!: string

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

/** A scene as created or replaced: the cron expressions are checked by the service (it needs the scheduler). */
export class SceneDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsDefined({ message: 'The name must be 1 to 64 characters.' })
  @IsString({ message: 'The name must be 1 to 64 characters.' })
  @MaxLength(64, { message: 'The name must be 1 to 64 characters.' })
  name!: string

  @ApiProperty({ type: [SceneActionDto], minItems: 1, maxItems: MAX_SCENE_ACTIONS })
  @IsDefined({ message: `A scene needs 1 to ${MAX_SCENE_ACTIONS} actions.` })
  @IsArray({ message: `A scene needs 1 to ${MAX_SCENE_ACTIONS} actions.` })
  @ArrayMinSize(1, { message: `A scene needs 1 to ${MAX_SCENE_ACTIONS} actions.` })
  @ArrayMaxSize(MAX_SCENE_ACTIONS, { message: `A scene needs 1 to ${MAX_SCENE_ACTIONS} actions.` })
  @IsObject({ each: true, message: 'each action must be an object' })
  @ValidateNested({ each: true })
  @Type(() => SceneActionDto)
  actions!: SceneActionDto[]

  @ApiPropertyOptional({ type: [SceneScheduleDto], maxItems: MAX_SCENE_SCHEDULES })
  @IsOptional()
  @IsArray({ message: `At most ${MAX_SCENE_SCHEDULES} schedules.` })
  @ArrayMaxSize(MAX_SCENE_SCHEDULES, { message: `At most ${MAX_SCENE_SCHEDULES} schedules.` })
  @IsObject({ each: true, message: 'each schedule must be an object' })
  @ValidateNested({ each: true })
  @Type(() => SceneScheduleDto)
  schedules?: SceneScheduleDto[]
}
