/**
 * Plugin custom settings UIs (plugin-ui-utils iframes) on real plugins:
 * the iframe loads, receives the parent's theme, and the dialog looks the
 * same on both UIs (the React run compares against the Angular screenshots,
 * see visual.spec.ts). Needs `node e2e/install-plugins.mjs` first; skipped
 * without it.
 */

import type { Page } from '@playwright/test'

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const installed = existsSync(resolve(dirname(fileURLToPath(import.meta.url)), '../.run/plugins/node_modules/homebridge-ring'))

// `form`: a field the plugin's page asks the parent to render (`createForm`).
// The Angular build renders no schema form inside a plugin dialog (NG0201,
// see pages.spec.ts), so such a plugin is checked by its form, not compared
// against an Angular screenshot.
const PLUGINS: { name: string, file: string, form?: string }[] = [
  { name: 'Ring', file: 'ring', form: 'Email' },
  { name: 'Homebridge Camera FFmpeg', file: 'camera-ffmpeg' },
  { name: 'UniFi Protect', file: 'unifi-protect' },
]

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('plugin custom settings UIs', () => {
  test.skip(!installed, 'run node e2e/install-plugins.mjs first')

  for (const plugin of PLUGINS) {
    test(`${plugin.name} opens themed`, async ({ page }, info) => {
      test.fail(!!plugin.form && info.project.name === 'angular', 'NG0201 in the Angular build')
      await page.setViewportSize({ width: 1280, height: 900 })
      await login(page)
      await page.goto('/plugins')
      const card = page.locator('.card.card-body').filter({ has: page.getByRole('heading', { name: plugin.name, exact: true }) })
      await card.getByRole('button', { name: 'Set Up' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const frame = dialog.frameLocator('iframe')
      // The plugin's page has loaded and plugin-ui-utils has applied the
      // parent's styles: the forwarded stylesheets are in its document
      await expect(frame.locator('body')).toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => frame.locator('link[rel="stylesheet"], style').count(), { timeout: 15_000 }).toBeGreaterThan(0)
      const parentClasses = await page.evaluate(() => [...document.body.classList].filter(c => c.endsWith('-mode') || c.startsWith('glass-ui-')).sort())
      const frameClasses = await frame.locator('body').evaluate(body => [...body.classList].sort())
      for (const name of parentClasses) {
        expect(frameClasses).toContain(name)
      }

      if (plugin.form) {
        await expect(dialog.getByRole('textbox', { name: plugin.form })).toBeVisible()
        return
      }
      await page.waitForTimeout(2000)
      await expect(dialog).toHaveScreenshot(`custom-ui-${plugin.file}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
      })
    })
  }
})
