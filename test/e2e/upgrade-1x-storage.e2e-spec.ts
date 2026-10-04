import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { emptyDir, outputJson, pathExists, readJson, writeFile } from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AuditModule } from '../../src/core/audit/audit.module.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { LEGACY_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS } from '../../src/core/auth/password-hasher.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { AccessoriesModule } from '../../src/modules/accessories/accessories.module.js'
import { ConfigEditorModule } from '../../src/modules/config-editor/config-editor.module.js'
import { HbServiceModule } from '../../src/modules/platform-tools/hb-service/hb-service.module.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

/**
 * A storage directory as Homebridge Glass UI 1.x (and homebridge-config-ui-x
 * before it) left it, loaded by 2.0: the `config` platform block, users hashed
 * at the old work factor with no `passwordIterations`, the JWT secret, config
 * backups in the storage root, the accessory layout and the hb-service
 * startup settings. None of 2.0's own files (scenes, notifications, API
 * tokens, the Assistant's usage, the audit log) exist yet.
 */
const SECRET_KEY = 'b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf'

const CONFIG_1X = {
  bridge: { name: 'Homebridge 1x', username: '0E:11:22:33:44:55', port: 51826, pin: '031-45-154' },
  accessories: [],
  platforms: [
    {
      name: 'Config',
      port: 8581,
      auth: 'form',
      theme: 'auto',
      tempUnits: 'c',
      lang: 'auto',
      log: { method: 'systemd', service: 'homebridge' },
      sudo: false,
      accessoryControl: { debug: false, instanceBlacklist: [] },
      platform: 'config',
    },
    { platform: 'SomePlugin', name: 'Kept as is', token: 'plugin-secret' },
  ],
}

// admin / admin, PBKDF2 at 1,000 iterations (no passwordIterations), as 1.x stored it
const USERS_1X = [
  {
    id: 1,
    username: 'admin',
    name: 'Administrator',
    hashedPassword: 'fd6bcc1e4d29c51f520191425d3c70610b89139be3042f1cdc3b13d58124178e3a620c9336a3029b4156aa631158e5552a4e222f2228520c2562e9e41cd259b2',
    salt: '77f01970830473410589fe6764d5c07f7a007c99d07e5992f98df21166026f2a',
    admin: true,
    otpActive: false,
  },
]

