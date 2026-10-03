import type { AccessoryLayout, AccessoryLayoutService, ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryRoom } from '@/core/accessories/accessory-layout'

import { describe, expect, it, vi } from 'vitest'

import {
  applyCustomAttributes,
  combineRelatedServices,
  generateHelpers,
  orderRooms,
  parseServices,
  propagateLinkedChanges,
  refreshRoomServices,
  sameServiceData,
  ServiceIndex,
  sortIntoRooms,
} from '@/core/accessories/accessory-grouping'
import { layoutFromRooms, mergeWithUndiscoveredServices, servicesMatch } from '@/core/accessories/accessory-layout'

const BRIDGE = '0E:AA:AA:AA:AA:AA'

/** A raw HAP service, as the socket delivers it. */
function hap(overrides: Record<string, any> = {}): ServiceTypeX {
  const type = overrides.type ?? 'Switch'
  return {
    aid: 1,
    iid: 10,
    uuid: `0000-${type}`,
    type,
    humanType: type,
    serviceName: overrides.serviceName ?? 'Test Switch',
    serviceCharacteristics: [{ aid: 1, iid: 11, type: 'On', value: false }],
    accessoryInformation: { 'Name': 'Accessory', 'Serial Number': 'SERIAL-1' },
    instance: { name: 'Bridge', username: BRIDGE },
    values: {},
    uniqueId: 'hap-1',
    ...overrides,
  } as unknown as ServiceTypeX
}

function entry(overrides: Partial<AccessoryLayoutService> = {}): AccessoryLayoutService {
  return { uniqueId: 'hap-1', name: 'Test Switch', bridge: BRIDGE, ...overrides } as AccessoryLayoutService
}

function room(name: string, services: ServiceTypeX[] = [], isDefault?: boolean): AccessoryRoom {
  return { name, isDefault, services }
}

