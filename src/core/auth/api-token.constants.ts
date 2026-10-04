/** Every API token starts with this, so a bearer value can be told apart from a JWT without parsing it. */
export const API_TOKEN_PREFIX = 'hbg_'

export const API_TOKEN_SCOPES = ['read', 'admin'] as const

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number]

/** The longest expiry a token can be created with (ten years); `null` means it never expires. */
export const API_TOKEN_MAX_EXPIRY_DAYS = 3650

export function isApiToken(token: unknown): token is string {
  return typeof token === 'string' && token.startsWith(API_TOKEN_PREFIX)
}

/** Whether a user stands on an API token limited to reading */
export function isReadOnlyApiTokenUser(user: unknown): boolean {
  return (user as { apiTokenScope?: unknown } | undefined)?.apiTokenScope === 'read'
}
