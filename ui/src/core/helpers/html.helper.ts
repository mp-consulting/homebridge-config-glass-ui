const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
}

const RE_HTML_SPECIAL = /[&<>"']/g

/**
 * Escape a value for interpolation into HTML, as text or inside a quoted
 * attribute.
 *
 * Several translation strings are rendered through `[innerHTML]` (e.g. the
 * confirm dialog), and their params often carry plugin-provided values such
 * as `displayName` from a plugin's package.json. Angular's sanitizer strips
 * scripts, but markup would still be injected into the dialog — so escape
 * anything a plugin author controls before handing it to `translate`.
 *
 * @param value - The value to escape; `null`/`undefined` become an empty string
 * @returns The value with `& < > " '` replaced by their HTML entities
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(RE_HTML_SPECIAL, char => HTML_ESCAPES[char])
}

/**
 * Accept a URL only when it parses as an absolute `https:` URL.
 *
 * @param value - The candidate URL, typically from a plugin's package.json
 * @returns The normalised URL, or `null` when it is not a valid https URL
 */
export function toHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
