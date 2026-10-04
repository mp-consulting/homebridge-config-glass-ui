/**
 * Accessibility: axe-core scans every main route (and the login page) as the
 * admin sees it with the mock storage's default settings (light glass), and
 * fails on any serious or critical violation.
 *
 * A violation that cannot be fixed cheaply in this UI (third-party internals,
 * a broad design change) goes in KNOWN_VIOLATIONS: by rule id and the node's
 * selector, with the reason, never by turning a rule off for the whole page.
 * The failure message lists each violation's rule, impact and nodes.
 */

import type { Page } from '@playwright/test'

import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const ROUTES = [
  '/',
  '/plugins',
  '/config',
  '/accessories',
  '/quick',
  '/scenes',
  '/logs',
  '/users',
  '/settings',
  '/support',
  '/child-bridges',
  '/power-options',
  '/platform-tools/terminal',
]

/**
 * Violations accepted for now, each matched by rule id and a pattern on the
 * node's selector (as axe prints it), optionally on one route only.
 *
 * Add an entry only with the reason it cannot be fixed here.
 */
const KNOWN_VIOLATIONS: { rule: string, target: RegExp, route?: string, why: string }[] = [
  {
    rule: 'color-contrast',
    target: /^\.view-line.*\.mtk\d+$/,
    route: '/config',
    why: 'Monaco\'s built-in `vs` syntax colours (numbers, keywords) on the light glass; changing them takes a custom Monaco theme',
  },
]

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

function isKnown(route: string, rule: string, target: string) {
  return KNOWN_VIOLATIONS.some(known => known.rule === rule && known.target.test(target) && (!known.route || known.route === route))
}

/** The serious and critical violations on the page, minus the known ones, one line per node. */
async function violations(page: Page, route: string): Promise<string[]> {
  // Let the page settle: data loads, entrance animations, lazy chunks
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap(violation => violation.nodes
      .map(node => node.target.map(String).join(' '))
      .filter(target => !isKnown(route, violation.id, target))
      .map(target => `${violation.id} [${violation.impact}] ${target}: ${violation.help}`))
}

test('/login has no serious accessibility violations', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('#form-username')).toBeVisible()
  expect(await violations(page, '/login')).toEqual([])
})

for (const route of ROUTES) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    // axe walks the whole DOM (Monaco, xterm, the dashboard): slow on a busy machine
    test.slow()
    await login(page)
    await page.goto(route)
    await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible()
    await expect(page.locator('.content').first()).toBeVisible()
    expect(await violations(page, route)).toEqual([])
  })
}
