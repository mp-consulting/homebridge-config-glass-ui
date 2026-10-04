import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { ChildBridgeHealthService, CRASH_LOOP_CRASHES, readProcessRss } from '../../src/modules/child-bridges/child-bridge-health.service.js'
import { ChildBridgesService } from '../../src/modules/child-bridges/child-bridges.service.js'
import { StatusModule } from '../../src/modules/status/status.module.js'
import { testStoragePath } from '../storage-path.js'

function bridge(status: 'ok' | 'down' | 'pending', extra: Record<string, unknown> = {}) {
  return {
    status,
    username: '0E:AA:BB:CC:DD:EE',
    name: 'Kitchen',
    plugin: 'homebridge-kitchen',
    identifier: 'kitchen',
    pin: '123-45-678',
    manuallyStopped: false,
    pid: 100,
    ...extra,
  }
}

describe('Child bridge health (e2e)', () => {
  let app: NestFastifyApplication
  let ipc: HomebridgeIpcService
  let health: ChildBridgeHealthService
  let childBridges: ChildBridgesService
  let authorization: string

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [StatusModule, AuthModule],
    }).overrideProvider(HttpService).useValue(new HttpService()).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    ipc = app.get(HomebridgeIpcService)
    health = app.get(ChildBridgeHealthService)
    childBridges = app.get(ChildBridgesService)
  })

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-10-04T10:00:00Z'), toFake: ['Date'] })
    ;(health as any).tracked.clear()
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)
  const report = async () => (await health.getHealth([])).bridges[0]

  it('reports uptime from the moment the bridge came up', async () => {
    ipc.emit('childBridgeStatusUpdate', bridge('ok'))
    advance(90_000)

    const kitchen = await report()
    expect(kitchen).toMatchObject({ name: 'Kitchen', status: 'ok', uptime: 90, restartCount: 0, crashCount: 0, crashLoop: false })
    expect(kitchen.upSince).toBe('2026-10-04T10:00:00.000Z')
  })

  it('counts an unrequested ok -> down as a crash and the way back up as a restart', async () => {
    ipc.emit('childBridgeStatusUpdate', bridge('ok'))
    ipc.emit('childBridgeStatusUpdate', bridge('down'))

    expect(await report()).toMatchObject({ status: 'down', uptime: null, crashCount: 1, recentCrashes: 1 })

    ipc.emit('childBridgeStatusUpdate', bridge('pending'))
    ipc.emit('childBridgeStatusUpdate', bridge('ok', { pid: 101 }))
    expect(await report()).toMatchObject({ status: 'ok', restartCount: 1, crashCount: 1 })
  })

  it('counts a new process while up as a restart', async () => {
    ipc.emit('childBridgeStatusUpdate', bridge('ok'))
    ipc.emit('childBridgeStatusUpdate', bridge('ok', { pid: 222 }))

    expect(await report()).toMatchObject({ restartCount: 1, crashCount: 0 })
  })

  it('does not count a bridge the user stopped or restarted as a crash', async () => {
    vi.spyOn(ipc, 'sendMessage').mockImplementation(() => {})
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date', 'setTimeout'] })
    ipc.emit('childBridgeStatusUpdate', bridge('ok'))

    childBridges.restartChildBridge('0EAABBCCDDEE')
    ipc.emit('childBridgeStatusUpdate', bridge('down'))
    ipc.emit('childBridgeStatusUpdate', bridge('down', { manuallyStopped: true }))

    expect(await report()).toMatchObject({ crashCount: 0 })
  })

  it('does not count Homebridge going down as child bridge crashes', async () => {
    ipc.emit('childBridgeStatusUpdate', bridge('ok'))
    ipc.emit('serverStatusUpdate', { status: 'down' })
    ipc.emit('childBridgeStatusUpdate', bridge('down'))

    expect(await report()).toMatchObject({ crashCount: 0 })
  })

  it('detects a crash loop, emits it once, and clears it when the crashes age out', async () => {
    const loops = vi.fn()
    health.on('crashLoop', loops)
    for (let i = 0; i < CRASH_LOOP_CRASHES; i++) {
      ipc.emit('childBridgeStatusUpdate', bridge('ok', { pid: 200 + i }))
      ipc.emit('childBridgeStatusUpdate', bridge('down'))
      advance(60_000)
    }

    expect(await report()).toMatchObject({ crashLoop: true, recentCrashes: 3 })
    expect(loops).toHaveBeenCalledTimes(1)
    expect(loops.mock.calls[0][0]).toMatchObject({ name: 'Kitchen', crashLoop: true })

    advance(11 * 60_000)
    expect(await report()).toMatchObject({ crashLoop: false, recentCrashes: 0, crashCount: 3 })
    health.off('crashLoop', loops)
  })

  it('serves the report at GET /status/homebridge/child-bridges/health without pairing codes', async () => {
    vi.spyOn(childBridges, 'getChildBridges').mockResolvedValue([bridge('ok') as any])

    const res = await app.inject({ method: 'GET', path: '/status/homebridge/child-bridges/health', headers: { authorization } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.crashLoop).toEqual({ crashes: 3, windowMinutes: 10 })
    expect(body.bridges).toHaveLength(1)
    expect(body.bridges[0]).toMatchObject({ username: '0E:AA:BB:CC:DD:EE', status: 'ok', restartCount: 0 })
    expect(body.bridges[0]).not.toHaveProperty('pin')
  })

  it('needs a login', async () => {
    const res = await app.inject({ method: 'GET', path: '/status/homebridge/child-bridges/health' })

    expect(res.statusCode).toBe(401)
  })

  it('reads memory only for a real process on Linux', async () => {
    expect(await readProcessRss(undefined)).toBeUndefined()
    expect(await readProcessRss(-1)).toBeUndefined()
    const own = await readProcessRss(process.pid)
    // A number on Linux, nothing anywhere else
    expect(own === undefined ? 'none' : typeof own).toBe(process.platform === 'linux' ? 'number' : 'none')
  })
})
