/**
 * Visual regression: screenshots of the main pages, also under dark, flat,
 * Hebrew and mobile settings, compared with the stored baseline.
 *
 * Deterministic by construction rather than by masking:
 * - the backend reports a fixed, made-up host and stays off the network
 *   (e2e/fixed-host.ts, preloaded by e2e/serve.mjs): host name, IPs, OS,
 *   paths, versions, uptime and the CPU / memory / network figures are
 *   constants, and the plugin list has no npm or GitHub data;
 * - the browser has a fixed date, timezone and locale and no outside requests
 *   (`beforeEach` below), and CSS animations and carets are off;
 * - only the log terminal and the config editor's cursor are masked.
 *
 * Baselines are per platform (`{platform}` in the config's
 * snapshotPathTemplate). The Linux ones are committed and CI compares against
 * them strictly; they must be recorded in the same pinned image CI runs, since
 * fonts and anti-aliasing differ between distributions:
 *
 *   docker run --rm --ipc=host --platform linux/amd64 -v "$PWD":/work -v /work/node_modules -v /work/ui/node_modules -v /work/e2e/.run \
 *     -w /work mcr.microsoft.com/playwright:v1.64.1-noble bash -c \
 *     'npm ci && npm ci --prefix ui && node e2e/build.mjs && node e2e/install-plugins.mjs \
 *      && npx playwright test -c e2e visual.spec --update-snapshots'
 *
 * The image tag must match the installed @playwright/test version (and the
 * `container:` of the visual job in .github/workflows/build.yml): bump all
 * three together and re-record. The macOS (`-darwin`) baselines stay local
 * and gitignored: record them before a change, compare after it:
 *
 *   npx playwright test -c e2e visual.spec --update-snapshots   (before)
 *   npx playwright test -c e2e visual.spec                      (after)
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

// One clock, timezone and locale wherever the run happens (the footer year,
// relative times, number and date formats)
const NOW = new Date('2026-01-01T12:00:00Z')
test.use({ timezoneId: 'UTC', locale: 'en-US' })

test.beforeEach(async ({ page }) => {
  // Time runs from NOW, so animations (Chart.js times them with Date.now) still finish
  await page.clock.install({ time: NOW })
  // The server's clock, which the UI compares with its own (a warning toast past 8 hours)
  await page.route('**/api/auth/settings', async (route) => {
    const response = await route.fetch()
    route.fulfill({ response, json: { ...await response.json(), serverTimestamp: NOW.toISOString() } })
  })
  // Nothing from the network (plugin icons and the like): the page is the same offline
  await page.route(url => !['localhost', '127.0.0.1'].includes(url.hostname), route => route.abort())
})

const PAGES = ['/login', '/', '/plugins', '/config', '/users', '/settings', '/support', '/power-options']

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

/**
 * Wait for the page to be complete: every widget's data in (the dashboard
 * talks over socket.io, which networkidle does not see, and a slow machine
 * or an emulated container can take seconds), then entrance animations and
 * debounced layout.
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.fa-spin:visible')).toHaveCount(0, { timeout: 30_000 })
  await page.waitForTimeout(1500)
}

/**
 * What is still live with e2e/fixed-host.ts in place: the log terminal
 * streams the backend's own log, and the config editor draws a blinking
 * cursor of its own (`caret: 'hide'` only covers native inputs).
 */
function masks(page: Page) {
  return [
    page.locator('.xterm'),
    page.locator('.monaco-editor .cursors-layer'),
  ]
}

for (const path of PAGES) {
  test(`${path} looks the same`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    if (path !== '/login') {
      await login(page)
    }
    await page.goto(path)
    await settle(page)
    const name = `${path === '/' ? 'status' : path.slice(1).replace(/\//g, '-')}.png`
    await expect(page).toHaveScreenshot(name, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      mask: masks(page),
      maxDiffPixelRatio: 0.02,
    })
  })
}

/**
 * The same comparison under other settings: each variant writes its UI
 * settings through the API the settings page uses, on this UI's own server.
 */
const VARIANTS: { name: string, settings: Record<string, unknown>, viewport?: { width: number, height: number } }[] = [
  { name: 'dark', settings: { lightingMode: 'dark' } },
  { name: 'flat', settings: { glassMode: false } },
  { name: 'flat-dark', settings: { glassMode: false, lightingMode: 'dark' } },
  { name: 'hebrew', settings: { lang: 'he' } },
  { name: 'mobile', settings: {}, viewport: { width: 390, height: 844 } },
]
const VARIANT_PAGES = ['/', '/plugins', '/settings']

for (const variant of VARIANTS) {
  test.describe(`${variant.name} variant`, () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(async ({ request }) => {
      const { access_token: token } = await (await request.post('/api/auth/login', { data: { username: 'admin', password: 'admin' } })).json()
      // Back to the defaults, then this variant's settings
      const settings = { lightingMode: 'auto', glassMode: true, lang: 'auto', ...variant.settings }
      const response = await request.patch('/api/config-editor/ui', { data: settings, headers: { authorization: `Bearer ${token}` } })
      expect(response.ok()).toBe(true)
    })

    for (const path of VARIANT_PAGES) {
      test(`${path} looks the same`, async ({ page }) => {
        await page.setViewportSize(variant.viewport ?? { width: 1280, height: 900 })
        await login(page)
        await page.goto(path)
        await settle(page)
        const name = `${variant.name}-${path === '/' ? 'status' : path.slice(1)}.png`
        await expect(page).toHaveScreenshot(name, {
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          mask: masks(page),
          maxDiffPixelRatio: 0.02,
        })
      })
    }
  })
}

test.afterAll(async ({ request }) => {
  const { access_token: token } = await (await request.post('/api/auth/login', { data: { username: 'admin', password: 'admin' } })).json()
  await request.patch('/api/config-editor/ui', { data: { lightingMode: 'auto', glassMode: true, lang: 'auto' }, headers: { authorization: `Bearer ${token}` } })
})
