import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderAiMarkdown } from '@/core/ai/ai-markdown'
import { aiActions, useAiStore } from '@/core/ai/ai.store'
import { DiagnoseDrawer } from '@/core/ai/diagnose/DiagnoseDrawer'
import { ws as realWs } from '@/core/ws'
import { activeModalStub, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))

const ws = realWs as unknown as FakeWs

/** The requestId of the last request sent on the `ai` namespace. */
function lastRequest(io: FakeIoNamespace) {
  return io.requests.at(-1)!
}

describe('log doctor drawer', () => {
  let io: FakeIoNamespace

  beforeEach(() => {
    ws.namespaces.clear()
    io = ws.namespace('ai')
    io.socket.respondTo('diagnose-logs', (payload: any) => ({ requestId: payload.requestId, accepted: true }))
    aiActions.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts diagnosing on open and streams the answer as markdown', async () => {
    const activeModal = activeModalStub()
    renderWithProviders(<DiagnoseDrawer activeModal={activeModal as any} focus="Ring" />)

    const request = lastRequest(io)
    expect(request.resource).toBe('diagnose-logs')
    expect(request.payload.body).toEqual({ focus: 'Ring' })
    expect(screen.getByText('ai.thinking')).toBeInTheDocument()
    // The page-edge glow runs while the request does
    expect(useAiStore.getState().running).toBe(1)

    const { requestId } = request.payload
    act(() => {
      io.socket.fire('ai:chunk', { requestId, delta: '**Ring** cannot ' })
      io.socket.fire('ai:chunk', { requestId: 'someone-else', delta: 'ignored' })
      io.socket.fire('ai:chunk', { requestId, delta: 'log in.' })
    })
    expect(screen.getByText('Ring').tagName).toBe('STRONG')
    expect(screen.queryByText(/ignored/)).toBeNull()
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      io.socket.fire('ai:done', { requestId, result: { text: '**Ring** cannot log in.', lines: 10 } })
    })
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByText('ai.disclaimer')).toBeInTheDocument()
    expect(useAiStore.getState().running).toBe(0)
    expect(io.end).toHaveBeenCalled()
  })

  it('shows a server error', async () => {
    renderWithProviders(<DiagnoseDrawer activeModal={activeModalStub() as any} />)
    const { requestId } = lastRequest(io).payload
    await act(async () => {
      io.socket.fire('ai:error', { requestId, message: 'The Assistant is not enabled.', status: 409 })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('The Assistant is not enabled.')
  })

  it('cancels on the server when the user stops it', async () => {
    renderWithProviders(<DiagnoseDrawer activeModal={activeModalStub() as any} />)
    const { requestId } = lastRequest(io).payload
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_cancel' }))
    })
    expect(io.socket.payloadsFor('cancel')).toContainEqual({ requestId })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks again with a new focus', async () => {
    renderWithProviders(<DiagnoseDrawer activeModal={activeModalStub() as any} />)
    const first = lastRequest(io).payload.requestId
    await act(async () => {
      io.socket.fire('ai:done', { requestId: first, result: { text: 'ok' } })
    })
    fireEvent.change(screen.getByLabelText('ai.log_doctor.focus'), { target: { value: 'Hue' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ai.log_doctor.diagnose/ }))
    })
    expect(lastRequest(io).payload.body).toEqual({ focus: 'Hue' })
    expect(lastRequest(io).payload.requestId).not.toBe(first)
  })
})

describe('assistant markdown', () => {
  it('shows raw HTML from the model as text', () => {
    const html = renderAiMarkdown('Hi <img src=x onerror="alert(1)"> <script>alert(2)</script>')
    const div = document.createElement('div')
    div.innerHTML = html
    expect(div.querySelector('img')).toBeNull()
    expect(div.querySelector('script')).toBeNull()
    expect(div.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('keeps markdown and makes links safe', () => {
    const div = document.createElement('div')
    div.innerHTML = renderAiMarkdown('# Title\n\n- `code`\n\n[docs](https://homebridge.io) [bad](javascript:alert(1)) ![img](https://evil/x.png)')
    expect(div.querySelector('h1')?.textContent).toBe('Title')
    expect(div.querySelector('code')?.textContent).toBe('code')
    const links = [...div.querySelectorAll('a')]
    expect(links[0]).toHaveAttribute('href', 'https://homebridge.io')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
    expect(links[1].getAttribute('href')).toBe('#')
    expect(div.querySelector('img')).toBeNull()
  })
})
