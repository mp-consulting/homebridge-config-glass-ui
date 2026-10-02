import type { AccessoryRoom } from '@/core/accessories/accessories'
import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AddRoomResult, EditRoomResult } from '@/modules/accessories/modal-data-tokens'

/**
 * The rules of the accessories page that do not depend on React: which tiles
 * to show, the list of bridges to filter by, and what the room modals do to
 * the rooms.
 *
 * Two features overlap here in a way that caused #2790: a bridge filter that
 * hides tiles, and drag-and-drop reordering by index. With tiles hidden, the
 * model indexes and the DOM indexes no longer line up, and a drop moves an
 * accessory the user was not touching. The fix is that the two are mutually
 * exclusive - manage-layout mode shows everything and suspends the filter, and
 * picking a filter leaves manage-layout mode.
 */

/** The name a service's bridge is listed under: the configured name, else the reported one. */
export function bridgeNameOf(service: ServiceTypeX, bridgeNames: Map<string, string>): string | undefined {
  if (!service.instance?.username) {
    return undefined
  }
  return bridgeNames.get(service.instance.username) || service.instance.name
}

export interface DisplayFilter {
  manageLayoutMode: boolean
  hideHidden: boolean
  selectedBridges: string[] | null
  bridgeNames: Map<string, string>
}

/**
 * Whether a service's tile is shown under the current filters.
 * @param service - the service
 * @param filter - the page's filter state
 */
export function shouldDisplayService(service: ServiceTypeX, filter: DisplayFilter): boolean {
  // In manage layout mode, show ALL accessories so the drag model and DOM stay 1-to-1 (#2790).
  if (filter.manageLayoutMode) {
    return true
  }

  // Check hidden filter
  if (filter.hideHidden && service.hidden) {
    return false
  }

  // Check bridge filter
  if (service.instance?.username) {
    const bridgeName = bridgeNameOf(service, filter.bridgeNames)
    const selected = filter.selectedBridges

    // If not initialized yet, show all
    if (selected === null) {
      return true
    }

    // If no bridges selected, show nothing
    if (selected.length === 0) {
      return false
    }

    // Show only if bridge is in selected list
    if (bridgeName && !selected.includes(bridgeName)) {
      return false
    }
  }

  return true
}

/**
 * Work out the bridges to offer in the filter from the accessories in the
 * rooms, and how the selection follows. Returns null when nothing changes.
 *
 * Only updates if the list changed AND is not shorter than before: the
 * configured bridge names arrive over a socket and may not be there yet, and a
 * pass made without them would drop bridges from the filter.
 * @param rooms - the rooms
 * @param bridgeNames - username → configured bridge name
 * @param currentAvailable - the bridges offered now
 * @param currentSelected - the bridges selected now
 */
export function computeAvailableBridges(
  rooms: AccessoryRoom[],
  bridgeNames: Map<string, string>,
  currentAvailable: string[],
  currentSelected: string[] | null,
): { availableBridges: string[], selectedBridges: string[] } | null {
  const bridges = new Set<string>()

  rooms.forEach((room) => {
    room.services.forEach((service) => {
      const bridgeName = bridgeNameOf(service, bridgeNames)
      if (bridgeName) {
        bridges.add(bridgeName)
      }
    })
  })

  const newBridges = [...bridges].toSorted((a, b) => {
    // Sort with "Homebridge" first, then alphabetically
    if (a === 'Homebridge') {
      return -1
    }
    if (b === 'Homebridge') {
      return 1
    }
    return a.localeCompare(b)
  })

  const shouldUpdate = JSON.stringify(newBridges) !== JSON.stringify(currentAvailable)
    && newBridges.length >= currentAvailable.length

  if (!shouldUpdate) {
    return null
  }

  let selectedBridges: string[]
  if (currentSelected === null || currentSelected.length === 0) {
    // First initialization or no bridges selected - select all bridges by default
    selectedBridges = [...newBridges]
  } else {
    // Check if we were showing all bridges before the update
    const wasShowingAll = currentSelected.length === currentAvailable.length
      && currentAvailable.length > 0

    selectedBridges = wasShowingAll
      // If showing all, keep showing all even when new bridges appear
      ? [...newBridges]
      // Remove any selected bridges that no longer exist, but don't add new ones
      : currentSelected.filter(bridge => newBridges.includes(bridge))
  }

  return { availableBridges: newBridges, selectedBridges }
}

/**
 * The rooms after the add-room modal closed, or null when there is nothing to add.
 * @param rooms - the rooms
 * @param result - what the modal closed with
 */
