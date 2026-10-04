import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService, sanitiseInstances } from '../../src/core/config/config.service.js'
import { BackupModule } from '../../src/modules/backup/backup.module.js'
import { ConfigEditorModule } from '../../src/modules/config-editor/config-editor.module.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

describe('Instance switcher list (e2e)', () => {
  let app: NestFastifyApplication
  let authorization: string
  let configService: ConfigService

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigEditorModule, AuthModule, BackupModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    configService = app.get(ConfigService)
  })

  beforeEach(async () => {
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`
  })

  afterAll(async () => {
    await app.close()
  })

  const put = (payload: unknown) => app.inject({ method: 'PUT', path: '/config-editor/ui/instances', headers: { authorization }, payload: payload as any })

  it('saves the list into the UI config and hands it to signed-in users', async () => {
    const instances = [{ name: 'Garage Pi', url: 'https://garage.local:8581' }, { name: 'Office', url: 'http://10.0.0.5:8581/' }]

    const res = await put(instances)

    expect(res.statusCode).toBe(200)
    const config = await readJson(process.env.UIX_CONFIG_PATH!)
    expect(config.platforms.find((p: any) => p.platform === 'config').instances).toEqual(instances)

    const settings = await app.inject({ method: 'GET', path: '/auth/settings', headers: { authorization } })
    expect(settings.json().env.instances).toEqual(instances)
  })

  it('does not show the list before sign-in', async () => {
    await put([{ name: 'Garage Pi', url: 'https://garage.local:8581' }])

    const settings = await app.inject({ method: 'GET', path: '/auth/settings' })

    expect(settings.json().env.instances).toBeUndefined()
  })

  it('refuses entries that are not a name and an http(s) URL', async () => {
    expect((await put([{ name: 'x', url: 'javascript:alert(1)' }])).statusCode).toBe(400)
    expect((await put([{ name: '', url: 'https://a.local' }])).statusCode).toBe(400)
    expect((await put([{ name: 'x', url: 'https://user:pass@a.local' }])).statusCode).toBe(400)
    expect((await put({ name: 'x' })).statusCode).toBe(400)
    expect((await put(Array.from({ length: 21 }, (_, i) => ({ name: `n${i}`, url: 'https://a.local' })))).statusCode).toBe(400)
  })

  it('drops hand-edited unsafe entries from what the UI receives', () => {
    expect(sanitiseInstances([
      { name: 'ok', url: 'https://a.local' },
      { name: 'bad', url: 'javascript:alert(1)' },
      { name: 'weird' },
      'nope',
    ])).toEqual([{ name: 'ok', url: 'https://a.local' }])
    expect(sanitiseInstances(undefined)).toEqual([])
    configService.ui.instances = [{ name: 'bad', url: 'data:text/html,x' }]
    expect(configService.uiSettings(true).env.instances).toEqual([])
  })
})
