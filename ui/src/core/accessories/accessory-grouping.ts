import type { AccessoryLayout, ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryRoom } from '@/core/accessories/accessory-layout'
import type { ServiceType } from '@homebridge/hap-client'

import { applyLayoutAttributes, findInLayout, servicesMatch } from '@/core/accessories/accessory-layout'

/**
 * How the live accessory services become rooms of tiles: merging a payload
 * into the service list, linking related services, sorting services into the
 * rooms of the saved layout, and attaching the control helpers.
 *
 * Every step keeps references stable where nothing changed (copy on write),
 * so memoised tiles only re-render for the services a payload touched. A step
 * that changed no room returns `null` for the rooms.
 */

/** Service types that never get a tile of their own. */
export const HIDDEN_SERVICE_TYPES: ReadonlySet<string> = new Set([
  'InputSource',
  'LockManagement',
  'CameraRTPStreamManagement',
  'ProtocolInformation',
  'NFCAccess',
  'BridgedNode',
  'History', // Eve History
])

/**
 * Fields the client writes onto a service after it arrives (control helpers,
 * the saved layout's custom attributes, the links to sibling services). They
 * are not part of the payload, so they are left out of the comparison.
 */
const CLIENT_SERVICE_FIELDS = new Set(['getCharacteristic', 'getCluster', 'linkedServices', 'customName', 'customType', 'hidden', 'onDashboard'])

/** Structural equality of payload data; function-valued fields (helpers such as `setValue`) are ignored. */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((value, index) => sameData(value, other[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = (record: Record<string, unknown>) => Object.keys(record).filter(key => typeof record[key] !== 'function')
  const leftKeys = keys(left)
  const rightKeys = keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(right, key) && sameData(left[key], right[key]))
}

/**
 * Whether an incoming service carries the same data as the object already
 * held for it. The client-written fields are ignored on the existing object;
 * `hidden` (also a HAP field) is compared when the payload sends it.
 * @param existing - the object held for the service
 * @param incoming - the object a payload brought
 */
export function sameServiceData(existing: ServiceTypeX, incoming: ServiceTypeX): boolean {
  const current = existing as unknown as Record<string, unknown>
  const next = incoming as unknown as Record<string, unknown>
  for (const key of Object.keys(next)) {
    if (typeof next[key] === 'function') {
      continue
    }
    if (!sameData(current[key], next[key])) {
      return false
    }
  }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(next, key) && !CLIENT_SERVICE_FIELDS.has(key) && typeof current[key] !== 'function') {
      return false
    }
  }
  return true
}

/**
 * The service list indexed by uniqueId (first occurrence), so a live update
 * does not scan the whole list per service. Rebuilt when the list was
 * replaced or changed from outside (specs and the manage modals swap it).
 */
export class ServiceIndex {
  private index = new Map<string | undefined, number>()
  private indexed: ServiceTypeX[] | null = null

  /** The position of a service in `list` (its first occurrence), or -1. */
  public indexOf(list: ServiceTypeX[], uniqueId: string | undefined): number {
    const index = this.indexed === list ? this.index.get(uniqueId) : undefined
    if (index !== undefined && list[index]?.uniqueId === uniqueId) {
      return index
    }
    if (index === undefined && this.indexed === list && this.index.size === list.length) {
      return -1
    }
    this.reindex(list)
    return this.index.get(uniqueId) ?? -1
  }

  /** The current object for a uniqueId in `list`, or undefined. */
  public find(list: ServiceTypeX[], uniqueId: string | undefined): ServiceTypeX | undefined {
    const index = this.indexOf(list, uniqueId)
    return index === -1 ? undefined : list[index]
  }

  public reindex(list: ServiceTypeX[]): void {
    this.index = new Map()
    list.forEach((service, index) => {
      if (!this.index.has(service.uniqueId)) {
        this.index.set(service.uniqueId, index)
      }
    })
    this.indexed = list
  }

  /** A service was pushed onto the end of `list`. */
  public appended(list: ServiceTypeX[], uniqueId: string | undefined): void {
    if (this.indexed === list && this.index.size === list.length - 1) {
      this.index.set(uniqueId, list.length - 1)
    } else {
      this.reindex(list)
    }
  }

