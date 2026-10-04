import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import type { HomebridgePlugin } from '../../src/modules/plugins/plugins.interfaces.js'

import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { checkPluginCompatibility, parseTargetVersion } from '../../src/modules/plugins/plugin-compatibility.js'
import { PluginsModule } from '../../src/modules/plugins/plugins.module.js'
import { PluginsService } from '../../src/modules/plugins/plugins.service.js'
import { testStoragePath } from '../storage-path.js'

function plugin(name: string, engines?: HomebridgePlugin['engines']) {
  return ({
    name,
    displayName: name.replace('homebridge-', ''),
    installedVersion: '1.0.0',
    engines,
  }) as HomebridgePlugin
}

const installedPlugins = [
  plugin('homebridge', { node: '^18' }),
  plugin('homebridge-old', { node: '^18.0.0 || ^20.0.0', homebridge: '^1.6.0' }),
  plugin('homebridge-modern', { node: '^22 || ^24', homebridge: '^1.8.0 || ^2.0.0-beta.0' }),
  plugin('homebridge-silent'),
  plugin('homebridge-garbled', { node: 'not a range', homebridge: '>=1.0.0' }),
]

describe('Plugin compatibility check (e2e)', () => {
  let app: NestFastifyApplication
  let authorization: string

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PluginsModule, AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    vi.spyOn(app.get(PluginsService), 'getInstalledPlugins').mockResolvedValue(installedPlugins)
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

  it('lists the plugins whose engines.node would not accept a Node.js upgrade', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/compatibility?node=24.4.0', headers: { authorization } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.target).toEqual({ node: '24.4.0' })
    expect(body.incompatible.map((p: any) => [p.name, p.engineIssues])).toEqual([['homebridge-old', ['node']]])
    expect(body.unknown.map((p: any) => p.name)).toEqual(['homebridge-garbled', 'homebridge-silent'])
    // Homebridge is not a plugin of itself
    expect(body.checked).toBe(4)
  })

  it('lists the plugins whose engines.homebridge would not accept a Homebridge upgrade, prereleases included', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/compatibility?homebridge=2.0.0-beta.5', headers: { authorization } })

    const body = res.json()
    expect(body.incompatible.map((p: any) => p.name)).toEqual(['homebridge-old'])
    expect(body.incompatible[0]).toMatchObject({ displayName: 'old', installedVersion: '1.0.0', engines: { homebridge: '^1.6.0' } })
    expect(body.unknown.map((p: any) => p.name)).toEqual(['homebridge-silent'])
  })

  it('checks both engines at once', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/compatibility?node=v24&homebridge=2.0.0', headers: { authorization } })

    const body = res.json()
    expect(body.target).toEqual({ node: '24.0.0', homebridge: '2.0.0' })
    expect(body.incompatible).toEqual([expect.objectContaining({ name: 'homebridge-old', engineIssues: ['node', 'homebridge'] })])
  })

  it('needs a target version', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/compatibility', headers: { authorization } })

    expect(res.statusCode).toBe(400)
  })

  it('refuses a version that is not one', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/compatibility?node=latest', headers: { authorization } })

    expect(res.statusCode).toBe(400)
  })

  it('needs a login', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/compatibility?node=24.0.0' })

    expect(res.statusCode).toBe(401)
  })

  it('parses target versions leniently but safely', () => {
    expect(parseTargetVersion(undefined, 'Node.js')).toBeUndefined()
    expect(parseTargetVersion('v22.12.0', 'Node.js')).toBe('22.12.0')
    expect(parseTargetVersion('2.0.0-beta.1', 'Homebridge')).toBe('2.0.0-beta.1')
    expect(() => parseTargetVersion('x'.repeat(100), 'Node.js')).toThrow()
    expect(() => parseTargetVersion(['1'] as any, 'Node.js')).toThrow()
  })

  it('reports nothing for an empty plugin list', () => {
    expect(checkPluginCompatibility([], { node: '24.0.0' })).toEqual({ target: { node: '24.0.0' }, incompatible: [], unknown: [], checked: 0 })
  })
})