export function addRoom(rooms: AccessoryRoom[], result: AddRoomResult | undefined): AccessoryRoom[] | null {
  // No room name provided (validation should prevent this, but safety check)
  if (!result?.name || !result.name.length) {
    return null
  }

  // If setting as default, unset other default rooms
  const current = result.isDefault ? rooms.map(r => ({ ...r, isDefault: false })) : rooms

  // Added empty, so no accessory moves into it by surprise
  return [...current, { name: result.name, isDefault: result.isDefault, services: [] }]
}

/**
 * The rooms after the edit-room modal closed (a rename, or a delete), or null
 * when nothing changes.
 * @param rooms - the rooms
 * @param roomIndex - the room that was edited
 * @param result - what the modal closed with
 */
export function editRoom(rooms: AccessoryRoom[], roomIndex: number, result: EditRoomResult | undefined): AccessoryRoom[] | null {
  const room = rooms[roomIndex]
  if (!room) {
    return null
  }

  if (result?.delete) {
    // Find target room to move services to
    let targetRoomIndex: number
    if (room.isDefault) {
      // If deleting default room, move services to first other room (which will become new default)
      targetRoomIndex = roomIndex === 0 ? 1 : 0
    } else {
      // If deleting non-default room, move services to current default room
      const defaultRoomIndex = rooms.findIndex(r => r.isDefault)
      targetRoomIndex = defaultRoomIndex !== -1 ? defaultRoomIndex : 0
    }

    let next = rooms

    // If deleting the default room, set the target room as the new default
    if (room.isDefault) {
      next = next.map((r, idx) => (idx === targetRoomIndex ? { ...r, isDefault: true } : { ...r, isDefault: false }))
    }

    // Move services from room being deleted to target room
    if (room.services.length > 0) {
      next = next.map((r, idx) => (idx === targetRoomIndex ? { ...r, services: [...r.services, ...room.services] } : r))
    }

    // Remove the room
    return next.filter((_, idx) => idx !== roomIndex)
  }

  // No room name provided (validation should prevent this, but safety check)
  if (!result?.name || !result.name.length) {
    return null
  }

  // If setting as default, unset other default rooms
  const current = result.isDefault ? rooms.map(r => ({ ...r, isDefault: false })) : rooms

  return current.map((r, idx) => (idx === roomIndex ? { ...r, name: result.name!, isDefault: result.isDefault ?? false } : r))
}

/** Drag ids: rooms by name (unique, the modals enforce it), tiles by uniqueId. */
export const roomDragId = (room: { name: string }) => `room:${room.name}`
export const serviceDragId = (service: ServiceTypeX) => `service:${service.uniqueId}`

/**
 * The rooms after a room was dragged onto another one's place.
 * @param rooms - the rooms
 * @param activeId - the dragged room's drag id
 * @param overId - the drag id of the room it was dropped on
 */
export function moveRoom(rooms: AccessoryRoom[], activeId: string, overId: string): AccessoryRoom[] | null {
  const from = rooms.findIndex(room => roomDragId(room) === activeId)
  const to = rooms.findIndex(room => roomDragId(room) === overId)
  if (from === -1 || to === -1 || from === to) {
    return null
  }
  const next = [...rooms]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * The rooms after a tile was dropped: on another tile (it takes that tile's
 * place, in the same room or another one) or on a room (it goes to the end).
 * @param rooms - the rooms
 * @param activeId - the dragged tile's drag id
 * @param overId - the drag id of the tile or room it was dropped on
 */
export function moveService(rooms: AccessoryRoom[], activeId: string, overId: string): AccessoryRoom[] | null {
  const fromRoom = rooms.findIndex(room => room.services.some(s => serviceDragId(s) === activeId))
  if (fromRoom === -1) {
    return null
  }
  const fromIndex = rooms[fromRoom].services.findIndex(s => serviceDragId(s) === activeId)

  let toRoom = rooms.findIndex(room => room.services.some(s => serviceDragId(s) === overId))
  let toIndex: number
  if (toRoom !== -1) {
    toIndex = rooms[toRoom].services.findIndex(s => serviceDragId(s) === overId)
  } else {
    toRoom = rooms.findIndex(room => roomDragId(room) === overId)
    if (toRoom === -1) {
      return null
    }
    toIndex = rooms[toRoom].services.length - (toRoom === fromRoom ? 1 : 0)
  }

  if (fromRoom === toRoom && fromIndex === toIndex) {
    return null
  }

  const moved = rooms[fromRoom].services[fromIndex]
  const next = rooms.map(room => ({ ...room, services: [...room.services] }))
  next[fromRoom].services.splice(fromIndex, 1)
  next[toRoom].services.splice(toIndex, 0, moved)
  // Only the rooms that changed get new objects
  return rooms.map((room, idx) => (idx === fromRoom || idx === toRoom ? next[idx] : room))
}
