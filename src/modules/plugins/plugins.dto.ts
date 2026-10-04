import { ApiProperty } from '@nestjs/swagger'
import {
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'

/**
 * An npm version, range or dist-tag ('latest', '1.2.3', '^2.0.0-beta.1',
 * '>=1.0.0'): alphanumerics, dots, dashes, dist-tag chars and range
 * operators. Mirrors the hb-service regex, but may not start with '-' so a
 * value like "--evil-flag" is never read by npm as an option. No ':' or '/'
 * either, so it can never name a URL, git repo or local path instead of a
 * registry version.
 */
export const RE_NPM_VERSION = /^[\w^~>=<*|+][\w.\-^~>=<*|+]*$/

export class HomebridgeUpdateActionDto {
  @IsOptional()
  @IsString()
  @Matches(RE_NPM_VERSION)
  version?: string

  @IsOptional()
  @IsNumber()
  termCols?: number

  @IsOptional()
  @IsNotEmpty()
  termRows?: number
}

export class PluginActionDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^(@[\w-]+(\.[\w-]+)*\/)?homebridge-[\w-]+$/)
  name: string

  // Semver-shaped (see RE_NPM_VERSION) so the in-UI install path can't
  // accept a version like "--evil-flag" or "1.0; rm -rf /" that the
  // validator-less version of this field would have passed through to the
  // npm argv.
  @IsOptional()
  @IsString()
  @Matches(RE_NPM_VERSION)
  version?: string

  @IsOptional()
  @IsNumber()
  termCols?: number

  @IsOptional()
  @IsNotEmpty()
  termRows?: number
}

/** The body of POST /plugins/install|update|uninstall */
export class PluginJobRequestDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^(@[\w-]+(\.[\w-]+)*\/)?homebridge-[\w-]+$/)
  @ApiProperty({ type: String, example: 'homebridge-example-plugin' })
  name: string

  @IsOptional()
  @IsString()
  @Matches(RE_NPM_VERSION)
  @ApiProperty({ type: String, required: false, description: 'Version or dist-tag to install. Defaults to `latest`; ignored for uninstall.', example: '1.2.3' })
  version?: string
}
