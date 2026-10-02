import DOMPurify from 'dompurify'

// Angular's URL check (`_sanitizeUrl`): a known scheme other than javascript:,
// or a relative URL. Anything else is kept but prefixed with `unsafe:`, which
// no browser navigates to.
const RE_SAFE_URL = /^(?!javascript:)(?:[a-z0-9+.-]+:|[^&:/?#]*(?:[/?#]|$))/i
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'cite', 'poster'])

const purify = DOMPurify(typeof window === 'undefined' ? undefined : window)

purify.addHook('uponSanitizeAttribute', (node, data) => {
  if (!URL_ATTRIBUTES.has(data.attrName)) {
    return
  }
  const value = data.attrValue.trim()
  if (value && !RE_SAFE_URL.test(value)) {
    // Kept the way Angular keeps it, so a neutralised link stays visible as
    // one. ⚠️ Written to the node here: `forceKeepAttr` skips the rest of
    // DOMPurify's checks AND its write-back, so changing `attrValue` alone
    // would keep the original javascript: URL
    node.setAttribute(data.attrName, `unsafe:${value}`)
    data.forceKeepAttr = true
  }
})

/**
 * The React stand-in for Angular's `[innerHTML]` binding, which sanitised what
 * it was given. `dangerouslySetInnerHTML` does not, so anything the Angular
 * templates bound with `[innerHTML]` goes through this first: scripts, event
 * handlers, iframes and the like are removed, and `javascript:` URLs are
 * prefixed with `unsafe:` exactly as Angular did. Ordinary formatting,
 * links and `target`/`rel` survive.
 * @param html - the markup to clean; nothing becomes an empty string
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) {
    return ''
  }
  return purify.sanitize(html, { ADD_ATTR: ['target'] })
}

/**
 * Props for `dangerouslySetInnerHTML`, sanitised.
 * @param html - the markup to render
 */
export function innerHtml(html: string | null | undefined): { __html: string } {
  return { __html: sanitizeHtml(html) }
}
