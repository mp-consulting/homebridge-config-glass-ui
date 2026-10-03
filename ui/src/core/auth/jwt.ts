import { jwtDecode } from 'jwt-decode'

/**
 * The two JwtHelperService (@auth0/angular-jwt) calls the auth code used,
 * with the same semantics.
 */

/**
 * Decode a token's payload. Throws on a token that cannot be read, like
 * `JwtHelperService.decodeToken`.
 * @param token - the JWT
 */
export function decodeToken<T = Record<string, any>>(token: string): T {
  return jwtDecode<T>(token)
}

/**
 * Whether a token has expired. A token with no `exp` never expires; an empty
 * one always has.
 * @param token - the JWT
 * @param offsetSeconds - treat the token as expiring this much earlier (the
 * server clock offset)
 */
export function isTokenExpired(token: string | null | undefined, offsetSeconds = 0): boolean {
  if (!token) {
    return true
  }
  const decoded = decodeToken<{ exp?: number }>(token)
  if (!decoded || typeof decoded.exp !== 'number') {
    return false
  }
  const expiresAt = decoded.exp * 1000
  return !(expiresAt > Date.now() + offsetSeconds * 1000)
}