  public clear(): void {
    this.index.clear()
    this.indexed = null
  }
}

/**
 * Merge an incoming payload into the service list: a service whose data
 * changed is replaced by the new object, a new one appended, an unchanged one
 * kept. The first payload becomes the list.
 * @param list - the services held so far (written in place)
 * @param incoming - the payload
 * @param index - the index of `list`
 * @param customAttributesApplied - uniqueIds whose layout attributes were applied; a replaced service is dropped from it
 * @returns the service list (a new one on the first payload) and the uniqueIds the payload replaced or added
 */
export function parseServices(
  list: ServiceTypeX[],
  incoming: ServiceTypeX[],
  index: ServiceIndex,
  customAttributesApplied: Set<string>,
): { services: ServiceTypeX[], changed: Set<string | undefined> } {
  if (!list.length) {
    index.reindex(incoming)
    return { services: incoming, changed: new Set<string | undefined>(incoming.map(service => service.uniqueId)) }
  }

  const changed = new Set<string | undefined>()

  // Replace existing objects instead of mutating them
  incoming.forEach((service) => {
    const existingIndex = index.indexOf(list, service.uniqueId)

    if (existingIndex !== -1) {
      // A full payload repeats every service: one whose data did not change
      // keeps its object, so the memoised tiles showing it do not re-render
      if (sameServiceData(list[existingIndex], service)) {
        return
      }
      changed.add(service.uniqueId)
      // Replace the object instead of mutating it
      list[existingIndex] = service
      // Clear from customAttributesApplied Set so attributes get re-applied to the new object
      customAttributesApplied.delete(service.uniqueId!)
    } else {
      changed.add(service.uniqueId)
      list.push(service)
      index.appended(list, service.uniqueId)
    }
  })

  return { services: list, changed }
}

/**
 * The key two services of the same physical accessory share
 * (same name, serial number, and bridge instance)
 */
function accessoryKey(service: ServiceType): string {
  return JSON.stringify([
    service.accessoryInformation?.Name,
    service.accessoryInformation?.['Serial Number'],
    service.instance?.username,
  ])
}

function attachLockManagementToMechanism(service: ServiceType, sameAccessory: ServiceType[]) {
  const lockMechanisms: ServiceType[] = []
  const lockManagements: ServiceType[] = []

  for (const serv of sameAccessory) {
    if (serv.type === 'LockMechanism') {
      lockMechanisms.push(serv)
    } else if (serv.type === 'LockManagement') {
      lockManagements.push(serv)
    }
  }

  if (lockMechanisms.length === 1 && lockManagements.length === 1) {
    const lockManagement = lockManagements[0]

    if (!service.linkedServices) {
      service.linkedServices = {}
    }
    service.linkedServices[lockManagement.iid] = lockManagement
  }
}

/** Link the one fan of an accessory that has exactly one `parentType` service, and hide the fan's own tile. */
function attachFanTo(service: ServiceType, parentType: string, sameAccessory: ServiceType[], combined: Set<string>) {
  const parents: ServiceType[] = []
  const fans: ServiceType[] = []

  for (const serv of sameAccessory) {
    if (serv.type === parentType) {
      parents.push(serv)
    } else if (serv.type === 'Fan' || serv.type === 'Fanv2') {
      fans.push(serv)
    }
  }

  if (parents.length === 1 && fans.length === 1) {
    const fan = fans[0]

    if (!service.linkedServices) {
      service.linkedServices = {}
    }
    service.linkedServices[fan.iid] = fan
    combined.add(fan.uniqueId!)
  }
}

/**
 * Link the services that belong together on one tile (a heater-cooler's or
 * humidifier's fan, a lock's management) and drop the combined fans from the
 * rooms.
 * @param services - every service (the parents get `linkedServices` in place)
 * @param rooms - the current rooms
 * @returns the uniqueIds of the combined services, and the new rooms (null when unchanged)
 */
