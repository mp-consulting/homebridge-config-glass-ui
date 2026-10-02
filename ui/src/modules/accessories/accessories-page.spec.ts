import type { AccessoryRoom } from '@/core/accessories/accessories'
import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { DisplayFilter } from '@/modules/accessories/accessories-page'

import { describe, expect, it } from 'vitest'

import {
  addRoom,
  computeAvailableBridges,
  editRoom,
  moveRoom,
  moveService,
  roomDragId,
  serviceDragId,
  shouldDisplayService,
} from '@/modules/accessories/accessories-page'

/**
 * The page rules that do not need React (Angular's `accessories.component.spec.ts`
 * cases about filtering, the bridge list and the room modals' results).
 *
 * Two features overlap here in a way that caused #2790: a bridge filter that
 * hides tiles, and drag-and-drop reordering by index. With tiles hidden, the
 * model and DOM indexes no longer line up, and a drop moves an accessory the
 * user was not touching. Manage-layout mode therefore shows everything.
 */
function makeService(overrides: Record<string, any> = {}): ServiceTypeX {
  return {
    uniqueId: 'service-1',
    hidden: false,
    instance: { username: '0E:11:11:11:11:11', name: 'Homebridge' },
    ...overrides,
  } as unknown as ServiceTypeX
}

function filter(overrides: Partial<DisplayFilter> = {}): DisplayFilter {
  return {
    manageLayoutMode: false,
    hideHidden: true,
    selectedBridges: ['Homebridge'],
    bridgeNames: new Map(),
    ...overrides,
  }
}

function room(name: string, overrides: Partial<AccessoryRoom> = {}): AccessoryRoom {
  return {
    name,
    isDefault: false,
    services: [],
    ...overrides,
  }
}