describe('upgrading from a 1.x storage directory (e2e)', () => {
  let app: NestFastifyApplication
  let configService: ConfigService
  let authorization: string

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    delete process.env.UIX_INSECURE_MODE

    await emptyDir(testStoragePath)
    await outputJson(process.env.UIX_CONFIG_PATH, CONFIG_1X, { spaces: 4 })
    await outputJson(resolve(testStoragePath, 'auth.json'), USERS_1X, { spaces: 4 })
    await outputJson(resolve(testStoragePath, '.uix-secrets'), { secretKey: SECRET_KEY })
    // Config backups were written next to config.json before they moved to backups/config-backups
    await writeFile(resolve(testStoragePath, 'config.json.1690000000000'), JSON.stringify(CONFIG_1X))
    await writeFile(resolve(testStoragePath, 'config.json.1690000001000'), JSON.stringify(CONFIG_1X))
    await outputJson(resolve(testStoragePath, 'accessories', 'uiAccessoriesLayout.json'), {
      admin: [{ name: 'Living Room', services: [{ uniqueId: 'abc', hidden: false }] }],
    })
    await outputJson(resolve(testStoragePath, '.uix-hb-service-homebridge-startup.json'), {
      debugMode: true,
      keepOrphans: false,
      insecureMode: true,
      env: { DEBUG: 'homebridge*', NODE_OPTIONS: '--max-old-space-size=512' },
    })

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, ConfigEditorModule, AccessoriesModule, HbServiceModule, AuditModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    configService = app.get(ConfigService)
  })

  afterAll(async () => {
    await app.close()
  })

  it('reads the 1.x UI settings from the config platform block', () => {
    expect(configService.ui).toMatchObject({ port: 8581, theme: 'auto', tempUnits: 'c', accessoryControl: { instanceBlacklist: [] } })
    // A 1.x log setting (systemd here) gives way to 2.0's own log file in the storage directory
    expect(configService.ui.log).toMatchObject({ method: 'native', path: resolve(testStoragePath, 'homebridge.log') })
    expect(configService.homebridgeConfig.bridge.name).toBe('Homebridge 1x')
  })

  it('keeps the 1.x JWT secret, so tokens signed before the upgrade stay valid', async () => {
    expect(configService.secrets.secretKey).toBe(SECRET_KEY)
    expect((await readJson(resolve(testStoragePath, '.uix-secrets'))).secretKey).toBe(SECRET_KEY)
    const token = app.get(JwtService).sign({ username: 'admin', name: 'Administrator', admin: true, instanceId: configService.instanceId })
    const res = await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `bearer ${token}` } })
    expect(res.statusCode).toBe(200)
  })

  it('signs in with a 1.x password hash, then upgrades it in place', async () => {
    const res = await app.inject({ method: 'POST', path: '/auth/login', payload: { username: 'admin', password: 'admin' } })
    expect(res.statusCode).toBe(201)
    authorization = `bearer ${res.json().access_token}`

    // The upgrade is written after the response
    let stored: Array<Record<string, unknown>> = []
    for (let i = 0; i < 50; i++) {
      stored = await readJson(resolve(testStoragePath, 'auth.json'))
      if (stored[0].passwordIterations) {
        break
      }
      await new Promise(done => setTimeout(done, 20))
    }
    expect(LEGACY_PBKDF2_ITERATIONS).toBeLessThan(PBKDF2_ITERATIONS)
    expect(stored[0]).toMatchObject({ username: 'admin', admin: true, passwordIterations: PBKDF2_ITERATIONS })
    expect(stored[0].hashedPassword).not.toBe(USERS_1X[0].hashedPassword)

    // Same password, new hash
    const again = await app.inject({ method: 'POST', path: '/auth/login', payload: { username: 'admin', password: 'admin' } })
    expect(again.statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', path: '/auth/login', payload: { username: 'admin', password: 'wrong' } })).statusCode).toBe(403)
  })

  it('moves the 1.x config backups out of the storage root', async () => {
    const root = await readdir(testStoragePath)
    expect(root.filter(name => name.startsWith('config.json.'))).toEqual([])
    const moved = await readdir(configService.configBackupPath)
    expect(moved).toEqual(expect.arrayContaining(['config.json.1690000000000', 'config.json.1690000001000']))
    const list = await app.inject({ method: 'GET', path: '/config-editor/backups', headers: { authorization } })
    expect(list.statusCode).toBe(200)
    expect(list.json().map((backup: { id: number | string }) => String(backup.id))).toEqual(expect.arrayContaining(['1690000000000', '1690000001000']))
  })

  it('serves and saves the 1.x config.json unchanged in shape', async () => {
    const res = await app.inject({ method: 'GET', path: '/config-editor', headers: { authorization } })
    expect(res.statusCode).toBe(200)
    expect(res.json().platforms).toEqual(expect.arrayContaining([expect.objectContaining({ platform: 'SomePlugin', token: 'plugin-secret' })]))

    const saved = await app.inject({ method: 'POST', path: '/config-editor', headers: { authorization }, payload: res.json() })
    expect(saved.statusCode).toBe(201)
    const onDisk = await readJson(process.env.UIX_CONFIG_PATH!)
    expect(onDisk.platforms.find((p: { platform: string }) => p.platform === 'config')).toMatchObject({ port: 8581, theme: 'auto' })
    expect(onDisk.platforms.find((p: { platform: string }) => p.platform === 'SomePlugin')).toMatchObject({ token: 'plugin-secret' })
  })

  it('reads the 1.x accessory layout and hb-service startup settings', async () => {
    const layout = await app.inject({ method: 'GET', path: '/accessories/layout', headers: { authorization } })
    expect(layout.json()).toEqual([{ name: 'Living Room', services: [{ uniqueId: 'abc', hidden: false }] }])

    const startup = await app.inject({ method: 'GET', path: '/platform-tools/hb-service/homebridge-startup-settings', headers: { authorization } })
    expect(startup.json()).toMatchObject({ HOMEBRIDGE_DEBUG: true, HOMEBRIDGE_INSECURE: true, ENV_DEBUG: 'homebridge*', ENV_NODE_OPTIONS: '--max-old-space-size=512' })
  })

  it('starts 2.0\'s own stores empty', async () => {
    expect((await app.inject({ method: 'GET', path: '/auth/tokens', headers: { authorization } })).json()).toEqual([])
    const audit = await app.inject({ method: 'GET', path: '/audit', headers: { authorization } })
    expect(audit.statusCode).toBe(200)
    // Only what this spec did
    expect(audit.json().entries.every((entry: { action: string }) => entry.action === 'config.save')).toBe(true)
    expect(await pathExists(resolve(testStoragePath, '.uix-ai-usage.json'))).toBe(false)
  })
})
