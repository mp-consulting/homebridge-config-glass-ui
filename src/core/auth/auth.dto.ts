import type { ApiTokenScope } from './api-token.constants.js'

import { ApiProperty } from '@nestjs/swagger'
import { IsDefined, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

import { API_TOKEN_MAX_EXPIRY_DAYS, API_TOKEN_SCOPES } from './api-token.constants.js'

export class AuthDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String })
  readonly username: string

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: String })
  readonly password: string

  @IsString()
  @IsOptional()
  @ApiProperty({ required: false, type: String })
  readonly otp?: string
}

/** Client-supplied reason for POST /auth/refresh — used only for distinct log lines. */
export const REFRESH_TOKEN_REASONS = [
  'admin-guard',
  'session-extension',
  'profile-update',
] as const

export type RefreshTokenReason = (typeof REFRESH_TOKEN_REASONS)[number]

/**
 * How far a logout reaches. `everywhere` (the default) revokes every session
 * for the account; `local` signs out this browser only, and exists for logouts
 * the USER never asked for - the inactivity timer fires with a valid token, so
 * without this an idle tab left on one machine would end the user's active
 * sessions on every other device.
 */
export const LOGOUT_SCOPES = ['local', 'everywhere'] as const

export type LogoutScope = (typeof LOGOUT_SCOPES)[number]

export class LogoutDto {
  @IsOptional()
  @IsString()
  @IsIn(LOGOUT_SCOPES)
  @ApiProperty({ required: false, enum: LOGOUT_SCOPES })
  readonly scope?: LogoutScope
}

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @IsIn(REFRESH_TOKEN_REASONS)
  @ApiProperty({
    required: false,
    enum: REFRESH_TOKEN_REASONS,
    description: 'Why the client is refreshing; affects log wording only.',
  })
  readonly reason?: RefreshTokenReason
}

export class CreateApiTokenDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({ type: String, description: 'A label to recognise the token by.', example: 'Assistant MCP server' })
  readonly name: string

  @IsDefined()
  @IsIn(API_TOKEN_SCOPES)
  @ApiProperty({ enum: API_TOKEN_SCOPES, description: '`read`: a non-admin user limited to GET/HEAD requests. `admin`: an administrator.' })
  readonly scope: ApiTokenScope

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(API_TOKEN_MAX_EXPIRY_DAYS)
  @ApiProperty({ required: false, nullable: true, type: Number, description: 'Days until the token expires. Omit or pass null for a token that never expires.', example: 90 })
  readonly expiresInDays?: number | null
}
