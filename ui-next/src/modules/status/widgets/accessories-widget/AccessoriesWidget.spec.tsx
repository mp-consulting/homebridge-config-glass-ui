import type { Mock } from 'vitest'

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessoriesWidget } from '@/modules/status/widgets/accessories-widget/AccessoriesWidget'
import { canStartDrag } from '@/modules/status/widgets/accessories-widget/accessory-drag'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'

const fakes = vi.hoisted(() => {
  class Emitter {
    listeners = new Set<(value: any) => void>()
    next(value?: any) {
      for (const listener of this.listeners) {
        listener(value)
      }
    }

    subscribe(listener: (value: any) => void) {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    }
  }
  return {
    rooms: [] as any[],
    accessoryData: new Emitter(),
    layoutSaved: new Emitter(),
    start: undefined as any,
    stop: undefined as any,
    mobile: false,
    dndContext: undefined as any,
    sortable: [] as any[],
  }
})

vi.mock('@/core/accessories/accessories', () => ({
  accessories: {
    rooms: () => fakes.rooms,
    accessoryData: fakes.accessoryData,
    layoutSaved: fakes.layoutSaved,
    start: (...args: any[]) => fakes.start(...args),
    stop: (...args: any[]) => fakes.stop(...args),
  },
}))

// The accessory tiles have their own routing spec
vi.mock('@/core/accessories/accessory-tile/AccessoryTile', () => ({
  AccessoryTile: ({ service }: any) => <div data-testid="tile">{service.uniqueId}</div>,
}))

vi.mock('@/core/utilities/mobile-detect', () => ({
  mobileDetect: { detect: { mobile: () => (fakes.mobile ? 'iPhone' : null) } },
}))

// A drag cannot be performed in jsdom, so the drop handler and the per-tile
// options are captured and driven directly
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: any) => {
      fakes.dndContext = props
      return <actual.DndContext {...props} />
    },
  }
})
vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>()
  return {
    ...actual,
    useSortable: (args: any) => {
      fakes.sortable.push(args)
      return actual.useSortable(args)
    },
  }
})

