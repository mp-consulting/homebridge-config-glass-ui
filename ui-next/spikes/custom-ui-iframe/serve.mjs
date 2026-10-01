/**
 * TEMPORARY (Phase 0, spike C) - not shipped, not part of any build.
 *
 * Hosts a Vite build of ui-next as the parent page and a plugin custom UI as
 * an iframe, with the same headers and wrapper HTML the backend uses, so the
 * style forwarding in src/core/plugins/custom-ui-styles.ts can be checked in a
 * real browser.
 *
 *   node spikes/custom-ui-iframe/serve.mjs <build dir>   (default ../public)
 *
 * Two servers:
 * - API_PORT (18581) plays the Nest backend: serves the build with the CSP from
 *   src/main.ts, `/spike/parent.html` (a page that uses the build's own
 *   <link rel=stylesheet> tags, like `vite build` output), and the plugin UI at
 *   `/api/plugins/settings-ui/demo/index.html` with the CSP and wrapper of
 *   plugins-settings-ui.service.ts (buildIndexHtml).
 * - DEV_PORT (14200) plays the Vite dev server: `/spike/parent.html` puts the
 *   same CSS into a <style data-vite-dev-id> with root-relative font URLs, the
 *   way `vite` serves it, and frames the plugin UI from API_PORT with the dev
 *   origin added to its CSP (UIX_DEVELOPMENT behaviour).
 *
 * The build itself is at `/` (and `/homebridge/` as a proxy subpath), e.g.
 * `/?spike=monaco` with a VITE_SPIKES=1 build.
 *
 * Add `?verbatim=1` to the parent page to copy inline CSS unchanged, as the
 * Angular component did.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import { extname, join, normalize, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const buildDir = resolve(process.argv[2] ?? join(here, '../../../public'))
const API_PORT = Number(process.env.API_PORT ?? 18581)
const DEV_PORT = Number(process.env.DEV_PORT ?? 14200)
const apiOrigin = `http://localhost:${API_PORT}`
const devOrigin = `http://localhost:${DEV_PORT}`

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

// src/main.ts (helmet) - the policy the parent page runs under in production.
const MAIN_CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data:`,
  `connect-src 'self'`,
  `frame-src 'self' data:`,
  `worker-src 'self' blob:`,
  `font-src 'self' data:`,
  `script-src-attr 'none'`,
  `frame-ancestors 'self'`,
].join('; ')

// plugins-settings-ui.service.ts serveCustomUiAsset - the iframe's policy.
function pluginCsp(dev) {
  const d = dev ? ` ${dev}` : ''
  return `default-src 'self'${d}; script-src 'self' 'unsafe-inline' 'unsafe-eval'${d}; style-src 'self' 'unsafe-inline'${d}; `
    + `img-src * data:; connect-src *; font-src 'self' data:${d}; frame-ancestors 'self'${d}; frame-src 'self'${d}`
}

// A typical plugin custom UI body: Bootstrap markup and Font Awesome icons,
// relying entirely on the styles the parent forwards.
const PLUGIN_BODY = `
  <div class="card card-body mb-3">
    <h4 class="primary-text"><i class="fas fa-plug"></i> Demo Plugin</h4>
    <p class="text-muted mb-2">Custom UI rendered inside the plugin iframe.</p>
    <div class="mb-2">
      <label class="form-label" for="name">Name</label>
      <input class="form-control" id="name" value="Living Room">
    </div>
    <div class="mb-2">
      <label class="form-label" for="mode">Mode</label>
      <select class="form-select" id="mode"><option>Auto</option><option>Manual</option></select>
    </div>
    <div class="form-check form-switch mb-3">
      <input class="form-check-input" type="checkbox" id="sw" checked>
      <label class="form-check-label" for="sw">Enabled</label>
    </div>
    <div class="d-flex gap-2">
      <button class="btn btn-primary"><i class="fas fa-check"></i> Primary</button>
      <button class="btn btn-secondary"><i class="far fa-circle"></i> Secondary</button>
      <button class="btn btn-danger"><i class="fab fa-github"></i> Danger</button>
    </div>
  </div>
  <script>
    homebridge.addEventListener('ready', () => { document.body.dataset.ready = '1' })
  </script>
`

// Same structure as buildIndexHtml().
function pluginIndexHtml(dev) {
  return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>homebridge-demo</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script>
          window._homebridge = {
            plugin: {"name":"homebridge-demo","installedVersion":"1.0.0"},
            serverEnv: {},
          };
          </script>
          <script src="${dev || ''}/assets/plugin-ui-utils/ui.js?v=spike"></script>
          <script>
            window.addEventListener('load', () => {
              window.parent.postMessage({action: 'loaded'}, '*');
            }, false)
          </script>
        </head>
        <body style="display:none;">
          ${PLUGIN_BODY}
        </body>
      </html>
    `
}

function buildCss() {
  const index = readFileSync(join(buildDir, 'index.html'), 'utf8')
  const links = [...index.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(m => m[0])
  const hrefs = links.map(l => l.match(/href="([^"]+)"/)[1])
  return { links, hrefs }
}

function parentHtml({ dev, verbatim, theme, dark }) {
  const { links, hrefs } = buildCss()
  let styles = links.join('\n    ')
  if (dev) {
    // What `vite` serves instead: the CSS inline, fonts root-relative to the
    // dev server (Vite writes `/node_modules/@fortawesome/...`).
    const css = hrefs
      .map(h => readFileSync(join(buildDir, h), 'utf8'))
      .join('\n')
      .replace(/url\(\.\/(fa-[a-z]+-\d+)-[\w-]+\.woff2\)/g, 'url("/node_modules/@fortawesome/fontawesome-free/webfonts/$1.woff2")')
    styles = `<style type="text/css" data-vite-dev-id="/ui-next/src/scss/styles.scss">${css}</style>`
  }
  const bodyClass = [dark ? `glass-ui-dark-mode-${theme}` : `glass-ui-${theme}`, dark && 'dark-mode', 'glass-mode'].filter(Boolean).join(' ')
  const iframeSrc = `${dev ? apiOrigin : ''}/api/plugins/settings-ui/demo/index.html${dev ? `?devOrigin=${encodeURIComponent(devOrigin)}` : ''}`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Spike C</title>
    <base href="/" />
    ${styles}
    <script type="module" src="/spike/parent.js"></script>
  </head>
  <body class="${bodyClass}" data-verbatim="${verbatim ? '1' : ''}">
    <div class="container py-3">
      <div class="modal-content p-3">
        <h5>Parent page (${dev ? 'Vite dev: inline &lt;style&gt;' : 'Vite prod: &lt;link&gt;'}${verbatim ? ', verbatim like Angular' : ''})</h5>
        <button class="btn btn-primary mb-2"><i class="fas fa-check"></i> Parent button</button>
        <iframe id="plugin" title="plugin" data-src="${iframeSrc}" style="width:100%;height:200px;border:0"></iframe>
      </div>
    </div>
  </body>
</html>`
}

const PARENT_JS = `
import { postCustomUiStyles } from '/spike/custom-ui-styles.js'
const iframe = document.getElementById('plugin')
const verbatim = document.body.dataset.verbatim === '1'
window.addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow) return
  if (e.data?.action === 'loaded') postCustomUiStyles(e.source, e.origin, document, { absolutizeInlineUrls: !verbatim })
  if (e.data?.action === 'scrollHeight') iframe.style.height = (e.data.scrollHeight + 10) + 'px'
})
// Like the app, only point the iframe at the plugin once the listener exists.
iframe.src = iframe.dataset.src
`

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

function handler(isDev) {
  return (req, res) => {
    const url = new URL(req.url, 'http://x')
    // `/homebridge/...` simulates a reverse-proxy subpath: same files, with
    // the <base href> a proxy would rewrite.
    const subpath = url.pathname.startsWith('/homebridge/') ? '/homebridge/' : ''
    const path = subpath ? url.pathname.slice(subpath.length - 1) : url.pathname
    if (path === '/spike/parent.html') {
      return send(res, 200, 'text/html', parentHtml({
        dev: isDev,
        verbatim: url.searchParams.get('verbatim') === '1',
        theme: url.searchParams.get('theme') ?? 'deep-purple',
        dark: url.searchParams.get('dark') === '1',
      }), isDev ? {} : { 'Content-Security-Policy': MAIN_CSP })
    }
    // Vite's dev server answers `/node_modules/...` and, by default, sends CORS
    // headers to localhost origins only (server.cors). Fonts are always
    // fetched in CORS mode, so this matters for a cross-origin iframe.
    const fa = isDev && path.match(/^\/node_modules\/@fortawesome\/fontawesome-free\/webfonts\/(fa-[a-z]+-\d+)\.woff2$/)
    if (fa) {
      const file = readdirSync(join(buildDir, 'assets')).find(f => f.startsWith(`${fa[1]}-`) && f.endsWith('.woff2'))
      const origin = req.headers.origin ?? ''
      const cors = /^https?:\/\/(?:[^:]+\.)?localhost(?::\d+)?$/.test(origin) ? { 'Access-Control-Allow-Origin': origin } : {}
      return send(res, 200, 'font/woff2', readFileSync(join(buildDir, 'assets', file)), cors)
    }
    if (path === '/spike/parent.js') {
      return send(res, 200, 'text/javascript', PARENT_JS)
    }
    if (path === '/spike/custom-ui-styles.js') {
      const ts = readFileSync(join(here, '../../src/core/plugins/custom-ui-styles.ts'), 'utf8')
      return send(res, 200, 'text/javascript', stripTypeScriptTypes(ts))
    }
    if (path === '/api/plugins/settings-ui/demo/index.html') {
      const dev = url.searchParams.get('devOrigin') === devOrigin ? devOrigin : ''
      return send(res, 200, 'text/html', pluginIndexHtml(dev), { 'Content-Security-Policy': pluginCsp(dev) })
    }
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '')
    try {
      let body = readFileSync(join(buildDir, rel))
      if (subpath && rel.endsWith('.html')) {
        body = body.toString().replace('<base href="/" />', `<base href="${subpath}" />`)
      }
      const headers = rel.endsWith('.html') && !isDev ? { 'Content-Security-Policy': MAIN_CSP } : {}
      return send(res, 200, TYPES[extname(rel)] ?? 'application/octet-stream', body, headers)
    } catch {
      return send(res, 404, 'text/plain', 'Not Found')
    }
  }
}

createServer(handler(false)).listen(API_PORT, () => console.warn(`api/prod parent: ${apiOrigin}/spike/parent.html (build: ${buildDir})`))
createServer(handler(true)).listen(DEV_PORT, () => console.warn(`dev parent:      ${devOrigin}/spike/parent.html`))
