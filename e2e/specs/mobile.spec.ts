/**
 * The shell at phone width: the side menu stays out of the way (and out of
 * the tab order) until the hamburger opens it.
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/plugins')
  await expect(page.locator('h3.primary-text').first()).toBeVisible()
})

test('the closed menu is hidden and out of the tab order', async ({ page }) => {
  const sidebar = page.locator('#sidebar')
  await expect(sidebar).not.toHaveClass(/expanded/)
  await expect(sidebar).toHaveAttribute('inert', '')
  await expect(sidebar.locator('.link-row').first()).toBeHidden()
  await expect(sidebar.locator('.header')).toBeHidden()

  // Tabbing through the page never lands in the closed menu
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab')
    const inMenu = await page.evaluate(() => !!document.activeElement?.closest('#sidebar'))
    expect(inMenu).toBe(false)
  }
})

test('the page title is not covered by the menu', async ({ page }) => {
  const title = page.locator('h3.primary-text').first()
  // Polled: the page fades and slides in, and the menu animates its width
  await expect.poll(async () => {
    const box = (await title.boundingBox())!
    return page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y)
      return hit?.closest('h3.primary-text') ? 'title' : `${hit?.tagName}.${hit?.className}`
    }, { x: box.x + 8, y: box.y + box.height / 2 })
  }).toBe('title')
})

test('the skip link is the first stop and lands on the page', async ({ page }) => {
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main-content')).toBeFocused()
})

test('the hamburger opens the menu', async ({ page }) => {
  const sidebar = page.locator('#sidebar')
  // The menu ignores taps for 750 ms after a navigation and closes on one
  // (Sidebar.tsx); on a slow runner the page can still be settling, so let it
  // go idle and retry the tap until the menu is open and stays interactive
  await page.waitForLoadState('networkidle')
  await expect(async () => {
    if (!await sidebar.evaluate(el => el.classList.contains('expanded'))) {
      await page.getByRole('button', { name: 'Menu' }).click()
    }
    await expect(sidebar).toHaveClass(/expanded/, { timeout: 1000 })
    await expect(sidebar).not.toHaveAttribute('inert', { timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(sidebar.getByRole('button', { name: 'Settings' })).toBeVisible()
})
