import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove, writeJson } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { AccessoriesService } from '../../src/modules/accessories/accessories.service.js'
import { ScenesModule } from '../../src/modules/scenes/scenes.module.js'
import { CHARACTERISTIC_TRIGGER_COOLDOWN_MS, findCoordinates, ScenesService } from '../../src/modules/scenes/scenes.service.js'
import { testStoragePath } from '../storage-path.js'

const LAMP = 'a'.repeat(64)
const FAN = 'b'.repeat(64)

const evening = {
  name: 'Evening',
  actions: [
    { uniqueId: LAMP, characteristicType: 'On', value: true },
    { uniqueId: LAMP, characteristicType: 'Brightness', value: 40 },
    { uniqueId: FAN, characteristicType: 'Active', value: 0 },
  ],
  schedules: [{ cron: '0 19 * * *', enabled: true }],
}

describe('Scenes (e2e)', () => {
  let app: NestFastifyApplication
  let scenes: ScenesService
  let scheduler: SchedulerService
  let accessories: AccessoriesService
  let configService: ConfigService
  let authorization: string
  let setCharacteristic: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ScenesModule, AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    scenes = app.get(ScenesService)
    scheduler = app.get(SchedulerService)
    accessories = app.get(AccessoriesService)
    configService = app.get(ConfigService)
  })

  beforeEach(async () => {
    await remove(scenes.scenesPath)
    await scenes.onModuleInit()
    delete configService.ui.accessoryControl
    setCharacteristic = vi.spyOn(accessories, 'setAccessoryCharacteristic').mockResolvedValue({} as any)
    vi.spyOn(accessories, 'loadAccessories').mockResolvedValue([
      { uniqueId: LAMP, instance: { username: '0E:AA:BB:CC:DD:EE' } },
      { uniqueId: FAN, instance: { username: '0E:11:22:33:44:55' } },
    ] as any)
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  const create = (payload: unknown = evening) => app.inject({ method: 'POST', path: '/scenes', headers: { authorization }, payload: payload as any })

  it('creates a scene, stores it and schedules it', async () => {
    const res = await create()

    expect(res.statusCode).toBe(201)
    const scene = res.json()
    expect(scene.id).toMatch(/^[a-f0-9]{16}$/)
    // Stored as version 2: the schedules are cron triggers
    const { schedules, ...stored } = scene
    expect(schedules).toEqual(evening.schedules)
    expect(await readJson(scenes.scenesPath)).toEqual({ version: 2, scenes: [{ ...stored, triggers: [{ type: 'cron', cron: '0 19 * * *', enabled: true }], conditions: [] }] })
    expect(scheduler.scheduledJobs).toHaveProperty(`scene-${scene.id}-0`)

    const list = await app.inject({ method: 'GET', path: '/scenes', headers: { authorization } })
    expect(list.json()).toEqual([scene])
  })

  it('runs every action in order and records the run', async () => {
    const { id } = (await create()).json()

    const res = await app.inject({ method: 'POST', path: `/scenes/${id}/run`, headers: { authorization } })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sceneId: id, ok: true })
    expect(setCharacteristic.mock.calls).toEqual([[LAMP, 'On', true], [LAMP, 'Brightness', 40], [FAN, 'Active', 0]])
    expect((await scenes.get(id)).lastRun).toMatchObject({ ok: true, trigger: 'manual' })
  })

  it('reports a failing action and still runs the rest', async () => {
    const { id } = (await create()).json()
    setCharacteristic.mockImplementation(async (_id: string, type: string) => {
      if (type === 'Brightness') {
        throw new BadRequestException('Invalid value. The value must be between 0 and 100.')
      }
      return {} as any
    })

    const result = await scenes.run(id)

    expect(result.ok).toBe(false)
    expect(result.results.map(r => r.ok)).toEqual([true, false, true])
    expect(result.results[1].error).toContain('between 0 and 100')
  })

  it('does not control a bridge in the accessory control blacklist', async () => {
    const { id } = (await create()).json()
    configService.ui.accessoryControl = { instanceBlacklist: ['0E:11:22:33:44:55'] }

    const result = await scenes.run(id)

    expect(setCharacteristic).toHaveBeenCalledTimes(2)
    expect(result.results[2]).toMatchObject({ uniqueId: FAN, ok: false })
  })

  it('runs on its schedule', async () => {
    const { id } = (await create()).json()

    scheduler.scheduledJobs[`scene-${id}-0`].invoke()

    await vi.waitFor(() => expect(setCharacteristic).toHaveBeenCalledTimes(3))
    await vi.waitFor(async () => expect((await scenes.get(id)).lastRun?.trigger).toBe('schedule'))
  })

  it('updates the schedules: a disabled one is not scheduled', async () => {
    const { id } = (await create()).json()

    const res = await app.inject({ method: 'PUT', path: `/scenes/${id}`, headers: { authorization }, payload: { ...evening, name: 'Late', schedules: [{ cron: '0 23 * * *', enabled: false }] } })

    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Late')
    expect(scheduler.scheduledJobs).not.toHaveProperty(`scene-${id}-0`)
  })

  it('deletes a scene and its jobs', async () => {
    const { id } = (await create()).json()

    const res = await app.inject({ method: 'DELETE', path: `/scenes/${id}`, headers: { authorization } })

    expect(res.statusCode).toBe(200)
    expect(await scenes.list()).toEqual([])
    expect(scheduler.scheduledJobs).not.toHaveProperty(`scene-${id}-0`)
    expect((await app.inject({ method: 'DELETE', path: `/scenes/${id}`, headers: { authorization } })).statusCode).toBe(404)
  })

  it('refuses an invalid scene', async () => {
    expect((await create({ ...evening, name: '' })).statusCode).toBe(400)
    expect((await create({ ...evening, actions: [] })).statusCode).toBe(400)
    expect((await create({ ...evening, actions: [{ uniqueId: '../x', characteristicType: 'On', value: true }] })).statusCode).toBe(400)
    expect((await create({ ...evening, actions: [{ uniqueId: LAMP, characteristicType: 'On', value: { a: 1 } }] })).statusCode).toBe(400)
    expect((await create({ ...evening, schedules: [{ cron: 'every day', enabled: true }] })).statusCode).toBe(400)
    expect(Object.keys(scheduler.scheduledJobs).filter(name => name.startsWith('scene-validate'))).toEqual([])
  })

  it('validates the body with the scene DTO', async () => {
    const noName = { actions: evening.actions, schedules: evening.schedules }
    const missing = await create(noName)
    expect(missing.statusCode).toBe(400)
    expect(missing.json().message).toContain('The name must be 1 to 64 characters.')

    expect((await create({ ...evening, name: '   ' })).statusCode).toBe(400)
    expect((await create({ ...evening, name: 'x'.repeat(65) })).statusCode).toBe(400)
    expect((await create({ name: 'No actions' })).statusCode).toBe(400)
    expect((await create({ ...evening, actions: [null] })).statusCode).toBe(400)
    expect((await create({ ...evening, schedules: 'daily' })).statusCode).toBe(400)

    const bad = await create({ ...evening, actions: [{ uniqueId: LAMP, value: true }] })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().message.join(' ')).toContain('characteristicType')

    const cron = await create({ ...evening, schedules: [{ cron: '61 * * * *' }] })
    expect(cron.json().message).toBe('Schedule 1: invalid cron expression.')
  })

  it('drops unknown fields and trims the name', async () => {
    const res = await create({ ...evening, name: '  Evening  ', id: 'ffffffffffffffff', extra: true, actions: [{ ...evening.actions[0], note: 'x' }] })
    expect(res.statusCode).toBe(201)
    const scene = res.json()
    expect(scene.name).toBe('Evening')
    expect(scene.id).not.toBe('ffffffffffffffff')
    expect(scene).not.toHaveProperty('extra')
    expect(scene.actions[0]).not.toHaveProperty('note')
    expect(scene.schedules.every((schedule: { enabled: boolean }) => typeof schedule.enabled === 'boolean')).toBe(true)
  })

  it('answers 404 for a scene that does not exist', async () => {
    expect((await app.inject({ method: 'POST', path: '/scenes/0123456789abcdef/run', headers: { authorization } })).statusCode).toBe(404)
  })

  it('needs a login', async () => {
    expect((await app.inject({ method: 'GET', path: '/scenes' })).statusCode).toBe(401)
  })

  describe('v2: triggers and conditions', () => {
    const PARIS = { lat: 48.8566, lon: 2.3522 }
    const dashboardPath = () => resolve(testStoragePath, '.uix-dashboard.json')

    beforeEach(async () => {
      await writeJson(dashboardPath(), [{ component: 'WeatherWidgetComponent', location: { id: 2988507, name: 'Paris', coord: PARIS } }])
      ;(scenes as any).locationCache = null
      configService.homebridgeInsecureMode = true
    })

    afterEach(async () => {
      await remove(dashboardPath())
      configService.homebridgeInsecureMode = false
      ;(scenes as any).detachMonitor()
      ;(scenes as any).watched = []
      ;(scenes as any).lastValues.clear()
      ;(scenes as any).lastFired.clear()
    })

    it('reads a v1 scene as v2 and keeps it working', async () => {
      await writeJson(scenes.scenesPath, { scenes: [{ id: '0123456789abcdef', name: 'Old', actions: evening.actions, schedules: [{ cron: '0 7 * * *', enabled: true }] }] })
      await scenes.onModuleInit()

      const [scene] = await scenes.list()
      expect(scene).toMatchObject({ triggers: [{ type: 'cron', cron: '0 7 * * *', enabled: true }], conditions: [], schedules: [{ cron: '0 7 * * *', enabled: true }] })
      expect(scheduler.scheduledJobs).toHaveProperty('scene-0123456789abcdef-0')
    })

    it('keeps the other triggers when an older client sends only schedules', async () => {
      const { id } = (await create({ ...evening, triggers: [{ type: 'cron', cron: '0 19 * * *' }, { type: 'sun', event: 'sunset', offsetMinutes: -15 }] })).json()

      const res = await app.inject({ method: 'PUT', path: `/scenes/${id}`, headers: { authorization }, payload: { ...evening, schedules: [{ cron: '0 20 * * *', enabled: true }] } })

      expect(res.json().triggers).toEqual([{ type: 'cron', cron: '0 20 * * *', enabled: true }, { type: 'sun', event: 'sunset', offsetMinutes: -15, enabled: true }])
    })

    it('schedules a sun trigger at the next sunset plus its offset, at the weather widget\'s location', async () => {
      const { id } = (await create({ ...evening, triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: -30 }] })).json()

      const job = scheduler.scheduledJobs[`scene-${id}-0`]
      expect(job).toBeDefined()
      const next = job.nextInvocation()!.getTime()
      const info = (await app.inject({ method: 'GET', path: '/scenes/automation', headers: { authorization } })).json()
      expect(info.location).toEqual({ ...PARIS, name: 'Paris' })
      expect(info.characteristicTriggers).toBe(true)
      // 30 minutes before a sunset (the next one, or the one after when it is already less than 30 minutes away)
      const sunset = Date.parse(info.nextSunset)
      expect([sunset - 30 * 60_000, sunset + 86_400_000 - 30 * 60_000].some(at => Math.abs(at - next) < 5 * 60_000)).toBe(true)
    })

    it('does not schedule a sun trigger without a location', async () => {
      await remove(dashboardPath())
      ;(scenes as any).locationCache = null
      const { id } = (await create({ ...evening, triggers: [{ type: 'sun', event: 'sunrise' }] })).json()

      expect(scheduler.scheduledJobs).not.toHaveProperty(`scene-${id}-0`)
    })

    it('runs on a characteristic change that starts to match, once per cooldown', async () => {
      const MOTION = 'c'.repeat(64)
      const sensor = (value: unknown) => [{ uniqueId: MOTION, serviceName: 'Hall', serviceCharacteristics: [{ type: 'MotionDetected', value }] }] as any
      vi.spyOn(accessories, 'loadAccessories').mockResolvedValue(sensor(false))
      const monitor = { on: vi.fn(), off: vi.fn() }
      vi.spyOn(accessories, 'getHapMonitor').mockResolvedValue(monitor as any)
      await create({ ...evening, triggers: [{ type: 'characteristic', uniqueId: MOTION, characteristicType: 'MotionDetected', operator: 'eq', value: true }] })
      expect(monitor.on).toHaveBeenCalledWith('service-update', expect.any(Function))

      const now = Date.now()
      scenes.onServiceUpdate(sensor(true), true, now)
      await vi.waitFor(() => expect(setCharacteristic).toHaveBeenCalledTimes(3))

      // Back off and on within the cooldown: not again
      scenes.onServiceUpdate(sensor(false), true, now + 1000)
      scenes.onServiceUpdate(sensor(true), true, now + 2000)
      // Still true: no new edge
      scenes.onServiceUpdate(sensor(true), true, now + CHARACTERISTIC_TRIGGER_COOLDOWN_MS + 1000)
      await new Promise(r => setTimeout(r, 50))
      expect(setCharacteristic).toHaveBeenCalledTimes(3)
    })

    it('skips an automatic run whose conditions do not hold, and records why', async () => {
      vi.spyOn(accessories, 'loadAccessories').mockResolvedValue([{ uniqueId: FAN, serviceCharacteristics: [{ type: 'Active', value: 1 }] }] as any)
      const { id } = (await create({ ...evening, conditions: [{ type: 'characteristic', uniqueId: FAN, characteristicType: 'Active', operator: 'eq', value: 0 }] })).json()

      const result = await scenes.run(id, 'schedule')

      expect(result).toMatchObject({ ok: true, results: [], skipped: 'Active is 1, not eq 0' })
      expect(setCharacteristic).not.toHaveBeenCalled()
      expect((await scenes.get(id)).lastSkipped).toMatchObject({ trigger: 'schedule', reason: 'Active is 1, not eq 0' })

      // A manual run ignores the conditions
      expect((await scenes.run(id, 'manual')).results).toHaveLength(3)
    })

    it('checks a time window, across midnight and with the sun', async () => {
      const at = (h: number, m = 0) => new Date(2026, 5, 21, h, m)
      expect(await scenes.checkConditions([{ type: 'time', after: '22:00', before: '06:00' }], at(23))).toBeNull()
      expect(await scenes.checkConditions([{ type: 'time', after: '22:00', before: '06:00' }], at(12))).toBe('outside 22:00–06:00')
      expect(await scenes.checkConditions([{ type: 'time', after: 'sunrise', before: 'sunset' }], at(3))).not.toBeNull()
    })

    it('refuses invalid triggers and conditions', async () => {
      expect((await create({ ...evening, triggers: [{ type: 'sun', event: 'noon' }] })).statusCode).toBe(400)
      expect((await create({ ...evening, triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: 900 }] })).statusCode).toBe(400)
      expect((await create({ ...evening, triggers: [{ type: 'characteristic', uniqueId: LAMP, characteristicType: 'On', operator: 'gt' }] })).statusCode).toBe(400)
      expect((await create({ ...evening, triggers: [{ type: 'webhook' }] })).statusCode).toBe(400)
      expect((await create({ ...evening, conditions: [{ type: 'time', after: '25:00', before: '06:00' }] })).statusCode).toBe(400)
      expect((await create({ ...evening, conditions: [{ type: 'time', after: '06:00', before: '06:00' }] })).statusCode).toBe(400)
      expect((await create({ ...evening, conditions: [{ type: 'characteristic', uniqueId: LAMP, characteristicType: 'On', operator: 'changes', value: 1 }] })).statusCode).toBe(400)
    })

    it('finds the weather widget\'s coordinates in the dashboard layout', () => {
      expect(findCoordinates({ dashboard: [{ component: 'Clock' }, { location: { name: 'Oslo', coord: { lat: 59.9, lon: 10.7 } } }] })).toEqual({ lat: 59.9, lon: 10.7, name: 'Oslo' })
      expect(findCoordinates([{ location: { id: 1 } }])).toBeNull()
    })
  })
})
