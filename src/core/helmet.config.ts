import type { FastifyHelmetOptions } from '@fastify/helmet'

import type { StartupConfig } from './config/config.interfaces.js'

/**
 * Helmet options (security headers and the CSP) for the UI server
 */
export function helmetOptions(startupConfig: StartupConfig): FastifyHelmetOptions {
  return {
    hsts: false,
    frameguard: false,
    referrerPolicy: {
      policy: 'no-referrer',
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        // No 'unsafe-inline': the built index.html loads only external module
        // scripts and carries no inline <script> body, so nothing here needs
        // it. Dropping it is what stops an injected event handler (e.g.
        // `<img src=x onerror=...>`) from running at all. 'unsafe-eval' stays
        // because the Monaco editor genuinely needs it. Plugin custom UIs are
        // served with their own, looser policy in plugins-settings-ui.service.
        scriptSrc: ['\'self\'', '\'unsafe-eval\''],
        // The Vite dev server injects styles as inline <style> blocks, and
        // react-bootstrap / the grid set inline style attributes.
        styleSrc: ['\'self\'', '\'unsafe-inline\''],
        imgSrc: ['\'self\'', 'data:', 'https://raw.githubusercontent.com', 'https://user-images.githubusercontent.com'],
        connectSrc: ['\'self\'', 'https://openweathermap.org', 'https://api.openweathermap.org', (req) => {
          return `wss://${req.headers.host} ws://${req.headers.host} ${startupConfig.cspWsOverride || ''}`
        }],
        frameSrc: ['\'self\'', 'data:', 'https://developers.homebridge.io'],
        workerSrc: ['\'self\'', 'blob:'], // required for web-workers for monaco editor
        fontSrc: ['\'self\'', 'data:'], // required for web-workers for monaco editor
        // Inline event-handler attributes are never used by the app, and this
        // says so explicitly rather than relying on the script-src fallback.
        scriptSrcAttr: ['\'none\''],
        objectSrc: null,
        // Block clickjacking: only same-origin pages may frame the UI (this
        // still allows the app's own same-origin plugin-UI iframes). Admins who
        // embed the dashboard in a third-party page can widen this with the
        // `allowFrameAncestors` config option. Was previously unset (any origin
        // could frame the authenticated UI). X-Frame-Options stays off
        // (frameguard: false) because it cannot express an allowlist; modern
        // browsers honour this CSP directive instead.
        frameAncestors: ['\'self\'', ...(startupConfig.allowedFrameAncestors ?? [])],
        // Forms may only submit back to this origin (form-action does not
        // fall back to default-src)
        formAction: ['\'self\''],
        baseUri: null,
        upgradeInsecureRequests: null,
        blockAllMixedContent: null,
      },
    },
  }
}
