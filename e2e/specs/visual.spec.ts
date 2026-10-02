/**
 * Visual parity: the Angular project writes the screenshots, the React
 * project is compared against the same files (the snapshot path has no
 * project name, see playwright.config.ts). Run Angular first:
 *
 *   npx playwright test -c e2e visual --project angular --update-snapshots
 *   npx playwright test -c e2e visual --project react
 *
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