export function combineRelatedServices(services: ServiceTypeX[], rooms: AccessoryRoom[]): { combined: Set<string>, rooms: AccessoryRoom[] | null } {
  const combined = new Set<string>()

  // The services of each physical accessory, in list order - built only when
  // there is something to combine
  let byAccessory: Map<string, ServiceType[]> | null = null
  const sameAccessoryAs = (service: ServiceType): ServiceType[] => {
    if (!byAccessory) {
      byAccessory = new Map()
      for (const serv of services) {
        const key = accessoryKey(serv)
        const group = byAccessory.get(key)
        if (group) {
          group.push(serv)
        } else {
          byAccessory.set(key, [serv])
        }
      }
    }
    return byAccessory.get(accessoryKey(service)) ?? []
  }

  for (const service of services) {
    if (service.type === 'HeaterCooler') {
      attachFanTo(service, 'HeaterCooler', sameAccessoryAs(service), combined)
    } else if (service.type === 'HumidifierDehumidifier') {
      attachFanTo(service, 'HumidifierDehumidifier', sameAccessoryAs(service), combined)
    } else if (service.type === 'LockMechanism') {
      // Here rather than in parseServices, which is where this used to live.
      // parseServices returns early on the very first payload, so the link
      // was never made on load: the long-press modal offered no lock
      // management settings until the lock next changed state, which for a
      // door lock can be hours. And on later payloads it searched the array
      // before the replacement objects were written back, so the mechanism
      // ended up linked to the previous management object — a stale
      // reference that was replaced again on the following event.
      attachLockManagementToMechanism(service, sameAccessoryAs(service))
    }
  }

  // Remove combined fan services from rooms; the other rooms keep their references
  if (!combined.size) {
    return { combined, rooms: null }
  }
  let removed = false
  const next = rooms.map((room) => {
    if (!room.services.some(s => combined.has(s.uniqueId!))) {
      return room
    }
    removed = true
    return { ...room, services: room.services.filter(s => !combined.has(s.uniqueId!)) }
  })
  return { combined, rooms: removed ? next : null }
}

export interface SortIntoRoomsInput {
  services: ServiceTypeX[]
  rooms: AccessoryRoom[]
  layout: AccessoryLayout
  /** Services shown on another service's tile (not given a tile of their own). */
  combined: ReadonlySet<string>
  /** uniqueIds whose layout attributes were applied; every service placed is added. */
  customAttributesApplied: Set<string>
}

/**
 * Sort the services into their rooms: one already in a room stays there, one
 * the saved layout places goes to that room (with its custom attributes), any
 * other to the default room (created if missing). Also writes each linked
 * service's `linkedServices`.
 * @returns the new rooms (null when unchanged) and the names of the rooms that received a service
 */
