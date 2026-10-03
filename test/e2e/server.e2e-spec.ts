import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import type { HomebridgeConfig } from '../../src/core/config/config.interfaces.js'

import { execFileSync, spawnSync } from 'node:child_process'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { chmod, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import fastifyMultipart from '@fastify/multipart'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import FormData from 'form-data'
import { copy, ensureDir, pathExists, readFile, readJson, remove, writeJson } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { AuthService } from '../../src/core/auth/auth.service.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { ChildBridgesService } from '../../src/modules/child-bridges/child-bridges.service.js'
import { ServerModule } from '../../src/modules/server/server.module.js'
import { ServerService } from '../../src/modules/server/server.service.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

describe('ServerController (e2e)', () => {
  let app: NestFastifyApplication

  let authFilePath: string
  let secretsFilePath: string
  let accessoriesPath: string
  let persistPath: string
  let authorization: string
  let configService: ConfigService
  let serverService: ServerService
  let childBridgesService: ChildBridgesService

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    secretsFilePath = resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets')
    accessoriesPath = resolve(process.env.UIX_STORAGE_PATH, 'accessories')
    persistPath = resolve(process.env.UIX_STORAGE_PATH, 'persist')

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), secretsFilePath)

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ServerModule, AuthModule],
    }).compile()

    const fAdapter = new FastifyAdapter()

    fAdapter.register(fastifyMultipart, {
      limits: {
        files: 1,
        fileSize: globalThis.backup.maxBackupSize,
      },
    })

    app = moduleFixture.createNestApplication<NestFastifyApplication>(fAdapter)

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))

    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    serverService = await app.get(ServerService)
    configService = await app.get(ConfigService)
    childBridgesService = await app.get(ChildBridgesService)
  })

  beforeEach(async () => {
    // Log in once per file - every login runs a 210,000-iteration PBKDF2 hash
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: {
        username: 'admin',
        password: 'admin',
      },
    })).json().access_token}`

    // Ensure it's clean
    await remove(persistPath)
    await remove(accessoriesPath)

    // copy mock accessories and persist
    await copy(resolve(__dirname, '../mocks', 'persist'), persistPath)
    await copy(resolve(__dirname, '../mocks', 'accessories'), accessoriesPath)
  })

  it('PUT /server/restart', async () => {
    const mockRestartServer = vi.fn()
    serverService.restartServer = mockRestartServer as any

    const res = await app.inject({
      method: 'PUT',
      path: '/server/restart',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockRestartServer).toHaveBeenCalled()
  })

  it('GET /server/pairing', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/pairing',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      displayName: 'Homebridge Test',
      isPaired: false,
      pincode: '874-99-441',
      setupCode: 'X-HM://0024X0Z3L1FAP',
    })
  })

  it('GET /server/pairing (not ready)', async () => {
    // Remove the persist folder
    await remove(persistPath)

    const res = await app.inject({
      method: 'GET',
      path: '/server/pairing',
      headers: {
        authorization,
      },
    })

    // Should return 503 - Service Unavailable
    expect(res.statusCode).toBe(503)
  })

  it('PUT /server/reset-homebridge-accessory', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/reset-homebridge-accessory',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)

    // check the persist and accessories folders were removed
    expect(await pathExists(persistPath)).toBe(false)
    expect(await pathExists(accessoriesPath)).toBe(false)
  })

  it('PUT /server/reset-cached-accessories', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/reset-cached-accessories',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
  })

  it('GET /server/cached-accessories', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/cached-accessories',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('DELETE /server/cached-accessories/:uuid (valid uuid)', async () => {
    // Sanity check to ensure one cached accessory is preset
    let cachedAccessories = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(cachedAccessories).toHaveLength(1)

    const res = await app.inject({
      method: 'DELETE',
      path: `/server/cached-accessories/${cachedAccessories[0].UUID}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)

    // check the cached accessory was removed
    cachedAccessories = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(cachedAccessories).toHaveLength(0)
  })

  it('DELETE /server/cached-accessories/:uuid (invalid uuid)', async () => {
    // Sanity check to ensure one cached accessory is preset
    let cachedAccessories = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(cachedAccessories).toHaveLength(1)

    const res = await app.inject({
      method: 'DELETE',
      path: '/server/cached-accessories/xxxxxxxx',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(404)

    // check the cached accessory was not removed
    cachedAccessories = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(cachedAccessories).toHaveLength(1)
  })

  it('DELETE /server/cached-accessories/:uuid (rejects unsafe cacheFile)', async () => {
    const cachedAccessories = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    const uuid = cachedAccessories[0].UUID

    for (const cacheFile of ['../../auth.json', 'auth.json', 'cachedAccessories.NOTHEX', 'random-file']) {
      const res = await app.inject({
        method: 'DELETE',
        path: `/server/cached-accessories/${uuid}?cacheFile=${encodeURIComponent(cacheFile)}`,
        headers: { authorization },
      })
      expect(res.statusCode).toBe(400)
    }

    const after = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(after).toHaveLength(1)
  })

  it('GET /server/pairings', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/pairings',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('lists no pairings or cached accessories before Homebridge has run once', async () => {
    // A fresh storage folder: Homebridge creates persist/ and accessories/ on its first start
    await remove(persistPath)
    await remove(accessoriesPath)

    for (const path of ['/server/pairings', '/server/cached-accessories']) {
      const res = await app.inject({ method: 'GET', path, headers: { authorization } })
      expect({ path, status: res.statusCode, body: res.json() }).toEqual({ path, status: 200, body: [] })
    }

    const res = await app.inject({ method: 'PUT', path: '/server/reset-cached-accessories', headers: { authorization } })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /server/cached-accessories refuses a request without accessories', async () => {
    const res = await app.inject({ method: 'DELETE', path: '/server/cached-accessories', headers: { authorization } })

    expect(res.statusCode).toBe(400)
  })

  it('GET /server/pairings/:deviceId', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/pairings/67E41F0EA05D',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    // pincode 874-99-441, category 2 (bridge), setupID 1FAP from the mock AccessoryInfo
    expect(res.json()._setupCode).toBe('X-HM://0024X0Z3L1FAP')
    expect(res.json()._isPaired).toBe(false)
    expect(res.json()._username).toBe('67:E4:1F:0E:A0:5D')
  })

  it('GET /server/pairings/:deviceId rejects an encoded path traversal', async () => {
    // The router decodes %2F inside a param, so this used to read <storage>/auth.json
    const res = await app.inject({
      method: 'GET',
      path: '/server/pairings/%2F..%2F..%2Fauth',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain('hashedPassword')
  })

  it('tags HAP externals with plugin attribution when externalAccessories.json is present', async () => {
    // Simulate what the homebridge runtime writes when a plugin calls publishExternalAccessories:
    // a HAP AccessoryInfo file in persist/ plus an externalAccessories index in accessories/.
    const externalDeviceId = 'ABCDEF012345'
    const externalUsername = 'AB:CD:EF:01:23:45'
    const externalPort = 51234

    await writeJson(resolve(persistPath, `AccessoryInfo.${externalDeviceId}.json`), {
      displayName: 'Living Room Camera',
      category: 17, // CAMERA
      pincode: '874-99-441',
      signSk: 'a'.repeat(128),
      signPk: 'a'.repeat(64),
      pairedClients: {},
      pairedClientsPermission: {},
      configVersion: 1,
      configHash: 'abcd',
      setupID: 'ABCD',
    })

    await writeJson(resolve(accessoriesPath, 'externalAccessories'), [
      {
        username: externalUsername,
        plugin: 'homebridge-camera-ffmpeg',
        displayName: 'Living Room Camera',
        category: 17,
        port: externalPort,
      },
    ])

    const res = await app.inject({
      method: 'GET',
      path: '/server/pairings',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    const external = res.json().find((d: any) => d._id === externalDeviceId)
    expect(external).toMatchObject({ _id: externalDeviceId, _username: externalUsername })
    expect(external._plugin).toBe('homebridge-camera-ffmpeg')
    expect(external._isExternal).toBe(true)
    expect(external._port).toBe(externalPort)
    expect(external._couldBeStale).toBe(false)
    // pincode 874-99-441, category 17 (camera), setupID ABCD
    expect(external._setupCode).toBe('X-HM://00GXNDDWXABCD')
  })

  it('exposes Matter commissioning QR data on Matter externals', async () => {
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
    await copy(resolve(__dirname, '../mocks', 'matter'), matterPath)

    const res = await app.inject({
      method: 'GET',
      path: '/server/pairings',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    const matterExternal = res.json().find((d: any) => d._matterOnly === true)
    expect(matterExternal).toMatchObject({ _matterOnly: true })
    expect(matterExternal._isExternal).toBe(true)
    expect(matterExternal._setupCode).toBe('MT:Y.K90-C80B00000000')
    expect(matterExternal.pincode).toBe('8765-432-1098')
    expect(matterExternal._isPaired).toBe(true)
    expect(matterExternal._plugin).toBe('homebridge-external-plugin')

    await remove(matterPath)
  })

  describe('GET /server/accessory-overview', () => {
    it('bundles cached HAP accessories, matter accessories and pairings into one payload', async () => {
      // Copy mock Matter storage so matterAccessories is non-empty
      const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
      await copy(resolve(__dirname, '../mocks', 'matter'), matterPath)

      const res = await app.inject({
        method: 'GET',
        path: '/server/accessory-overview',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('hapAccessories')
      expect(body).toHaveProperty('matterAccessories')
      expect(body).toHaveProperty('pairings')
      expect(Array.isArray(body.hapAccessories)).toBe(true)
      expect(Array.isArray(body.matterAccessories)).toBe(true)
      expect(Array.isArray(body.pairings)).toBe(true)
      expect(body.hapAccessories).toHaveLength(1)
      expect(body.matterAccessories.length).toBeGreaterThan(0)
      // Pairings include the HAP bridge plus any Matter-external published accessories
      expect(body.pairings.length).toBeGreaterThanOrEqual(1)
      // Matter accessory shape is preserved
      expect(body.matterAccessories[0]).toHaveProperty('uuid')
      expect(body.matterAccessories[0]).toHaveProperty('$protocol', 'matter')

      // Cleanup
      await remove(matterPath)
    })

    it('returns an empty matter array when the matter store is missing', async () => {
      // No matter mock copied — accessories + persist are restored by beforeEach
      const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
      await remove(matterPath)

      const res = await app.inject({
        method: 'GET',
        path: '/server/accessory-overview',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.hapAccessories).toHaveLength(1)
      expect(body.matterAccessories).toEqual([])
      expect(body.pairings).toHaveLength(1)
    })

    it('returns 401 without an authorization token', async () => {
      const res = await app.inject({
        method: 'GET',
        path: '/server/accessory-overview',
      })

      expect(res.statusCode).toBe(401)
    })
  })

  it('DELETE /server/pairings/:deviceId', async () => {
    const res = await app.inject({
      method: 'DELETE',
      path: '/server/pairings/67E41F0EA05D',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)
  })

  it('GET /server/network-interfaces/system', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/network-interfaces/system',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  }, 30000)

  it('GET /server/network-interfaces/bridge', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/network-interfaces/bridge',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('PUT /server/network-interfaces/bridge', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/network-interfaces/bridge',
      headers: {
        authorization,
      },
      payload: {
        adapters: ['en0'],
      },
    })

    expect(res.statusCode).toBe(200)

    // check the value was saved
    const config = await readJson(configService.configPath)
    expect(config.bridge.bind).toEqual(['en0'])
  })

  it('PUT /server/network-interfaces/bridge (no adapters)', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/network-interfaces/bridge',
      headers: {
        authorization,
      },
      payload: {
        adapters: [],
      },
    })

    expect(res.statusCode).toBe(200)

    // check the value was saved
    const config = await readJson(configService.configPath)
    expect(config.bridge.bind).toBeUndefined()
  })

  it('PUT /server/network-interfaces/bridge (bad payload)', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/network-interfaces/bridge',
      headers: {
        authorization,
      },
      payload: {
        adapters: 'en0',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('adapters must be an array')
  })

  it('GET /server/mdns-advertiser (when not set - default to bonjour-hap)', async () => {
    const config: HomebridgeConfig = await readJson(configService.configPath)
    delete config.bridge.advertiser
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'GET',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advertiser: 'bonjour-hap' })
  })

  it('GET /server/mdns-advertiser (when set to ciao)', async () => {
    const config: HomebridgeConfig = await readJson(configService.configPath)
    config.bridge.advertiser = 'ciao'
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'GET',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advertiser: 'ciao' })
  })

  it('GET /server/mdns-advertiser (when set to avahi)', async () => {
    const config: HomebridgeConfig = await readJson(configService.configPath)
    config.bridge.advertiser = 'avahi'
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'GET',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advertiser: 'avahi' })
  })

  it('GET /server/mdns-advertiser (when set to resolved)', async () => {
    const config: HomebridgeConfig = await readJson(configService.configPath)
    config.bridge.advertiser = 'resolved'
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'GET',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ advertiser: 'resolved' })
  })

  it('PUT /server/mdns-advertiser (bonjour-hap)', async () => {
    const initialConfig: HomebridgeConfig = await readJson(configService.configPath)
    delete initialConfig.bridge.advertiser
    await writeJson(configService.configPath, initialConfig)

    const res = await app.inject({
      method: 'PUT',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
      payload: {
        advertiser: 'bonjour-hap',
      },
    })

    expect(res.statusCode).toBe(200)

    // check the value was saved
    const config = await readJson(configService.configPath)
    expect(config.bridge.advertiser).toBe('bonjour-hap')
  })

  it('PUT /server/mdns-advertiser (ciao)', async () => {
    const initialConfig: HomebridgeConfig = await readJson(configService.configPath)
    delete initialConfig.mdns
    await writeJson(configService.configPath, initialConfig)

    const res = await app.inject({
      method: 'PUT',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
      payload: {
        advertiser: 'ciao',
      },
    })

    expect(res.statusCode).toBe(200)

    // check the value was saved
    const config = await readJson(configService.configPath)
    expect(config.bridge.advertiser).toBe('ciao')
  })

  it('PUT /server/mdns-advertiser (avahi)', async () => {
    const initialConfig: HomebridgeConfig = await readJson(configService.configPath)
    delete initialConfig.mdns
    await writeJson(configService.configPath, initialConfig)

    const res = await app.inject({
      method: 'PUT',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
      payload: {
        advertiser: 'avahi',
      },
    })

    expect(res.statusCode).toBe(200)

    // check the value was saved
    const config = await readJson(configService.configPath)
    expect(config.bridge.advertiser).toBe('avahi')
  })

  it('PUT /server/mdns-advertiser (invalid value)', async () => {
    const initialConfig: HomebridgeConfig = await readJson(configService.configPath)
    delete initialConfig.mdns
    await writeJson(configService.configPath, initialConfig)

    const res = await app.inject({
      method: 'PUT',
      path: '/server/mdns-advertiser',
      headers: {
        authorization,
      },
      payload: {
        advertiser: 'xxxxxxx',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('GET /server/port/new', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/port/new',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(typeof res.json().port).toBe('number')
    expect(res.json().port).toBeGreaterThanOrEqual(30000)
    expect(res.json().port).toBeLessThanOrEqual(60000)
  })

  it('POST /server/wallpaper', async () => {
    // create multipart form
    const payload = new FormData()
    payload.append('wallpaper', await readFile(resolve(__dirname, '../mocks/persist/wallpaper.png')), 'wallpaper.png')

    const headers = payload.getHeaders()
    headers.authorization = authorization

    const res = await app.inject({
      method: 'POST',
      path: '/server/wallpaper',
      headers,
      payload,
    })

    // the upload is saved before the response is sent
    expect(res.statusCode).toBe(201)

    // Two things to ensure:
    // 1. The wallpaper was saved to the correct location
    const wallpaperPath = resolve(process.env.UIX_STORAGE_PATH, 'ui-wallpaper.png')
    expect(await pathExists(wallpaperPath)).toBe(true)

    // 2. The wallpaper was set in the config
    const config = await readJson(configService.configPath)
    expect(config.platforms[0].wallpaper).toBe('ui-wallpaper.png')
  })

  it('DELETE /server/wallpaper', async () => {
    // Create wallpaper first (same as test above)
    const payload = new FormData()
    payload.append('wallpaper', await readFile(resolve(__dirname, '../mocks/persist/wallpaper.png')), 'wallpaper.png')

    const headers = payload.getHeaders()
    headers.authorization = authorization

    const res = await app.inject({
      method: 'POST',
      path: '/server/wallpaper',
      headers,
      payload,
    })

    // the upload is saved before the response is sent
    expect(res.statusCode).toBe(201)

    // Now delete the wallpaper
    const deleteRes = await app.inject({
      method: 'DELETE',
      path: '/server/wallpaper',
      headers,
    })

    expect(deleteRes.statusCode).toBe(204)

    // Check the wallpaper file was removed
    const wallpaperPath = resolve(process.env.UIX_STORAGE_PATH, 'ui-wallpaper.png')
    expect(await pathExists(wallpaperPath)).toBe(false)

    // Check the config file was updated
    const config = await readJson(configService.configPath)
    expect(config.platforms[0].wallpaper).toBeUndefined()
  })

  describe('wallpaper file name hardening', () => {
    const uploadWallpaper = async (fileName: string) => {
      const payload = new FormData()
      payload.append('wallpaper', await readFile(resolve(__dirname, '../mocks/persist/wallpaper.png')), fileName)
      const headers = payload.getHeaders()
      headers.authorization = authorization
      return app.inject({ method: 'POST', path: '/server/wallpaper', headers, payload })
    }

    // Write `ui.wallpaper` straight into config.json and the running config,
    // the way a hand edit (or a value saved before the check existed) would
    const setWallpaperInConfig = async (value: string) => {
      const config: HomebridgeConfig = await readJson(configService.configPath)
      ;(config.platforms.find((p: any) => p.platform === 'config') as any).wallpaper = value
      await writeJson(configService.configPath, config)
      configService.ui.wallpaper = value
    }

    afterAll(async () => {
      await remove(resolve(process.env.UIX_STORAGE_PATH, 'victim.txt'))
    })

    it('refuses to upload a file that is not an allowed image type', async () => {
      const res = await uploadWallpaper('evil.html')

      expect(res.statusCode).toBe(400)
      expect(await pathExists(resolve(process.env.UIX_STORAGE_PATH, 'ui-wallpaper.html'))).toBe(false)
      const config = await readJson(configService.configPath)
      expect(config.platforms[0].wallpaper).not.toBe('ui-wallpaper.html')
    })

    it('refuses to upload a file without an extension', async () => {
      const res = await uploadWallpaper('wallpaper')
      expect(res.statusCode).toBe(400)
    })

    it('accepts an upper-case image extension and keeps its case', async () => {
      const res = await uploadWallpaper('Photo.JPG')

      expect(res.statusCode).toBe(201)
      const config = await readJson(configService.configPath)
      expect(config.platforms[0].wallpaper).toBe('ui-wallpaper.JPG')
      expect(await pathExists(resolve(process.env.UIX_STORAGE_PATH, 'ui-wallpaper.JPG'))).toBe(true)
      await remove(resolve(process.env.UIX_STORAGE_PATH, 'ui-wallpaper.JPG'))
    })

    it('does not delete the file a hand-edited wallpaper value names when a new one is uploaded', async () => {
      const victim = resolve(process.env.UIX_STORAGE_PATH, 'victim.txt')
      await writeJson(victim, { keep: true })
      await setWallpaperInConfig('victim.txt')

      const res = await uploadWallpaper('wallpaper.png')

      expect(res.statusCode).toBe(201)
      expect(await pathExists(victim)).toBe(true)
    })

    it('does not delete the file a hand-edited wallpaper value names on DELETE, but clears the value', async () => {
      const victim = resolve(process.env.UIX_STORAGE_PATH, 'victim.txt')
      await writeJson(victim, { keep: true })
      await setWallpaperInConfig('../storage/victim.txt')

      const res = await app.inject({ method: 'DELETE', path: '/server/wallpaper', headers: { authorization } })

      expect(res.statusCode).toBe(204)
      expect(await pathExists(victim)).toBe(true)
      const config = await readJson(configService.configPath)
      expect(config.platforms[0].wallpaper).toBeUndefined()
    })

    it('GET /auth/wallpaper/:hash serves an uploaded wallpaper without authentication', async () => {
      expect((await uploadWallpaper('wallpaper.png')).statusCode).toBe(201)
      configService.ui.wallpaper = 'ui-wallpaper.png'

      const res = await app.inject({ method: 'GET', path: '/auth/wallpaper/any.jpg' })

      expect(res.statusCode).toBe(200)
      expect(res.rawPayload).toEqual(await readFile(resolve(__dirname, '../mocks/persist/wallpaper.png')))
    })

    it.each([
      'auth.json',
      '.uix-secrets',
      '../auth.json',
      '/etc/passwd',
      'ui-wallpaper.png/../auth.json',
      'sub/ui-wallpaper.png',
    ])('GET /auth/wallpaper/:hash does not serve a wallpaper value of %s', async (value) => {
      configService.ui.wallpaper = value

      const res = await app.inject({ method: 'GET', path: '/auth/wallpaper/any.jpg' })

      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('hashedPassword')
      expect(res.body).not.toContain('secretKey')
      expect(res.body).not.toContain('root:')
    })
  })

  it('GET /server/matter-accessories (should return empty array when no Matter storage)', async () => {
    // Ensure no Matter directory exists
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
    await remove(matterPath)

    const res = await app.inject({
      method: 'GET',
      path: '/server/matter-accessories',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
    expect(res.json()).toHaveLength(0)
  })

  it('GET /server/matter-accessories (should return accessories from all devices)', async () => {
    // Copy mock Matter storage
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
    await copy(resolve(__dirname, '../mocks', 'matter'), matterPath)

    const res = await app.inject({
      method: 'GET',
      path: '/server/matter-accessories',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    const accessories = res.json()
    expect(Array.isArray(accessories)).toBe(true)
    expect(accessories.length).toBeGreaterThan(0)

    // Verify structure
    const firstAccessory = accessories[0]
    expect(firstAccessory).toHaveProperty('uuid')
    expect(firstAccessory).toHaveProperty('$deviceId')
    expect(firstAccessory).toHaveProperty('$protocol', 'matter')

    // Cleanup
    await remove(matterPath)
  })

  it('DELETE /server/matter-accessories/:deviceId/:uuid (should remove single Matter accessory)', async () => {
    // Setup: Copy mock Matter storage
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
    await copy(resolve(__dirname, '../mocks', 'matter'), matterPath)

    const deviceId = '67E41F0EA05D'
    const uuid = 'matter-test-accessory-uuid-1'

    const res = await app.inject({
      method: 'DELETE',
      path: `/server/matter-accessories/${deviceId}/${uuid}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)

    // Verify accessory was removed from the file
    const accessoriesPath = resolve(matterPath, deviceId, 'accessories.json')
    const accessories = await readJson(accessoriesPath)
    expect(accessories.find(a => a.uuid === uuid)).toBeUndefined()

    // Cleanup
    await remove(matterPath)
  })

  it('DELETE /server/matter-accessories/:deviceId/:uuid (should return 404 if accessories file not found)', async () => {
    // Valid 12-hex device ID that simply doesn't exist on disk.
    const deviceId = 'ABCDEF012345'
    const uuid = 'some-uuid'

    const res = await app.inject({
      method: 'DELETE',
      path: `/server/matter-accessories/${deviceId}/${uuid}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(404)
  })

  it('DELETE /server/matter-accessories/:deviceId/:uuid (should return 400 for a malformed device ID)', async () => {
    // A non-hex device ID must be rejected before any fs path is built, so a
    // request-supplied value can't traverse out of the matter storage dir.
    const res = await app.inject({
      method: 'DELETE',
      path: `/server/matter-accessories/${encodeURIComponent('../../etc')}/some-uuid`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('DELETE /server/matter-accessories (should return 400 for a malformed device ID)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      path: '/server/matter-accessories',
      headers: {
        authorization,
      },
      payload: [{ deviceId: '../../etc', uuid: 'some-uuid' }],
    })

    expect(res.statusCode).toBe(400)
  })

  it('DELETE /server/matter-accessories/:deviceId/:uuid (should return 404 if uuid not found)', async () => {
    // Setup: Copy mock Matter storage
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
    await copy(resolve(__dirname, '../mocks', 'matter'), matterPath)

    const deviceId = '67E41F0EA05D'
    const uuid = 'nonexistent-uuid'

    const res = await app.inject({
      method: 'DELETE',
      path: `/server/matter-accessories/${deviceId}/${uuid}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(404)

    // Cleanup
    await remove(matterPath)
  })

  it('DELETE /server/matter-accessories (should remove multiple Matter accessories)', async () => {
    // Setup: Copy mock Matter storage
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter')
    await copy(resolve(__dirname, '../mocks', 'matter'), matterPath)

    const accessoriesToDelete = [
      { deviceId: '67E41F0EA05D', uuid: 'matter-test-accessory-uuid-1' },
      { deviceId: '67E41F0EA05D', uuid: 'matter-test-accessory-uuid-2' },
    ]

    const res = await app.inject({
      method: 'DELETE',
      path: '/server/matter-accessories',
      headers: {
        authorization,
      },
      payload: accessoriesToDelete,
    })

    expect(res.statusCode).toBe(204)

    // Verify accessories were removed
    const accessoriesPath = resolve(matterPath, '67E41F0EA05D', 'accessories.json')
    const accessories = await readJson(accessoriesPath)
    expect(accessories).toHaveLength(0)

    // Cleanup
    await remove(matterPath)
  })

  it('GET /server/port/new/matter (should return port in Matter range)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/port/new/matter',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(typeof res.json().port).toBe('number')
    expect(res.json().port).toBeGreaterThanOrEqual(5530)
    expect(res.json().port).toBeLessThanOrEqual(5541)
  })

  it('GET /server/port/new/matter (should avoid already used ports)', async () => {
    // Set up config with some used Matter ports
    const config = await readJson(configService.configPath)
    config.bridge.matter = { port: 5530 }
    config.platforms = [
      {
        name: 'Test Plugin',
        _bridge: {
          username: '0E:02:9A:9D:44:45',
          matter: {
            port: 5531,
          },
        },
      },
    ]
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'GET',
      path: '/server/port/new/matter',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    const returnedPort = res.json().port
    expect(returnedPort).not.toBe(5530)
    expect(returnedPort).not.toBe(5531)
    expect(returnedPort).toBeGreaterThanOrEqual(5530)
    expect(returnedPort).toBeLessThanOrEqual(5541)
  })

  it('DELETE /server/pairings/:deviceId/matter (should remove Matter config from child bridge)', async () => {
    // Setup: Create config with Matter enabled on a child bridge
    const config = await readJson(configService.configPath)
    const deviceId = '0E029A9D4445'
    const username = '0E:02:9A:9D:44:45'

    config.platforms = [
      {
        name: 'Test Plugin',
        _bridge: {
          username,
          matter: {
            port: 5540,
          },
        },
      },
    ]
    await writeJson(configService.configPath, config)

    // Create Matter storage for this bridge
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter', deviceId)
    await ensureDir(matterPath)
    await writeJson(resolve(matterPath, 'test.json'), { test: true })

    expect(await pathExists(matterPath)).toBe(true)

    const res = await app.inject({
      method: 'DELETE',
      path: `/server/pairings/${deviceId}/matter`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)

    // Verify Matter config was removed from config.json
    const updatedConfig = await readJson(configService.configPath)
    expect(updatedConfig.platforms[0]._bridge.matter).toBeUndefined()

    // Verify Matter storage was removed
    expect(await pathExists(matterPath)).toBe(false)
  })

  it('DELETE /server/pairings/:deviceId/matter (should return 204 if Matter config not found)', async () => {
    const config = await readJson(configService.configPath)
    config.platforms = [
      {
        name: 'Test Plugin',
        _bridge: {
          username: '0E:02:9A:9D:44:45',
          // No Matter config
        },
      },
    ]
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'DELETE',
      path: '/server/pairings/0E029A9D4445/matter',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)
  })

  it('DELETE /server/pairings/:deviceId/matter (should handle deviceId with colons)', async () => {
    // Setup: Create config with Matter enabled
    const config = await readJson(configService.configPath)
    const username = '0E:02:9A:9D:44:45'

    config.platforms = [
      {
        name: 'Test Plugin',
        _bridge: {
          username,
          matter: {
            port: 5540,
          },
        },
      },
    ]
    await writeJson(configService.configPath, config)

    // Create Matter storage
    const matterPath = resolve(process.env.UIX_STORAGE_PATH, 'matter', '0E029A9D4445')
    await ensureDir(matterPath)
    await writeJson(resolve(matterPath, 'test.json'), { test: true })

    // Use deviceId WITH colons
    const res = await app.inject({
      method: 'DELETE',
      path: `/server/pairings/${username}/matter`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)

    // Verify Matter storage was removed
    expect(await pathExists(matterPath)).toBe(false)
  })

  it('PUT /server/restart/:deviceId', async () => {
    vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true })

    const res = await app.inject({
      method: 'PUT',
      path: '/server/restart/0EAABBCCDDEE',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(childBridgesService.restartChildBridge).toHaveBeenCalledWith('0EAABBCCDDEE')
  })

  it('PUT /server/stop/:deviceId', async () => {
    vi.spyOn(childBridgesService, 'stopChildBridge').mockReturnValue({ ok: true })

    const res = await app.inject({
      method: 'PUT',
      path: '/server/stop/0EAABBCCDDEE',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(childBridgesService.stopChildBridge).toHaveBeenCalledWith('0EAABBCCDDEE')
  })

  it('PUT /server/start/:deviceId', async () => {
    vi.spyOn(childBridgesService, 'startChildBridge').mockReturnValue({ ok: true })

    const res = await app.inject({
      method: 'PUT',
      path: '/server/start/0EAABBCCDDEE',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(childBridgesService.startChildBridge).toHaveBeenCalledWith('0EAABBCCDDEE')
  })

  it('DELETE /server/cached-accessories (bulk)', async () => {
    const cachedAccessories = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(cachedAccessories).toHaveLength(1)

    const res = await app.inject({
      method: 'DELETE',
      path: '/server/cached-accessories',
      headers: {
        authorization,
      },
      payload: [{ uuid: cachedAccessories[0].UUID, cacheFile: 'cachedAccessories' }],
    })

    expect(res.statusCode).toBe(204)

    const remaining = await readJson(resolve(accessoriesPath, 'cachedAccessories'))
    expect(remaining).toHaveLength(0)
  })

  it('DELETE /server/cached-accessories (bulk - rejects unsafe cacheFile)', async () => {
    const authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    const authBefore = await readJson(authFilePath)
    expect(authBefore).toStrictEqual(expect.arrayContaining([expect.objectContaining({ username: 'admin' })]))

    for (const cacheFile of ['../../auth.json', 'auth.json', 'cachedAccessories.NOTHEX']) {
      const res = await app.inject({
        method: 'DELETE',
        path: '/server/cached-accessories',
        headers: { authorization },
        payload: [{ uuid: 'some-uuid', cacheFile }],
      })
      expect(res.statusCode).toBe(400)
    }

    const authAfter = await readJson(authFilePath)
    expect(authAfter).toEqual(authBefore)
  })

  it('DELETE /server/pairings (bulk)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      path: '/server/pairings',
      headers: {
        authorization,
      },
      payload: [{ id: '67E41F0EA05D', resetPairingInfo: false }],
    })

    expect(res.statusCode).toBe(204)
  })

  it('DELETE /server/pairings/:deviceId/accessories', async () => {
    const res = await app.inject({
      method: 'DELETE',
      path: '/server/pairings/67E41F0EA05D/accessories',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(204)
  })

  it('DELETE /server/pairings/accessories (bulk)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      path: '/server/pairings/accessories',
      headers: {
        authorization,
      },
      payload: [{ id: '67E41F0EA05D' }],
    })

    expect(res.statusCode).toBe(204)
  })

  it('GET /server/network/overview', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/network/overview',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('entries')
    expect(res.json()).toHaveProperty('conflicts')
    expect(Array.isArray(res.json().entries)).toBe(true)
    expect(Array.isArray(res.json().conflicts)).toBe(true)
    // Should at least have the main bridge and UI entries
    expect(res.json().entries.length).toBeGreaterThanOrEqual(2)
  })

  it('PUT /server/name', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/name',
      headers: {
        authorization,
      },
      payload: {
        name: 'My Homebridge',
      },
    })

    expect(res.statusCode).toBe(200)

    const config = await readJson(configService.configPath)
    expect(config.bridge.name).toBe('My Homebridge')
  })

  it('PUT /server/name (invalid name)', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/name',
      headers: {
        authorization,
      },
      payload: {
        name: '',
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('GET /server/port', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/port',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(typeof res.json().port).toBe('number')
  })

  it('PUT /server/port', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/port',
      headers: {
        authorization,
      },
      payload: {
        port: 51827,
      },
    })

    expect(res.statusCode).toBe(200)

    const config = await readJson(configService.configPath)
    expect(config.bridge.port).toBe(51827)
  })

  it('PUT /server/port (invalid port)', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/port',
      headers: {
        authorization,
      },
      payload: {
        port: 100,
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('GET /server/ports', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/server/ports',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(typeof res.json()).toBe('object')
  })

  it('PUT /server/ports', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/ports',
      headers: {
        authorization,
      },
      payload: {
        start: 30000,
        end: 40000,
      },
    })

    expect(res.statusCode).toBe(200)

    const config = await readJson(configService.configPath)
    expect(config.ports.start).toBe(30000)
    expect(config.ports.end).toBe(40000)
  })

  it('PUT /server/ports (invalid - start >= end)', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/server/ports',
      headers: {
        authorization,
      },
      payload: {
        start: 40000,
        end: 30000,
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('POST /server/ssl/validate (no SSL configured)', async () => {
    // Reset config to have a proper platforms array with config platform
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/validate',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().valid).toBe(true)
    expect(res.json().type).toBe('off')
  })

  it('POST /server/ssl/selfsigned/generate', async () => {
    // Reset config to ensure config platform block exists
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/selfsigned/generate',
      headers: {
        authorization,
      },
      payload: {
        hostnames: ['localhost', '192.168.1.1'],
        mode: 'keycert',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().type).toBe('generated')
    expect(res.json().mode).toBe('keycert')
    const sslDir = resolve(configService.storagePath, 'ssl-certs')
    expect(res.json().keyPath).toBe(resolve(sslDir, 'private-key.pem'))
    expect(res.json().certPath).toBe(resolve(sslDir, 'certificate.pem'))
    expect(await pathExists(res.json().keyPath)).toBe(true)
    expect(await pathExists(res.json().certPath)).toBe(true)
  })

  it('POST /server/ssl/selfsigned/generate (selfsigned mode)', async () => {
    // Reset config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/selfsigned/generate',
      headers: {
        authorization,
      },
      payload: {
        mode: 'selfsigned',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().mode).toBe('selfsigned')

    // Should have updated config
    const config = await readJson(configService.configPath)
    const uiBlock = config.platforms.find(x => x.platform === 'config')
    expect(uiBlock.ssl.selfSigned).toBe(true)
  })

  it('POST /server/ssl/validate (after self-signed generated in keycert mode)', async () => {
    // Reset config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // First generate a self-signed cert in keycert mode
    const genRes = await app.inject({
      method: 'POST',
      path: '/server/ssl/selfsigned/generate',
      headers: {
        authorization,
      },
      payload: {
        hostnames: ['localhost'],
        mode: 'keycert',
      },
    })

    expect(genRes.statusCode).toBe(201)

    // Now validate
    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/validate',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().valid).toBe(true)
    expect(res.json().type).toBe('keycert')
  })

  // Windows has no POSIX permission bits - report what was asked for there
  const modeOf = async (path: string, windowsMode: number) => process.platform === 'win32'
    ? windowsMode
    : (await stat(path)).mode & 0o777

  it('POST /server/ssl/selfsigned/generate writes a valid, owner-only certificate', async () => {
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/selfsigned/generate',
      headers: { authorization },
      payload: { hostnames: ['homebridge.local', '192.168.1.20', 'fe80::1'], mode: 'keycert' },
    })
    expect(res.statusCode).toBe(201)

    const keyPem = await readFile(res.json().keyPath)
    const cert = new X509Certificate(await readFile(res.json().certPath))
    expect(cert.subject).toContain('CN=homebridge.local')
    expect(cert.subject).toContain('O=Homebridge')
    expect(cert.subject).toContain('OU=Homebridge Glass UI')
    expect(cert.issuer).toBe(cert.subject)
    expect(cert.subjectAltName).toContain('DNS:homebridge.local')
    expect(cert.subjectAltName).toContain('IP Address:192.168.1.20')
    expect(cert.subjectAltName).toMatch(/IP Address:fe80:0:0:0:0:0:0:1/i)
    expect(cert.ca).toBe(false)
    expect(cert.keyUsage).toEqual(expect.arrayContaining(['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2']))
    expect(new Date(cert.validTo).toISOString()).toBe('2050-01-01T00:00:00.000Z')
    expect(cert.verify(cert.publicKey)).toBe(true)
    expect(cert.checkPrivateKey(createPrivateKey(keyPem))).toBe(true)
    // A fresh random serial each time (Firefox rejects a reused issuer + serial)
    expect(cert.serialNumber).toMatch(/^01[0-9A-F]{32}$/)

    expect(await modeOf(res.json().keyPath, 0o600)).toBe(0o600)
    expect(await modeOf(resolve(configService.storagePath, 'ssl-certs'), 0o700)).toBe(0o700)
  })

  it('POST /server/ssl/keycert saves the uploaded pair owner-only', async () => {
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // A valid pair to upload
    const gen = await app.inject({
      method: 'POST',
      path: '/server/ssl/selfsigned/generate',
      headers: { authorization },
      payload: { hostnames: ['localhost'], mode: 'keycert' },
    })
    const keyPem = await readFile(gen.json().keyPath)
    const certPem = await readFile(gen.json().certPath)

    // Files and a directory left world-readable by an older version are tightened
    const sslDir = resolve(configService.storagePath, 'ssl-certs')
    await chmod(sslDir, 0o755)
    await writeFile(resolve(sslDir, 'ui-ssl.key'), 'old', { mode: 0o644 })
    await chmod(resolve(sslDir, 'ui-ssl.key'), 0o644)

    const payload = new FormData()
    payload.append('key', keyPem, 'ui.key')
    payload.append('cert', certPem, 'ui.crt')
    const headers = payload.getHeaders()
    headers.authorization = authorization

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/keycert',
      headers,
      payload,
    })

    expect(res.statusCode).toBe(201)
    expect(await readFile(res.json().keyPath)).toEqual(keyPem)
    expect(await readFile(res.json().certPath)).toEqual(certPem)
    expect(await modeOf(res.json().keyPath, 0o600)).toBe(0o600)
    expect(await modeOf(res.json().certPath, 0o600)).toBe(0o600)
    expect(await modeOf(sslDir, 0o700)).toBe(0o700)
  })

  // Node can read a PKCS#12 bundle but not write one, so the openssl CLI builds it
  const hasOpenssl = spawnSync('openssl', ['version']).status === 0

  it.skipIf(!hasOpenssl)('POST /server/ssl/pfx saves the uploaded bundle owner-only', async () => {
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const gen = await app.inject({
      method: 'POST',
      path: '/server/ssl/selfsigned/generate',
      headers: { authorization },
      payload: { hostnames: ['localhost'], mode: 'keycert' },
    })
    const sslDir = resolve(configService.storagePath, 'ssl-certs')
    const sourcePfx = resolve(configService.storagePath, 'upload.pfx')
    execFileSync('openssl', [
      'pkcs12',
      '-export',
      '-inkey',
      gen.json().keyPath,
      '-in',
      gen.json().certPath,
      '-out',
      sourcePfx,
      '-passout',
      'pass:secret',
      // Ciphers OpenSSL 3 reads without the legacy provider (LibreSSL defaults to RC2)
      '-keypbe',
      'AES-256-CBC',
      '-certpbe',
      'AES-256-CBC',
      '-macalg',
      'sha256',
    ])
    await chmod(sslDir, 0o755)

    const payload = new FormData()
    payload.append('pfx', await readFile(sourcePfx), 'ui.pfx')
    payload.append('passphrase', 'secret')
    const headers = payload.getHeaders()
    headers.authorization = authorization

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/pfx',
      headers,
      payload,
    })

    expect(res.statusCode).toBe(201)
    expect(await readFile(res.json().pfxPath)).toEqual(await readFile(sourcePfx))
    expect(await modeOf(res.json().pfxPath, 0o600)).toBe(0o600)
    expect(await modeOf(sslDir, 0o700)).toBe(0o700)
  })

  it('POST /server/ssl/keycert (no files uploaded)', async () => {
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const payload = new FormData()

    const headers = payload.getHeaders()
    headers.authorization = authorization

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/keycert',
      headers,
      payload,
    })

    expect(res.statusCode).toBe(400)
  })

  it('POST /server/ssl/validate (selfsigned mode)', async () => {
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Set selfsigned mode in config
    const config = await readJson(configService.configPath)
    const uiBlock = config.platforms.find(x => x.platform === 'config')
    uiBlock.ssl = { selfSigned: true }
    await writeJson(configService.configPath, config)

    const res = await app.inject({
      method: 'POST',
      path: '/server/ssl/validate',
      headers: { authorization },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().valid).toBe(true)
    expect(res.json().type).toBe('selfsigned')
  })

  it('PUT /server/restart (rejects non-admin users)', async () => {
    // The restart command is admin-edited; non-admins can authenticate but
    // must not be able to trigger whatever shell command an admin saved.
    const authService = app.get(AuthService)
    await authService.addUser({
      name: 'NonAdmin Tester',
      username: 'restart-nonadmin',
      password: 'restart-nonadmin',
      admin: false,
    } as any)

    const nonAdminAuth = `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'restart-nonadmin', password: 'restart-nonadmin' },
    })).json().access_token}`

    const mockRestartServer = vi.fn()
    serverService.restartServer = mockRestartServer as any

    const res = await app.inject({
      method: 'PUT',
      path: '/server/restart',
      headers: { authorization: nonAdminAuth },
    })

    expect(res.statusCode).toBe(403)
    expect(mockRestartServer).not.toHaveBeenCalled()
  })

  afterAll(async () => {
    await app.close()
  })
})
