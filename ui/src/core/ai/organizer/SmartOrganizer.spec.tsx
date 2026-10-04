import type { FakeApi, FakeIoNamespace, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aiActions, useAiStore } from '@/core/ai/ai.store'
import { SmartOrganizer } from '@/core/ai/organizer/SmartOrganizer'
import { ws as realWs } from '@/core/ws'
import { activeModalStub, fakeApi, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))

const ws = realWs as unknown as FakeWs

const ACCESSORIES = [
  { uniqueId: 'a1', name: 'Light 1', type: 'Lightbulb', room: 'Default Room' },
  { uniqueId: 'a2', name: 'Hall Lamp', type: 'Lightbulb', room: 'Hall' },
]

describe('smart organiser', () => {
  let io: FakeIoNamespace
  let api: FakeApi

  /** The requestId of the organiser's request. */
  function requestId(): string {
    return io.requests.at(-1)!.payload.requestId
  }

  async function fire(event: string, payload: Record<string, unknown>) {
    await act(async () => {
      io.socket.fire(event, { requestId: requestId(), ...payload })
    })
  }

  beforeEach(() => {
    api = fakeApi()
    ws.namespaces.clear()
    io = ws.namespace('ai')
    io.socket.respondTo('organize', (payload: any) => ({ requestId: payload.requestId, accepted: true }))
    aiActions.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks over the ai socket, not over HTTP, without sending any accessories or rooms', async () => {
    renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)

    const request = io.requests.at(-1)!
    expect(request.resource).toBe('organize')
    expect(request.payload.body).toEqual({})
    expect(api.callsTo('post', '/ai/organize')).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('ai.organizer.thinking')
    expect(useAiStore.getState().running).toBe(1)

    await fire('ai:done', { result: { rooms: [], renames: [], orphans: [] } })
    expect(screen.getByText('ai.organizer.nothing')).toBeInTheDocument()
    expect(useAiStore.getState().running).toBe(0)
    expect(io.end).toHaveBeenCalled()
  })

  it('shows how many batches are done while a large installation is organised', async () => {
    renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)

    await fire('ai:progress', { done: 0, total: 1 })
    expect(screen.getByRole('status')).toHaveTextContent('ai.organizer.thinking')
    await fire('ai:progress', { done: 1, total: 3 })
    expect(screen.getByRole('status')).toHaveTextContent('ai.organizer.progress')
    // Another request's progress is not this one's
    await act(async () => {
      io.socket.fire('ai:progress', { requestId: 'someone-else', done: 0, total: 1 })
    })
    expect(screen.getByRole('status')).toHaveTextContent('ai.organizer.progress')
  })

  it('lists only the real changes, all ticked, and returns the kept ones', async () => {
    const activeModal = activeModalStub()
    renderWithProviders(<SmartOrganizer activeModal={activeModal as any} accessories={ACCESSORIES} />)
    await fire('ai:done', {
      result: {
        rooms: [{ name: 'Kitchen', accessories: ['a1'] }, { name: 'Hall', accessories: ['a2'] }],
        renames: [{ uniqueId: 'a1', name: 'Kitchen Light' }, { uniqueId: 'unknown', name: 'x' }],
        orphans: [],
      },
    })

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: 'ai.organizer.apply' }))

    expect(activeModal.close).toHaveBeenCalledWith({ moves: [{ uniqueId: 'a1', room: 'Kitchen' }], renames: [] })
  })

  it('shows the server\'s error, such as a reply cut off at the output limit', async () => {
    renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)
    await fire('ai:error', { message: 'The answer was cut off at the 2048-token output limit.', status: 502 })

    expect(screen.getByRole('alert')).toHaveTextContent('The answer was cut off at the 2048-token output limit.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a request the server refused', async () => {
    io.socket.respondTo('organize', { error: 'Forbidden', status: 403 })
    renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)
    await act(async () => {})

    expect(screen.getByRole('alert')).toHaveTextContent('Forbidden')
  })

  it('cancels on the server when the modal closes', async () => {
    const { unmount } = renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)
    const id = requestId()

    await act(async () => {
      unmount()
    })

    expect(io.socket.payloadsFor('cancel')).toContainEqual({ requestId: id })
    expect(useAiStore.getState().running).toBe(0)
  })
})