export function sortIntoRooms({ services, rooms: initialRooms, layout, combined, customAttributesApplied }: SortIntoRoomsInput): { rooms: AccessoryRoom[] | null, touched: Set<string> } {
  const touched = new Set<string>()

  // The rooms are copied on write: only a room that receives a service gets
  // a new object, so the others keep their references
  let working: AccessoryRoom[] | null = null
  const copied = new Set<number>()
  const rooms = () => working ?? initialRooms
  const addTo = (name: string, service: ServiceTypeX): boolean => {
    const current = rooms()
    let added = false
    current.forEach((room, index) => {
      if (room.name !== name) {
        return
      }
      working ??= [...current]
      if (!copied.has(index)) {
        working[index] = { ...room, services: [...room.services] }
        copied.add(index)
      }
      working[index].services.push(service)
      touched.add(name)
      added = true
    })
    return added
  }

  // The uniqueIds already allocated to an active room
  const inRooms = new Set<string | undefined>()
  for (const room of initialRooms) {
    for (const service of room.services) {
      inRooms.add(service.uniqueId)
    }
  }

  // Services by bridge, aid and iid (first occurrence), for the links
  let byAddress: Map<string, ServiceTypeX> | null = null
  const addressOf = (username: string | undefined, aid: number, iid: number) => `${username}\u0000${aid}\u0000${iid}`

  services.forEach((service) => {
    // Don't put hidden types or combined services into rooms
    // Matter services use deviceType instead of type
    if (HIDDEN_SERVICE_TYPES.has(service.type) || HIDDEN_SERVICE_TYPES.has(service.deviceType!) || combined.has(service.uniqueId!)) {
      return
    }

    // Link services
    if (service.linked) {
      if (!byAddress) {
        byAddress = new Map()
        for (const s of services) {
          const key = addressOf(s.instance?.username, s.aid, s.iid)
          if (!byAddress.has(key)) {
            byAddress.set(key, s)
          }
        }
      }
      const lookup = byAddress
      service.linkedServices = {}
      service.linked.forEach((iid) => {
        service.linkedServices![iid] = lookup.get(addressOf(service.instance?.username, service.aid, iid))!
      })
    }

    // Check if the service has already been allocated to an active room
    if (inRooms.has(service.uniqueId)) {
      return
    }

    // Not in an active room, perhaps the service is in the layout cache
    const cached = findInLayout(layout, service)

    if (cached) {
      // Apply custom attributes from cache before adding to room
      applyLayoutAttributes(service, cached.service)

      // Mark that custom attributes have been applied to this accessory
      customAttributesApplied.add(service.uniqueId!)

      // Add to the correct room
      if (addTo(cached.room.name, service)) {
        inRooms.add(service.uniqueId)
      }
    } else {
      // Mark as processed (even though no custom attributes to apply)
      customAttributesApplied.add(service.uniqueId!)

      // New accessory add to the default room
      const defaultRoom = rooms().find(r => r.isDefault === true)
        || rooms().find(r => r.name === 'Default Room')

      if (defaultRoom) {
        addTo(defaultRoom.name, service)
      } else {
        working = [...rooms(), {
          name: 'Default Room',
          isDefault: true,
          services: [service],
        }]
        copied.add(working.length - 1)
        touched.add('Default Room')
      }
      // The default room always exists by name, so it was added
      inRooms.add(service.uniqueId)
    }
  })

  return { rooms: working, touched }
}

/**
 * A tile reads its linked services (a television's inputs, a heater-cooler's
 * fan, a lock's management), but those links are written onto the parent in
 * place. So that a memoised tile still sees a linked service change, a parent
 * whose linked service was replaced is replaced by a copy too.
 * @param list - every service (written in place)
 * @param changed - the uniqueIds replaced so far; the copied parents are added
 */
export function propagateLinkedChanges(list: ServiceTypeX[], changed: Set<string | undefined>): void {
  let grew = true
  while (grew) {
    grew = false
    list.forEach((service, index) => {
      if (!service.linkedServices || changed.has(service.uniqueId)) {
        return
      }
      const linkedChanged = Object.values(service.linkedServices).some(linked => linked && changed.has(linked.uniqueId))
      if (linkedChanged) {
        list[index] = { ...service } as ServiceTypeX
        changed.add(service.uniqueId)
        grew = true
      }
    })
  }
}

/**
 * Order the services within each room based on the cached layout positions.
 * @param rooms - the current rooms
 * @param layout - the saved layout
 * @param only - which rooms to order; all of them when null
 * @returns the new rooms, or null when none was reordered
 */
export function orderRooms(rooms: AccessoryRoom[], layout: AccessoryLayout, only: ((room: AccessoryRoom) => boolean) | null): AccessoryRoom[] | null {
  let next: AccessoryRoom[] | null = null
  rooms.forEach((room, index) => {
    if (only && !only(room)) {
      return
    }
    const roomCache = layout.find(r => r.name === room.name)
    if (!roomCache) {
      return
    }

    // Each service's position is looked up once, not once per comparison
    const positions = new Map<ServiceTypeX, number>()
    for (const service of room.services) {
      if (!positions.has(service)) {
        positions.set(service, roomCache.services.findIndex(s => servicesMatch(s, service)))
      }
    }
    const sortedServices = room.services.toSorted((a, b) => positions.get(a)! - positions.get(b)!)
    if (sortedServices.every((service, i) => service === room.services[i])) {
      return
    }
    next ??= [...rooms]
    next[index] = { ...room, services: sortedServices }
  })
  return next
}

/**
 * Point the rooms at the current service objects (a payload replaces them
 * rather than mutating). A room none of whose services were replaced keeps
 * its reference.
 * @param rooms - the current rooms
 * @param currentService - the current object for a uniqueId
 * @returns the new rooms, or null when nothing was replaced
 */
