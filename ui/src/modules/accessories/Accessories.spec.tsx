import type { AccessoryRoom } from '@/core/accessories/accessories'
import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accessories } from '@/core/accessories/accessories'
import { useAuthStore } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { ws as realWs } from '@/core/ws'
import { Accessories } from '@/modules/accessories/Accessories'
import { AccessorySupport } from '@/modules/accessories/accessory-support/AccessorySupport'
import { AddRoom } from '@/modules/accessories/add-room/AddRoom'
import { EditRoom } from '@/modules/accessories/edit-room/EditRoom'
import { makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
// The tiles have their own routing spec
vi.mock('@/core/accessories/accessory-tile/AccessoryTile', () => ({
  AccessoryTile: ({ service }: { service: { uniqueId: string } }) => <div data-testid="tile">{service.uniqueId}</div>,
}))

const modal = modalModule as unknown as FakeOpenModal
const ws = realWs as unknown as FakeWs

/**
 * The accessories page.
 *
 * Two features overlap here in a way that caused #2790: a bridge filter that
 * hides tiles, and drag-and-drop reordering by index. The fix is that the two
 * are mutually exclusive - manage-layout mode shows everything and suspends the
 * filter, and picking a filter leaves manage-layout mode. The pure rules are in
 * `accessories-page.spec.ts`; this is about the page wiring them up.
 */
describe('accessories page', () => {
  let statusIo: FakeIoNamespace
  let childIo: FakeIoNamespace

  function makeService(overrides: Record<string, any> = {}): ServiceTypeX {
    return {
      uniqueId: 'service-1',
      hidden: false,
      serviceName: 'Lamp',
      instance: { username: '0E:11:11:11:11:11', name: 'Homebridge' },
      ...overrides,
    } as unknown as ServiceTypeX
  }

  const room = (name: string, overrides: Partial<AccessoryRoom> = {}): AccessoryRoom => ({
    name,
    isDefault: false,
    services: [],
    ...overrides,
  })

  interface OpenOptions {
    rooms?: AccessoryRoom[]
    availableBridges?: string[]
    selectedBridges?: string[] | null
    env?: Record<string, any>
    admin?: boolean
    childBridges?: Array<{ username: string, name: string }>
  }

  async function open(options: OpenOptions = {}) {
    useSettingsStore.setState(makeSettingsState({ env: options.env as never }))
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    accessories.store.setState({
      rooms: options.rooms ?? [],
      availableBridges: options.availableBridges ?? [],
      selectedBridges: options.selectedBridges ?? null,
    })
    childIo.socket.respondTo('get-homebridge-child-bridge-status', options.childBridges ?? [])
    const result = renderWithProviders(<Accessories />)
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
    return result
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  const tiles = () => screen.queryAllByTestId('tile').map(tile => tile.textContent)
  const addRoomButton = () => document.querySelector('button[aria-label="accessories.button_add_room"]') as HTMLButtonElement
  /** The desktop filter (the one with "manage layout"). */
  const filterToggle = () => screen.getAllByRole('button', { name: 'accessories.filter_by_bridge' }).at(-1)!

  function openFilter() {
    fireEvent.click(filterToggle())
  }

  function pick(label: string) {
    fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)!)
  }

  beforeEach(() => {
    statusIo = ws.namespace('status')
    childIo = ws.namespace('child-bridges')
    vi.spyOn(accessories, 'start').mockResolvedValue(undefined)
    vi.spyOn(accessories, 'stop').mockImplementation(() => {})
    vi.spyOn(accessories, 'saveLayout').mockImplementation(() => {})
    vi.spyOn(settingsActions, 'setPageTitle').mockImplementation(() => {})
    accessories.bridgeUsernameToNameMap.clear()
    modal.opened.length = 0
    modal.openModal.mockClear()
    ws.connectToNamespace.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('opening the page', () => {
    it('names itself in the page title', async () => {
      await open()

      expect(settingsActions.setPageTitle).toHaveBeenCalledWith('menu.label_accessories')
    })

    it('starts the accessory feed', async () => {
      await open()

      expect(accessories.start).toHaveBeenCalled()
    })

    it('shows every bridge the first time the page is opened', async () => {
      // A brand new user has never chosen a filter, and an empty selection
      // means nothing at all is shown
      await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: null })

      expect(accessories.selectedBridges()).toEqual(['Homebridge', 'Hue'])
    })

    it('keeps a filter the user chose earlier', async () => {
      // The selection lives on the service so it survives navigating away
      await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Hue'] })

      expect(accessories.selectedBridges()).toEqual(['Hue'])
    })

    it('starts with the layout locked', async () => {
      // Rooms and tiles are only draggable once the user asks for it
      await open({ rooms: [room('Kitchen', { services: [makeService()] })] })

      expect(addRoomButton()).toHaveAttribute('hidden')
      expect(screen.getByRole('button', { name: 'accessories.button_edit_room' })).toHaveClass('edit-room-hidden')
      expect(screen.getByText('Kitchen')).not.toHaveClass('cursor-move')
      expect(screen.getByText('Kitchen')).not.toHaveAttribute('role')
    })

    it('hides an empty room while locked', async () => {
      await open({ rooms: [room('Kitchen', { services: [makeService()] }), room('Empty')] })

      expect(screen.queryByText('Empty')).toBeNull()
      expect(screen.queryByText('accessories.control.drag_here')).toBeNull()
    })

    it('hides hidden accessories to begin with', async () => {
      await open({
        rooms: [room('Kitchen', { services: [makeService(), makeService({ uniqueId: 'hidden-1', hidden: true })] })],
        availableBridges: ['Homebridge'],
        selectedBridges: ['Homebridge'],
      })

      expect(tiles()).toEqual(['service-1'])
    })

    it('fills the last row with placeholders', async () => {
      const { container } = await open({ rooms: [room('Kitchen', { services: [makeService()] })] })

      expect(container.querySelectorAll('.services-bag .accessory-box-placeholder.no-drag')).toHaveLength(10)
    })

    it('offers the filter only when there is something to filter', async () => {
      const { unmount } = await open({ availableBridges: [] })
      expect(screen.queryByRole('button', { name: 'accessories.filter_by_bridge' })).toBeNull()
      unmount()

      await open({ availableBridges: ['Homebridge'] })
      expect(screen.getAllByRole('button', { name: 'accessories.filter_by_bridge' })).toHaveLength(2)
    })

    it('hides the filter when no plugins are installed', async () => {
      await open({ availableBridges: ['Homebridge'], env: { hasInstalledPlugins: false } })

      expect(screen.queryByRole('button', { name: 'accessories.filter_by_bridge' })).toBeNull()
      expect(screen.getByText('accessories.no_plugins.title')).toBeInTheDocument()
    })

    it('stops the feed and lets go of the sockets when the page closes', async () => {
      const { unmount } = await open()

      unmount()

      expect(accessories.stop).toHaveBeenCalled()
      expect(statusIo.end).toHaveBeenCalled()
      expect(childIo.end).toHaveBeenCalled()
      expect(childIo.socket.handlers('child-bridge-status-update')).toHaveLength(0)
      expect(statusIo.socket.handlers('homebridge-status')).toHaveLength(0)
    })
  })

  describe('manage layout mode', () => {
    const twoBridges = () => ({
      rooms: [room('Kitchen', {
        services: [
          makeService(),
          makeService({ uniqueId: 'hue-1', instance: { username: '0E:22', name: 'Hue' } }),
          makeService({ uniqueId: 'hidden-1', hidden: true }),
        ],
      })],
      availableBridges: ['Homebridge', 'Hue'],
      selectedBridges: ['Hue'],
    })

    it('unlocks the layout and shows absolutely everything', async () => {
      // The heart of #2790: the drag model and the DOM have to stay 1-to-1
      const { container } = await open(twoBridges())
      expect(tiles()).toEqual(['hue-1'])

      openFilter()
      pick('accessories.manage_layout')

      expect(tiles()).toEqual(['service-1', 'hue-1', 'hidden-1'])
      expect(addRoomButton()).not.toHaveAttribute('hidden')
      // No placeholders to drop between while rearranging
      expect(container.querySelectorAll('.accessory-box-placeholder')).toHaveLength(0)
      // The room title becomes the drag handle
      expect(screen.getByText('Kitchen')).toHaveClass('cursor-move')
      expect(screen.getByText('Kitchen')).toHaveAttribute('role', 'button')
    })

    it('shows no bridge as selected while rearranging', async () => {
      // The filter is suspended rather than changed
      await open(twoBridges())
      openFilter()
      pick('accessories.manage_layout')

      expect(screen.getAllByRole('button', { name: 'Hue' }).at(-1)).not.toHaveClass('active')
      expect(screen.getAllByRole('button', { name: 'accessories.manage_layout' }).at(-1)).toHaveClass('active')
    })

    it('puts the filter back when the user leaves it', async () => {
      await open(twoBridges())
      openFilter()
      pick('accessories.manage_layout')
      pick('accessories.manage_layout')

      expect(accessories.selectedBridges()).toEqual(['Hue'])
      expect(tiles()).toEqual(['hue-1'])
      expect(addRoomButton()).toHaveAttribute('hidden')
    })

    it('leaves manage mode when a bridge is picked from the filter', async () => {
      // Picking a filter is the user saying they are done rearranging
      await open(twoBridges())
      openFilter()
      pick('accessories.manage_layout')

      pick('Homebridge')

      expect(accessories.selectedBridges()).toEqual(['Homebridge'])
      expect(tiles()).toEqual(['service-1'])
      expect(addRoomButton()).toHaveAttribute('hidden')
    })

    it('leaves manage mode when all bridges are picked', async () => {
      await open(twoBridges())
      openFilter()
      pick('accessories.manage_layout')

      pick('accessories.filter_all_bridges')

      expect(accessories.selectedBridges()).toEqual(['Homebridge', 'Hue'])
      expect(addRoomButton()).toHaveAttribute('hidden')
    })

    it('does not restore the old filter when leaving through the filter', async () => {
      await open(twoBridges())
      openFilter()
      pick('accessories.manage_layout')
      pick('Homebridge')

      pick('accessories.manage_layout')
      pick('accessories.manage_layout')

      expect(accessories.selectedBridges()).toEqual(['Homebridge'])
    })
  })

  describe('the bridge filter', () => {
    it('adds and removes a bridge', async () => {
      await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Homebridge'] })
      openFilter()

      pick('Hue')
      expect(accessories.selectedBridges()).toEqual(['Homebridge', 'Hue'])

      pick('Homebridge')
      expect(accessories.selectedBridges()).toEqual(['Hue'])
    })

    it('ticks the selected bridges, and "all" when everything is shown', async () => {
      await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Homebridge', 'Hue'] })
      openFilter()

      expect(screen.getAllByRole('button', { name: 'accessories.filter_all_bridges' }).at(-1)).toHaveClass('active')
      expect(screen.getAllByRole('button', { name: 'Hue' }).at(-1)).toHaveClass('active')
    })

    it('unselects everything when all are already selected', async () => {
      await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Homebridge', 'Hue'] })
      openFilter()

      pick('accessories.filter_all_bridges')

      expect(accessories.selectedBridges()).toEqual([])
    })

    it('selects everything when only some are selected', async () => {
      await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Hue'] })
      openFilter()

      pick('accessories.filter_all_bridges')

      expect(accessories.selectedBridges()).toEqual(['Homebridge', 'Hue'])
    })

    it('stays open while picking, and closes from its close button', async () => {
      const { container } = await open({ availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Hue'] })
      openFilter()
      pick('Homebridge')

      expect(container.querySelectorAll('.dropdown-menu.show')).toHaveLength(1)

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' }).at(-1)!)
      expect(container.querySelectorAll('.dropdown-menu.show')).toHaveLength(0)
    })

    it('locks the layout again whenever the filter changes', async () => {
      // An unlocked layout plus an active filter is exactly the combination that
      // reorders the wrong accessory
      await open({ rooms: [room('Kitchen', { isDefault: true })], availableBridges: ['Homebridge', 'Hue'], selectedBridges: ['Hue'] })
      fireEvent.click(addRoomButton())
      modal.lastOpened()!.ref.close({ name: 'Hall', isDefault: false })
      await settle()
      expect(addRoomButton()).not.toHaveAttribute('hidden')

      openFilter()
      pick('Homebridge')

      expect(addRoomButton()).toHaveAttribute('hidden')
    })
  })

  describe('the hidden accessories toggle', () => {
    it('shows hidden accessories once asked', async () => {
      await open({
        rooms: [room('Kitchen', { isDefault: true, services: [makeService({ hidden: true })] })],
        availableBridges: ['Homebridge'],
        selectedBridges: ['Homebridge'],
      })
      fireEvent.click(addRoomButton())
      modal.lastOpened()!.ref.close({ name: 'Hall', isDefault: false })
      await settle()
      expect(tiles()).toEqual([])

      fireEvent.click(screen.getByRole('button', { name: 'accessories.button_hidden_show' }))

      expect(tiles()).toEqual(['service-1'])
      expect(screen.getByRole('button', { name: 'accessories.button_hidden_hide' })).toBeInTheDocument()
    })
  })

  describe('managing the rooms', () => {
    it('tells the add modal which rooms already exist, so it can refuse a duplicate', async () => {
      await open({ rooms: [room('Kitchen', { services: [makeService()] })] })

      fireEvent.click(addRoomButton())

      expect(modal.lastOpened()!.component).toBe(AddRoom)
      expect(modal.propsFor()!.existingRooms).toHaveLength(1)
      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })

    it('adds the room, saves the layout and unlocks the layout so it can be filled', async () => {
      await open({ rooms: [room('Kitchen', { isDefault: true, services: [makeService()] })] })

      fireEvent.click(addRoomButton())
      modal.lastOpened()!.ref.close({ name: 'Hall', isDefault: false })
      await settle()

      expect(accessories.rooms().map(r => r.name)).toEqual(['Kitchen', 'Hall'])
      expect(accessories.saveLayout).toHaveBeenCalled()
      expect(screen.getByText('accessories.control.drag_here')).toBeInTheDocument()
    })

    it('leaves the layout alone when the add modal is dismissed', async () => {
      await open({ rooms: [room('Kitchen', { services: [makeService()] })] })

      fireEvent.click(addRoomButton())
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(accessories.rooms()).toHaveLength(1)
      expect(accessories.saveLayout).not.toHaveBeenCalled()
    })

    it('tells the edit modal the room it is editing, and which one that is', async () => {
      await open({ rooms: [room('Kitchen', { services: [makeService()] }), room('Hall', { services: [makeService({ uniqueId: 'b' })] })] })

      fireEvent.click(screen.getAllByRole('button', { name: 'accessories.button_edit_room' })[1])

      expect(modal.lastOpened()!.component).toBe(EditRoom)
      expect(modal.propsFor()).toMatchObject({ roomName: 'Hall', isDefault: false, currentRoomIndex: 1 })
    })

    it('applies a rename and saves', async () => {
      const service = makeService()
      await open({ rooms: [room('Kitchen', { services: [service] })] })

      fireEvent.click(screen.getByRole('button', { name: 'accessories.button_edit_room' }))
      modal.lastOpened()!.ref.close({ name: 'Kitchenette', isDefault: false })
      await settle()

      expect(accessories.rooms()[0]).toMatchObject({ name: 'Kitchenette', services: [service] })
      expect(accessories.saveLayout).toHaveBeenCalled()
      expect(screen.getByText('Kitchenette')).toBeInTheDocument()
    })

    it('moves the accessories of a deleted room into the default room', async () => {
      // ⚠️ They would otherwise vanish from the page, and the layout would be
      // saved without them
      const service = makeService({ uniqueId: 'spare-1' })
      await open({ rooms: [room('Kitchen', { isDefault: true, services: [makeService()] }), room('Spare', { services: [service] })] })

      fireEvent.click(screen.getAllByRole('button', { name: 'accessories.button_edit_room' })[1])
      modal.lastOpened()!.ref.close({ delete: true })
      await settle()

      expect(accessories.rooms().map(r => r.name)).toEqual(['Kitchen'])
      expect(tiles()).toEqual(['service-1', 'spare-1'])
      expect(accessories.saveLayout).toHaveBeenCalled()
    })

    it('opens the support modal', async () => {
      await open()

      fireEvent.click(screen.getAllByRole('button', { name: 'support.title' })[0])

      expect(modal.lastOpened()!.component).toBe(AccessorySupport)
    })
  })

  describe('bridge names from the socket', () => {
    it('connects to both namespaces it needs and asks them for updates', async () => {
      // Bridge names come from the child-bridge feed, not from the accessory
      // data, so the page needs its own subscription
      await open()

      expect(ws.connectToNamespace).toHaveBeenCalledWith('status')
      expect(ws.connectToNamespace).toHaveBeenCalledWith('child-bridges')
      expect(statusIo.socket.payloadsFor('monitor-server-status')).not.toHaveLength(0)
      expect(childIo.socket.payloadsFor('monitor-child-bridge-status')).not.toHaveLength(0)
    })

    it('learns the child bridge names from the socket', async () => {
      // The name the user gave the bridge only exists on this feed, and it is
      // what the filter matches against
      await open({
        rooms: [room('Kitchen', { services: [makeService()] })],
        childBridges: [{ username: '0E:11:11:11:11:11', name: 'Kitchen Bridge' }],
        availableBridges: ['Kitchen Bridge'],
        selectedBridges: ['Kitchen Bridge'],
      })

      expect(accessories.bridgeUsernameToNameMap.get('0E:11:11:11:11:11')).toBe('Kitchen Bridge')
      expect(tiles()).toEqual(['service-1'])
    })

    it('picks up a bridge renamed while the page is open', async () => {
      await open()

      childIo.socket.fire('child-bridge-status-update', { username: '0E:11:11:11:11:11', name: 'Kitchen Bridge' })
      statusIo.socket.fire('homebridge-status', { username: '0E:00:00:00:00:00' })

      expect(accessories.bridgeUsernameToNameMap.get('0E:11:11:11:11:11')).toBe('Kitchen Bridge')
      expect(accessories.bridgeUsernameToNameMap.get('0E:00:00:00:00:00')).toBe('Homebridge')
    })

    it('re-reads the available bridges when the accessories change', async () => {
      // A plugin restarting adds and removes bridges, so the filter list cannot
      // be worked out once at startup
      await open({ rooms: [room('Kitchen', { services: [makeService()] })] })

      act(() => {
        accessories.accessoryData.emit([])
      })

      expect(accessories.availableBridges()).toEqual(['Homebridge'])
      expect(accessories.selectedBridges()).toEqual(['Homebridge'])
      expect(screen.getAllByRole('button', { name: 'accessories.filter_by_bridge' })).toHaveLength(2)
    })

    it('stops re-reading them once the page has closed', async () => {
      const { unmount } = await open({ rooms: [room('Kitchen', { services: [makeService()] })] })
      unmount()

      accessories.accessoryData.emit([])

      expect(accessories.availableBridges()).toEqual([])
    })
  })

  describe('when accessory control is switched off', () => {
    it('says so, with the settings hint for an admin', async () => {
      await open({ env: { enableAccessories: false } })

      expect(screen.getByText('accessories.control_disabled')).toBeInTheDocument()
      expect(screen.getByText('accessories.settings_link')).toBeInTheDocument()
    })

    it('leaves the settings hint out for a non-admin', async () => {
      await open({ env: { enableAccessories: false }, admin: false })

      expect(screen.queryByText('accessories.settings_link')).toBeNull()
    })
  })
})
