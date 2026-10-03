import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, outputJson, readJson } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { AccessoriesGateway } from '../../src/modules/accessories/accessories.gateway.js'
import { AccessoriesModule } from '../../src/modules/accessories/accessories.module.js'
import { testStoragePath } from '../storage-path.js'
import { authorizeWsClient } from '../ws-client.js'

/**
 * The accessory layout belongs to the user the socket was verified for
 * (client.data.user, set by WsGuard), never to a username in the payload.
 */
describe('AccessoriesGateway per-user layout (e2e)', () => {
  let app: NestFastifyApplication
  let gateway: AccessoriesGateway
  let layoutPath: string

  const adminLayout = [{ name: 'Admin Room', services: [{ uniqueId: 'admin-only', aid: 1, iid: 1 }] }]
  const userLayout = [{ name: 'User Room', services: [] }]
  const attackerLayout = [{ name: 'Hijacked', services: [] }]

  const regularSocket = () => authorizeWsClient(new EventEmitter(), { username: 'regular', admin: false })

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture = await Test.createTestingModule({
      imports: [AccessoriesModule, AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    gateway = app.get(AccessoriesGateway)
    layoutPath = app.get(ConfigService).accessoryLayoutPath
  })

  beforeEach(async () => {
    await outputJson(layoutPath, { admin: adminLayout, regular: userLayout })
  })

  afterAll(async () => {
    await app.close()
  })

  it('save-layout with another username in the payload only changes the caller\'s layout', async () => {
    const result = await gateway.saveAccessoryLayout(regularSocket(), { username: 'admin', user: 'admin', layout: attackerLayout })

    expect(result).toEqual(attackerLayout)
    const stored = await readJson(layoutPath)
    expect(stored.admin).toEqual(adminLayout)
    expect(stored.regular).toEqual(attackerLayout)
  })

  it('save-layout from a user with no layout yet creates only theirs', async () => {
    const newcomer = authorizeWsClient(new EventEmitter(), { username: 'newcomer', admin: false })

    await gateway.saveAccessoryLayout(newcomer, { username: 'admin', layout: attackerLayout })

    const stored = await readJson(layoutPath)
    expect(stored).toEqual({ admin: adminLayout, regular: userLayout, newcomer: attackerLayout })
  })

  it('get-layout ignores a username in the payload and returns the caller\'s layout', async () => {
    const getLayout = gateway.getAccessoryLayout.bind(gateway) as (client: unknown, payload?: unknown) => Promise<unknown>

    expect(await getLayout(regularSocket(), { username: 'admin', user: 'admin' })).toEqual(userLayout)
  })

  it('get-layout for a user without a layout returns the default, not someone else\'s', async () => {
    const newcomer = authorizeWsClient(new EventEmitter(), { username: 'newcomer', admin: false })
    const getLayout = gateway.getAccessoryLayout.bind(gateway) as (client: unknown, payload?: unknown) => Promise<unknown>

    expect(await getLayout(newcomer, { username: 'admin' })).toEqual([
      { name: 'Default Room', isDefault: true, services: [] },
    ])
  })

  it('the admin still reads their own layout afterwards', async () => {
    await gateway.saveAccessoryLayout(regularSocket(), { username: 'admin', layout: attackerLayout })

    expect(await gateway.getAccessoryLayout(authorizeWsClient(new EventEmitter()))).toEqual(adminLayout)
  })
})
