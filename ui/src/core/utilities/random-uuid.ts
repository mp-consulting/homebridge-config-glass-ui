/**
 * A random (version 4) UUID.
 *
 * `crypto.randomUUID()` exists only in a secure context (HTTPS or
 * localhost), and the ui is often opened over plain http on the LAN, so this
 * falls back to building one from `crypto.getRandomValues()`, which every
 * context has.
 */
export function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0F) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3F) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
