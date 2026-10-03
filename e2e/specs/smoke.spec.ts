/**
 * Smoke parity: every route renders for a logged-in admin, with no console
 * errors and no failed same-origin requests. The selectors are the Angular
 * UI's own ids and classes, which the React port keeps.
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

const ROUTES = [
  '/',
  '/plugins',
  '/config',
  '/accessories',
  '/logs',
  '/users',
  '/settings',
  '/support',
  '/power-options',
  '/platform-tools/terminal',
]

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Logged by both UIs while no one is logged in: the session check is refused
const EXPECTED_ERRORS = [
  /Failed to load resource: the server responded with a status of 401/,
  /Token does not match instance/,
]

/**
 * 5xx responses a route may get by design, as method + pathname. Everything
 * else fails the test, /api included.
 *
 * Empty: with no Homebridge process attached, the endpoints that need one
 * answer without a 5xx on this mock storage (child bridges come back empty,
 * the pairing info is read from test/mocks/persist), and a run of every
 * route logged none. Add an entry only with the reason it cannot succeed here,
 * e.g. `{ method: 'GET', path: /^\/api\/server\/pairing$/, why: 'no persist/AccessoryInfo yet' }`.
 */
const ALLOWED_5XX: { method: string, path: RegExp, why: string }[] = []

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !EXPECTED_ERRORS.some(re => re.test(message.text()))) {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('response', (response) => {
    const url = new URL(response.url())
    const method = response.request().method()
    if (url.origin !== new URL(page.url() || 'http://x').origin || response.status() < 500) {
      return
    }
    if (!ALLOWED_5XX.some(allowed => allowed.method === method && allowed.path.test(url.pathname))) {
      errors.push(`http ${response.status()}: ${method} ${url.pathname}`)
    }
  })
  return errors
}

test('the login page renders', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/login')
  await expect(page.locator('#form-username')).toBeVisible()
  await expect(page.locator('#form-pass')).toBeVisible()
  await expect(page.locator('#submit-button')).toBeVisible()
  expect(errors).toEqual([])
})

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('wrong')
  await page.locator('#submit-button').click()
  await expect(page).toHaveURL(/\/login/)
})

for (const route of ROUTES) {
  test(`${route} renders after login`, async ({ page }) => {
    await login(page)
    const errors = watchErrors(page)
    await page.goto(route)
    await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible()
    await expect(page.locator('.content').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
}
