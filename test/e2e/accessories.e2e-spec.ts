import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import type { MockInstance } from 'vitest'

import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { AccessoriesModule } from '../../src/modules/accessories/accessories.module.js'
import { AccessoriesService } from '../../src/modules/accessories/accessories.service.js'
import { MatterAccessoriesService } from '../../src/modules/accessories/matter-accessories.service.js'
import { testStoragePath } from '../storage-path.js'
import { authorizeWsClient } from '../ws-client.js'

describe('AccessoriesController (e2e)', () => {
  let app: NestFastifyApplication

  let configService: ConfigService
  let accessoriesService: AccessoriesService

  let authFilePath: string
  let secretsFilePath: string
  let authorization: string

  const refreshCharacteristics = vi.fn()
  const getCharacteristic = vi.fn()
  const setValue = vi.fn()

  const booleanCharacteristic = {
    setValue,
    type: 'On',
    value: true,
    format: 'bool',
    canWrite: true,
  }

  const intCharacteristic = {
    setValue,
    type: 'Active',
    value: 1,
    format: 'uint8',
    maxValue: 1,
    minValue: 0,
    canWrite: true,
  }

  const floatCharacteristic = {
    setValue,
    type: 'TargetTemperature',
    value: 1,
    format: 'float',
    maxValue: 100,
    minValue: 18,
    canWrite: true,
  }

  const mockedServices = [
    {
      refreshCharacteristics,
      getCharacteristic,
      serviceCharacteristics: [
        booleanCharacteristic,
        intCharacteristic,
        floatCharacteristic,
      ],
      uniqueId: 'c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
    },
  ]

  let hapClientMock: MockInstance

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    secretsFilePath = resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets')

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), secretsFilePath)

    // Clear any accessory layout left behind by a previous run. The layout is
    // written by the save test later in this file, so without this the
    // "user not in layout" test sees the saved layout and fails on every run
    // after the first. CI never caught it because CI always starts clean.
    await remove(resolve(process.env.UIX_STORAGE_PATH, 'accessories', 'uiAccessoriesLayout.json'))

    // Enable insecure mode for this test suite.
    configService = new ConfigService()
    configService.homebridgeInsecureMode = true

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AccessoriesModule, AuthModule],
    }).overrideProvider(ConfigService).useValue(configService).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))

    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    accessoriesService = app.get(AccessoriesService)
  })

  beforeEach(async () => {
    vi.resetAllMocks()

    // Enable insecure mode
    configService.homebridgeInsecureMode = true

    // Every test starts from a cold shared load and may refresh discovery
    ;(accessoriesService as any).sharedHapLoad = null
    ;(accessoriesService as any).lastInstanceRefresh = 0

    // Setup mocks
    hapClientMock = vi.spyOn(accessoriesService.hapClient, 'getAllServices')
      .mockResolvedValue(mockedServices as any)
    // Log in once per file - every login runs a 210,000-iteration PBKDF2 hash
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: {
        username: 'admin',
        password: 'admin',
      },
    })).json().access_token}`
  })

  it('GET /accessories (insecure mode enabled)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/accessories',
      headers: {
        authorization,
      },
    })

    expect(hapClientMock).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('GET /accessories (insecure mode disabled)', async () => {
    configService.homebridgeInsecureMode = false

    const res = await app.inject({
      method: 'GET',
      path: '/accessories',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('GET /accessories/layout', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/accessories/layout',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it('GET /accessories/:uniqueId (valid unique id)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(refreshCharacteristics).toHaveBeenCalledTimes(1)
  })

  it('GET /accessories/:uniqueId (invalid unique id)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/accessories/xxxx',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (boolean - valid)', async () => {
    getCharacteristic.mockReturnValueOnce(booleanCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'On',
        value: 'true',
      },
    })

    expect(getCharacteristic).toHaveBeenCalled()
    expect(setValue).toHaveBeenCalledWith(true)
    expect(res.statusCode).toBe(200)
  })

  it('PUT /accessories/:uniqueId (boolean - invalid)', async () => {
    getCharacteristic.mockReturnValueOnce(booleanCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'On',
        value: 'not a boolean',
      },
    })

    expect(getCharacteristic).toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (int - valid)', async () => {
    getCharacteristic.mockReturnValueOnce(intCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'Active',
        value: 1,
      },
    })

    expect(getCharacteristic).toHaveBeenCalled()
    expect(setValue).toHaveBeenCalledWith(1)
    expect(res.statusCode).toBe(200)
  })

  it('PUT /accessories/:uniqueId (int - out of range)', async () => {
    getCharacteristic.mockReturnValueOnce(intCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'Active',
        value: 22,
      },
    })

    expect(getCharacteristic).toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (int - not a number)', async () => {
    // Regression: NaN passed both range checks (every comparison against NaN
    // is false), so a non-numeric value was sent on to Homebridge.
    getCharacteristic.mockReturnValueOnce(intCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'Active',
        value: 'not-a-number',
      },
    })

    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (float - not a number)', async () => {
    getCharacteristic.mockReturnValueOnce(floatCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'TargetTemperature',
        value: 'not-a-number',
      },
    })

    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (float - valid)', async () => {
    getCharacteristic.mockReturnValueOnce(floatCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'TargetTemperature',
        value: '22.5',
      },
    })

    expect(getCharacteristic).toHaveBeenCalled()
    expect(setValue).toHaveBeenCalledWith(22.5)
    expect(res.statusCode).toBe(200)
  })

  it('PUT /accessories/:uniqueId (float - out of range)', async () => {
    getCharacteristic.mockReturnValueOnce(floatCharacteristic)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'TargetTemperature',
        value: '12.6',
      },
    })

    expect(getCharacteristic).toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (invalid characteristic type)', async () => {
    getCharacteristic.mockReturnValueOnce(null)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'NotReal',
        value: '12.6',
      },
    })

    expect(getCharacteristic).toHaveBeenCalledWith('NotReal')
    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
  })

  it('PUT /accessories/:uniqueId (missing characteristic type)', async () => {
    getCharacteristic.mockReturnValueOnce(null)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        value: '12.6',
      },
    })

    expect(getCharacteristic).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('characteristicType should not be null or undefined')
  })

  it('PUT /accessories/:uniqueId (missing value)', async () => {
    getCharacteristic.mockReturnValueOnce(null)

    const res = await app.inject({
      method: 'PUT',
      path: '/accessories/c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c',
      headers: {
        authorization,
      },
      payload: {
        characteristicType: 'TargetTemperature',
      },
    })

    expect(getCharacteristic).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('value should not be null or undefined')
  })

  it('GET /accessories/layout (returns default room when user not in layout)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/accessories/layout',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    const layout = res.json()
    expect(Array.isArray(layout)).toBe(true)
    expect(layout).toHaveLength(1)
    expect(layout[0].name).toBe('Default Room')
    expect(layout[0].isDefault).toBe(true)
  })

  it('service.saveAccessoryLayout should save and return layout', async () => {
    const layout = {
      rooms: [{ name: 'Living Room', services: ['abc'] }],
    }

    const result = await accessoriesService.saveAccessoryLayout('admin', layout as any)
    expect(result).toEqual(layout)

    // Now getAccessoryLayout should return the saved layout
    const loaded = await accessoriesService.getAccessoryLayout('admin')
    expect(loaded).toEqual(layout)
  })

  it('service.connect survives a malformed accessory-control payload', async () => {
    // Regression: the accessory-control handler is an async socket listener.
    // socket.io does not await listeners and there is no global
    // unhandledRejection handler, so `msg.refresh` throwing on an undefined
    // payload rejected unhandled - which exits the Node process. Vitest fails
    // this test on any unhandled rejection, so it genuinely catches that.
    const { EventEmitter } = await import('node:events')
    const client = authorizeWsClient(new EventEmitter() as any)
    client.emit = vi.fn(client.emit.bind(client))

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)
    // the full connect path calls refreshCharacteristics on each service,
    // which the shared fixture does not carry
    hapClientMock.mockResolvedValue((mockedServices as any[]).map(s => ({
      ...s,
      refreshCharacteristics: vi.fn().mockResolvedValue(undefined),
    })) as any)

    await accessoriesService.connect(client)

    // a malformed payload must be ignored, not crash the process
    client.emit('accessory-control')
    client.emit('accessory-control', 'not-an-object')

    // and the session still works afterwards: a real refresh still runs.
    // The listener is async and not awaited by the emitter, so wait for it;
    // the two malformed calls above started first and settle before it
    hapClientMock.mockClear()
    client.emit('accessory-control', { refresh: true })
    await vi.waitFor(() => expect(hapClientMock).toHaveBeenCalledTimes(1))

    client.emit('disconnect')
  })

  it('service.connect shares one characteristic monitor across clients', async () => {
    // Regression: each client used to call hapClient.monitorCharacteristics(),
    // and every call finishes the previous monitor - so opening the
    // accessories page in a second tab silently froze live updates in the
    // first. One shared monitor, per-client listeners.
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    const monitorSpy = vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)
    hapClientMock.mockResolvedValue((mockedServices as any[]).map(s => ({
      ...s,
      refreshCharacteristics: vi.fn().mockResolvedValue(undefined),
    })) as any)

    const clientA = new EventEmitter() as any
    const clientB = new EventEmitter() as any
    await accessoriesService.connect(clientA)
    await accessoriesService.connect(clientB)

    // one monitor for both clients
    expect(monitorSpy).toHaveBeenCalledTimes(1)

    // both clients receive live updates
    const emitsA = vi.fn()
    const emitsB = vi.fn()
    clientA.on('accessories-data', emitsA)
    clientB.on('accessories-data', emitsB)
    monitor.emit('service-update', { uniqueId: 'x' })
    expect(emitsA).toHaveBeenCalledTimes(1)
    expect(emitsB).toHaveBeenCalledTimes(1)

    // one client leaving must not silence the other, and must not finish the monitor
    clientA.emit('disconnect')
    monitor.emit('service-update', { uniqueId: 'y' })
    expect(emitsA).toHaveBeenCalledTimes(1)
    expect(emitsB).toHaveBeenCalledTimes(2)
    expect(monitor.finish).not.toHaveBeenCalled()

    clientB.emit('disconnect')
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.connect cleans up a client that disconnects mid-setup', async () => {
    // Regression: the disconnect handler used to be attached only after the
    // setup awaits, so a client leaving during them stayed in activeClients
    // forever and still got listeners plus a 3s reload timer wired up.
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null
    const svc = accessoriesService as any

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    let releaseMonitor: (m: any) => void
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockReturnValue(new Promise((res) => {
      releaseMonitor = res
    }) as any)
    const refreshInstances = vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)

    const client = authorizeWsClient(new EventEmitter() as any)
    const connecting = accessoriesService.connect(client)
    // still waiting on the monitor
    await vi.waitFor(() => expect(accessoriesService.hapClient.monitorCharacteristics).toHaveBeenCalledTimes(1))
    expect(svc.activeClients.has(client)).toBe(true)

    client.emit('disconnect')
    expect(svc.activeClients.has(client)).toBe(false)
    expect(svc.clientSessions.has(client)).toBe(false)

    releaseMonitor!(monitor)
    await connecting

    // nothing was wired up after the client left
    expect(monitor.listenerCount('service-update')).toBe(0)
    expect(client.listenerCount('accessory-control')).toBe(0)
    expect(accessoriesService.hapClient.listenerCount('instance-discovered')).toBe(0)
    expect(refreshInstances).not.toHaveBeenCalled()
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.connect cleans up when a setup step rejects', async () => {
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null
    const svc = accessoriesService as any

    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockRejectedValue(new Error('no monitor'))
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)

    const client = authorizeWsClient(new EventEmitter() as any)
    await expect(accessoriesService.connect(client)).rejects.toThrow('no monitor')

    expect(svc.activeClients.has(client)).toBe(false)
    expect(svc.clientSessions.has(client)).toBe(false)
    expect(client.listenerCount('disconnect')).toBe(0)
    expect(client.listenerCount('end')).toBe(0)
    // the failed attempt is not cached, so the next client can retry
    expect(svc.hapMonitorPromise).toBeNull()
  })

  it('service.connect does not re-fetch every service after getAllServices', async () => {
    // getAllServices() already returns current values, so the per-service
    // GET /characteristics fan-out on every load was pure overhead
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)
    const refreshA = vi.fn().mockResolvedValue(undefined)
    const refreshB = vi.fn().mockResolvedValue(undefined)
    const setCharacteristic = vi.fn().mockResolvedValue(undefined)
    hapClientMock.mockResolvedValue([
      { uniqueId: 'a', serviceCharacteristics: [], refreshCharacteristics: refreshA, setCharacteristic },
      { uniqueId: 'b', serviceCharacteristics: [], refreshCharacteristics: refreshB, setCharacteristic },
    ] as any)

    const client = authorizeWsClient(new EventEmitter() as any)
    await accessoriesService.connect(client)
    expect(refreshA).not.toHaveBeenCalled()
    expect(refreshB).not.toHaveBeenCalled()

    // a characteristic write re-reads only the service it touched, without a
    // full reload
    vi.useFakeTimers()
    try {
      hapClientMock.mockClear()
      client.emit('accessory-control', { set: { uniqueId: 'a', iid: 10, value: true } })
      await vi.advanceTimersByTimeAsync(1600)
      expect(setCharacteristic).toHaveBeenCalledWith(10, true)
      expect(refreshA).toHaveBeenCalledTimes(1)
      expect(refreshB).not.toHaveBeenCalled()
      expect(hapClientMock).not.toHaveBeenCalled()
    } finally {
      client.emit('disconnect')
      vi.useRealTimers()
    }
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.connect coalesces a burst of instance discoveries into one reload request', async () => {
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)

    vi.useFakeTimers()
    const client = authorizeWsClient(new EventEmitter() as any)
    try {
      await accessoriesService.connect(client)
      const reloads = vi.fn()
      client.on('accessories-reload-required', reloads)

      accessoriesService.hapClient.emit('instance-discovered', {})
      await vi.advanceTimersByTimeAsync(500)
      accessoriesService.hapClient.emit('instance-discovered', {})
      accessoriesService.hapClient.emit('instance-discovered', {})
      expect(reloads).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(AccessoriesService.INSTANCE_RELOAD_DEBOUNCE_MS)
      expect(reloads).toHaveBeenCalledTimes(1)

      // a pending reload is dropped when the client leaves
      accessoriesService.hapClient.emit('instance-discovered', {})
      client.emit('disconnect')
      await vi.advanceTimersByTimeAsync(AccessoriesService.INSTANCE_RELOAD_DEBOUNCE_MS)
      expect(reloads).toHaveBeenCalledTimes(1)
    } finally {
      client.emit('disconnect')
      vi.useRealTimers()
    }
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.connect sends the delayed second load only when the data changed', async () => {
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)
    // An instance announced while setup runs is what makes the second load worth it
    let current: any = [{ uniqueId: 'a', serviceCharacteristics: [{ type: 'On', value: false }] }]
    hapClientMock.mockImplementation(async () => {
      accessoriesService.hapClient.emit('instance-discovered', {})
      return current
    })

    vi.useFakeTimers()
    const unchanged = authorizeWsClient(new EventEmitter() as any)
    const changed = authorizeWsClient(new EventEmitter() as any)
    try {
      unchanged.emit = vi.fn(unchanged.emit.bind(unchanged))
      await accessoriesService.connect(unchanged)
      vi.mocked(unchanged.emit).mockClear()
      await vi.advanceTimersByTimeAsync(3000)
      // reloaded, still ready for control, but the identical list is not re-sent
      expect(hapClientMock).toHaveBeenCalledTimes(2)
      expect(unchanged.emit).toHaveBeenCalledWith('hap-accessories-ready-for-control')
      expect(unchanged.emit).not.toHaveBeenCalledWith('accessories-data', expect.anything())

      // an explicit refresh always sends
      unchanged.emit('accessory-control', { refresh: true })
      await vi.waitFor(() => expect(unchanged.emit).toHaveBeenCalledWith('accessories-data', expect.anything()))
      unchanged.emit('disconnect')

      // (past the shared load's lifetime, so this tab runs a load of its own)
      await vi.advanceTimersByTimeAsync(AccessoriesService.SHARED_LOAD_TTL_MS)
      changed.emit = vi.fn(changed.emit.bind(changed))
      await accessoriesService.connect(changed)
      vi.mocked(changed.emit).mockClear()
      const next = [{ uniqueId: 'a', serviceCharacteristics: [{ type: 'On', value: true }] }]
      current = next
      await vi.advanceTimersByTimeAsync(3000)
      expect(changed.emit).toHaveBeenCalledWith('accessories-data', next)
    } finally {
      unchanged.emit('disconnect')
      changed.emit('disconnect')
      vi.useRealTimers()
    }
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.connect skips the delayed second load when nothing was discovered during setup', async () => {
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)

    vi.useFakeTimers()
    const client = authorizeWsClient(new EventEmitter() as any)
    try {
      await accessoriesService.connect(client)
      await vi.advanceTimersByTimeAsync(5000)
      expect(hapClientMock).toHaveBeenCalledTimes(1)
      expect(accessoriesService.hapClient.listenerCount('instance-discovered')).toBe(1)
    } finally {
      client.emit('disconnect')
      vi.useRealTimers()
    }
    expect(accessoriesService.hapClient.listenerCount('instance-discovered')).toBe(0)
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.connect shares one HAP load between clients, and refreshes discovery at most every 30 s', async () => {
    const { EventEmitter } = await import('node:events')
    ;(accessoriesService as any).hapMonitorPromise = null

    const monitor = new EventEmitter() as any
    monitor.finish = vi.fn()
    vi.spyOn(accessoriesService.hapClient, 'monitorCharacteristics').mockResolvedValue(monitor)
    const refreshInstances = vi.spyOn(accessoriesService.hapClient, 'refreshInstances').mockImplementation(() => undefined)

    vi.useFakeTimers()
    const clients = [0, 1, 2].map(() => authorizeWsClient(new EventEmitter() as any))
    try {
      // three tabs connecting together: one getAllServices, one discovery refresh
      await Promise.all(clients.map(client => accessoriesService.connect(client)))
      expect(hapClientMock).toHaveBeenCalledTimes(1)
      expect(refreshInstances).toHaveBeenCalledTimes(1)

      // a tab connecting shortly after reuses the finished load
      const late = authorizeWsClient(new EventEmitter() as any)
      clients.push(late)
      await vi.advanceTimersByTimeAsync(1000)
      await accessoriesService.connect(late)
      expect(hapClientMock).toHaveBeenCalledTimes(1)

      // but an explicit refresh always reads current data
      late.emit('accessory-control', { refresh: true })
      await vi.waitFor(() => expect(hapClientMock).toHaveBeenCalledTimes(2))

      // past the shared-load lifetime a new tab loads again; discovery is
      // only refreshed again once 30 s have passed
      await vi.advanceTimersByTimeAsync(AccessoriesService.SHARED_LOAD_TTL_MS)
      const next = authorizeWsClient(new EventEmitter() as any)
      clients.push(next)
      await accessoriesService.connect(next)
      expect(hapClientMock).toHaveBeenCalledTimes(3)
      expect(refreshInstances).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(AccessoriesService.REFRESH_INSTANCES_MIN_INTERVAL_MS)
      const later = authorizeWsClient(new EventEmitter() as any)
      clients.push(later)
      await accessoriesService.connect(later)
      expect(refreshInstances).toHaveBeenCalledTimes(2)
    } finally {
      for (const client of clients) {
        client.emit('disconnect')
      }
      vi.useRealTimers()
    }
    ;(accessoriesService as any).hapMonitorPromise = null
  })

  it('service.resetInstancePool should not throw when insecure mode disabled', () => {
    configService.homebridgeInsecureMode = false
    // Should be a no-op when insecure mode is disabled
    expect(() => accessoriesService.resetInstancePool()).not.toThrow()
    configService.homebridgeInsecureMode = true
  })

  /**
   * Even in insecure mode a bridge checks the `Authorization` header against
   * ITS OWN pincode, so a child bridge with a `pin` in its `_bridge` block
   * answered 470 and was dropped during discovery - its accessories never
   * appeared on the Accessories page (#2936).
   */
  describe('per-child-bridge pins (#2936)', () => {
    const originalConfig = { platforms: undefined, accessories: undefined }

    beforeEach(() => {
      originalConfig.platforms = configService.homebridgeConfig.platforms
      originalConfig.accessories = configService.homebridgeConfig.accessories
    })

    afterEach(() => {
      configService.homebridgeConfig.platforms = originalConfig.platforms
      configService.homebridgeConfig.accessories = originalConfig.accessories
    })

    it('collects the pin of every child bridge that sets one', () => {
      configService.homebridgeConfig.platforms = [
        { platform: 'WithPin', _bridge: { username: '0E:AA:BB:CC:DD:EE', pin: '999-88-777' } },
        { platform: 'NoPin', _bridge: { username: '0E:11:22:33:44:55' } },
        { platform: 'NoBridge' },
      ] as any
      configService.homebridgeConfig.accessories = [
        { accessory: 'AccWithPin', name: 'A', _bridge: { username: '0E:99:88:77:66:55', pin: '111-22-333' } },
      ] as any

      const pins = (accessoriesService as any).getChildBridgePins()

      // only the two that set their own - everything else falls back to the main pin
      expect(pins).toEqual({
        '0E:AA:BB:CC:DD:EE': '999-88-777',
        '0E:99:88:77:66:55': '111-22-333',
      })
    })

    it('returns an empty map when nothing sets its own pin', () => {
      configService.homebridgeConfig.platforms = [
        { platform: 'NoPin', _bridge: { username: '0E:11:22:33:44:55' } },
      ] as any
      configService.homebridgeConfig.accessories = undefined

      expect((accessoriesService as any).getChildBridgePins()).toEqual({})
    })

    it('does not throw when the config has no platforms or accessories', () => {
      configService.homebridgeConfig.platforms = undefined
      configService.homebridgeConfig.accessories = undefined

      expect(() => (accessoriesService as any).getChildBridgePins()).not.toThrow()
    })
  })

  /**
   * Core loses its Matter monitoring switch when the Homebridge process
   * restarts, so the service must clear its one-shot on status 'down' and
   * re-arm it on 'ok' while viewers are connected (#3993). Without that,
   * external (Matter controller) changes silently stop reaching the
   * accessories page until the UI process restarts.
   */
  describe('matter monitoring re-arm after homebridge restart (#3993)', () => {
    let ipcService: HomebridgeIpcService
    let svc: any

    beforeEach(() => {
      ipcService = app.get(HomebridgeIpcService)
      svc = app.get(MatterAccessoriesService) as any
      svc.activeClients.clear()
    })

    afterEach(() => {
      svc.activeClients.clear()
      svc.matterMonitoringActive = false
      svc.matterMonitoringStartPromise = null
      svc.matterUpdateListener = null
    })

    it('on "down", forgets the one-shot and detaches the matter update listener', () => {
      const listener = vi.fn()
      ipcService.on('matterEvent', listener)
      svc.matterUpdateListener = listener
      svc.matterMonitoringActive = true
      svc.matterMonitoringStartPromise = Promise.resolve()

      ipcService.emit('serverStatusUpdate', { status: 'down' })

      expect(svc.matterMonitoringActive).toBe(false)
      expect(svc.matterMonitoringStartPromise).toBeNull()
      expect(svc.matterUpdateListener).toBeNull()
      expect(ipcService.listeners('matterEvent')).not.toContain(listener)
    })

    it('on "ok" with viewers connected, re-arms monitoring and tells them to re-fetch', async () => {
      const client = { emit: vi.fn() }
      svc.activeClients.add(client)
      const ensureSpy = vi.spyOn(svc, 'ensureMatterMonitoringStarted').mockImplementation(async () => {
        svc.matterMonitoringActive = true
      })

      ipcService.emit('serverStatusUpdate', { status: 'down' })
      ipcService.emit('serverStatusUpdate', { status: 'ok' })

      expect(ensureSpy).toHaveBeenCalledTimes(1)
      // the reload event lands after the ensure promise resolves
      await new Promise(setImmediate)
      expect(client.emit).toHaveBeenCalledWith('matter-accessories-reload-required')
    })

    it('on "ok" with nobody connected, leaves re-arming to the next client connect', () => {
      const ensureSpy = vi.spyOn(svc, 'ensureMatterMonitoringStarted').mockResolvedValue(undefined)

      ipcService.emit('serverStatusUpdate', { status: 'down' })
      ipcService.emit('serverStatusUpdate', { status: 'ok' })

      expect(ensureSpy).not.toHaveBeenCalled()
    })

    it('does not emit the re-fetch event when the start returned early (matter off)', async () => {
      const client = { emit: vi.fn() }
      svc.activeClients.add(client)
      // resolves without flipping matterMonitoringActive - the "matter not
      // supported / not enabled" early-return shape
      vi.spyOn(svc, 'ensureMatterMonitoringStarted').mockResolvedValue(undefined)

      ipcService.emit('serverStatusUpdate', { status: 'down' })
      ipcService.emit('serverStatusUpdate', { status: 'ok' })

      await new Promise(setImmediate)
      expect(client.emit).not.toHaveBeenCalled()
    })
  })

  afterAll(async () => {
    await app.close()
  })
})
