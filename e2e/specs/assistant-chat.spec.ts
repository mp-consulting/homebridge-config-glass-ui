/**
 * The Assistant palette with the Assistant on: a question goes out over the
 * `ai` socket.io namespace with the page context, the answer streams back, the
 * conversation survives closing the palette, and New chat starts another.
 *
 * No provider is called: `/api/ai/status` is answered from the test (the mock
 * storage has the Assistant off), and so is the `chat` request, the way the
 * server would (an ack, then `ai:chunk` and `ai:done` events carrying the
 * request's requestId). The rest of the socket traffic reaches the server.
 */

import type { Page, WebSocketRoute } from '@playwright/test'

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

const ANSWER = ['You have **two** plugins ', 'installed: Homebridge Mock Plugin ', 'and Homebridge Mock Plugin Two.']

interface ChatRequest {
  requestId: string
  body: { messages: { role: string, content: string }[], context: { route: string, page: string, plugin?: string } }
}

test('a question is answered in the palette and the conversation is kept', async ({ page }) => {
  await page.route('**/api/ai/status', route => route.fulfill({ json: ENABLED_STATUS }))

  const chats: ChatRequest[] = []
  await page.routeWebSocket(/\/socket\.io\//, (ws: WebSocketRoute) => {
    const server = ws.connectToServer()
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString()
      // engine.io message (4) + socket.io event (2), namespace, ack id, payload
      const chat = /^42\/ai,(\d+)(\["chat",.*)$/s.exec(text)
      if (!chat) {
        server.send(message)
        return
      }
      const request = JSON.parse(chat[2])[1] as ChatRequest
      chats.push(request)
      const { requestId } = request
      ws.send(`43/ai,${chat[1]}${JSON.stringify([{ requestId, accepted: true }])}`)
      for (const delta of ANSWER) {
        ws.send(`42/ai,${JSON.stringify(['ai:chunk', { requestId, delta }])}`)
      }
      ws.send(`42/ai,${JSON.stringify(['ai:done', { requestId, result: { text: ANSWER.join('') } }])}`)
    })
  })

  await login(page)
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Scenes' }).click()
  await expect(page).toHaveURL(/\/scenes$/)

  // The menu entry opens the palette
  await page.getByRole('button', { name: 'Open the Assistant' }).click()
  const palette = page.locator('.hb-ai-palette')
  await expect(palette).toBeVisible()
  await expect(palette.locator('.hb-ai-palette-model')).toHaveText('claude-sonnet-5-5')
  await expect(palette.getByText('Ask about your Homebridge, its plugins or your accessories.')).toBeVisible()
  await expect(palette.getByRole('button', { name: 'New chat' })).toBeDisabled()

  const input = palette.getByRole('textbox', { name: 'Message the Assistant' })
  await input.fill('Which plugins do I have?')
  await input.press('Enter')

  const log = palette.getByRole('log')
  await expect(log.locator('.mp-ai-chat-msg.is-user')).toContainText('Which plugins do I have?')
  const answer = log.locator('.mp-ai-chat-msg.is-assistant')
  await expect(answer).toContainText('You have two plugins installed: Homebridge Mock Plugin and Homebridge Mock Plugin Two.')
  // Rendered as Markdown
  await expect(answer.locator('strong')).toHaveText('two')

  expect(chats).toHaveLength(1)
  expect(chats[0].body.messages).toEqual([{ role: 'user', content: 'Which plugins do I have?' }])
  expect(chats[0].body.context).toEqual({ route: '/scenes', page: 'scenes' })

  // Closed and opened again (Ctrl+K), the conversation is still there
  await palette.getByRole('button', { name: 'Close' }).first().click()
  await expect(palette).toBeHidden()
  await page.keyboard.press('Control+K')
  await expect(palette).toBeVisible()
  await expect(log.locator('.mp-ai-chat-msg.is-user')).toContainText('Which plugins do I have?')
  await expect(answer).toContainText('You have two plugins installed')

  // A follow-up carries the earlier turns
  await input.fill('And which are configured?')
  await input.press('Enter')
  await expect(log.locator('.mp-ai-chat-msg.is-assistant')).toHaveCount(2)
  expect(chats).toHaveLength(2)
  expect(chats[1].body.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user'])

  // New chat starts over, and the old conversation moves to the history
  await palette.getByRole('button', { name: 'New chat' }).click()
  await expect(log.locator('.mp-ai-chat-msg')).toHaveCount(0)
  await expect(palette.getByText('Ask about your Homebridge, its plugins or your accessories.')).toBeVisible()
  await palette.getByRole('button', { name: 'Recent conversations' }).click()
  await expect(palette.locator('.hb-ai-palette-history-title')).toHaveText(['Which plugins do I have?'])
})
