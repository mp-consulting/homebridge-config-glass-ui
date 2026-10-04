import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number

  @ApiPropertyOptional({ description: 'An action, or an action prefix: `plugin` matches `plugin.install`.', example: 'plugin' })
  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  action?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  username?: string
}
