/**
 * Visual regression: screenshots of the main pages, also under dark, flat,
 * Hebrew and mobile settings, compared with the stored baseline
 * (`npx playwright test -c e2e visual --update-snapshots` records it).
 * Baselines are machine-specific (they show this host's name and IPs), so
 * they are gitignored: record one before a change, compare after it.
 * Moving parts (clock, charts, terminals, timestamps) are masked.
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

const PAGES = ['/login', '/', '/plugins', '/config', '/users', '/settings', '/support', '/power-options']

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

function masks(page: Page) {
  return [
    page.locator('canvas'),
    page.locator('.xterm'),
    page.locator('.monaco-editor'),
    page.locator('time, .clock, [class*="clock"], [class*="uptime"]'),
  ]
}

for (const path of PAGES) {
  test(`${path} looks the same`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    if (path !== '/login') {
      await login(page)
    }
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    // Let entrance animations and debounced layout settle
    await page.waitForTimeout(1500)
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
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1500)
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
