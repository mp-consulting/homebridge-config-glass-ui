import type { ServiceType } from '@homebridge/hap-client'

/** One accessory as the organiser prompt sees it. */
export interface OrganizerAccessory {
  uniqueId: string
  serviceName: string
  type?: string
  manufacturer?: string
  model?: string
  room: string
}

/** A saved room of the accessory layout (`accessories/accessory-layout.json`, per user). */
export interface LayoutRoom {
  name: string
  isDefault?: boolean
  services?: Array<{
    uniqueId?: string
    nameBasedUniqueId?: string
    name?: string
    serial?: string
    bridge?: string
    uuid?: string
    customName?: string
  }>
}

/** Service types that never get a tile on the Accessories page (kept in step with the UI). */
const HIDDEN_SERVICE_TYPES: ReadonlySet<string> = new Set([
  'AccessoryInformation',
  'InputSource',
  'LockManagement',
  'CameraRTPStreamManagement',
  'ProtocolInformation',
  'NFCAccess',
  'BridgedNode',
  'History',
])

const DEFAULT_ROOM = 'Default Room'

type LayoutEntry = NonNullable<LayoutRoom['services']>[number]

/** The same matching the Accessories page uses to find a live service in the saved layout. */
function matches(entry: LayoutEntry, service: ServiceType): boolean {
  if (entry.nameBasedUniqueId && service.nameBasedUniqueId) {
    return entry.nameBasedUniqueId === service.nameBasedUniqueId
  }
  if (entry.uniqueId && entry.uniqueId === service.uniqueId) {
    return true
  }
  return entry.name === service.serviceName
    && entry.serial === service.accessoryInformation?.['Serial Number']
    && entry.bridge === service.instance?.username
    && entry.uuid === service.uuid
}

/**
 * The organiser's input, built on the server from the live HAP services and
 * the user's saved layout: each visible service with its room and the name
 * the user sees (their custom name, if any). The client sends no list, so
 * what the provider is shown is always what the bridge actually has.
 * @param services - from AccessoriesService.loadAccessories()
 * @param layout - the user's rooms, from AccessoriesService.getAccessoryLayout()
 * @param onlyRooms - when given, only accessories currently in these rooms
 */
export function organizerInput(services: ServiceType[], layout: unknown, onlyRooms?: string[]): { accessories: OrganizerAccessory[], rooms: string[] } {
  const rooms: LayoutRoom[] = Array.isArray(layout)
    ? layout.filter((room): room is LayoutRoom => typeof room?.name === 'string')
    : []
  const fallback = rooms.find(room => room.isDefault)?.name ?? DEFAULT_ROOM
  const roomNames = [...new Set([...rooms.map(room => room.name), fallback])]

  const seen = new Set<string>()
  const accessories: OrganizerAccessory[] = []
  for (const service of services) {
    if (!service.uniqueId || seen.has(service.uniqueId) || HIDDEN_SERVICE_TYPES.has(service.type)) {
      continue
    }
    seen.add(service.uniqueId)
    let room = fallback
    let customName: string | undefined
    for (const candidate of rooms) {
      const entry = candidate.services?.find(x => !!x?.name && matches(x, service))
      if (entry) {
        room = candidate.name
        customName = entry.customName
        break
      }
    }
    if (onlyRooms && !onlyRooms.includes(room)) {
      continue
    }
    accessories.push({
      uniqueId: service.uniqueId,
      serviceName: customName || service.serviceName,
      type: service.humanType,
      manufacturer: service.accessoryInformation?.Manufacturer,
      model: service.accessoryInformation?.Model,
      room,
    })
  }
  return { accessories, rooms: roomNames }
}