describe('the accessories widget', () => {
  let saveWidgets: Mock<(...args: any[]) => any>

  function makeRoom(services: any[]) {
    return { name: 'Default Room', isDefault: true, services }
  }

  function makeAccessory(uniqueId: string, onDashboard = true, extra: Record<string, any> = {}) {
    return { uniqueId, onDashboard, serviceName: uniqueId, type: 'Switch', ...extra }
  }

  async function open(widget: Record<string, any> = {}, rooms: any[] = []) {
    fakes.rooms = rooms
    saveWidgets = vi.fn()
    const result = render(
      <AccessoriesWidget
        widget={{ component: 'AccessoriesWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, ...widget }}
        resizeEvent={createWidgetEvent()}
        configureEvent={createWidgetEvent()}
        updateWidget={vi.fn()}
        saveWidgets={saveWidgets}
      />,
    )
    await act(async () => {})
    return result
  }

  const tiles = () => screen.queryAllByTestId('tile').map(el => el.textContent)

  beforeEach(() => {
    fakes.mobile = false
    fakes.dndContext = undefined
    fakes.sortable = []
    fakes.accessoryData.listeners.clear()
    fakes.layoutSaved.listeners.clear()
    fakes.start = vi.fn(async () => undefined)
    fakes.stop = vi.fn()
  })

  it('shows only the accessories pinned to the dashboard', async () => {
    await open({}, [makeRoom([makeAccessory('a'), makeAccessory('b', false), makeAccessory('c')])])

    await act(async () => fakes.accessoryData.next([]))

    expect(tiles()).toEqual(['a', 'c'])
    expect(fakes.start).toHaveBeenCalled()
  })

  it('shows nothing, not the help text, before the first data', async () => {
    await open({}, [])

    expect(screen.queryByText('status.widget.accessories.choose_accessories')).toBeNull()
  })

  it('says how to pin accessories when none are', async () => {
    await open({}, [makeRoom([makeAccessory('a', false)])])

    await act(async () => fakes.accessoryData.next([]))

    expect(screen.getByText('status.widget.accessories.choose_accessories')).toBeInTheDocument()
  })

  it('leaves out hidden accessories', async () => {
    await open({}, [makeRoom([makeAccessory('a'), makeAccessory('b', true, { hidden: true })])])

    await act(async () => fakes.accessoryData.next([]))

    expect(tiles()).toEqual(['a'])
  })

  it('gathers them from every room', async () => {
    await open({}, [makeRoom([makeAccessory('a')]), { name: 'Kitchen', services: [makeAccessory('b')] }])

    await act(async () => fakes.accessoryData.next([]))

    // The widget is a flat list; the rooms are a page concept
    expect(tiles()).toEqual(['a', 'b'])
  })

  it('honours the order the user dragged them into', async () => {
    await open({ accessoryOrder: ['c', 'a', 'b'] }, [makeRoom([makeAccessory('a'), makeAccessory('b'), makeAccessory('c')])])

    await act(async () => fakes.accessoryData.next([]))

    expect(tiles()).toEqual(['c', 'a', 'b'])
  })

  it('re-reads the list when the layout is saved elsewhere', async () => {
    await open({}, [makeRoom([makeAccessory('a')])])

    await act(async () => fakes.layoutSaved.next(undefined))

    // Pinning an accessory on the accessories page has to show up here
    expect(tiles()).toEqual(['a'])
  })

  it('saves the new order after a drag', async () => {
    await open({}, [makeRoom([makeAccessory('a'), makeAccessory('b'), makeAccessory('c')])])
    await act(async () => fakes.accessoryData.next([]))

    await act(async () => fakes.dndContext.onDragEnd({ active: { id: 'c' }, over: { id: 'a' } }))

    // The order lives on the widget config, which the dashboard persists
    expect(saveWidgets).toHaveBeenCalledWith({ accessoryOrder: ['c', 'a', 'b'] })
    expect(tiles()).toEqual(['c', 'a', 'b'])
  })

  it('saves nothing for a drop back where it started', async () => {
    await open({}, [makeRoom([makeAccessory('a'), makeAccessory('b')])])
    await act(async () => fakes.accessoryData.next([]))

    await act(async () => fakes.dndContext.onDragEnd({ active: { id: 'a' }, over: { id: 'a' } }))
    await act(async () => fakes.dndContext.onDragEnd({ active: { id: 'a' }, over: null }))

    expect(saveWidgets).not.toHaveBeenCalled()
  })

  it('does not allow dragging on a phone', async () => {
    fakes.mobile = true
    await open({}, [makeRoom([makeAccessory('a')])])
    await act(async () => fakes.accessoryData.next([]))

    // A drag gesture on a touch screen is indistinguishable from a scroll
    expect(fakes.sortable.at(-1).disabled).toBe(true)
    expect(canStartDrag(document.createElement('div'), true)).toBe(false)
  })

  it('allows dragging on a desktop', async () => {
    await open({}, [makeRoom([makeAccessory('a')])])
    await act(async () => fakes.accessoryData.next([]))

    expect(fakes.sortable.at(-1).disabled).toBe(false)
    expect(canStartDrag(document.createElement('div'), false)).toBe(true)
  })

  it('refuses to drag a tile marked no-drag', () => {
    const tile = document.createElement('div')
    tile.classList.add('no-drag')
    const inner = document.createElement('span')
    tile.appendChild(inner)

    expect(canStartDrag(tile, false)).toBe(false)
    expect(canStartDrag(inner, false)).toBe(false)
  })

  it('stops the feed when removed', async () => {
    const { unmount } = await open({}, [makeRoom([makeAccessory('a')])])

    unmount()

    expect(fakes.stop).toHaveBeenCalled()
    expect(fakes.accessoryData.listeners.size).toBe(0)
    expect(fakes.layoutSaved.listeners.size).toBe(0)
  })
})
