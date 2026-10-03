/**
 * Theme a plugin's custom-UI iframe from the parent page.
 *
 * When the iframe's wrapper page fires `loaded`, the Angular
 * `CustomPluginsComponent.injectDefaultStyles` posted, in this order:
 *
 * 1. `body-class` with the current `glass-ui-*` theme class (sent even when
 *    there is none, as `class: undefined`), then `modal-content`, then
 *    `dark-mode` and `glass-mode` when the parent body has them;
 * 2. one `link-element` per `<link rel="stylesheet">`, with an absolute href;
 * 3. one `inline-style` per `<style>` element, with its text;
 * 4. one last `inline-style` with the iframe layout override.
 *
 * It then posted `{ action: 'ready' }`. `@homebridge/plugin-ui-utils`' `ui.js`
 * adds the classes to its body, appends a `<style>`/`<link>` per message, waits
 * for every link to load (or fail, or 5 s) on `ready`, and only then shows the
 * body.
 *
 * This module builds the same messages, with the same action names and payload
 * shapes, from any `Document`. Two changes make it work for a Vite build:
 *
 * - Link hrefs that are already absolute (Vite's lazy-chunk CSS links, which
 *   its preload helper inserts with `new URL(dep, import.meta.url)`, and
 *   Monaco's `editor.main.css`) are passed through. Angular prefixed every
 *   href with `document.baseURI`, which turned those into
 *   `http://host/http://host/...`. Relative and root-relative hrefs resolve
 *   exactly as before.
 * - Relative `url(...)` and `@import` references in inline styles are made
 *   absolute against the parent's base URL. In a `<style>` element they
 *   resolve against the document that holds it, and once copied into the
 *   iframe that is the plugin page (`/api/plugins/settings-ui/<name>/`).
 *   The Vite dev server delivers all CSS as `<style data-vite-dev-id>` with
 *   root-relative font URLs (`/node_modules/@fortawesome/...`), which would
 *   otherwise 404 on the API origin. Angular's dev server used a `<link>` for
 *   the global styles, so it never hit this.
 */

export type CustomUiStyleMessage
  = | { action: 'body-class', class: string | undefined }
    | { action: 'link-element', href: string, rel: 'stylesheet' }
    | { action: 'inline-style', style: string }

/** The iframe-only layout override Angular appended last (same text). */
export const IFRAME_LAYOUT_STYLE = `
      body {
        height: unset !important;
      }
    `

export interface CustomUiStyleOptions {
  /**
   * Make relative `url()`/`@import` references in inline styles absolute
   * against the parent's base URL. Default `true`; `false` copies the text
   * verbatim, as Angular did.
   */
  absolutizeInlineUrls?: boolean
}

const RE_ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i

/**
 * Resolve a parent `<link>` href to the absolute URL the iframe must load.
 *
 * Root-relative hrefs (`/styles.css`) keep the Angular behaviour of resolving
 * against the base URL rather than the origin root, so a reverse-proxy subpath
 * still works.
 *
 * @param href - the raw `href` attribute
 * @param baseURI - the parent document's base URL
 */
export function resolveStylesheetHref(href: string, baseURI: string): string {
  if (RE_ABSOLUTE_URL.test(href) || href.startsWith('//')) {
    return new URL(href, baseURI).href
  }
  return new URL(href.startsWith('/') ? href.substring(1) : href, baseURI).href
}

function absolutizeRef(ref: string, baseURI: string): string {
  const trimmed = ref.trim()
  // Absolute (incl. data:/blob:), and fragment-only references to SVG
  // elements in the same document, mean the same thing in any document.
  if (!trimmed || trimmed.startsWith('#') || RE_ABSOLUTE_URL.test(trimmed)) {
    return ref
  }
  try {
    return new URL(trimmed, baseURI).href
  } catch {
    return ref
  }
}

const RE_CSS_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/g

/**
 * Rewrite the relative `url(...)` and `@import "..."` references in a CSS
 * string to absolute URLs.
 *
 * @param css - the stylesheet text
 * @param baseURI - the URL the references are relative to
 */
export function absolutizeCssUrls(css: string, baseURI: string): string {
  return css.replace(RE_CSS_REF, (match, dq?: string, sq?: string, bare?: string, importDq?: string, importSq?: string) => {
    if (importDq !== undefined || importSq !== undefined) {
      return `@import "${absolutizeRef((importDq ?? importSq)!, baseURI)}"`
    }
    const ref = (dq ?? sq ?? bare)!
    const resolved = absolutizeRef(ref, baseURI)
    if (resolved === ref) {
      return match
    }
    return `url("${resolved}")`
  })
}

/**
 * Build the style messages for a custom-UI iframe from the parent document.
 *
 * @param doc - the parent document (defaults to `document`)
 * @param options - see {@link CustomUiStyleOptions}
 */
export function buildCustomUiStyleMessages(doc: Document = document, options: CustomUiStyleOptions = {}): CustomUiStyleMessage[] {
  const { absolutizeInlineUrls = true } = options
  const bodyClasses = doc.body.classList
  const baseURI = doc.baseURI
  const messages: CustomUiStyleMessage[] = []

  messages.push({ action: 'body-class', class: [...bodyClasses].find(x => x.startsWith('glass-ui-')) })
  messages.push({ action: 'body-class', class: 'modal-content' })
  if (bodyClasses.contains('dark-mode')) {
    messages.push({ action: 'body-class', class: 'dark-mode' })
  }
  if (bodyClasses.contains('glass-mode')) {
    messages.push({ action: 'body-class', class: 'glass-mode' })
  }

  for (const link of doc.querySelectorAll('link')) {
    const href = link.getAttribute('href')
    if (link.getAttribute('rel') === 'stylesheet' && href) {
      messages.push({ action: 'link-element', href: resolveStylesheetHref(href, baseURI), rel: 'stylesheet' })
    }
  }

  for (const style of doc.querySelectorAll('style')) {
    const css = style.innerHTML
    messages.push({ action: 'inline-style', style: absolutizeInlineUrls ? absolutizeCssUrls(css, baseURI) : css })
  }

  messages.push({ action: 'inline-style', style: IFRAME_LAYOUT_STYLE })
  return messages
}

/**
 * Answer the iframe's `loaded` message the way the Angular component did:
 * post every style message, then `{ action: 'ready' }`, to the sending window
 * and origin.
 *
 * @param target - the iframe's window (`event.source`)
 * @param targetOrigin - the iframe's origin (`event.origin`)
 * @param doc - the parent document (defaults to `document`)
 * @param options - see {@link CustomUiStyleOptions}
 */
export function postCustomUiStyles(
  target: Pick<Window, 'postMessage'>,
  targetOrigin: string,
  doc: Document = document,
  options?: CustomUiStyleOptions,
): void {
  for (const message of buildCustomUiStyleMessages(doc, options)) {
    target.postMessage(message, targetOrigin)
  }
  target.postMessage({ action: 'ready' }, targetOrigin)
}
