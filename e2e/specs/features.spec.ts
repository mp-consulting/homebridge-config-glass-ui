/**
 * Feature smoke tests for the pages and dialogs the parity specs predate:
 * scenes, Quick Controls, Child Bridge Health, notifications, backup and
 * restore, API tokens and a plugin uninstall.
 *
 * Everything runs against the real backend on the mock storage, except what
 * would need a running Homebridge, the network or npm: the accessory list
 * (no Homebridge to read it from), the stored backups (none on fresh storage)
 * and npm itself (answered over socket.io, as saves.spec.ts does for an
 * install). Whatever a test writes it removes again, since every spec file
 * shares one backend.
 */

import type { APIRequestContext, Page, WebSocketRoute } from '@playwright/test'

import { expect, test } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#form-username').fill('admin')
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function apiToken(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/auth/login', { data: { username: 'admin', password: 'admin' } })
  expect(response.ok()).toBe(true)
  return (await response.json()).access_token
}

/**
 * Pass the app's socket.io traffic through to the server, except the messages
 * `answer` handles (it returns true when it did). Call before the page opens
 * its socket, i.e. before login. Resolves once that socket is open: from then
 * on navigate inside the app, since a page load starts a new socket.io
 * connection that talks over HTTP polling until it upgrades, out of reach.
 */
async function interceptSocket(page: Page, answer: (text: string, ws: WebSocketRoute) => boolean): Promise<{ socketOpen: Promise<void> }> {
  let socketReady!: () => void
  const socketOpen = new Promise<void>((resolve) => {
    socketReady = resolve
  })
  await page.routeWebSocket(/\/socket\.io\//, (ws: WebSocketRoute) => {
    const server = ws.connectToServer()
    socketReady()
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString()
      if (!answer(text, ws)) {
        server.send(message)
      }
    })
  })
  return { socketOpen }
}

test.describe('scenes', () => {
  // With no Homebridge there are no accessories to put in a scene: offer one
  const ACCESSORIES = [{
    uniqueId: 'e2e-lamp',
    serviceName: 'E2E Lamp',
    serviceCharacteristics: [{ type: 'On', description: 'On', format: 'bool', canWrite: true }],
  }]

  test('a scene is added and deleted again', async ({ page, request }) => {
    await page.route('**/api/accessories', route => route.fulfill({ json: ACCESSORIES }))
    await login(page)
    await page.goto('/scenes')
    await expect(page.getByRole('heading', { name: 'Scenes', exact: true })).toBeVisible()
    await expect(page.getByText(/There are no scenes yet/)).toBeVisible()

    await page.getByRole('button', { name: 'Add Scene' }).click()
    const editor = page.locator('.hb-scene-editor')
    await expect(editor).toBeVisible()
    await editor.getByRole('textbox', { name: 'Name' }).fill('E2E Evening')
    await editor.getByRole('button', { name: 'Add a value' }).click()
    await expect(editor.getByRole('combobox', { name: 'Accessory' })).toHaveValue('e2e-lamp')
    await editor.getByRole('combobox', { name: 'Value' }).selectOption('false')

    const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/scenes')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    const createdResponse = await created
    expect(createdResponse.ok()).toBe(true)
    const scene = await createdResponse.json()
    expect(scene).toMatchObject({ name: 'E2E Evening', actions: [{ uniqueId: 'e2e-lamp', characteristicType: 'On', value: false }], schedules: [] })
    await expect(editor).toBeHidden()

    const row = page.locator(`li[data-scene="${scene.id}"]`)
    await expect(row).toContainText('E2E Evening')
    await expect(row).toContainText('1 value(s)')
    await expect(row.getByRole('button', { name: 'Run E2E Evening' })).toBeVisible()

    try {
      await row.getByRole('button', { name: 'Delete' }).click()
      const confirm = page.getByRole('dialog').filter({ hasText: 'Delete the scene E2E Evening?' })
      await expect(confirm).toBeVisible()
      const removed = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname === `/api/scenes/${scene.id}`)
      await confirm.getByRole('button', { name: 'Delete' }).click()
      expect((await removed).ok()).toBe(true)
      await expect(row).toHaveCount(0)
      await expect(page.getByText(/There are no scenes yet/)).toBeVisible()
    } finally {
      // Whatever happened above, leave no scene behind for the other specs
      const token = await apiToken(request)
      await request.delete(`/api/scenes/${scene.id}`, { headers: { Authorization: `Bearer ${token}` } })
    }
  })
})

