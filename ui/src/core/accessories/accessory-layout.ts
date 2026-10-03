import type { AccessoryLayout, AccessoryLayoutService, ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ServiceType } from '@homebridge/hap-client'

/** A room of the accessories page, holding the services sorted into it. */
export interface AccessoryRoom {
  name: string
  isDefault?: boolean
  services: ServiceTypeX[]
}

/**
 * Check if a cached service matches a discovered service.
 *
 * Matching priority:
 * 1. nameBasedUniqueId (stable across sessions, available from hap-client)
 * 2. uniqueId (stable within a session, may change between sessions)
 * 3. Fallback: name + serial + bridge + uuid (legacy layouts without nameBasedUniqueId)
 *
 * Matter accessories use uniqueId + bridge matching only.
 * @param cachedService - an entry of the saved layout
 * @param discoveredService - a live service (or another layout entry)
 */
export function servicesMatch(cachedService: AccessoryLayoutService, discoveredService: any): boolean {
  const isMatterAccessory = discoveredService.protocol === 'matter' || discoveredService.uniqueId?.startsWith('matter:')
  if (isMatterAccessory) {
    return cachedService.uniqueId === discoveredService.uniqueId
      && cachedService.bridge === (discoveredService.instance?.username || discoveredService.bridge)
  }

  // Primary match: nameBasedUniqueId (stable across sessions)
  if (cachedService.nameBasedUniqueId && discoveredService.nameBasedUniqueId) {
    return cachedService.nameBasedUniqueId === discoveredService.nameBasedUniqueId
  }

  // Secondary match: uniqueId
  if (cachedService.uniqueId === discoveredService.uniqueId) {
    return true
  }

  // Fallback: multi-field match for legacy layouts without nameBasedUniqueId
  return cachedService.name === (discoveredService.serviceName || discoveredService.name)
    && cachedService.serial === (discoveredService.accessoryInformation?.['Serial Number'] || discoveredService.serial)
    && cachedService.bridge === (discoveredService.instance?.username || discoveredService.bridge)
    && cachedService.uuid === discoveredService.uuid
}

/**
 * Find a cached service in the layout that matches a discovered service.
 * Returns the cached service and the room it belongs to, or null if not found.
 * @param layout - the saved layout
 * @param service - the live service
 */
export function findInLayout(layout: AccessoryLayout, service: ServiceType): { room: AccessoryLayout[number], service: AccessoryLayoutService } | null {
  for (const room of layout) {
    for (const cachedService of room.services) {
      if (!cachedService.name) {
        continue
      }
      if (servicesMatch(cachedService, service)) {
        return { room, service: cachedService }
      }
    }
  }
  return null
}

/**
 * Copy the custom attributes a saved layout entry holds (customType,
 * customName, hidden, onDashboard) onto a live service; only the ones set.
 * @param service - the live service, written in place
 * @param cached - its layout entry
 */
export function applyLayoutAttributes(service: ServiceTypeX, cached: AccessoryLayoutService): void {
  if (cached.customType) {
    service.customType = cached.customType
  }
  if (cached.customName) {
    service.customName = cached.customName
  }
  if (cached.hidden) {
    service.hidden = cached.hidden
  }
  if (cached.onDashboard) {
    service.onDashboard = cached.onDashboard
  }
}

/** Get a stable key for a service, preferring nameBasedUniqueId */
function getServiceKey(service: { nameBasedUniqueId?: string, uniqueId?: string }): string {
  return (service.nameBasedUniqueId || service.uniqueId)!
}

/**
 * The layout schema of the rooms as they stand, with at least one room
 * flagged as the default.
 * @param rooms - the active rooms
 */
export function layoutFromRooms(rooms: readonly AccessoryRoom[]): AccessoryLayout {
  const currentLayout = rooms.map(room => ({
    name: room.name,
    isDefault: room.isDefault,
    services: room.services.map(service => ({
      uniqueId: service.uniqueId,
      nameBasedUniqueId: service.nameBasedUniqueId || undefined,
      name: service.serviceName,
      serial: service.accessoryInformation?.['Serial Number'],
      bridge: service.instance?.username,
      aid: service.aid,
      iid: service.iid,
      uuid: service.uuid,
      customName: service.customName || undefined,
      customType: service.customType || undefined,
      hidden: service.hidden || undefined,
      onDashboard: service.onDashboard || undefined,
    })),
  }))

  // Ensure at least one room has isDefault: true
  const hasDefaultRoom = currentLayout.some(r => r.isDefault === true)
  if (!hasDefaultRoom && currentLayout.length > 0) {
    currentLayout[0].isDefault = true
  }
  return currentLayout as AccessoryLayout
}

