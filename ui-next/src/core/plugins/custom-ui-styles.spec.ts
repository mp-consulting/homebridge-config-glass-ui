import { describe, expect, it, vi } from 'vitest'

import { absolutizeCssUrls, buildCustomUiStyleMessages, IFRAME_LAYOUT_STYLE, postCustomUiStyles, resolveStylesheetHref } from './custom-ui-styles'

function makeDocument(html: string, base: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let baseEl = doc.querySelector('base')
  if (!baseEl) {
    baseEl = doc.createElement('base')
    doc.head.prepend(baseEl)
  }
  // DOMParser documents are about:blank, so the served URL is given as an
  // absolute <base>, which is what the backend's `<base href="/">` resolves to.
  baseEl.setAttribute('href', base)
  return doc
}

// Shaped like `ui-next` `vite build` output (public/index.html) after the app
// has started: the entry CSS link, plus what gets added at runtime.
const VITE_PROD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Homebridge</title>
    <base href="/" />
    <link rel="apple-touch-icon" sizes="180x180" href="./assets/apple-touch-icon.png" />
    <link rel="shortcut icon" type="image/x-icon" href="favicon.ico" />
    <link rel="manifest" href="./assets/manifest.webmanifest" crossorigin="use-credentials" />
    <script type="module" crossorigin="use-credentials" src="./assets/index-DHrdNAgL.js"></script>
    <link rel="stylesheet" crossorigin="use-credentials" href="./assets/index-CVJjnSsG.css">
    <link rel="modulepreload" crossorigin href="http://hb.local:8581/assets/PluginsPage-Cx1.js">
    <link rel="stylesheet" crossorigin href="http://hb.local:8581/assets/PluginsPage-Bb2.css">
    <link rel="stylesheet" type="text/css" href="http://hb.local:8581/assets/monaco/min/vs/editor/editor.main.css">
    <style class="monaco-colors">.mtk1 { color: #000000; }</style>
  </head>
  <body class="glass-ui-deep-purple dark-mode glass-mode">
    <div id="root"></div>
  </body>
</html>`

// Shaped like the Vite dev server (port 4200): no stylesheet links, every
// stylesheet is a <style data-vite-dev-id> with dev-server-relative URLs.
const VITE_DEV_HTML = `<!doctype html>
<html lang="en">
  <head>
    <script type="module" src="/@vite/client"></script>
    <base href="/" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <style type="text/css" data-vite-dev-id="/repo/ui-next/src/scss/styles.scss">
@font-face { font-family: "Font Awesome 7 Free"; src: url("/node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2") format("woff2"); }
.hap-icon { background-image: url("../assets/hap.svg"); }
.form-select { background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3c/svg%3e"); }
.mask { mask: url(#hb-mask); }
    </style>
  </head>
  <body class="glass-ui-blue">
    <div id="root"></div>
  </body>
</html>`

describe('buildCustomUiStyleMessages (Vite prod document)', () => {
  const doc = makeDocument(VITE_PROD_HTML, 'http://hb.local:8581/')

  it('sends the Angular sequence: body classes, links, inline styles, layout override', () => {
    expect(buildCustomUiStyleMessages(doc)).toEqual([
      { action: 'body-class', class: 'glass-ui-deep-purple' },
      { action: 'body-class', class: 'modal-content' },
      { action: 'body-class', class: 'dark-mode' },
      { action: 'body-class', class: 'glass-mode' },
      { action: 'link-element', href: 'http://hb.local:8581/assets/index-CVJjnSsG.css', rel: 'stylesheet' },
      // Absolute hrefs inserted at runtime pass through (Angular broke these).
      { action: 'link-element', href: 'http://hb.local:8581/assets/PluginsPage-Bb2.css', rel: 'stylesheet' },
      { action: 'link-element', href: 'http://hb.local:8581/assets/monaco/min/vs/editor/editor.main.css', rel: 'stylesheet' },
      { action: 'inline-style', style: '.mtk1 { color: #000000; }' },
      { action: 'inline-style', style: IFRAME_LAYOUT_STYLE },
    ])
  })

  it('ignores icon/manifest/modulepreload links', () => {
    const hrefs = buildCustomUiStyleMessages(doc).filter(m => m.action === 'link-element').map(m => 'href' in m && m.href)
    expect(hrefs.some(h => String(h).includes('manifest') || String(h).endsWith('.js') || String(h).endsWith('.ico'))).toBe(false)
  })

  it('resolves the entry stylesheet under a reverse-proxy subpath', () => {
    const subpathDoc = makeDocument(VITE_PROD_HTML, 'https://proxy.example/homebridge/')
    const first = buildCustomUiStyleMessages(subpathDoc).find(m => m.action === 'link-element')
    expect(first).toEqual({ action: 'link-element', href: 'https://proxy.example/homebridge/assets/index-CVJjnSsG.css', rel: 'stylesheet' })
  })
})

describe('buildCustomUiStyleMessages (Vite dev document)', () => {
  const doc = makeDocument(VITE_DEV_HTML, 'http://localhost:4200/')

  it('forwards the dev <style> tags with URLs pinned to the dev server', () => {
    const messages = buildCustomUiStyleMessages(doc)
    expect(messages.slice(0, 2)).toEqual([
      { action: 'body-class', class: 'glass-ui-blue' },
      { action: 'body-class', class: 'modal-content' },
    ])
    expect(messages.filter(m => m.action === 'link-element')).toEqual([])
    expect(messages).toHaveLength(4)

    const css = (messages[2] as { style: string }).style
    expect(css).toContain('url("http://localhost:4200/node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2")')
    expect(css).toContain('url("http://localhost:4200/assets/hap.svg")')
    // data: and fragment references are left alone.
    expect(css).toContain('url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\'%3e%3c/svg%3e")')
    expect(css).toContain('url(#hb-mask)')
    expect(messages[3]).toEqual({ action: 'inline-style', style: IFRAME_LAYOUT_STYLE })
  })

  it('can copy inline CSS verbatim like Angular', () => {
    const css = (buildCustomUiStyleMessages(doc, { absolutizeInlineUrls: false })[2] as { style: string }).style
    expect(css).toBe(doc.querySelector('style')!.innerHTML)
  })
})

describe('body classes', () => {
  it('sends class undefined when no theme class is set, and omits dark/glass when absent (Angular parity)', () => {
    const doc = makeDocument('<html><head></head><body></body></html>', 'http://hb.local:8581/')
    expect(buildCustomUiStyleMessages(doc)).toEqual([
      { action: 'body-class', class: undefined },
      { action: 'body-class', class: 'modal-content' },
      { action: 'inline-style', style: IFRAME_LAYOUT_STYLE },
    ])
  })

  it('picks the light theme class (glass-ui-<theme>) and the dark one (glass-ui-dark-mode-<theme>)', () => {
    const light = makeDocument('<html><body class="glass-ui-teal"></body></html>', 'http://h/')
    const dark = makeDocument('<html><body class="dark-mode glass-ui-dark-mode-teal"></body></html>', 'http://h/')
    expect(buildCustomUiStyleMessages(light)[0]).toEqual({ action: 'body-class', class: 'glass-ui-teal' })
    expect(buildCustomUiStyleMessages(dark)[0]).toEqual({ action: 'body-class', class: 'glass-ui-dark-mode-teal' })
  })
})

describe('resolveStylesheetHref', () => {
  it.each([
    ['./assets/index.css', 'http://h:8581/', 'http://h:8581/assets/index.css'],
    ['styles-ABC.css', 'http://h:8581/', 'http://h:8581/styles-ABC.css'],
    // Root-relative resolves against the base (Angular behaviour), not the origin.
    ['/assets/x.css', 'https://p.example/hb/', 'https://p.example/hb/assets/x.css'],
    ['http://h:8581/assets/lazy.css', 'http://h:8581/', 'http://h:8581/assets/lazy.css'],
    ['//cdn.example/x.css', 'https://p.example/hb/', 'https://cdn.example/x.css'],
  ])('%s against %s', (href, base, expected) => {
    expect(resolveStylesheetHref(href, base)).toBe(expected)
  })
})

describe('absolutizeCssUrls', () => {
  it('handles quoted, unquoted and @import references', () => {
    const css = `@import "theme.css"; a { b: url(./x.woff2) } c { d: url('/y.png') } e { f: url( "z.svg" ) } g { h: url(https://e.example/i.png) }`
    expect(absolutizeCssUrls(css, 'http://localhost:4200/')).toBe(
      `@import "http://localhost:4200/theme.css"; a { b: url("http://localhost:4200/x.woff2") } c { d: url("http://localhost:4200/y.png") } e { f: url("http://localhost:4200/z.svg") } g { h: url(https://e.example/i.png) }`,
    )
  })
})

describe('postCustomUiStyles', () => {
  it('posts every message then ready, to the given origin', () => {
    const doc = makeDocument('<html><body class="glass-ui-blue"></body></html>', 'http://hb.local:8581/')
    const target = { postMessage: vi.fn() }
    postCustomUiStyles(target, 'http://hb.local:8581', doc)
    expect(target.postMessage.mock.calls.map(c => c[0].action)).toEqual(['body-class', 'body-class', 'inline-style', 'ready'])
    expect(target.postMessage.mock.calls.every(c => c[1] === 'http://hb.local:8581')).toBe(true)
  })
})
