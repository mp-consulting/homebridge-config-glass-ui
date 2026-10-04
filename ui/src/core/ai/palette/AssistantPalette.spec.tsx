import type { AiStatus } from '@/core/ai/ai.interfaces'
import type { FakeApi, FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiActions } from '@/core/ai/ai.store'
import { AiHost } from '@/core/ai/AiHost'
import { AssistantPalette } from '@/core/ai/palette/AssistantPalette'
import { useAuthStore } from '@/core/auth'
import * as modalModule from '@/core/ui/modal'
import { ws as realWs } from '@/core/ws'
import { activeModalStub, fakeApi, makeAuthState, makeUser, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const ws = realWs as unknown as FakeWs
const modal = modalModule as unknown as FakeOpenModal

const ENABLED: AiStatus = {
  enabled: true,
  reason: null,
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  capabilities: { tools: true, streaming: true, contextTokens: 200000, jsonMode: false },
  usage: { total: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 }, byModel: {} },
}

describe('assistant palette', () => {
  let io: FakeIoNamespace

  const send = (text: string) => {
    fireEvent.change(screen.getByLabelText('ai.palette.input'), { target: { value: text } })
    fireEvent.keyDown(screen.getByLabelText('ai.palette.input'), { key: 'Enter' })
    return io.requests.at(-1)!.payload
  }

  beforeEach(() => {
    ws.namespaces.clear()
    io = ws.namespace('ai')
    io.socket.respondTo('chat', (payload: any) => ({ requestId: payload.requestId, accepted: true }))
    useAuthStore.setState(makeAuthState({ user: makeUser({ admin: true }) }))
    aiActions.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the conversation and streams the answer with tool chips', async () => {
    renderWithProviders(<AssistantPalette activeModal={activeModalStub() as any} />)
    expect(screen.getByLabelText('ai.palette.input')).toHaveFocus()

    const { requestId, body } = send('How many lights are on?')
    expect(body).toEqual({ messages: [{ role: 'user', content: 'How many lights are on?' }] })
    expect(screen.getByText('How many lights are on?')).toBeInTheDocument()

    act(() => {
      io.socket.fire('ai:tool', { requestId, phase: 'call', id: 't1', name: 'list_accessories', arguments: {} })
    })
    expect(screen.getByText('list_accessories')).toBeInTheDocument()
    expect(screen.getByText('ai.chat.tool_running')).toBeInTheDocument()

    act(() => {
      io.socket.fire('ai:tool', { requestId, phase: 'result', id: 't1', name: 'list_accessories', isError: false })
      io.socket.fire('ai:chunk', { requestId, delta: 'Three lights are on.' })
    })
    expect(screen.getByText('ai.chat.tool_done')).toBeInTheDocument()

    await act(async () => {
      io.socket.fire('ai:done', { requestId, result: { text: 'Three lights are on.', toolCalls: [], truncated: false, readOnly: false } })
    })
    expect(screen.getByText('Three lights are on.')).toBeInTheDocument()

    // The next question carries the history
    const next = send('And off?')
    expect(next.body.messages).toEqual([
      { role: 'user', content: 'How many lights are on?' },
      { role: 'assistant', content: 'Three lights are on.' },
      { role: 'user', content: 'And off?' },
    ])
  })

  it('asks before a destructive tool, focused on Deny, and sends the answer', async () => {
    renderWithProviders(<AssistantPalette activeModal={activeModalStub() as any} />)
    const { requestId } = send('Restart Homebridge')

    act(() => {
      io.socket.fire('ai:confirm', { requestId, confirmId: 'c1', tool: { name: 'restart_homebridge', arguments: {} }, timeoutMs: 60000 })
    })
    const dialog = screen.getByRole('alertdialog', { name: 'ai.confirm.title' })
    expect(dialog).toHaveTextContent('restart_homebridge')
    expect(screen.getByRole('button', { name: 'ai.confirm.deny' })).toHaveFocus()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ai.confirm.allow' }))
    })
    expect(io.socket.payloadsFor('confirm')).toEqual([{ requestId, confirmId: 'c1', allow: true }])
    expect(screen.queryByRole('alertdialog')).toBeNull()

    act(() => {
      io.socket.fire('ai:confirm', { requestId, confirmId: 'c2', tool: { name: 'uninstall_plugin', arguments: { name: 'homebridge-x' } }, timeoutMs: 60000 })
    })
    expect(screen.getByLabelText('ai.confirm.arguments')).toHaveTextContent('homebridge-x')
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    })
    expect(io.socket.payloadsFor('confirm').at(-1)).toEqual({ requestId, confirmId: 'c2', allow: false })
  })

  it('drops the question when the server stops waiting', () => {
    renderWithProviders(<AssistantPalette activeModal={activeModalStub() as any} />)
    const { requestId } = send('Restart')
    act(() => {
      io.socket.fire('ai:confirm', { requestId, confirmId: 'c1', tool: { name: 'restart_homebridge', arguments: {} }, timeoutMs: 60000 })
    })
    act(() => {
      io.socket.fire('ai:confirm-expired', { requestId, confirmId: 'c1' })
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('tells a non-admin it is read-only', () => {
    useAuthStore.setState(makeAuthState({ user: makeUser({ admin: false }) }))
    renderWithProviders(<AssistantPalette activeModal={activeModalStub() as any} />)
    expect(screen.getByText('ai.palette.read_only')).toBeInTheDocument()
    expect(screen.getByText('ai.palette.hint_read_only')).toBeInTheDocument()
  })

  it('shows an error from the server in the conversation', async () => {
    renderWithProviders(<AssistantPalette activeModal={activeModalStub() as any} />)
    const { requestId } = send('hi')
    await act(async () => {
      io.socket.fire('ai:error', { requestId, message: 'Too many Assistant requests.', status: 429 })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Too many Assistant requests.')
  })
})

describe('assistant host', () => {
  let api: FakeApi

  beforeEach(() => {
    modal.opened.length = 0
    modal.openModal.mockClear()
    aiActions.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mount(status: AiStatus) {
    api = fakeApi().respond('get', '/ai/status', status)
    const result = renderWithProviders(<AiHost />)
    await act(async () => {})
    return result
  }

  it('opens the palette on Cmd/Ctrl+K once the Assistant is on', async () => {
    await mount(ENABLED)
    expect(api.callsTo('get', '/ai/status')).toHaveLength(1)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(modal.openModal).toHaveBeenCalledTimes(1)
    // Already open: a second press does not stack another one
    fireEvent.keyDown(window, { key: 'K', metaKey: true })
    expect(modal.openModal).toHaveBeenCalledTimes(1)
  })

  it('leaves Cmd/Ctrl+K alone while the Assistant is off', async () => {
    await mount({ ...ENABLED, enabled: false, reason: 'disabled' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(modal.openModal).not.toHaveBeenCalled()
  })

  it('shows the page-edge halo while a request runs', async () => {
    const { container } = await mount({ ...ENABLED, enabled: false, reason: 'disabled' })
    expect(container.querySelector('.mp-ai-edge-glow')).toBeNull()
    let end = () => {}
    act(() => {
      end = aiActions.beginRun()
    })
    expect(container.querySelector('.mp-ai-edge-glow')).toHaveAttribute('aria-hidden', 'true')
    act(() => end())
    expect(container.querySelector('.mp-ai-edge-glow')).toBeNull()
  })
})