describe('the accessories page rules', () => {
  describe('deciding which tiles to show', () => {
    it('shows an accessory from a selected bridge', () => {
      expect(shouldDisplayService(makeService(), filter())).toBe(true)
    })

    it('hides an accessory from a bridge that is filtered out', () => {
      expect(shouldDisplayService(makeService(), filter({ selectedBridges: ['Hue'] }))).toBe(false)
    })

    it('hides everything when no bridge is selected', () => {
      expect(shouldDisplayService(makeService(), filter({ selectedBridges: [] }))).toBe(false)
    })

    it('shows everything before a filter has been decided', () => {
      expect(shouldDisplayService(makeService(), filter({ selectedBridges: null }))).toBe(true)
    })

    it('matches on the custom bridge name rather than the reported one', () => {
      // The name in the filter is what the user renamed the bridge to; the
      // accessory only knows the original
      const names = new Map([['0E:11:11:11:11:11', 'Kitchen Bridge']])

      expect(shouldDisplayService(makeService(), filter({ selectedBridges: ['Kitchen Bridge'], bridgeNames: names }))).toBe(true)
    })

    it('hides a hidden accessory', () => {
      expect(shouldDisplayService(makeService({ hidden: true }), filter())).toBe(false)
    })

    it('shows a hidden accessory once the user asks for it', () => {
      expect(shouldDisplayService(makeService({ hidden: true }), filter({ hideHidden: false }))).toBe(true)
    })

    it('shows an accessory with no bridge of its own', () => {
      // Nothing to filter it by, so filtering it out would make it unreachable
      expect(shouldDisplayService(makeService({ instance: undefined }), filter({ selectedBridges: [] }))).toBe(true)
    })

    it('shows absolutely everything in manage layout mode', () => {
      // The heart of #2790: the drag model and the DOM have to stay 1-to-1
      const managing = filter({ manageLayoutMode: true, selectedBridges: ['Hue'] })

      expect(shouldDisplayService(makeService(), managing)).toBe(true)
      expect(shouldDisplayService(makeService({ hidden: true }), managing)).toBe(true)
    })
  })

  /**
   * ⚠️ **The bridge names arrive after the accessories do.** They come over a
   * separate socket, so an early pass sees fewer bridges than the last one — and
   * shrinking the list would deselect bridges the user is filtering by. The list
   * therefore only ever grows.
   */
  describe('the list of bridges to filter by', () => {
    const service = (username: string, name: string) => makeService({ instance: { username, name } })
    const kitchen = (services: ServiceTypeX[]) => [room('Kitchen', { isDefault: true, services })]

    it('lists the bridge each accessory belongs to', () => {
      const update = computeAvailableBridges(kitchen([service('0E:11', 'Homebridge'), service('0E:22', 'Kitchen Bridge')]), new Map(), [], null)

      expect(update?.availableBridges).toEqual(['Homebridge', 'Kitchen Bridge'])
    })

    it('puts homebridge itself first, then the rest by name', () => {
      const update = computeAvailableBridges(kitchen([
        service('0E:33', 'Zebra Bridge'),
        service('0E:11', 'Homebridge'),
        service('0E:22', 'Apple Bridge'),
      ]), new Map(), [], null)

      expect(update?.availableBridges).toEqual(['Homebridge', 'Apple Bridge', 'Zebra Bridge'])
    })

    it('prefers the name the user gave a bridge in the config', () => {
      const update = computeAvailableBridges(kitchen([service('0E:22', 'homebridge-example')]), new Map([['0E:22', 'My Own Name']]), [], null)

      expect(update?.availableBridges).toEqual(['My Own Name'])
    })

    it('lists a bridge once however many accessories it has', () => {
      const update = computeAvailableBridges(kitchen([service('0E:11', 'Homebridge'), service('0E:11', 'Homebridge')]), new Map(), [], null)

      expect(update?.availableBridges).toEqual(['Homebridge'])
    })

    it('ignores an accessory with no bridge attached', () => {
      // Nothing to list, and nothing changed from the empty list
      expect(computeAvailableBridges(kitchen([makeService({ instance: undefined })]), new Map(), [], null)).toBeNull()
    })

    it('selects every bridge the first time the list is built', () => {
      expect(computeAvailableBridges(kitchen([service('0E:11', 'Homebridge')]), new Map(), [], null)?.selectedBridges).toEqual(['Homebridge'])
    })

    it('keeps showing everything when a new bridge appears', () => {
      const update = computeAvailableBridges(
        kitchen([service('0E:11', 'Homebridge'), service('0E:22', 'New Bridge')]),
        new Map(),
        ['Homebridge'],
        ['Homebridge'],
      )

      expect(update?.selectedBridges).toEqual(['Homebridge', 'New Bridge'])
    })

    it('leaves a narrowed filter narrowed when a new bridge appears', () => {
      // The user deliberately hid a bridge; a new one must not undo that
      const update = computeAvailableBridges(
        kitchen([service('0E:11', 'Homebridge'), service('0E:22', 'Kitchen Bridge'), service('0E:33', 'New Bridge')]),
        new Map(),
        ['Homebridge', 'Kitchen Bridge'],
        ['Homebridge'],
      )

      expect(update?.selectedBridges).toEqual(['Homebridge'])
    })

    it('drops a selected bridge that has gone away', () => {
      // Only when the new list is not *shorter*: a bridge that really has gone
      // is dropped when another appears in its place
      const update = computeAvailableBridges(
        kitchen([service('0E:11', 'Apple Bridge'), service('0E:33', 'New Bridge')]),
        new Map(),
        ['Apple Bridge', 'Gone Bridge'],
        ['Gone Bridge'],
      )

      expect(update?.availableBridges).toEqual(['Apple Bridge', 'New Bridge'])
      expect(update?.selectedBridges).not.toContain('Gone Bridge')
    })

    it('ignores a pass that sees fewer bridges than the last one', () => {
      // ⚠️ The race: the names arrive on their own socket
      expect(computeAvailableBridges(
        kitchen([service('0E:11', 'Homebridge')]),
        new Map(),
        ['Homebridge', 'Kitchen Bridge'],
        ['Homebridge', 'Kitchen Bridge'],
      )).toBeNull()
    })

    it('changes nothing when the list is the same as before', () => {
      expect(computeAvailableBridges(kitchen([service('0E:11', 'Homebridge')]), new Map(), ['Homebridge'], ['Homebridge'])).toBeNull()
    })
  })

  /**
   * ⚠️ **Deleting a room must not delete the accessories in it.** They are moved to
   * the default room first — and if the room being deleted *is* the default, another
   * room becomes the default and takes them.
   */
  describe('managing the rooms', () => {
    describe('adding one', () => {
      it('adds the room at the end', () => {
        expect(addRoom([room('Kitchen', { isDefault: true })], { name: 'Hall', isDefault: false })?.map(r => r.name)).toEqual(['Kitchen', 'Hall'])
      })

      it('adds it empty, so no accessory moves into it by surprise', () => {
        expect(addRoom([], { name: 'Hall', isDefault: false })![0].services).toEqual([])
      })

      it('makes it the only default when it is added as one', () => {
        // Two default rooms would fight over every new accessory
        const next = addRoom([room('Kitchen', { isDefault: true })], { name: 'Hall', isDefault: true })!

        expect(next.filter(r => r.isDefault).map(r => r.name)).toEqual(['Hall'])
      })

      it('adds nothing for a nameless room', () => {
        expect(addRoom([room('Kitchen')], { name: '', isDefault: false })).toBeNull()
        expect(addRoom([room('Kitchen')], undefined)).toBeNull()
      })
    })

    describe('renaming one', () => {
      it('renames it in place, keeping its accessories', () => {
        const service = makeService()

        expect(editRoom([room('Kitchen', { services: [service] })], 0, { name: 'Kitchenette', isDefault: false })![0])
          .toMatchObject({ name: 'Kitchenette', services: [service] })
      })

      it('moves the default over when a room is made the default', () => {
        const next = editRoom([room('Kitchen', { isDefault: true }), room('Hall')], 1, { name: 'Hall', isDefault: true })!

        expect(next.map(r => r.isDefault)).toEqual([false, true])
      })

      it('does nothing for a room index that is not there', () => {
        expect(editRoom([room('Kitchen')], 5, { name: 'X' })).toBeNull()
      })

      it('ignores a blank name', () => {
        expect(editRoom([room('Kitchen')], 0, { name: '', isDefault: false })).toBeNull()
      })
    })

    describe('deleting one', () => {
      it('moves its accessories into the default room', () => {
        const service = makeService()
        const next = editRoom([room('Kitchen', { isDefault: true }), room('Spare', { services: [service] })], 1, { delete: true })!

        expect(next.map(r => r.name)).toEqual(['Kitchen'])
        expect(next[0].services).toEqual([service])
      })

      it('hands the accessories of a deleted default room to another room, which becomes the default', () => {
        const service = makeService()
        const next = editRoom([room('Kitchen', { isDefault: true, services: [service] }), room('Hall')], 0, { delete: true })!

        expect(next).toEqual([{ name: 'Hall', isDefault: true, services: [service] }])
      })

      it('leaves the default where it is when deleting another room', () => {
        const next = editRoom([room('Kitchen', { isDefault: true }), room('Spare')], 1, { delete: true })!

        expect(next[0]).toMatchObject({ name: 'Kitchen', isDefault: true })
      })

      it('copes with a layout that has no default room at all', () => {
        // Older layouts predate the default-room flag
        const service = makeService()

        expect(editRoom([room('Kitchen'), room('Spare', { services: [service] })], 1, { delete: true })![0].services).toEqual([service])
      })
    })
  })

  describe('dragging', () => {
    const a = makeService({ uniqueId: 'a' })
    const b = makeService({ uniqueId: 'b' })
    const c = makeService({ uniqueId: 'c' })

    it('moves a room to where it was dropped', () => {
      const rooms = [room('Kitchen'), room('Hall'), room('Attic')]

      expect(moveRoom(rooms, roomDragId(rooms[0]), roomDragId(rooms[2]))?.map(r => r.name)).toEqual(['Hall', 'Attic', 'Kitchen'])
    })

    it('does nothing for a room dropped on itself', () => {
      const rooms = [room('Kitchen')]

      expect(moveRoom(rooms, roomDragId(rooms[0]), roomDragId(rooms[0]))).toBeNull()
    })

    it('reorders a tile within its room', () => {
      const rooms = [room('Kitchen', { services: [a, b, c] })]

      expect(moveService(rooms, serviceDragId(a), serviceDragId(c))![0].services).toEqual([b, c, a])
    })

    it('moves a tile into another room at the tile it was dropped on', () => {
      const rooms = [room('Kitchen', { services: [a, b] }), room('Hall', { services: [c] })]
      const next = moveService(rooms, serviceDragId(a), serviceDragId(c))!

      expect(next[0].services).toEqual([b])
      expect(next[1].services).toEqual([a, c])
    })

    it('moves a tile to the end of a room it was dropped on, even an empty one', () => {
      const rooms = [room('Kitchen', { services: [a, b] }), room('Hall')]
      const next = moveService(rooms, serviceDragId(a), roomDragId(rooms[1]))!

      expect(next[1].services).toEqual([a])
    })

    it('replaces only the rooms that changed', () => {
      const rooms = [room('Kitchen', { services: [a, b] }), room('Hall'), room('Attic')]
      const next = moveService(rooms, serviceDragId(b), serviceDragId(a))!

      expect(next[0].services).toEqual([b, a])
      expect(next[1]).toBe(rooms[1])
      expect(next[2]).toBe(rooms[2])
    })

    it('does nothing for a tile dropped where it already is', () => {
      const rooms = [room('Kitchen', { services: [a] })]

      expect(moveService(rooms, serviceDragId(a), serviceDragId(a))).toBeNull()
      expect(moveService(rooms, serviceDragId(a), roomDragId(rooms[0]))).toBeNull()
    })
  })
})
