import process from 'node:process'

import { RE_DEV_SERVER_ORIGIN } from './regex.constants.js'

/**
 * Shared CORS configuration for HTTP and WebSocket connections
 *
 * Only in development (UIX_DEVELOPMENT=1) are cross-origin requests from the
 * Angular dev server allowed - on any hostname (localhost, 127.0.0.1, local IP,
 * etc.) on port 4200 or 8080. In production the UI is served from the same
 * origin, so every cross-origin request is refused: otherwise any page on
 * those ports (including another service on the same host, which counts as
 * same-site for the SameSite=Strict refresh cookie) could read API responses
 * with credentials.
 */
export const devServerCorsConfig = {
  origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      // Same-origin and non-browser requests carry no Origin header
      callback(null, true)
    } else {
      callback(null, process.env.UIX_DEVELOPMENT === '1' && RE_DEV_SERVER_ORIGIN.test(origin))
    }
  },
  credentials: true,
}
