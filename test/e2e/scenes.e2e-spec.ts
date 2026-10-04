import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { AccessoriesService } from '../../src/modules/accessories/accessories.service.js'
import { ScenesModule } from '../../src/modules/scenes/scenes.module.js'
import { ScenesService } from '../../src/modules/scenes/scenes.service.js'
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
    expect((await readJson(scenes.scenesPath)).scenes).toEqual([scene])
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

  it('answers 404 for a scene that does not exist', async () => {
    expect((await app.inject({ method: 'POST', path: '/scenes/0123456789abcdef/run', headers: { authorization } })).statusCode).toBe(404)
  })

  it('needs a login', async () => {
    expect((await app.inject({ method: 'GET', path: '/scenes' })).statusCode).toBe(401)
  })
})
