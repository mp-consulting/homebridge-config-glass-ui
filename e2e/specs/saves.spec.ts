/**
 * Writes: the config editor and the settings page save to disk and the change
 * survives a reload, a plugin install runs to completion (against a mocked
 * registry and socket), and a 2FA user can log in.
 *
 * Every spec file shares one backend and one mock storage, so whatever a test
 * here writes is put back afterwards (see restoreConfig).
 */

import type { APIRequestContext, Page, WebSocketRoute } from '@playwright/test'

import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import process from 'node:process'

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

async function readConfig(request: APIRequestContext, token: string): Promise<Record<string, any>> {
  const response = await request.get('/api/config-editor', { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok()).toBe(true)
  return response.json()
}

test.describe('saving', () => {
  let token: string
  let originalConfig: Record<string, any>

  test.beforeAll(async ({ request }) => {
    token = await apiToken(request)
    originalConfig = await readConfig(request, token)
  })

  // Put config.json back as the mock storage had it, for the specs that run after
  async function restoreConfig(request: APIRequestContext) {
    const response = await request.post('/api/config-editor', {
      headers: { Authorization: `Bearer ${token}` },
      data: originalConfig,
    })
    expect(response.ok()).toBe(true)
  }

  test.afterEach(async ({ request }) => {
    await restoreConfig(request)
  })

  test('the config editor saves an edit, asks for a restart, and the edit survives a reload', async ({ page }) => {
    await login(page)
    await page.goto('/config')
    const editor = page.locator('.monaco-editor').first()
    await expect(editor.locator('.view-lines')).toContainText('"bridge"')

    const edited = structuredClone(originalConfig)
    edited.bridge.name = 'Homebridge Saved E2E'

    // Replace the whole document (the save formats it). Control, not Meta, on
    // every OS: the Desktop Chrome device reports a Windows user agent, so
    // Monaco binds Windows keys. Monaco auto-closes the opening brace and
    // quote of the inserted text, so drop whatever ends up after the cursor.
    await editor.locator('.view-lines').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(JSON.stringify(edited))
    await page.keyboard.press('Control+Shift+End')
    await page.keyboard.press('Delete')

    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/config-editor')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).ok()).toBe(true)

    // A bridge change needs Homebridge restarted
    // The modal window is the one dialog, named after its title
    const prompt = page.getByRole('dialog', { name: 'Restart Required' })
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('#restart-homebridge-modal-title')).toHaveText('Restart Required')
    await prompt.getByRole('button', { name: 'Close' }).first().click()
    await expect(prompt).toBeHidden()

    await page.reload()
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('Homebridge Saved E2E')
  })

  test('a settings field saves and survives a reload', async ({ page }) => {
    await login(page)
    await page.goto('/settings')
    const name = page.getByRole('textbox', { name: 'Homebridge Name' })
    await expect(name).toHaveValue('Homebridge Test')

    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/server/name')
    await name.fill('Homebridge Renamed')
    expect((await saved).ok()).toBe(true)

    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Homebridge Name' })).toHaveValue('Homebridge Renamed')
  })
})

test('a plugin installs from the search results', async ({ page }) => {
  const pluginName = 'homebridge-e2e-fake'

  // The registry: search results and the version list (the backend would ask npm)
  await page.route(`**/api/plugins/search/**`, route => route.fulfill({
    json: [{
      name: pluginName,
      displayName: 'E2E Fake Plugin',
      description: 'Not a real plugin',
      private: false,
      publicPackage: true,
      latestVersion: '1.0.0',
      lastUpdated: '2026-01-01T00:00:00.000Z',
      links: { npm: `https://www.npmjs.com/package/${pluginName}` },
      author: 'e2e',
      verifiedPlugin: false,
    }],
  }))
  await page.route(`**/api/plugins/lookup/${pluginName}/versions`, route => route.fulfill({
    json: { tags: { latest: '1.0.0' }, versions: { '1.0.0': { name: pluginName, version: '1.0.0', engines: {} } } },
  }))

  // The install itself: the UI asks over socket.io (`install` with an ack) and
  // streams npm's output from `stdout` events. Answer it here instead of
  // letting the backend run npm; everything else goes through to the server.
  const installRequests: string[] = []
  let socketReady!: () => void
  const socketOpen = new Promise<void>((resolve) => {
    socketReady = resolve
  })
  await page.routeWebSocket(/\/socket\.io\//, (ws: WebSocketRoute) => {
    const server = ws.connectToServer()
    socketReady()
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString()
      // engine.io message (4) + socket.io event (2), namespace, ack id, payload
      const install = /^42\/plugins,(\d+)\["install",/.exec(text)
      if (!install) {
        server.send(message)
        return
      }
      installRequests.push(text)
      ws.send(`42/plugins,["stdout","added 1 package for ${pluginName}\\r\\n"]`)
      ws.send(`43/plugins,${install[1]}[true]`)
    })
  })

  await login(page)
  // Navigate inside the app so the socket opened at login (one engine.io
  // connection, already upgraded to a WebSocket) carries the plugins namespace
  await socketOpen
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Plugins' }).click()
  await expect(page).toHaveURL(/\/plugins$/)

  const search = page.getByRole('textbox', { name: 'Search for plugins to install…' })
  if (!await search.isVisible()) {
    await page.getByRole('button', { name: 'Search...', exact: true }).click()
  }
  await search.fill('e2e fake')
  await search.press('Enter')

  const card = page.locator('.card.card-body').filter({ has: page.getByRole('heading', { name: 'E2E Fake Plugin', exact: true }) })
  await card.getByRole('button', { name: 'Install' }).click()

  const versions = page.getByRole('dialog')
  await expect(versions.getByText('v1.0.0').first()).toBeVisible()
  await versions.locator('.list-group-item').first().getByRole('button').click()

  await expect(page.locator('#toast-container')).toContainText(pluginName)
  expect(installRequests).toHaveLength(1)
  expect(installRequests[0]).toContain(`"name":"${pluginName}"`)
})

// Kept in step with e2e/serve.mjs, which seeds this user when E2E_OTP_USER=1
const OTP_USER = 'otp-user'
const OTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

// RFC 6238 with otplib's defaults: HMAC-SHA1, 30 s step, 6 digits
function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0F
  const code = (hmac.readUInt32BE(offset) & 0x7FFFFFFF) % 1_000_000
  return code.toString().padStart(6, '0')
}

test('a user with 2FA logs in with a one-time code', async ({ page }) => {
  test.skip(process.env.E2E_OTP_USER !== '1', 'needs the 2FA user e2e/serve.mjs seeds when E2E_OTP_USER=1')

  await page.goto('/login')
  await page.locator('#form-username').fill(OTP_USER)
  await page.locator('#form-pass').fill('admin')
  await page.locator('#submit-button').click()

  // The password is right, so the server asks for the code (412)
  const code = page.locator('#form-ota')
  await expect(code).toBeVisible()
  await expect(page).toHaveURL(/\/login/)

  await code.fill(totp(OTP_SECRET))
  await page.locator('#submit-button').click()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible()
})
