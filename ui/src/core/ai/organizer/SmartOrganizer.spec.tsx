import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SmartOrganizer } from '@/core/ai/organizer/SmartOrganizer'
import { activeModalStub, apiError, fakeApi, renderWithProviders } from '@/testing'

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  })
}

const ACCESSORIES = [
  { uniqueId: 'a1', name: 'Light 1', type: 'Lightbulb', room: 'Default Room' },
  { uniqueId: 'a2', name: 'Hall Lamp', type: 'Lightbulb', room: 'Hall' },
]

describe('smart organiser', () => {
  let api: FakeApi

  beforeEach(() => {
    api = fakeApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks the server without sending any accessories or rooms', async () => {
    api.respond('post', '/ai/organize', { rooms: [], renames: [], orphans: [] })
    renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)
    await settle()

    const calls = api.callsTo('post', '/ai/organize')
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({})
    expect(screen.getByText('ai.organizer.nothing')).toBeInTheDocument()
  })

  it('lists only the real changes, all ticked, and returns the kept ones', async () => {
    api.respond('post', '/ai/organize', {
      rooms: [{ name: 'Kitchen', accessories: ['a1'] }, { name: 'Hall', accessories: ['a2'] }],
      renames: [{ uniqueId: 'a1', name: 'Kitchen Light' }, { uniqueId: 'unknown', name: 'x' }],
      orphans: [],
    })
    const activeModal = activeModalStub()
    renderWithProviders(<SmartOrganizer activeModal={activeModal as any} accessories={ACCESSORIES} />)
    await settle()

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: 'ai.organizer.apply' }))

    expect(activeModal.close).toHaveBeenCalledWith({ moves: [{ uniqueId: 'a1', room: 'Kitchen' }], renames: [] })
  })

  it('shows the server error', async () => {
    api.fail('post', '/ai/organize', apiError('There are no accessories to organise.', 400))
    renderWithProviders(<SmartOrganizer activeModal={activeModalStub() as any} accessories={ACCESSORIES} />)
    await settle()

    expect(screen.getByRole('alert')).toHaveTextContent('There are no accessories to organise.')
  })
})
