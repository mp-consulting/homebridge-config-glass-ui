import type { AccessoryLayout } from '@/core/accessories/accessories.interfaces'
import type { FakeIoNamespace, FakeWs } from '@/testing'
import type { ServiceType } from '@homebridge/hap-client'

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessoriesService } from '@/core/accessories/accessories'
import { useAuthStore } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { ws as realWs } from '@/core/ws'
import { Accessories } from '@/modules/accessories/Accessories'
import { fakeWs, makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))

// AccessoryTile asks the tile map for its tile on every render, so counting
// `tileFor` calls per service counts AccessoryTile renders
const tileRenders = vi.hoisted(() => new Map<string, number>())
vi.mock('@/core/accessories/accessory-tile/tile-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/accessories/accessory-tile/tile-map')>()
  return {
    ...actual,
    tileFor: (service: { uniqueId: string }) => {
      tileRenders.set(service.uniqueId, (tileRenders.get(service.uniqueId) ?? 0) + 1)
      return actual.tileFor(service as never)
    },
  }
})

const ws = realWs as unknown as FakeWs

const SERVICE_COUNT = 300
const ROOM_COUNT = 10
const UPDATE_COUNT = 50
const BRIDGE = '0E:AA:AA:AA:AA:AA'

function rawSwitch(index: number, on = false): ServiceType {
  return {
    aid: index + 2,
    iid: 10,
    uuid: '0000-Switch',
    type: 'Switch',
    humanType: 'Switch',
    serviceName: `Switch ${index}`,
    serviceCharacteristics: [{ aid: index + 2, iid: 11, uuid: '0000-On', type: 'On', value: on, format: 'bool', perms: ['pr', 'pw', 'ev'] }],
    accessoryInformation: { 'Name': `Switch ${index}`, 'Serial Number': `SERIAL-${index}` },
    instance: { name: 'Bridge A', username: BRIDGE },
    values: { On: on },
    uniqueId: `svc-${index}`,
  } as unknown as ServiceType
}

function layout(): AccessoryLayout {
  return Array.from({ length: ROOM_COUNT }, (_, room) => ({
    name: `Room ${room}`,
    isDefault: room === 0,
    services: Array.from({ length: SERVICE_COUNT / ROOM_COUNT }, (_, slot) => {
      const index = room * (SERVICE_COUNT / ROOM_COUNT) + slot
      return { uniqueId: `svc-${index}`, name: `Switch ${index}`, serial: `SERIAL-${index}`, bridge: BRIDGE, aid: index + 2, iid: 10, uuid: '0000-Switch' }
    }),
  }))
}

/**
 * The accessories page under a live feed: one `accessories-data` event per
 * characteristic change must re-render only the tile that changed.
 */
describe('accessories page performance', () => {
  let io: FakeIoNamespace

  async function flush() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  async function openWithAll() {
    useSettingsStore.setState(makeSettingsState({ env: { enableAccessories: true, hasInstalledPlugins: true } as never }))
    useAuthStore.setState(makeAuthState({ user: { admin: false } }))
    ws.namespace('status')
    ws.namespace('child-bridges').socket.respondTo('get-homebridge-child-bridge-status', [])
    io = ws.namespace('accessories', { connected: true })
    io.socket.respondTo('get-layout', () => layout())
    io.socket.respondTo('save-layout', () => ({ ok: true }))
    const result = renderWithProviders(<Accessories />)
    await flush()
    act(() => {
      io.socket.fire('accessories-data', Array.from({ length: SERVICE_COUNT }, (_, index) => rawSwitch(index)))
      io.socket.fire('hap-accessories-ready-for-control')
    })
    return result
  }

  beforeEach(() => {
    vi.spyOn(settingsActions, 'setPageTitle').mockImplementation(() => {})
    tileRenders.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-renders only the tile whose service changed', async () => {
    const { unmount } = await openWithAll()
    expect(document.querySelectorAll('.accessory-item')).toHaveLength(SERVICE_COUNT)

    tileRenders.clear()
    act(() => {
      io.socket.fire('accessories-data', [rawSwitch(42, true)])
    })

    expect(Object.fromEntries(tileRenders)).toEqual({ 'svc-42': 1 })
    unmount()
  })

  it(`handles ${UPDATE_COUNT} single-service updates across ${SERVICE_COUNT} services`, async () => {
    const { unmount } = await openWithAll()

    tileRenders.clear()
    const start = performance.now()
    for (let update = 0; update < UPDATE_COUNT; update += 1) {
      act(() => {
        io.socket.fire('accessories-data', [rawSwitch((update * 7) % SERVICE_COUNT, update % 2 === 0)])
      })
    }
    const elapsed = performance.now() - start
    const renders = [...tileRenders.values()].reduce((sum, count) => sum + count, 0)

    process.stdout.write(`[perf] ${UPDATE_COUNT} updates / ${SERVICE_COUNT} services: ${elapsed.toFixed(1)} ms (${(elapsed / UPDATE_COUNT).toFixed(2)} ms/update), ${renders} tile renders\n`)
    expect(renders).toBe(UPDATE_COUNT)
    unmount()
  })

  it(`processes ${UPDATE_COUNT} updates in the service alone`, async () => {
    const serviceWs = fakeWs()
    const serviceIo = serviceWs.namespace('accessories', { connected: true })
    serviceIo.socket.respondTo('get-layout', () => layout())
    const service = new AccessoriesService({ ws: serviceWs as never, getUser: () => ({ admin: false, username: 'admin' }) })
    await service.start()
    serviceIo.socket.fire('accessories-data', Array.from({ length: SERVICE_COUNT }, (_, index) => rawSwitch(index)))

    let kept = 0
    let elapsed = 0
    for (let update = 0; update < UPDATE_COUNT; update += 1) {
      const before = service.rooms()
      const start = performance.now()
      serviceIo.socket.fire('accessories-data', [rawSwitch((update * 7) % SERVICE_COUNT, update % 2 === 0)])
      elapsed += performance.now() - start
      kept += service.rooms().filter((room, index) => room === before[index]).length
    }

    process.stdout.write(`[perf] service only: ${elapsed.toFixed(1)} ms (${(elapsed / UPDATE_COUNT).toFixed(3)} ms/update), ${(kept / UPDATE_COUNT).toFixed(1)}/${ROOM_COUNT} rooms kept per update\n`)
    expect(kept).toBe(UPDATE_COUNT * (ROOM_COUNT - 1))
    expect(service.rooms().flatMap(room => room.services)).toHaveLength(SERVICE_COUNT)
    service.stop()
  })
})
