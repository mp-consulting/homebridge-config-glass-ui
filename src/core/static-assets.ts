import type { FastifyReply } from 'fastify'

import { API_PREFIX } from './api.constants.js'
import { RE_HASHED_ASSET } from './regex.constants.js'

// With `preCompressed: true`, @fastify/static hands setHeaders() the path of the
// variant it actually sends (chunk-B3-qTyJy.js.br), so the encoding suffix is
// dropped before deciding whether the underlying asset is content-hashed.
const RE_PRECOMPRESSED_SUFFIX = /\.(?:br|gz)$/i

export function setStaticAssetCacheHeaders(reply: unknown, path: string): void {
  const res = reply as FastifyReply
  // sendFile() also passes through this callback. Preserve the private,
  // non-cacheable policy set by the authenticated plugin-settings route;
  // otherwise a hash-looking plugin filename would become public and
  // immutable for a year after its asset session was revoked.
  if (res.request.url.startsWith(`${API_PREFIX}/plugins/settings-ui/`)) {
    res.header('Cache-Control', 'no-store, private')
  } else if (RE_HASHED_ASSET.test(path.replace(RE_PRECOMPRESSED_SUFFIX, ''))) {
    res.header('Cache-Control', 'public,max-age=31536000,immutable')
  } else {
    res.header('Cache-Control', 'no-cache')
  }
}

// The @fastify/static options main.ts serves public/ with. `cacheControl: false`
// leaves Cache-Control entirely to setStaticAssetCacheHeaders(); `preCompressed`
// picks the .br/.gz sibling written by scripts/precompress.mjs when the client's
// Accept-Encoding allows it, and sets Content-Encoding and Vary: Accept-Encoding
// (Vary on the identity fallback too, so shared caches keep the variants apart).
export const staticAssetOptions = {
  cacheControl: false,
  preCompressed: true,
  setHeaders: setStaticAssetCacheHeaders,
} as const