describe('accessory grouping', () => {
  describe('parseServices', () => {
    it('takes the first payload as the list', () => {
      const incoming = [hap(), hap({ uniqueId: 'hap-2' })]
      const { services, changed } = parseServices([], incoming, new ServiceIndex(), new Set())
      expect(services).toBe(incoming)
      expect([...changed]).toEqual(['hap-1', 'hap-2'])
    })

    it('keeps the object of a service whose data did not change', () => {
      const first = hap()
      const list = [first]
      const { changed } = parseServices(list, [hap()], new ServiceIndex(), new Set())
      expect(list[0]).toBe(first)
      expect(changed.size).toBe(0)
    })

    it('replaces a changed service and forgets its applied attributes', () => {
      const list = [hap()]
      const applied = new Set(['hap-1'])
      const next = hap({ values: { On: true } })
      const { changed } = parseServices(list, [next], new ServiceIndex(), applied)
      expect(list[0]).toBe(next)
      expect(changed.has('hap-1')).toBe(true)
      expect(applied.has('hap-1')).toBe(false)
    })

    it('appends a new service', () => {
      const list = [hap()]
      const index = new ServiceIndex()
      parseServices(list, [hap({ uniqueId: 'hap-2' })], index, new Set())
      expect(list.map(s => s.uniqueId)).toEqual(['hap-1', 'hap-2'])
      expect(index.indexOf(list, 'hap-2')).toBe(1)
    })
  })

  it('compares service data without the fields the client writes', () => {
    const existing = Object.assign(hap(), { customName: 'Mine', getCharacteristic: () => null })
    expect(sameServiceData(existing, hap())).toBe(true)
    expect(sameServiceData(existing, hap({ serviceName: 'Other' }))).toBe(false)
  })

  describe('combineRelatedServices', () => {
    it('links the single fan of a heater-cooler and drops it from the rooms', () => {
      const heater = hap({ type: 'HeaterCooler', iid: 10, uniqueId: 'heater' })
      const fan = hap({ type: 'Fanv2', iid: 20, uniqueId: 'fan' })
      const other = room('Other', [hap({ uniqueId: 'x' })])
      const rooms = [room('Hall', [heater, fan]), other]

      const result = combineRelatedServices([heater, fan], rooms)

      expect(heater.linkedServices![20]).toBe(fan)
      expect([...result.combined]).toEqual(['fan'])
      expect(result.rooms![0].services).toEqual([heater])
      expect(result.rooms![1]).toBe(other)
    })

    it('links the lock management of a single lock mechanism', () => {
      const mechanism = hap({ type: 'LockMechanism', iid: 10, uniqueId: 'lock' })
      const management = hap({ type: 'LockManagement', iid: 11, uniqueId: 'mgmt' })
      const result = combineRelatedServices([mechanism, management], [])
      expect(mechanism.linkedServices![11]).toBe(management)
      expect(result.rooms).toBeNull()
    })

    it('leaves services of different accessories apart', () => {
      const heater = hap({ type: 'HeaterCooler', uniqueId: 'heater' })
      const fan = hap({ type: 'Fan', uniqueId: 'fan', accessoryInformation: { 'Name': 'Other', 'Serial Number': 'S2' } })
      const result = combineRelatedServices([heater, fan], [])
      expect(heater.linkedServices).toBeUndefined()
      expect(result.combined.size).toBe(0)
    })
  })

  describe('sortIntoRooms', () => {
    it('puts a service the layout knows into its room, with its custom attributes', () => {
      const service = hap()
      const layout: AccessoryLayout = [{ name: 'Kitchen', services: [entry({ customName: 'Kettle' })] }]
      const applied = new Set<string>()
      const kitchen = room('Kitchen')
      const { rooms, touched } = sortIntoRooms({ services: [service], rooms: [kitchen], layout, combined: new Set(), customAttributesApplied: applied })

      expect(rooms![0].services).toEqual([service])
      expect(rooms![0]).not.toBe(kitchen)
      expect(service.customName).toBe('Kettle')
      expect([...touched]).toEqual(['Kitchen'])
      expect(applied.has('hap-1')).toBe(true)
    })

    it('puts an unknown service into the default room', () => {
      const service = hap({ uniqueId: 'new' })
      const { rooms } = sortIntoRooms({ services: [service], rooms: [room('A'), room('B', [], true)], layout: [], combined: new Set(), customAttributesApplied: new Set() })
      expect(rooms![1].services).toEqual([service])
    })

    it('creates a default room when there is none', () => {
      const service = hap({ uniqueId: 'new' })
      const { rooms, touched } = sortIntoRooms({ services: [service], rooms: [], layout: [], combined: new Set(), customAttributesApplied: new Set() })
      expect(rooms).toEqual([{ name: 'Default Room', isDefault: true, services: [service] }])
      expect(touched.has('Default Room')).toBe(true)
    })

    it('skips hidden types, combined services and services already in a room', () => {
      const placed = hap()
      const rooms = [room('A', [placed], true)]
      const result = sortIntoRooms({
        services: [placed, hap({ type: 'InputSource', uniqueId: 'input' }), hap({ uniqueId: 'fan' })],
        rooms,
        layout: [],
        combined: new Set(['fan']),
        customAttributesApplied: new Set(),
      })
      expect(result.rooms).toBeNull()
      expect(result.touched.size).toBe(0)
    })

    it('links the services a service lists', () => {
      const tv = hap({ type: 'Television', uniqueId: 'tv', iid: 10, linked: [20] })
      const input = hap({ type: 'InputSource', uniqueId: 'input', iid: 20 })
      sortIntoRooms({ services: [tv, input], rooms: [room('A', [], true)], layout: [], combined: new Set(), customAttributesApplied: new Set() })
      expect(tv.linkedServices![20]).toBe(input)
    })
  })

  it('copies a parent whose linked service changed', () => {
    const fan = hap({ uniqueId: 'fan' })
    const parent = Object.assign(hap({ uniqueId: 'parent' }), { linkedServices: { 20: fan } })
    const list = [parent, fan]
    const changed = new Set<string | undefined>(['fan'])
    propagateLinkedChanges(list, changed)
    expect(list[0]).not.toBe(parent)
    expect(list[0]).toEqual(parent)
    expect(changed.has('parent')).toBe(true)
  })

  it('orders a room by the layout, leaving ordered rooms alone', () => {
    const a = hap({ uniqueId: 'a', serviceName: 'A' })
    const b = hap({ uniqueId: 'b', serviceName: 'B' })
    const layout: AccessoryLayout = [{ name: 'R', services: [entry({ uniqueId: 'b', name: 'B' }), entry({ uniqueId: 'a', name: 'A' })] }]
    const next = orderRooms([room('R', [a, b])], layout, null)
    expect(next![0].services).toEqual([b, a])
    expect(orderRooms(next!, layout, null)).toBeNull()
  })

  it('points the rooms at the current service objects', () => {
    const old = hap()
    const current = hap({ values: { On: true } })
    const untouched = room('B', [hap({ uniqueId: 'b' })])
    const next = refreshRoomServices([room('A', [old]), untouched], id => (id === 'hap-1' ? current : undefined))
    expect(next![0].services[0]).toBe(current)
    expect(next![1]).toBe(untouched)
    expect(refreshRoomServices(next!, id => (id === 'hap-1' ? current : undefined))).toBeNull()
  })

  it('applies the layout attributes once per service', () => {
    const service = hap()
    const layout: AccessoryLayout = [{ name: 'A', services: [entry({ customType: 'Lightbulb', hidden: true })] }]
    const applied = new Set<string>()
    applyCustomAttributes([room('A', [service])], layout, applied)
    expect(service.customType).toBe('Lightbulb')
    expect(service.hidden).toBe(true)
    expect(applied.has('hap-1')).toBe(true)
  })

  describe('generateHelpers', () => {
    it('gives a HAP service a setValue that sends once control is ready', async () => {
      const service = hap()
      const send = vi.fn()
      let ready = false
      generateHelpers([service], { hapReady: () => ready, matterReady: () => false, send })

      await service.getCharacteristic!('On')!.setValue!(true)
      expect(send).not.toHaveBeenCalled()

      ready = true
      await service.getCharacteristic!('On')!.setValue!(true)
      expect(send).toHaveBeenCalledWith({ set: { uniqueId: 'hap-1', aid: 1, siid: 10, iid: 11, value: true } })
      expect(service.getCharacteristic!('Missing')).toBeNull()
    })

    it('gives a Matter service a cluster setter', async () => {
      const service = hap({ protocol: 'matter', uniqueId: 'matter:1', clusters: { onOff: { onOff: false } } })
      const send = vi.fn()
      generateHelpers([service], { hapReady: () => false, matterReady: () => true, send })

      const cluster = service.getCluster!('onOff')!
      expect(cluster.attributes).toEqual({ onOff: false })
      await cluster.setAttributes({ onOff: true })
      expect(send).toHaveBeenCalledWith({ set: { uniqueId: 'matter:1', cluster: 'onOff', attributes: { onOff: true } } })
      expect(service.getCluster!('missing')).toBeNull()
    })
  })
})

