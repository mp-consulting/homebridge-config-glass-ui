import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/testing'

import { favouritesOf } from './favourites'
import { QuickControls } from './QuickControls'

const fakes = vi.hoisted(() => {
  const emitter = () => {
    const listeners = new Set<() => void>()
    return {
      next: () => listeners.forEach(listener => listener()),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }
  return { rooms: [] as any[], accessoryData: emitter(), layoutSaved: emitter(), start: vi.fn(async () => undefined), stop: vi.fn() }
})

vi.mock('@/core/accessories/accessories', () => ({
  accessories: {
    rooms: () => fakes.rooms,
    accessoryData: fakes.accessoryData,
    layoutSaved: fakes.layoutSaved,
    start: () => fakes.start(),
    stop: () => fakes.stop(),
  },
}))

vi.mock('@/core/accessories/accessory-tile/AccessoryTile', () => ({
  AccessoryTile: ({ service }: any) => <div data-testid="tile">{service.uniqueId}</div>,
}))

const service = (uniqueId: string, extra: Record<string, unknown> = {}) => ({ uniqueId, onDashboard: true, hidden: false, ...extra })

describe('the quick controls page', () => {
  beforeEach(() => {
    fakes.rooms = []
    fakes.start.mockClear()
    fakes.stop.mockClear()
  })

  async function open() {
    const view = renderWithProviders(<QuickControls />)
    await act(async () => {})
    return view
  }

  it('shows the favourite accessories by room, as live tiles', async () => {
    fakes.rooms = [
      { name: 'Kitchen', services: [service('lamp'), service('fan', { onDashboard: false })] },
      { name: 'Garage', services: [service('door', { hidden: true })] },
      { name: 'Hall', services: [service('light')] },
    ]
    await open()
    act(() => fakes.accessoryData.next())

    expect(screen.getAllByTestId('tile').map(tile => tile.textContent)).toEqual(['lamp', 'light'])
    expect(screen.getByRole('region', { name: 'Kitchen' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Garage' })).toBeNull()
    expect(fakes.start).toHaveBeenCalled()
  })

  it('explains how to add favourites when there are none', async () => {
    await open()
    act(() => fakes.accessoryData.next())

    expect(screen.getByText('quick.none')).toBeInTheDocument()
  })

  it('stops the accessory connection when it closes', async () => {
    const { unmount } = await open()
    unmount()

    expect(fakes.stop).toHaveBeenCalled()
  })

  it('keeps only favourites that are not hidden', () => {
    expect(favouritesOf([{ name: 'A', services: [service('x', { hidden: true })] as any }])).toEqual([])
  })
})
