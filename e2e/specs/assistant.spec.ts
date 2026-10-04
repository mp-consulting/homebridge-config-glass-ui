/**
 * The Assistant's entry points in the browser. The mock storage has no
 * `HomebridgeAiKit` block, so the real server reports the Assistant off; the
 * on case answers `/api/ai/status` from the test and lets the rest reach the
 * real server, which refuses the request (409) without calling any provider.
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

const ENABLED_STATUS = {
  enabled: true,
  reason: null,
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  capabilities: { tools: true, streaming: true, contextTokens: 200000, jsonMode: false },
  usage: { total: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 }, byModel: {} },
}

test('the Logs page offers no Diagnose button while the Assistant is off', async ({ page }) => {
  await login(page)
  await page.goto('/logs')
  await expect(page.locator('#log-output')).toBeVisible()
  await expect(page.locator('.hb-logs-diagnose')).toHaveCount(0)
})

test('Diagnose on the Logs page opens Log Doctor', async ({ page }) => {
  await page.route('**/api/ai/status', route => route.fulfill({ json: ENABLED_STATUS }))
  await login(page)
  await page.goto('/logs')

  const diagnose = page.locator('.hb-logs-diagnose')
  await expect(diagnose).toBeVisible()
  await diagnose.click()

  const drawer = page.locator('.hb-ai-drawer .hb-ai-diagnose')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('.modal-title')).toHaveText('Log Doctor')
  // The server is not configured, so the request comes back refused
  await expect(drawer.getByRole('alert')).toContainText('not enabled')

  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await expect(drawer).toHaveCount(0)
})