test('Quick Controls shows its empty state', async ({ page }) => {
  // No Homebridge to list accessories: answer the request with none
  const { socketOpen } = await interceptSocket(page, (text, ws) => {
    if (/^42\/accessories,\d*\["get-accessories"/.test(text)) {
      ws.send('42/accessories,["accessories-data",[]]')
      return true
    }
    return false
  })
  await login(page)
  await socketOpen
  // Only the phone menu links to /quick: navigate the router the way the
  // browser's back button would, without a page load
  await page.evaluate(() => {
    window.history.pushState(null, '', '/quick')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(/\/quick$/)
  await expect(page.getByRole('heading', { name: 'Quick Controls', exact: true })).toBeVisible()
  await expect(page.getByText(/No favourite accessories yet/)).toBeVisible()
  await expect(page.locator('.hb-quick-controls').getByRole('link', { name: 'Accessories' })).toHaveAttribute('href', /\/accessories$/)
})

test('Child Bridge Health renders with no child bridges', async ({ page }) => {
  await login(page)
  await page.goto('/child-bridges')
  await expect(page.getByRole('heading', { name: 'Child Bridge Health', exact: true })).toBeVisible()
  await expect(page.getByText(/is in a crash loop/)).toBeVisible()
  await expect(page.getByText('There are no child bridges.')).toBeVisible()
})

test('the settings page lists the notification channels and events', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  const section = page.locator('#settings-section-notifications')
  await expect(section.getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-expanded', 'true')

  for (const channel of ['Webhook', 'ntfy', 'Pushover', 'Telegram']) {
    await expect(section.getByRole('checkbox', { name: `${channel} Enabled` })).toBeAttached()
  }
  for (const event of ['Homebridge goes down', 'Homebridge is back up', 'A child bridge is crash looping', 'Updates are available', 'A scheduled backup fails']) {
    await expect(section.getByRole('checkbox', { name: event })).toBeVisible()
  }

  // Turning a channel on shows its fields and arms Save; nothing is saved or sent
  const save = section.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled()
  await expect(section.getByLabel('Webhook URL (receives a JSON POST)')).toHaveCount(0)
  await section.locator('label[for="notifications-webhook-enabled"]').click()
  await expect(section.getByRole('checkbox', { name: 'Webhook Enabled' })).toBeChecked()
  await expect(section.getByLabel('Webhook URL (receives a JSON POST)')).toBeVisible()
  await expect(save).toBeEnabled()
  // Not until it is saved
  await expect(section.locator('.setting-row').first().getByRole('button', { name: 'Send test' })).toBeDisabled()
})

test('the backup dialog lists stored backups and downloads one', async ({ page }) => {
  // Fresh storage has no stored backups: list one, and serve its archive
  const backup = { id: 'homebridge-backup-e2e.tar.gz', fileName: 'homebridge-backup-e2e.tar.gz', timestamp: Date.parse('2026-01-02T03:04:05Z'), size: 1 }
  await page.route('**/api/backup/scheduled-backups', route => route.fulfill({ json: [backup] }))
  await page.route(`**/api/backup/scheduled-backups/${backup.id}`, route => route.fulfill({
    body: 'not a real archive',
    contentType: 'application/octet-stream',
  }))
  const restores: string[] = []
  await page.route('**/api/backup/**/restore', (route) => {
    restores.push(route.request().url())
    return route.abort()
  })

  await login(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Backup & Restore', exact: true }).click()

  const dialog = page.getByRole('dialog').filter({ has: page.getByText('Stored Backup Files') })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download', exact: true }).first()).toBeVisible()
  const actions = dialog.getByRole('group')
  await expect(actions).toHaveCount(1)
  await expect(actions.getByRole('button', { name: 'Restore' })).toBeEnabled()

  const download = page.waitForEvent('download')
  await actions.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe(backup.fileName)

  await dialog.getByRole('button', { name: 'Close' }).last().click()
  await expect(dialog).toBeHidden()
  expect(restores).toEqual([])
})

test('an API token is created, shown once, works, and is revoked', async ({ page, request }) => {
  await login(page)
  await page.goto('/users')
  const section = page.getByRole('region', { name: 'API Tokens' })
  await expect(section.getByText('No API tokens yet.')).toBeVisible()

  await section.getByRole('button', { name: 'Create API Token' }).click()
  const create = page.getByRole('dialog').filter({ has: page.locator('#api-token-name') })
  await create.getByLabel('Name').fill('e2e-token')
  await create.getByLabel('Access').selectOption('read')
  await create.getByRole('button', { name: 'Create API Token' }).click()

  const shown = page.locator('.api-token-created')
  await expect(shown.getByRole('alert')).toContainText('It is shown only once')
  const value = await shown.locator('#api-token-value').inputValue()
  expect(value).toMatch(/^hbg_/)

  let revoked = false
  try {
    // A read token can GET
    const read = await request.get('/api/scenes', { headers: { Authorization: `Bearer ${value}` } })
    expect(read.ok()).toBe(true)

    await shown.getByRole('button', { name: 'Done' }).click()
    await expect(shown).toBeHidden()
    const row = section.getByRole('row').filter({ hasText: 'e2e-token' })
    await expect(row).toContainText('Read-only')
    // The list never shows the token again
    await expect(section.getByText(value)).toHaveCount(0)

    await row.getByRole('button', { name: 'Revoke e2e-token' }).click()
    const confirm = page.getByRole('dialog').filter({ hasText: 'Revoke the API token' })
    await confirm.getByRole('button', { name: 'Revoke' }).click()
    await expect(page.locator('#toast-container')).toContainText('has been revoked')
    await expect(section.getByText('No API tokens yet.')).toBeVisible()
    revoked = true

    const refused = await request.get('/api/scenes', { headers: { Authorization: `Bearer ${value}` } })
    expect(refused.status()).toBe(401)
  } finally {
    if (!revoked) {
      // Leave no token behind for the other specs
      const token = await apiToken(request)
      const headers = { Authorization: `Bearer ${token}` }
      const tokens: { id: string, name: string }[] = await (await request.get('/api/auth/tokens', { headers })).json()
      for (const left of tokens.filter(t => t.name === 'e2e-token')) {
        await request.delete(`/api/auth/tokens/${encodeURIComponent(left.id)}`, { headers })
      }
    }
  }
})

test('a plugin uninstalls and asks for a restart', async ({ page, request }) => {
  const pluginName = 'homebridge-mock-plugin-two'
  const token = await apiToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const originalConfig = await (await request.get('/api/config-editor', { headers })).json()

  // npm itself: answer the `uninstall` request (with its ack) instead of the backend
  const uninstallRequests: string[] = []
  const { socketOpen } = await interceptSocket(page, (text, ws) => {
    const uninstall = /^42\/plugins,(\d+)\["uninstall",/.exec(text)
    if (!uninstall) {
      return false
    }
    uninstallRequests.push(text)
    ws.send(`42/plugins,["stdout","removed 1 package\\r\\n"]`)
    ws.send(`43/plugins,${uninstall[1]}[true]`)
    return true
  })

  try {
    await login(page)
    await socketOpen
    // Inside the app, so the socket opened at login carries the plugins namespace
    await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Plugins' }).click()
    await expect(page).toHaveURL(/\/plugins$/)

    const card = page.locator('.card.card-body').filter({ has: page.getByRole('heading', { name: 'Homebridge Mock Plugin Two', exact: true }) })
    await card.getByRole('button', { name: 'Plugin Actions' }).click()
    await card.getByRole('button', { name: 'Uninstall', exact: true }).click()

    const confirm = page.getByRole('dialog').filter({ hasText: 'Are you sure you want to uninstall' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Uninstall', exact: true }).click()

    const restart = page.getByRole('dialog', { name: 'Restart Required' })
    await expect(restart).toBeVisible()
    expect(uninstallRequests).toHaveLength(1)
    expect(uninstallRequests[0]).toContain(`"name":"${pluginName}"`)
    await restart.getByRole('button', { name: 'Close' }).first().click()
    await expect(restart).toBeHidden()
  } finally {
    // The uninstall dialog may have removed the plugin's config: put it back
    const response = await request.post('/api/config-editor', { headers, data: originalConfig })
    expect(response.ok()).toBe(true)
  }
})
