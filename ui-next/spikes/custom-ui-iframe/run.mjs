/**
 * TEMPORARY (Phase 0, spikes B and C) - browser checks against serve.mjs.
 *
 * Playwright is not a project dependency. Install it somewhere else and point
 * PLAYWRIGHT_MODULE at it:
 *
 *   (cd /tmp/pw && npm i playwright)
 *   node spikes/custom-ui-iframe/serve.mjs <VITE_SPIKES=1 build dir> &
 *   PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs OUT=/tmp/shots node spikes/custom-ui-iframe/run.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const out = process.env.OUT ?? '.'
mkdirSync(out, { recursive: true })
const api = `http://localhost:${process.env.API_PORT ?? 18581}`
const dev = `http://localhost:${process.env.DEV_PORT ?? 14200}`

let browser
const results = {}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  const log = { console: [], failed: [], csp: [] }
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.parent.postMessage({ __csp: `${e.violatedDirective} ${e.blockedURI}` }, '*')
      console.warn(`[CSP] ${e.violatedDirective} blocked ${e.blockedURI}`)
    })
  })
  page.on('console', m => log.console.push(`${m.type()}: ${m.text()}`))
  page.on('requestfailed', r => log.failed.push(`${r.url()} ${r.failure()?.errorText}`))
  page.on('response', (r) => {
    if (r.status() >= 400) {
      log.failed.push(`${r.status()} ${r.url()}`)
    }
  })
  log.csp = log.console
  return { page, log }
}

async function monaco(name, url) {
  const { page, log } = await newPage()
  const requests = []
  page.on('request', r => requests.push(r.url()))
  await page.goto(url)
  await page.waitForSelector('.monaco-editor .view-lines', { timeout: 20000 })
  await page.waitForSelector('[data-testid=markers] li', { timeout: 20000 })
  const markers = await page.$$eval('[data-testid=markers] li', els => els.map(e => e.textContent))
  const info = await page.evaluate(() => ({
    windowMonaco: typeof window.monaco?.editor?.create,
    schemas: window.monaco.json.jsonDefaults.diagnosticsOptions.schemas.map(s => s.uri),
    modelMarkers: window.monaco.editor.getModelMarkers({}).map(m => `${m.resource.toString()} L${m.startLineNumber} ${m.message}`),
    themeClass: document.querySelector('.monaco-editor').className.includes('vs-dark') ? 'vs-dark' : 'vs',
  }))
  await page.screenshot({ path: join(out, `${name}-light.png`) })
  await page.click('[data-testid=toggle-dark]')
  await page.waitForSelector('.monaco-editor.vs-dark')
  await page.screenshot({ path: join(out, `${name}-dark.png`) })
  await page.click('[data-testid=toggle-diff]')
  await page.waitForSelector('.monaco-diff-editor .view-lines', { timeout: 20000 })
  await page.waitForTimeout(1000)
  const diffSchemas = await page.evaluate(() => window.monaco.json.jsonDefaults.diagnosticsOptions.schemas.map(s => s.uri))
  await page.screenshot({ path: join(out, `${name}-diff.png`) })
  await page.click('[data-testid=toggle-diff]')
  await page.waitForTimeout(500)
  const afterRemount = await page.evaluate(() => window.monaco.json.jsonDefaults.diagnosticsOptions.schemas.map(s => s.uri))
  results[name] = {
    markers,
    ...info,
    diffSchemas,
    afterRemount,
    loaderUrl: requests.find(u => u.includes('loader.js')),
    workerRequests: requests.filter(u => u.includes('worker')),
    problems: [...log.failed, ...log.console.filter(c => /CSP|error|Could not create web worker|Refused/i.test(c))],
  }
  await page.close()
}

async function iframe(name, url) {
  const { page, log } = await newPage()
  await page.goto(url)
  const frame = await (await page.waitForSelector('#plugin')).contentFrame()
  await frame.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 15000 })
  await page.waitForTimeout(800)
  const info = await frame.evaluate(async () => {
    await document.fonts.ready
    const css = sel => getComputedStyle(document.querySelector(sel))
    const icon = getComputedStyle(document.querySelector('.fa-check'), '::before')
    return {
      bodyClass: document.body.className,
      bodyBg: css('body').backgroundColor,
      btnPrimaryBg: css('.btn-primary').backgroundColor,
      formControlBorder: css('.form-control').borderColor,
      iconFont: icon.fontFamily,
      fonts: [...document.fonts].filter(f => f.family.includes('Awesome')).map(f => `${f.family} ${f.weight} ${f.status}`),
      links: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `${l.href} sheet=${!!l.sheet}`),
      inlineStyles: document.querySelectorAll('style').length,
    }
  })
  const parentBtn = await page.evaluate(() => getComputedStyle(document.querySelector('.btn-primary')).backgroundColor)
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true })
  results[name] = { ...info, parentBtnPrimaryBg: parentBtn, problems: [...log.failed, ...log.console.filter(c => /CSP|Refused|error/i.test(c))] }
  await page.close()
}

async function main() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' }).catch(() => chromium.launch())
  const only = process.env.ONLY
  if (!only || only === 'monaco') {
    await monaco('monaco-root', `${api}/?spike=monaco`)
    await monaco('monaco-subpath', `${api}/homebridge/?spike=monaco`)
  }
  if (!only || only === 'iframe') {
    await iframe('iframe-prod-light', `${api}/spike/parent.html`)
    await iframe('iframe-prod-dark', `${api}/spike/parent.html?dark=1`)
    await iframe('iframe-dev', `${dev}/spike/parent.html?dark=1`)
    await iframe('iframe-dev-verbatim', `${dev}/spike/parent.html?dark=1&verbatim=1`)
  }

  await browser.close()
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

main()