/**
 * Backward compatibility for a layout loaded from the server: make sure one
 * room is the default ("Default Room" if there is one, else the first).
 * Written in place.
 * @param layout - the loaded layout
 */
export function ensureDefaultRoom(layout: AccessoryLayout): void {
  const hasDefaultRoom = layout.some(r => r.isDefault)
  if (!hasDefaultRoom && layout.length > 0) {
    // Find room named "Default Room" or use first room
    const defaultRoomIndex = layout.findIndex(r => r.name === 'Default Room')
    const indexToMakeDefault = defaultRoomIndex !== -1 ? defaultRoomIndex : 0
    layout[indexToMakeDefault].isDefault = true
  }
}

/**
 * The empty rooms of a layout, before any service is sorted into them.
 * @param layout - the loaded layout
 */
export function emptyRoomsFromLayout(layout: AccessoryLayout): AccessoryRoom[] {
  return layout.map(room => ({
    name: room.name,
    isDefault: room.isDefault,
    services: [] as ServiceTypeX[],
  }))
}

/**
 * Merge current layout with undiscovered services to preserve custom information
 * @param currentLayout - the layout of the active rooms
 * @param originalLayout - the layout as loaded, holding services not discovered this session
 */
export function mergeWithUndiscoveredServices(currentLayout: AccessoryLayout, originalLayout: AccessoryLayout | undefined): AccessoryLayout {
  if (!originalLayout) {
    return currentLayout
  }

  // Create the merged layout starting with current rooms
  const mergedLayout: AccessoryLayout = JSON.parse(JSON.stringify(currentLayout))

  // Track which original services have been matched to a discovered service
  const matchedOriginalKeys = new Set<string>()

  // First pass: find all original services that match a discovered service
  for (const room of mergedLayout) {
    for (const discoveredService of room.services) {
      for (const originalRoom of originalLayout) {
        for (const originalService of originalRoom.services) {
          if (!originalService.name) {
            continue
          }
          if (servicesMatch(originalService, discoveredService)) {
            matchedOriginalKeys.add(getServiceKey(originalService))
            break
          }
        }
        if (matchedOriginalKeys.has(getServiceKey(discoveredService))) {
          break
        }
      }
    }
  }

  // Second pass: add unmatched services from original layout (truly undiscovered services)
  for (const originalRoom of originalLayout) {
    for (const originalService of originalRoom.services) {
      if (matchedOriginalKeys.has(getServiceKey(originalService))) {
        continue
      }
      if (!originalService.name) {
        continue
      }

      // Find the room for this undiscovered service
      let targetRoom = mergedLayout.find(room => room.name === originalRoom.name)

      // If the room doesn't exist in current layout, it was deleted by the user
      // Move undiscovered services to the default room instead of recreating the deleted room
      if (!targetRoom) {
        targetRoom = mergedLayout.find(room => room.isDefault)
        if (!targetRoom) {
          continue
        }
      }

      // Add the undiscovered service with its preserved custom information
      targetRoom.services.push({
        uniqueId: originalService.uniqueId,
        nameBasedUniqueId: originalService.nameBasedUniqueId,
        name: originalService.name,
        bridge: originalService.bridge,
        serial: originalService.serial,
        aid: originalService.aid,
        iid: originalService.iid,
        uuid: originalService.uuid,
        customName: originalService.customName,
        customType: originalService.customType,
        hidden: originalService.hidden,
        onDashboard: originalService.onDashboard,
      })
    }
  }

  // Keep rooms that either have services OR were in the current layout (user-created empty rooms)
  return mergedLayout.filter(room =>
    room.services.length > 0 || currentLayout.some(r => r.name === room.name),
  )
}
