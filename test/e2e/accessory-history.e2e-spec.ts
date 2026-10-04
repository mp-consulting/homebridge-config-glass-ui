import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { EventEmitter } from 'node:events'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, ensureDir, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { AccessoriesModule } from '../../src/modules/accessories/accessories.module.js'
import { AccessoriesService } from '../../src/modules/accessories/accessories.service.js'
import { AccessoryHistoryService, downsample, isRecordedCharacteristic, MIN_SAMPLE_INTERVAL_MS } from '../../src/modules/accessories/accessory-history.service.js'
import { testStoragePath } from '../storage-path.js'

const ID = 'c8964091efa500870e34996208e670cf7dc362d244e0410220752459a5e78d1c'
const NOW = Date.parse('2026-10-04T12:00:00Z')

function sensor(temperature: number | null, extra: any[] = []) {
  return {
    uniqueId: ID,
    serviceCharacteristics: [
      { type: 'CurrentTemperature', description: 'Current Temperature', format: 'float', unit: 'celsius', value: temperature },
      { type: 'On', description: 'On', format: 'bool', value: true },
      { type: 'Name', description: 'Name', format: 'string', value: 'Kitchen' },
      ...extra,
    ],
  } as any
}

describe('Accessory history (e2e)', () => {
  let app: NestFastifyApplication
  let configService: ConfigService
  let history: AccessoryHistoryService
  let authorization: string

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    configService = new ConfigService()
    configService.homebridgeInsecureMode = true

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AccessoriesModule, AuthModule],
    }).overrideProvider(ConfigService).useValue(configService).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    history = app.get(AccessoryHistoryService)
  })

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    await remove(history.dir)
    ;(history as any).last.clear()
    ;(history as any).pending.clear()
    ;(history as any).monitor = null
    delete configService.ui.accessoryHistory
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

  const get = (query: string) => app.inject({ method: 'GET', path: `/accessories/${ID}/history${query}`, headers: { authorization } })

  it('records numeric sensor values, not switches or names', async () => {
    history.record([sensor(21.5)], NOW - 1000)
    await history.drain()

    const lines = (await readFile(resolve(history.dir, '2026-10-04.jsonl'), 'utf8')).trim().split('\n')
    expect(lines.map(line => JSON.parse(line))).toEqual([{ t: NOW - 1000, id: ID, c: 'CurrentTemperature', v: 21.5 }])
  })

  it('records a change, skips a repeat, and holds a too-quick change until the interval is up', async () => {
    const t0 = NOW - 10 * 60_000
    history.record([sensor(20)], t0)
    history.record([sensor(20)], t0 + 5 * 60_000)
    history.record([sensor(21)], t0 + 5 * 60_000)
    history.record([sensor(22)], t0 + 5 * 60_000 + 1000)
    history.flushPending(t0 + 5 * 60_000 + 1000)
    history.flushPending(t0 + 6 * 60_000 + 1000)

    const res = await get('?hours=1')
    expect(res.statusCode).toBe(200)
    expect(res.json().series).toEqual([{
      type: 'CurrentTemperature',
      description: 'Current Temperature',
      unit: 'celsius',
      points: [[t0, 20], [t0 + 5 * 60_000, 21], [t0 + 5 * 60_000 + MIN_SAMPLE_INTERVAL_MS, 22]],
    }])
  })

  it('records Eve power and energy readings by their description', () => {
    expect(isRecordedCharacteristic({ type: 'E863F10D-079E-48FF-8F27-9C2605A29F52', description: 'Consumption', format: 'float' })).toBe(true)
    expect(isRecordedCharacteristic({ type: 'BatteryLevel', description: 'Battery Level', format: 'uint8' })).toBe(true)
    expect(isRecordedCharacteristic({ type: 'Brightness', description: 'Brightness', format: 'int' })).toBe(false)
    expect(isRecordedCharacteristic({ type: 'Name', description: 'Power name', format: 'string' })).toBe(false)
  })

  it('skips null and non-numeric values', async () => {
    history.record([sensor(null)], NOW)
    await history.drain()

    expect((await get('')).json().series).toEqual([])
  })

  it('filters by type and time, and reads across day files', async () => {
    const yesterday = NOW - 20 * 3_600_000
    history.record([sensor(18, [{ type: 'CurrentRelativeHumidity', description: 'Humidity', format: 'float', value: 40 }])], yesterday)
    history.record([sensor(19, [{ type: 'CurrentRelativeHumidity', description: 'Humidity', format: 'float', value: 41 }])], NOW - 1000)

    const all = (await get('?hours=24')).json()
    expect(all.series.map((s: any) => [s.type, s.points.length])).toEqual([['CurrentRelativeHumidity', 2], ['CurrentTemperature', 2]])

    const recent = (await get('?hours=1&type=CurrentTemperature')).json()
    expect(recent.series).toHaveLength(1)
    expect(recent.series[0].points).toEqual([[NOW - 1000, 19]])
    expect(await readdir(history.dir)).toEqual(['2026-10-03.jsonl', '2026-10-04.jsonl'])
  })

  it('skips a torn line', async () => {
    await ensureDir(history.dir)
    await writeFile(resolve(history.dir, '2026-10-04.jsonl'), `{"t":${NOW - 5},"id":"${ID}","c":"BatteryLevel","v":80}\n{"t":${NOW},"id":"${ID}","c":"Batt`)

    expect((await get('')).json().series[0].points).toEqual([[NOW - 5, 80]])
  })

  it('refuses bad queries', async () => {
    expect((await get('?hours=0')).statusCode).toBe(400)
    expect((await get('?hours=abc')).statusCode).toBe(400)
    expect((await get('?type=../../etc')).statusCode).toBe(400)
    expect((await get('?maxPoints=1')).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', path: '/accessories/bad%24id/history', headers: { authorization } })).statusCode).toBe(400)
  })

  it('needs a login', async () => {
    expect((await app.inject({ method: 'GET', path: `/accessories/${ID}/history` })).statusCode).toBe(401)
  })

  it('deletes day files older than the retention', async () => {
    configService.ui.accessoryHistory = { retentionDays: 2 }
    await ensureDir(history.dir)
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      await writeFile(resolve(history.dir, `${day}.jsonl`), '')
    }
    await writeFile(resolve(history.dir, 'notes.txt'), '')

    await history.prune(NOW)

    expect((await readdir(history.dir)).sort()).toEqual(['2026-10-03.jsonl', '2026-10-04.jsonl', 'notes.txt'])
  })

  it('downsamples long series into averaged buckets', () => {
    const points = Array.from({ length: 1000 }, (_, i) => [i * 1000, i % 2] as [number, number])

    const result = downsample(points, 10)

    expect(result).toHaveLength(10)
    expect(result.every(([, v]) => v === 0.5)).toBe(true)
  })

  it('attaches to the shared HAP monitor and records its updates', async () => {
    const monitor = new EventEmitter()
    const accessories = app.get(AccessoriesService)
    vi.spyOn(accessories, 'loadAccessories').mockResolvedValue([sensor(20)])
    vi.spyOn(accessories, 'getHapMonitor').mockResolvedValue(monitor as any)

    await history.start()
    vi.setSystemTime(NOW + 2 * MIN_SAMPLE_INTERVAL_MS)
    monitor.emit('service-update', [sensor(23)])

    const points = (await get('?hours=1')).json().series[0].points
    expect(points.map(([, v]: [number, number]) => v)).toEqual([20, 23])
    monitor.removeAllListeners()
  })

  it('does not record when switched off', async () => {
    configService.ui.accessoryHistory = { enabled: false }
    const accessories = app.get(AccessoriesService)
    const load = vi.spyOn(accessories, 'loadAccessories')

    await history.start()

    expect(load).not.toHaveBeenCalled()
  })
})
