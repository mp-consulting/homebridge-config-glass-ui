import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'

import { MAX_KEEP, SECRET_PLACEHOLDER } from './backup-destinations.service.js'

const SECRET = `Write-only: reads as \`${SECRET_PLACEHOLDER}\`; send that back to keep it.`

class DestinationBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_KEEP, default: 7, description: 'Copies of this instance\'s backups kept there.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_KEEP)
  keep?: number
}

export class WebDavDestinationDto extends DestinationBaseDto {
  @ApiPropertyOptional({ example: 'https://cloud.example.com/remote.php/dav/files/me/homebridge/' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  username?: string

  @ApiPropertyOptional({ description: SECRET })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  password?: string
}

export class S3DestinationDto extends DestinationBaseDto {
  @ApiPropertyOptional({ example: 'https://s3.eu-west-1.amazonaws.com' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string

  @ApiPropertyOptional({ example: 'eu-west-1' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(63)
  bucket?: string

  @ApiPropertyOptional({ example: 'homebridge/' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  prefix?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  accessKeyId?: string

  @ApiPropertyOptional({ description: SECRET })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  secretAccessKey?: string

  @ApiPropertyOptional({ default: true, description: 'Path-style URLs (MinIO and most compatible servers).' })
  @IsOptional()
  @IsBoolean()
  forcePathStyle?: boolean
}

/** PUT /backup/destinations: partial; what is left out keeps its stored value. */
export class BackupDestinationsDto {
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: MAX_KEEP, description: 'null keeps 7 days of scheduled backups; a number keeps that many.' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt({ message: `keepLocal must be null or a whole number from 1 to ${MAX_KEEP}.` })
  @Min(1, { message: `keepLocal must be null or a whole number from 1 to ${MAX_KEEP}.` })
  @Max(MAX_KEEP, { message: `keepLocal must be null or a whole number from 1 to ${MAX_KEEP}.` })
  keepLocal?: number | null

  @ApiPropertyOptional({ type: WebDavDestinationDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebDavDestinationDto)
  webdav?: WebDavDestinationDto

  @ApiPropertyOptional({ type: S3DestinationDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => S3DestinationDto)
  s3?: S3DestinationDto
}

/** POST /backup/destinations/test */
export class BackupDestinationTestDto {
  @ApiPropertyOptional({ enum: ['webdav', 's3'] })
  @IsDefined({ message: 'Unknown destination.' })
  @IsIn(['webdav', 's3'], { message: 'Unknown destination.' })
  destination!: 'webdav' | 's3'

  @ApiPropertyOptional({ description: 'Unsaved settings of that destination, merged over the stored ones.' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>
}