describe('accessory layout', () => {
  it('matches services by nameBasedUniqueId before uniqueId', () => {
    expect(servicesMatch(entry({ nameBasedUniqueId: 'n1', uniqueId: 'x' }), { nameBasedUniqueId: 'n1', uniqueId: 'y' })).toBe(true)
    expect(servicesMatch(entry({ nameBasedUniqueId: 'n1' }), { nameBasedUniqueId: 'n2', uniqueId: 'hap-1' })).toBe(false)
    expect(servicesMatch(entry(), { uniqueId: 'hap-1' })).toBe(true)
  })

  it('matches a Matter service by uniqueId and bridge only', () => {
    const cached = entry({ uniqueId: 'matter:1', bridge: 'B' })
    expect(servicesMatch(cached, { uniqueId: 'matter:1', protocol: 'matter', instance: { username: 'B' } })).toBe(true)
    expect(servicesMatch(cached, { uniqueId: 'matter:1', protocol: 'matter', instance: { username: 'C' } })).toBe(false)
  })

  it('flags the first room as the default when none is', () => {
    const layout = layoutFromRooms([room('A', [hap()]), room('B')])
    expect(layout[0].isDefault).toBe(true)
    expect(layout[0].services[0]).toMatchObject({ uniqueId: 'hap-1', name: 'Test Switch', bridge: BRIDGE })
  })

  it('keeps undiscovered services, moving those of a deleted room to the default room', () => {
    const current: AccessoryLayout = [{ name: 'Default', isDefault: true, services: [] }]
    const original: AccessoryLayout = [
      { name: 'Gone', services: [entry({ uniqueId: 'lost', name: 'Lost', customName: 'Keep me' })] },
    ]
    const merged = mergeWithUndiscoveredServices(current, original)
    expect(merged).toHaveLength(1)
    expect(merged[0].services).toEqual([expect.objectContaining({ uniqueId: 'lost', customName: 'Keep me' })])
  })
})