export function refreshRoomServices(rooms: AccessoryRoom[], currentService: (uniqueId: string | undefined) => ServiceTypeX | undefined): AccessoryRoom[] | null {
  let changedRooms = false
  const next = rooms.map((room) => {
    let services: ServiceTypeX[] | null = null
    room.services.forEach((service, index) => {
      // Find the updated service from the main accessories array
      const updatedService = currentService(service.uniqueId)
      if (updatedService && updatedService !== service) {
        services ??= [...room.services]
        services[index] = updatedService
      }
    })
    if (!services) {
      return room
    }
    changedRooms = true
    return { ...room, services }
  })
  return changedRooms ? next : null
}

/**
 * Apply custom attributes to services that haven't been processed yet
 * Only applies the custom properties we care about: customName, customType, hidden, onDashboard
 * @param rooms - the rooms (their services are written in place)
 * @param layout - the saved layout
 * @param applied - uniqueIds already processed; the processed ones are added
 */
export function applyCustomAttributes(rooms: AccessoryRoom[], layout: AccessoryLayout, applied: Set<string>): void {
  rooms.forEach((room) => {
    room.services.forEach((service) => {
      // Skip if we've already applied custom attributes to this accessory
      if (applied.has(service.uniqueId!)) {
        return
      }

      // Use servicesMatch to find the cached service across any room in the layout
      const cached = findInLayout(layout, service)
      if (!cached) {
        return
      }

      // Only apply the custom properties we care about, not all properties
      applyLayoutAttributes(service, cached.service)

      // Mark this accessory as processed
      applied.add(service.uniqueId!)
    })
  })
}

/** How the control helpers reach the server. */
export interface AccessoryControl {
  hapReady: () => boolean
  matterReady: () => boolean
  /** Send an `accessory-control` message. */
  send: (payload: unknown) => void
}

/**
 * Generate helpers for accessory control on the services of a payload (the
 * others got theirs when they arrived, and copies carry them over)
 * @param services - the services to equip (written in place)
 * @param control - the ready flags and the socket
 */
export function generateHelpers(services: ServiceTypeX[], control: AccessoryControl): void {
  services.forEach((service) => {
    // Matter accessories use cluster-based control
    if (service.protocol === 'matter') {
      if (!service.getCluster) {
        service.getCluster = (clusterName: string) => {
          const clusters = service.clusters || {}

          if (!clusters[clusterName]) {
            return null
          }

          return {
            attributes: clusters[clusterName],
            /**
             * Fire-and-forget: emits a WebSocket message and resolves immediately.
             * The promise never rejects; errors are not surfaced to callers.
             * Try/catch blocks around setAttributes calls are therefore no-ops for
             * transport errors but kept for documentation and future-proofing.
             */
            setAttributes: (attributes: Record<string, unknown>) => new Promise<void>((resolve) => {
              if (!control.matterReady()) {
                console.warn('Matter control attempted but not ready for control:', {
                  matterReadyForControl: control.matterReady(),
                  uniqueId: service.uniqueId,
                  cluster: clusterName,
                })
                return resolve(undefined)
              }

              control.send({
                set: {
                  uniqueId: service.uniqueId,
                  cluster: clusterName,
                  attributes,
                },
              })
              return resolve(undefined)
            }),
          }
        }
      }
    } else {
      // HAP accessories use characteristic-based control
      if (!service.getCharacteristic) {
        service.getCharacteristic = ((type: string) => {
          const characteristic = service.serviceCharacteristics.find(x => x.type === type)

          if (!characteristic) {
            return null
          }

          characteristic.setValue = ((value: number | string | boolean) => new Promise<void>((resolve) => {
            if (!control.hapReady()) {
              return resolve(undefined)
            }

            control.send({
              set: {
                uniqueId: service.uniqueId,
                aid: service.aid,
                siid: service.iid,
                iid: characteristic.iid,
                value,
              },
            })
            return resolve(undefined)
          })) as any

          return characteristic
        }) as any
      }
    }
  })
}
