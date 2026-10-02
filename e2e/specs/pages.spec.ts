/**
 * Page behaviour parity: the same interactions on both UIs, through roles,
 * labels and the markup the React port keeps from the Angular templates.
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

// What the Angular UI puts on <body> for the mock storage's default settings
const BODY_CLASSES = ['glass-mode', 'glass-ui-deep-purple', 'terminal-dark']

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('the sidebar navigates between pages', async ({ page }) => {
  const menu = page.getByRole('navigation', { name: 'Menu' })
  await menu.getByRole('button', { name: 'Plugins' }).click()
  await expect(page).toHaveURL(/\/plugins$/)
  await menu.getByRole('button', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await menu.getByRole('button', { name: 'Status' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('the plugins page lists the installed plugins', async ({ page }) => {
  await page.goto('/plugins')
  await expect(page.getByRole('heading', { name: 'Homebridge Mock Plugin', exact: true, level: 5 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Homebridge Mock Plugin Two', exact: true, level: 5 })).toBeVisible()
})

test('a plugin settings form opens from its card', async ({ page }, info) => {
  // The Angular production build throws NG0201 (no provider) when this modal
  // opens from a plugin card, and renders no form: an Angular bug, not a spec one
  test.fail(info.project.name === 'angular', 'NG0201 in the Angular build')
  await page.goto('/plugins')
  const card = page.locator('.card.card-body').filter({ has: page.getByRole('heading', { name: 'Homebridge Mock Plugin', exact: true }) })
  await card.getByRole('button', { name: 'Set Up' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  // The mock plugin's schema: one required string with a default
  await expect(modal.getByRole('textbox', { name: /Name/ })).toHaveValue('Example Dynamic Platform')
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('the config editor loads config.json into Monaco', async ({ page }) => {
  await page.goto('/config')
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('"bridge"')
})

test('the users page lists the administrator', async ({ page }) => {
  await page.goto('/users')
  await expect(page.getByText('Administrator').first()).toBeVisible()
})

test('the logs page attaches a terminal', async ({ page }) => {
  await page.goto('/logs')
  await expect(page.locator('.xterm').first()).toBeVisible()
})

test('the settings page renders its sections', async ({ page }) => {
  await page.goto('/settings')
  const sections = page.getByRole('navigation', { name: 'Settings' })
  for (const name of ['General', 'Display', 'Network', 'Security', 'Bridges']) {
    await expect(sections.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('textbox', { name: 'Homebridge Name' })).toHaveValue('Homebridge Test')
})

test('logging out returns to the login page', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Log Out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('#form-username')).toBeVisible()
})

test('the body carries the default theme classes', async ({ page }) => {
  const classes = await page.evaluate(() => [...document.body.classList].sort())
  expect(classes).toEqual(BODY_CLASSES)
})
