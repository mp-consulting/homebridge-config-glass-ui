import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import type { HomebridgePlugin } from '../../src/modules/plugins/plugins.interfaces.js'

import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { copy, readJson, remove } from 'fs-extra'
import { of } from 'rxjs'
import { gt as semverGt } from 'semver'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { ChildBridgesService } from '../../src/modules/child-bridges/child-bridges.service.js'
import { InstalledPluginsService } from '../../src/modules/plugins/installed-plugins.service.js'
import { PluginInstallerService } from '../../src/modules/plugins/plugin-installer.service.js'
import { PluginMetadataService } from '../../src/modules/plugins/plugin-metadata.service.js'
import { PluginRegistryService } from '../../src/modules/plugins/plugin-registry.service.js'
import { HomebridgeUpdateActionDto, PluginActionDto } from '../../src/modules/plugins/plugins.dto.js'
import { PluginsModule } from '../../src/modules/plugins/plugins.module.js'
import { PluginsService } from '../../src/modules/plugins/plugins.service.js'
import { UiUpdateService } from '../../src/modules/plugins/ui-update.service.js'
import { testStoragePath } from '../storage-path.js'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
    fork: vi.fn(actual.fork),
  }
})

/**
 * `POST /plugins/update/:name` answers first and runs the update from a
 * setImmediate. Wait for that background update to be started, then for it to
 * finish, and return its result. Its restart step runs synchronously right
 * after, so it has happened by the time this resolves.
 */
async function settledUpdate(performUpdateSpy: { mock: { results: Array<{ value: any }> } }) {
  await vi.waitFor(() => expect(performUpdateSpy.mock.results).toHaveLength(1))
  return performUpdateSpy.mock.results[0].value
}

describe('PluginController (e2e)', () => {
  let app: NestFastifyApplication
  let httpService: HttpService
  let pluginsService: PluginsService
  let installed: InstalledPluginsService
  let installer: PluginInstallerService
  let metadata: PluginMetadataService
  let registry: PluginRegistryService
  let uiUpdate: UiUpdateService
  let homebridgeIpcService: HomebridgeIpcService
  let childBridgesService: ChildBridgesService

  let authFilePath: string
  let secretsFilePath: string
  let pluginsPath: string
  let authorization: string

  // ⚠️ Two tests below POST /plugins/update/@mp-consulting/homebridge-config-glass-ui, which is
  // the path that schedules the UI's own restart - a real process.exit(0) five
  // seconds later. The test that arms it passes and moves on, so the exit lands
  // mid-suite and kills the whole vitest worker, blamed on whichever unrelated
  // test happened to be running. Held for the lifetime of this file rather than
  // per-test, because the fuse outlives the test that lit it.
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')
    process.env.UIX_CUSTOM_PLUGIN_PATH = resolve(process.env.UIX_STORAGE_PATH, 'plugins/node_modules')

    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    secretsFilePath = resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets')
    pluginsPath = process.env.UIX_CUSTOM_PLUGIN_PATH

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), secretsFilePath)

    await remove(pluginsPath)
    await copy(resolve(__dirname, '../mocks', 'plugins'), pluginsPath)

    // create httpService instance
    httpService = new HttpService()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PluginsModule, AuthModule],
    }).overrideProvider(HttpService).useValue(httpService).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))

    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    // Get service instances for testing
    pluginsService = app.get<PluginsService>(PluginsService)
    installed = app.get(InstalledPluginsService)
    installer = app.get(PluginInstallerService)
    metadata = app.get(PluginMetadataService)
    registry = app.get(PluginRegistryService)
    uiUpdate = app.get(UiUpdateService)
    homebridgeIpcService = app.get<HomebridgeIpcService>(HomebridgeIpcService)
    childBridgesService = app.get<ChildBridgesService>(ChildBridgesService)

    // Isolate plugin discovery to the test plugin path only
    ;(installed as any)._paths = [pluginsPath]
  })

  beforeEach(async () => {
    vi.resetAllMocks()
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

  it('sanitises the npm-spawn env so plugin postinstall scripts cannot read secret-shaped keys', () => {
    const sanitized = (installer as any).sanitizeNpmEnv({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LANG: 'en_GB.UTF-8',
      USER: 'pi',
      AWS_ACCESS_KEY_ID: 'AKIA...',
      AWS_SECRET_ACCESS_KEY: 'sekret',
      AZURE_CLIENT_SECRET: 'shh',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json',
      GITHUB_TOKEN: 'gh_xxx',
      GH_TOKEN: 'gh_xxx',
      NPM_TOKEN: 'npm_xxx',
      MY_CUSTOM_PASSWORD: 'hunter2',
      DB_PASSWD: 'hunter2',
      SOMETHING_SECRET: 'shh',
      A_PRIVATE_KEY: '-----BEGIN-----',
      HOMEBRIDGE_CONFIG_UI_PORT: '8581',
      UIX_STORAGE_PATH: '/var/lib/homebridge',
      npm_config_loglevel: 'error',
    })

    // Boring system + UI/homebridge wiring must pass through.
    expect(sanitized.PATH).toBe('/usr/bin')
    expect(sanitized.HOME).toBe('/home/me')
    expect(sanitized.LANG).toBe('en_GB.UTF-8')
    expect(sanitized.USER).toBe('pi')
    expect(sanitized.HOMEBRIDGE_CONFIG_UI_PORT).toBe('8581')
    expect(sanitized.UIX_STORAGE_PATH).toBe('/var/lib/homebridge')
    expect(sanitized.npm_config_loglevel).toBe('error')

    // Cloud creds and CI tokens are stripped wholesale.
    expect(sanitized.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(sanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(sanitized.AZURE_CLIENT_SECRET).toBeUndefined()
    expect(sanitized.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(sanitized.GITHUB_TOKEN).toBeUndefined()
    expect(sanitized.GH_TOKEN).toBeUndefined()
    expect(sanitized.NPM_TOKEN).toBeUndefined()

    // Generic secret-shaped keys are stripped by pattern.
    expect(sanitized.MY_CUSTOM_PASSWORD).toBeUndefined()
    expect(sanitized.DB_PASSWD).toBeUndefined()
    expect(sanitized.SOMETHING_SECRET).toBeUndefined()
    expect(sanitized.A_PRIVATE_KEY).toBeUndefined()
  })

  it('GET /plugins', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().length).toBeGreaterThan(0)

    const mockPlugin: HomebridgePlugin = res.json().find(x => x.name === 'homebridge-mock-plugin')

    expect(mockPlugin).toBeTruthy()
    expect(mockPlugin.settingsSchema).toBe(true)
    expect(mockPlugin.private).toBe(true)
    expect(mockPlugin.publicPackage).toBe(false)
  })

  it('GET /plugins/search/:query (keyword)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/search/google',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().length).toBeGreaterThan(0)
    expect(res.json().find(x => x.name === 'homebridge-gsh')).toBeTruthy()
    expect(res.json()[0]).toHaveProperty('lastUpdated')
    expect(res.json()[0]).toHaveProperty('private')
  })

  it('GET /plugins/search/:query (keyword) - #2290', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/search/alexa',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().length).toBeGreaterThan(0)
    expect(res.json().find(x => x.name === 'homebridge-alexa-smarthome')).toBeTruthy()
    expect(res.json()[0]).toHaveProperty('lastUpdated')
    expect(res.json()[0].private).toBe(false)
  })

  it('GET /plugins/search/:query (exact plugin name)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/search/homebridge-daikin-esp8266',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.json().find(x => x.name === 'homebridge-daikin-esp8266')).toBeTruthy()
    expect(res.json()[0]).toHaveProperty('lastUpdated')
    expect(res.json()[0]).toHaveProperty('private')
    expect(res.json()[0].private).toBe(false)
  })

  it('GET /plugins/search/:query (exact plugin name - @scoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: `/plugins/search/${encodeURIComponent('@mp-consulting/homebridge-philips-ambilight-tv')}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.json().find(x => x.name === '@mp-consulting/homebridge-philips-ambilight-tv')).toBeTruthy()
    expect(res.json()[0]).toHaveProperty('lastUpdated')
    expect(res.json()[0]).toHaveProperty('private')
    expect(res.json()[0].private).toBe(false)
  })

  it('GET /plugins/search/:query (blacklisted - exact plugin name)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/search/homebridge-config-ui-rdp',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().filter(x => x.name === 'homebridge-config-ui-rdp')).toHaveLength(0)
  })

  it('GET /plugins/search/:query (blacklisted - search query)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: `/plugins/search/${encodeURIComponent('ui')}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().filter(x => x.name === 'homebridge-config-ui-rdp')).toHaveLength(0)
  })

  it('GET /plugins/lookup/:pluginName (non-scoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/lookup/homebridge-daikin-esp8266',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('homebridge-daikin-esp8266')
    expect(res.json()).toHaveProperty('lastUpdated')
    expect(res.json()).toHaveProperty('private')
    expect(res.json().private).toBe(false)
  })

  it('GET /plugins/lookup/:pluginName (@scoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: `/plugins/lookup/${encodeURIComponent('@mp-consulting/homebridge-philips-ambilight-tv')}`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('@mp-consulting/homebridge-philips-ambilight-tv')
    expect(res.json()).toHaveProperty('lastUpdated')
    expect(res.json()).toHaveProperty('private')
    expect(res.json().private).toBe(false)
  })

  it('GET /plugins/lookup/:pluginName (not a homebridge plugin)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/lookup/npm',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Invalid plugin name.')
  })

  it('GET /plugins/lookup/:pluginName/versions (non-scoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/lookup/homebridge-daikin-esp8266/versions',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('tags')
    expect(res.json()).toHaveProperty('versions')
  })

  it('GET /plugins/lookup/:pluginName/versions (@scoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: `/plugins/lookup/${encodeURIComponent('@mp-consulting/homebridge-philips-ambilight-tv')}/versions`,
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('tags')
    expect(res.json()).toHaveProperty('versions')
  })

  it('GET /plugins/config-schema/:plugin-name', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/config-schema/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
    expect(res.json().pluginType).toBe('platform')
  })

  it('GET /plugins/config-schema/:plugin-name (i18n - French)', async () => {
    // Mock the language setting to French
    const originalLang = (installed as any).configService.ui.lang;
    (installed as any).configService.ui.lang = 'fr'

    const res = await app.inject({
      method: 'GET',
      path: '/plugins/config-schema/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
    expect(res.json().pluginType).toBe('platform')
    // Verify French translation is loaded
    expect(res.json().schema.properties.name.title).toBe('Nom')
    expect(res.json().schema.properties.name.default).toBe('Exemple de plateforme dynamique')

    // Restore original language
    ;(installed as any).configService.ui.lang = originalLang
  })

  it('GET /plugins/config-schema/:plugin-name (i18n - German)', async () => {
    // Mock the language setting to German
    const originalLang = (installed as any).configService.ui.lang;
    (installed as any).configService.ui.lang = 'de'

    const res = await app.inject({
      method: 'GET',
      path: '/plugins/config-schema/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
    expect(res.json().pluginType).toBe('platform')
    // Verify German translation is loaded
    expect(res.json().schema.properties.name.title).toBe('Name')
    expect(res.json().schema.properties.name.default).toBe('Beispiel Dynamische Plattform')

    // Restore original language
    ;(installed as any).configService.ui.lang = originalLang
  })

  it('GET /plugins/config-schema/:plugin-name (i18n - fallback to base for unsupported language)', async () => {
    // Mock the language setting to a language that doesn't have a translation
    const originalLang = (installed as any).configService.ui.lang;
    (installed as any).configService.ui.lang = 'es'

    const res = await app.inject({
      method: 'GET',
      path: '/plugins/config-schema/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
    expect(res.json().pluginType).toBe('platform')
    // Verify base English schema is loaded as fallback
    expect(res.json().schema.properties.name.title).toBe('Name')
    expect(res.json().schema.properties.name.default).toBe('Example Dynamic Platform')

    // Restore original language
    ;(installed as any).configService.ui.lang = originalLang
  })

  it('GET /plugins/config-schema/:plugin-name (i18n - English explicitly)', async () => {
    // Mock the language setting to English (should skip i18n directory)
    const originalLang = (installed as any).configService.ui.lang;
    (installed as any).configService.ui.lang = 'en'

    const res = await app.inject({
      method: 'GET',
      path: '/plugins/config-schema/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
    expect(res.json().pluginType).toBe('platform')
    // Verify base English schema is loaded (not from i18n directory)
    expect(res.json().schema.properties.name.title).toBe('Name')
    expect(res.json().schema.properties.name.default).toBe('Example Dynamic Platform')

    // Restore original language
    ;(installed as any).configService.ui.lang = originalLang
  })

  it('GET /plugins/config-schema/:plugin-name rejects a dynamicSchemaVersion that escapes storagePath', async () => {
    const { readJson, writeJson, remove } = await import('fs-extra')
    const { resolve: pathResolve } = await import('node:path')

    const baseSchemaPath = pathResolve(pluginsPath, 'homebridge-mock-plugin', 'config.schema.json')
    const baseSchema = await readJson(baseSchemaPath)
    // Traversal climbs from storagePath up into the parent test/ dir.
    const escapeVersion = '1.0/../../escape'
    const escapeTarget = pathResolve(process.env.UIX_STORAGE_PATH!, `.homebridge-mock-plugin-v${escapeVersion}.schema.json`)
    const maliciousSchema = {
      pluginAlias: 'EscapedPlugin',
      pluginType: 'platform',
      schema: { properties: { exfiltrated: { type: 'string', default: 'OWNED' } } },
    }

    try {
      await writeJson(baseSchemaPath, { ...baseSchema, dynamicSchemaVersion: escapeVersion })
      await writeJson(escapeTarget, maliciousSchema)
      // Reset the in-memory plugin cache so the new schema is picked up.
      ;(installed as any).installedPlugins = null

      const res = await app.inject({
        method: 'GET',
        path: '/plugins/config-schema/homebridge-mock-plugin',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      // Must return the original schema, NOT the one parked outside storagePath.
      expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
      expect(res.json().schema.properties.exfiltrated).toBeUndefined()
    } finally {
      await writeJson(baseSchemaPath, baseSchema)
      await remove(escapeTarget).catch(() => undefined)
      ;(installed as any).installedPlugins = null
    }
  })

  it('GET /plugins/changelog/:plugin-name', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/changelog/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('changelog')
  })

  it('GET /plugins/changelog/:plugin-name (changelog missing)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/changelog/homebridge-mock-plugin-two',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(404)
  })

  it('GET /plugins/alias/:plugin-name (with config.schema.json)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/alias/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('ExampleHomebridgePlugin')
    expect(res.json().pluginType).toBe('platform')
  })

  it('GET /plugins/alias/:plugin-name (without config.schema.json)', async () => {
    const res = await app.inject({
      method: 'GET',
      path: '/plugins/alias/homebridge-mock-plugin-two',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pluginAlias).toBe('HomebridgeMockPluginTwo')
    expect(res.json().pluginType).toBe('accessory')
  })

  describe('GET /plugins/:pluginName/editor-context', () => {
    it('returns alias, configSchema, config blocks and childBridges for a plugin with schema', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Living Room',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
              port: 45678,
              pin: '111-22-333',
            },
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Kitchen',
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([
        { plugin: 'homebridge-mock-plugin', username: '0E:AA:BB:CC:DD:EE' } as any,
        { plugin: 'homebridge-some-other-plugin', username: '0E:11:22:33:44:55' } as any,
      ])

      const res = await app.inject({
        method: 'GET',
        path: '/plugins/homebridge-mock-plugin/editor-context',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.pluginName).toBe('homebridge-mock-plugin')
      expect(body.alias.pluginAlias).toBe('ExampleHomebridgePlugin')
      expect(body.alias.pluginType).toBe('platform')
      expect(body.configSchema).toBeTruthy()
      expect(body.configSchema.pluginAlias).toBe('ExampleHomebridgePlugin')
      expect(Array.isArray(body.config)).toBe(true)
      expect(body.config).toHaveLength(2)
      expect(body.config.map((b: any) => b.name).sort()).toEqual(['Kitchen', 'Living Room'])
      // childBridges is scoped to the requested plugin only
      expect(body.childBridges).toHaveLength(1)
      expect(body.childBridges[0].plugin).toBe('homebridge-mock-plugin')
    })

    it('returns configSchema: null when the plugin ships without a config.schema.json', async () => {
      vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        path: '/plugins/homebridge-mock-plugin-two/editor-context',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.pluginName).toBe('homebridge-mock-plugin-two')
      expect(body.alias.pluginAlias).toBe('HomebridgeMockPluginTwo')
      expect(body.alias.pluginType).toBe('accessory')
      expect(body.configSchema).toBeNull()
      expect(Array.isArray(body.config)).toBe(true)
      expect(Array.isArray(body.childBridges)).toBe(true)
    })

    it('returns 401 without an authorization token', async () => {
      const res = await app.inject({
        method: 'GET',
        path: '/plugins/homebridge-mock-plugin/editor-context',
      })

      expect(res.statusCode).toBe(401)
    })
  })

  describe('GET /plugins?include=config', () => {
    it('attaches saved config blocks to each plugin when include=config is set', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        accessories: [
          {
            accessory: 'HomebridgeMockPluginTwo',
            name: 'Saved Accessory',
          },
        ],
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Saved Platform',
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const res = await app.inject({
        method: 'GET',
        path: '/plugins?include=config',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const plugins: HomebridgePlugin[] = res.json()
      const mockOne = plugins.find(p => p.name === 'homebridge-mock-plugin')
      const mockTwo = plugins.find(p => p.name === 'homebridge-mock-plugin-two')
      expect(mockOne).toBeTruthy()
      expect(mockTwo).toBeTruthy()
      expect(mockOne!.config).toEqual([{ platform: 'ExampleHomebridgePlugin', name: 'Saved Platform' }])
      expect(mockTwo!.config).toEqual([{ accessory: 'HomebridgeMockPluginTwo', name: 'Saved Accessory' }])
    })

    it('attaches an empty config array when the plugin has no saved blocks', async () => {
      // config.json mock has no blocks for homebridge-mock-plugin or -two
      await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

      const res = await app.inject({
        method: 'GET',
        path: '/plugins?include=config',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const plugins: HomebridgePlugin[] = res.json()
      for (const plugin of plugins) {
        expect(Array.isArray(plugin.config)).toBe(true)
      }
    })

    it('default GET /plugins still omits the config field', async () => {
      const res = await app.inject({
        method: 'GET',
        path: '/plugins',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const plugins: HomebridgePlugin[] = res.json()
      for (const plugin of plugins) {
        expect(plugin).not.toHaveProperty('config')
      }
    })

    it('ignores unknown include values without erroring', async () => {
      const res = await app.inject({
        method: 'GET',
        path: '/plugins?include=bogus',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)
      const plugins: HomebridgePlugin[] = res.json()
      for (const plugin of plugins) {
        expect(plugin).not.toHaveProperty('config')
      }
    })
  })

  it('POST /plugins/update/:pluginName (plugin with specific version)', async () => {
    const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
    const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)
    const performUpdateSpy = vi.spyOn(uiUpdate, 'performPackageUpdate')

    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/homebridge-mock-plugin?version=1.0.1',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().name).toBe('homebridge-mock-plugin')
    expect(res.json().version).toBe('1.0.1')

    // The update itself runs after the response, from a setImmediate
    expect(await settledUpdate(performUpdateSpy)).toEqual({
      ok: true,
      name: 'homebridge-mock-plugin',
      version: '1.0.1',
      restart: { homebridge: true, ui: false, childBridgeUsernames: [] },
    })
    expect(managePluginSpy).toHaveBeenCalledExactlyOnceWith('install', { name: 'homebridge-mock-plugin', version: '1.0.1' }, expect.any(EventEmitter))
    expect(restartHomebridgeSpy).toHaveBeenCalledOnce()

    managePluginSpy.mockRestore()
    restartHomebridgeSpy.mockRestore()
    performUpdateSpy.mockRestore()
  })

  it('POST /plugins/update/:pluginName (plugin without version - latest)', async () => {
    const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
    const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)
    const performUpdateSpy = vi.spyOn(uiUpdate, 'performPackageUpdate')

    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/homebridge-mock-plugin',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().name).toBe('homebridge-mock-plugin')
    expect(res.json()).toHaveProperty('version')
    // Latest version should be resolved from package

    // The background update installs exactly the version the response announced
    const { version } = res.json()
    expect(await settledUpdate(performUpdateSpy)).toMatchObject({ ok: true, name: 'homebridge-mock-plugin', version })
    expect(managePluginSpy).toHaveBeenCalledExactlyOnceWith('install', { name: 'homebridge-mock-plugin', version }, expect.any(EventEmitter))

    managePluginSpy.mockRestore()
    restartHomebridgeSpy.mockRestore()
    performUpdateSpy.mockRestore()
  })

  it('POST /plugins/update/:pluginName (homebridge)', async () => {
    const updateHomebridgeSpy = vi.spyOn(uiUpdate as any, 'updateHomebridgePackage').mockResolvedValue(true)
    const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)
    const performUpdateSpy = vi.spyOn(uiUpdate, 'performPackageUpdate')

    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/homebridge',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().name).toBe('homebridge')
    expect(res.json()).toHaveProperty('version')

    const { version } = res.json()
    expect(await settledUpdate(performUpdateSpy)).toEqual({
      ok: true,
      name: 'homebridge',
      version,
      restart: { homebridge: true, ui: false, childBridgeUsernames: [] },
    })
    expect(updateHomebridgeSpy).toHaveBeenCalledExactlyOnceWith({ version }, expect.any(EventEmitter))
    expect(restartHomebridgeSpy).toHaveBeenCalledOnce()

    updateHomebridgeSpy.mockRestore()
    restartHomebridgeSpy.mockRestore()
    performUpdateSpy.mockRestore()
  })

  it('POST /plugins/update/:pluginName (@mp-consulting/homebridge-config-glass-ui)', async () => {
    const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const performUpdateSpy = vi.spyOn(uiUpdate, 'performPackageUpdate')

    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/%40mp-consulting%2Fhomebridge-config-glass-ui?version=5.8.0',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().ok).toBe(true)
    expect(res.json().name).toBe('@mp-consulting/homebridge-config-glass-ui')
    expect(res.json().version).toBe('5.8.0')

    expect(await settledUpdate(performUpdateSpy)).toEqual({
      ok: true,
      name: '@mp-consulting/homebridge-config-glass-ui',
      version: '5.8.0',
      restart: { homebridge: false, ui: true, childBridgeUsernames: [] },
    })
    expect(managePluginSpy).toHaveBeenCalledExactlyOnceWith('install', { name: '@mp-consulting/homebridge-config-glass-ui', version: '5.8.0' }, expect.any(EventEmitter))
    expect(exitSpy).not.toHaveBeenCalled()

    // ⚠️ Kill the fuse before releasing the stub - see the note on the other
    // update test. The restart is on a 5000ms timer: restoring process.exit
    // here left a live timer that fired during a later test and killed the worker.
    uiUpdate.onModuleDestroy()
    managePluginSpy.mockRestore()
    exitSpy.mockRestore()
    performUpdateSpy.mockRestore()
  })

  it('POST /plugins/update/:pluginName (not installed)', async () => {
    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/homebridge-not-installed',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toHaveProperty('message')
  })

  it('POST /plugins/update/:pluginName (invalid plugin name)', async () => {
    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/invalid-plugin-name',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('message')
  })

  it('POST /plugins/update/:pluginName (@scoped plugin)', async () => {
    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/@mp-consulting/homebridge-philips-ambilight-tv?version=1.0.0',
      headers: {
        authorization,
      },
    })

    // This should return 404 because the plugin is not installed in the test environment
    // But it validates that scoped packages are handled correctly
    expect([404, 201]).toContain(res.statusCode)
  })

  it('POST /plugins/update/:pluginName (requires authentication)', async () => {
    const res = await app.inject({
      method: 'POST',
      path: '/plugins/update/homebridge-mock-plugin?version=1.0.1',
    })

    expect(res.statusCode).toBe(401)
  })

  describe('getPluginChildBridgeUsernames', () => {
    it('should return empty array for plugin not in child bridge', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test',
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const result = await pluginsService.getPluginChildBridgeUsernames('homebridge-mock-plugin')

      expect(result).toEqual([])
    })

    it('should return username for plugin in a single child bridge', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
              port: 45678,
              pin: '111-22-333',
            },
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const result = await pluginsService.getPluginChildBridgeUsernames('homebridge-mock-plugin')

      expect(result).toHaveLength(1)
      expect(result[0]).toBe('0E:AA:BB:CC:DD:EE')
    })

    it('should return multiple usernames for plugin in multiple child bridges', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test 1',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
              port: 45678,
              pin: '111-22-333',
            },
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test 2',
            _bridge: {
              username: '0E:FF:FF:FF:FF:FF',
              port: 45679,
              pin: '222-33-444',
            },
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const result = await pluginsService.getPluginChildBridgeUsernames('homebridge-mock-plugin')

      expect(result).toHaveLength(2)
      expect(result).toContain('0E:AA:BB:CC:DD:EE')
      expect(result).toContain('0E:FF:FF:FF:FF:FF')
    })

    it('should return single username when multiple blocks share same child bridge', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        accessories: [
          {
            accessory: 'HomebridgeMockPluginTwo',
            name: 'Test 1',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
            },
          },
          {
            accessory: 'HomebridgeMockPluginTwo',
            name: 'Test 2',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
            },
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const result = await pluginsService.getPluginChildBridgeUsernames('homebridge-mock-plugin-two')

      expect(result).toEqual(['0E:AA:BB:CC:DD:EE'])
    })

    it('should handle mixed config blocks (some with _bridge, some without)', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'In Child Bridge',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
              port: 45678,
              pin: '111-22-333',
            },
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'In Main Bridge',
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const result = await pluginsService.getPluginChildBridgeUsernames('homebridge-mock-plugin')

      // Should only return child bridge username, not count the main bridge config
      expect(result).toEqual(['0E:AA:BB:CC:DD:EE'])
    })
  })

  describe('POST /plugins/update/:pluginName (restart behavior)', () => {
    beforeEach(async () => {
      // Reset the config to a known state before each test
      await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    })

    it('should restart child bridge when plugin is in child bridge', async () => {
      // Setup config with plugin in child bridge
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
              port: 45678,
              pin: '111-22-333',
            },
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      // Mock the update and restart methods BEFORE making the request
      const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
      const getPluginAliasSpy = vi.spyOn(metadata, 'getPluginAlias').mockResolvedValue({
        pluginAlias: 'ExampleHomebridgePlugin',
        pluginType: 'platform',
      })
      const restartChildBridgeSpy = vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true })
      const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)

      const res = await app.inject({
        method: 'POST',
        path: '/plugins/update/homebridge-mock-plugin?version=1.0.0',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().ok).toBe(true)

      // The update runs after the response (setImmediate + file operations)
      await vi.waitFor(() => expect(restartChildBridgeSpy).toHaveBeenCalledExactlyOnceWith('0E:AA:BB:CC:DD:EE'))

      // Verify child bridge restart was called, not main homebridge restart
      expect(restartHomebridgeSpy).not.toHaveBeenCalled()

      managePluginSpy.mockRestore()
      getPluginAliasSpy.mockRestore()
      restartChildBridgeSpy.mockRestore()
      restartHomebridgeSpy.mockRestore()
    })

    it('should restart multiple child bridges when plugin is in multiple child bridges', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test 1',
            _bridge: {
              username: '0E:AA:BB:CC:DD:EE',
              port: 45678,
              pin: '111-22-333',
            },
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test 2',
            _bridge: {
              username: '0E:FF:FF:FF:FF:FF',
              port: 45679,
              pin: '222-33-444',
            },
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
      const getPluginAliasSpy = vi.spyOn(metadata, 'getPluginAlias').mockResolvedValue({
        pluginAlias: 'ExampleHomebridgePlugin',
        pluginType: 'platform',
      })
      const restartChildBridgeSpy = vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true })
      const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)

      const res = await app.inject({
        method: 'POST',
        path: '/plugins/update/homebridge-mock-plugin?version=1.0.0',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(201)

      // Both child bridges should be restarted
      await vi.waitFor(() => expect(restartChildBridgeSpy).toHaveBeenCalledTimes(2))
      expect(restartChildBridgeSpy).toHaveBeenCalledWith('0E:AA:BB:CC:DD:EE')
      expect(restartChildBridgeSpy).toHaveBeenCalledWith('0E:FF:FF:FF:FF:FF')
      expect(restartHomebridgeSpy).not.toHaveBeenCalled()

      managePluginSpy.mockRestore()
      getPluginAliasSpy.mockRestore()
      restartChildBridgeSpy.mockRestore()
      restartHomebridgeSpy.mockRestore()
    })

    it('should restart homebridge when plugin is not in child bridge', async () => {
      const config = {
        bridge: {
          name: 'Homebridge',
          username: '0E:1A:2B:3C:4D:5E',
          port: 51826,
          pin: '123-45-678',
        },
        platforms: [
          {
            platform: 'config',
            name: 'Config',
          },
          {
            platform: 'ExampleHomebridgePlugin',
            name: 'Test',
            // No _bridge property - running in main bridge
          },
        ],
      }
      await writeFile(process.env.UIX_CONFIG_PATH, JSON.stringify(config, null, 2))

      const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
      const restartChildBridgeSpy = vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true })
      const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)

      const res = await app.inject({
        method: 'POST',
        path: '/plugins/update/homebridge-mock-plugin?version=1.0.0',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(201)

      // Main homebridge should be restarted, not child bridges
      await vi.waitFor(() => expect(restartHomebridgeSpy).toHaveBeenCalledOnce())
      expect(restartChildBridgeSpy).not.toHaveBeenCalled()

      managePluginSpy.mockRestore()
      restartChildBridgeSpy.mockRestore()
      restartHomebridgeSpy.mockRestore()
    })

    it('should restart homebridge when updating homebridge itself', async () => {
      const updateHomebridgeSpy = vi.spyOn(uiUpdate as any, 'updateHomebridgePackage').mockResolvedValue(true)
      const restartChildBridgeSpy = vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true })
      const restartHomebridgeSpy = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockReturnValue(true)

      const res = await app.inject({
        method: 'POST',
        path: '/plugins/update/homebridge?version=1.8.0',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(201)

      // Homebridge quick restart should be called
      await vi.waitFor(() => expect(restartHomebridgeSpy).toHaveBeenCalledOnce())
      expect(updateHomebridgeSpy).toHaveBeenCalledExactlyOnceWith({ version: '1.8.0' }, expect.any(EventEmitter))
      expect(restartChildBridgeSpy).not.toHaveBeenCalled()

      updateHomebridgeSpy.mockRestore()
      restartChildBridgeSpy.mockRestore()
      restartHomebridgeSpy.mockRestore()
    })

    it('should schedule full restart when updating @mp-consulting/homebridge-config-glass-ui', async () => {
      const managePluginSpy = vi.spyOn(installer as any, 'managePlugin').mockResolvedValue(true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      // Only the timer pair is faked: the update itself runs from a setImmediate
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      try {
        const res = await app.inject({
          method: 'POST',
          path: '/plugins/update/%40mp-consulting%2Fhomebridge-config-glass-ui?version=5.8.0',
          headers: {
            authorization,
          },
        })

        expect(res.statusCode).toBe(201)

        // The restart is armed once the background update has finished...
        // (polled on setImmediate: vi.waitFor would advance the fake clock)
        for (let i = 0; i < 1000 && !uiUpdate.uiRestartPending; i++) {
          await new Promise(resolve => setImmediate(resolve))
        }
        expect(uiUpdate.uiRestartPending).toBe(true)
        expect(exitSpy).not.toHaveBeenCalled()

        // ...and actually happens 5 seconds later (UiUpdateService.UI_RESTART_DELAY_MS)
        await vi.advanceTimersByTimeAsync(4999)
        expect(exitSpy).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(exitSpy).toHaveBeenCalledExactlyOnceWith(0)
      } finally {
        // ⚠️ Kill the fuse before releasing the stub, so no live timer can
        // call the real process.exit during a later test.
        uiUpdate.onModuleDestroy()
        vi.useRealTimers()
        managePluginSpy.mockRestore()
        exitSpy.mockRestore()
      }
    })
  })

  describe('module discovery with broken directories', () => {
    it('should skip modules without a package.json', async () => {
      // Create a broken module directory (no package.json) alongside valid plugins
      const brokenModulePath = join(pluginsPath, 'homebridge-broken-plugin')
      await mkdir(brokenModulePath, { recursive: true })
      // Only add a node_modules subfolder, no package.json — simulates a partial install
      await mkdir(join(brokenModulePath, 'node_modules'), { recursive: true })

      // Clear the installed plugins cache so discovery runs fresh
      pluginsService.clearInstalledPluginsCache()

      const res = await app.inject({
        method: 'GET',
        path: '/plugins',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)

      const plugins: HomebridgePlugin[] = res.json()
      // The broken module should not appear in results
      expect(plugins.find(x => x.name === 'homebridge-broken-plugin')).toBeUndefined()
      // Valid plugins should still be found
      expect(plugins.find(x => x.name === 'homebridge-mock-plugin')).toBeTruthy()

      // Cleanup
      await remove(brokenModulePath)
    })

    it('should skip scoped modules without a package.json', async () => {
      // Create a broken scoped module directory
      const scopePath = join(pluginsPath, '@test-scope')
      const brokenScopedModulePath = join(scopePath, 'homebridge-broken-scoped')
      await mkdir(brokenScopedModulePath, { recursive: true })
      // No package.json inside

      // Clear the installed plugins cache so discovery runs fresh
      pluginsService.clearInstalledPluginsCache()

      const res = await app.inject({
        method: 'GET',
        path: '/plugins',
        headers: {
          authorization,
        },
      })

      expect(res.statusCode).toBe(200)

      const plugins: HomebridgePlugin[] = res.json()
      // The broken scoped module should not appear in results
      expect(plugins.find(x => x.name === '@test-scope/homebridge-broken-scoped')).toBeUndefined()
      // Valid plugins should still be found
      expect(plugins.find(x => x.name === 'homebridge-mock-plugin')).toBeTruthy()

      // Cleanup
      await remove(scopePath)
    })
  })

  describe('cleanNpmCache', () => {
    it('invokes spawn in argv form so shell metacharacters in the npm path are not interpreted', async () => {
      const fakeChild = new EventEmitter()
      const spawnMock = vi.mocked(childProcess.spawn)
      spawnMock.mockClear()
      spawnMock.mockImplementationOnce(() => {
        setImmediate(() => fakeChild.emit('exit', 0))
        return fakeChild as any
      })

      await (installer as any).cleanNpmCache()

      expect(spawnMock).toHaveBeenCalledOnce()
      const call = spawnMock.mock.calls[0]
      expect(typeof call[0]).toBe('string')
      expect(Array.isArray(call[1])).toBe(true)
      expect((call[2] as any)?.shell).not.toBe(true)
    })
  })

  describe('npm cache clean as a retry path', () => {
    let cleanSpy: any
    let npmSpy: any
    const action = { name: 'homebridge-mock-plugin', version: '1.0.0' }

    beforeEach(() => {
      ;(installed as any).installedPlugins = [
        { name: '@mp-consulting/homebridge-config-glass-ui', installPath: pluginsPath, globalInstall: false },
      ]
      vi.spyOn(installed as any, 'getInstalledPlugins').mockResolvedValue([])
      vi.spyOn(installer as any, 'applyAllowScripts').mockResolvedValue(undefined)
      vi.spyOn(installer, 'isPluginBundleAvailable').mockResolvedValue(false)
      cleanSpy = vi.spyOn(installer as any, 'cleanNpmCache').mockResolvedValue(undefined)
      npmSpy = vi.spyOn(installer as any, 'runNpmCommand')
    })

    it('does not clean the cache before an install or uninstall that succeeds', async () => {
      npmSpy.mockResolvedValue(undefined)

      await (installer as any).doManagePlugin('install', { ...action }, new EventEmitter())
      await (installer as any).doManagePlugin('uninstall', { ...action }, new EventEmitter())

      expect(npmSpy).toHaveBeenCalledTimes(2)
      expect(cleanSpy).not.toHaveBeenCalled()
    })

    it('cleans the cache and retries once when npm failed on a corrupt cache', async () => {
      npmSpy
        .mockRejectedValueOnce(Object.assign(new Error('Operation failed with code 1.'), { npmOutput: 'npm error code EINTEGRITY\r\nnpm error sha512-abc integrity checksum failed' }))
        .mockResolvedValueOnce(undefined)
      const client = new EventEmitter()
      const stdout = vi.fn()
      client.on('stdout', stdout)

      await (installer as any).doManagePlugin('install', { ...action }, client)

      expect(cleanSpy).toHaveBeenCalledTimes(1)
      expect(npmSpy).toHaveBeenCalledTimes(2)
      expect(npmSpy.mock.calls[1][0]).toEqual(npmSpy.mock.calls[0][0])
      expect(cleanSpy.mock.invocationCallOrder[0]).toBeLessThan(npmSpy.mock.invocationCallOrder[1])
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('npm cache looks corrupt'))
    })

    it('retries only once', async () => {
      const cacheFailure = () => Object.assign(new Error('Operation failed with code 1.'), { npmOutput: 'npm error code ENOTCACHED' })
      npmSpy.mockRejectedValueOnce(cacheFailure()).mockRejectedValueOnce(cacheFailure())

      await expect((installer as any).doManagePlugin('install', { ...action }, new EventEmitter())).rejects.toThrow('Operation failed')

      expect(npmSpy).toHaveBeenCalledTimes(2)
      expect(cleanSpy).toHaveBeenCalledTimes(1)
    })

    it('does not retry a failure that has nothing to do with the cache', async () => {
      npmSpy.mockRejectedValueOnce(Object.assign(new Error('Operation failed with code 1.'), { npmOutput: 'npm error code E404\r\nnpm error 404 Not Found' }))

      await expect((installer as any).doManagePlugin('install', { ...action }, new EventEmitter())).rejects.toThrow('Operation failed')

      expect(npmSpy).toHaveBeenCalledTimes(1)
      expect(cleanSpy).not.toHaveBeenCalled()
    })

    it('keeps the tail of the npm output on a failed command', async () => {
      npmSpy.mockRestore()
      ;(installed as any).npmGlobalRootPromise = Promise.resolve(pluginsPath)
      vi.spyOn((installer as any).nodePtyService, 'spawn').mockImplementation(() => {
        let onData: (data: string) => void
        return {
          onData: (cb: (data: string) => void) => {
            onData = cb
          },
          onExit: (cb: (e: { exitCode: number }) => void) => setImmediate(() => {
            onData('x'.repeat(20_000))
            onData('npm error code EINTEGRITY')
            cb({ exitCode: 1 })
          }),
          kill: vi.fn(),
        }
      })

      const error = await (installer as any).runNpmCommand(['npm', 'install', 'homebridge-mock-plugin@1.0.0'], pluginsPath, new EventEmitter()).catch((e: any) => e)

      expect(error.npmOutput.length).toBeLessThanOrEqual(16 * 1024)
      expect(PluginInstallerService.isNpmCacheError(error.npmOutput)).toBe(true)
      ;(installed as any).npmGlobalRootPromise = null
    })

    it.each([
      ['npm ERR! code EINTEGRITY', true],
      ['npm error code ECOMPROMISED', true],
      ['ENOENT: no such file or directory, open \'/root/.npm/_cacache/index-v5/ab/cd\'', true],
      ['npm error code E404', false],
      ['npm error code EACCES /usr/lib/node_modules', false],
      [undefined, false],
    ])('classifies %s as a cache error: %s', (output, expected) => {
      expect(PluginInstallerService.isNpmCacheError(output)).toBe(expected)
    })
  })

  describe('supportsMatter', () => {
    const call = (keywords?: string[]) => (registry as any).supportsMatter(keywords) as boolean

    it('is true when the plugin declares the supports-matter keyword', () => {
      expect(call(['homebridge-plugin', 'supports-matter'])).toBe(true)
    })

    it('is false when the keyword is absent', () => {
      expect(call(['homebridge-plugin', 'matter'])).toBe(false)
    })

    it('is false when there are no keywords at all', () => {
      expect(call([])).toBe(false)
      expect(call(undefined)).toBe(false)
    })

    it('ignores keyword casing', () => {
      expect(call(['supports-matter'])).toBe(true)
    })

    it('does not match a keyword that merely contains the term', () => {
      expect(call(['not-supports-matter-really'])).toBe(false)
    })
  })

  describe('supportsHap', () => {
    const call = (keywords?: string[]) => (registry as any).supportsHap(keywords) as boolean

    it('is true when the plugin declares the supports-hap keyword', () => {
      expect(call(['homebridge-plugin', 'supports-hap'])).toBe(true)
    })

    it('is false when the keyword is absent', () => {
      expect(call(['homebridge-plugin', 'hap'])).toBe(false)
    })

    it('is false when there are no keywords at all', () => {
      expect(call([])).toBe(false)
      expect(call(undefined)).toBe(false)
    })

    it('ignores keyword casing', () => {
      expect(call(['Supports-HAP'])).toBe(true)
    })

    it('does not match a keyword that merely contains the term', () => {
      expect(call(['not-supports-hap-really'])).toBe(false)
    })

    // The convention (#3975): declaring either transport keyword makes the
    // declaration complete, so supports-matter without supports-hap marks a
    // matter-only plugin. Neither keyword = legacy = treated as HAP.
    it('marks a plugin as matter-only when it declares supports-matter without supports-hap', () => {
      const matterOnly = (keywords: string[]) =>
        (registry as any).supportsMatter(keywords) && !(registry as any).supportsHap(keywords)
      expect(matterOnly(['homebridge-plugin', 'supports-matter'])).toBe(true)
      expect(matterOnly(['homebridge-plugin', 'supports-matter', 'supports-hap'])).toBe(false)
      expect(matterOnly(['homebridge-plugin'])).toBe(false)
    })
  })

  describe('checkForBetaUpdates', () => {
    // Model the caller: it sets latestVersion/updateAvailable from the stable
    // release before delegating to the beta check.
    const check = async (opts: {
      installed: string
      stable: string
      betaTag?: string
      preferBetas: boolean
    }) => {
      const plugin: any = {
        name: 'homebridge-mock-plugin',
        installedVersion: opts.installed,
        latestVersion: opts.stable,
        updateAvailable: semverGt(opts.stable, opts.installed),
        updateTag: null,
      }

      const versionsSpy = vi.spyOn(registry, 'getAvailablePluginVersions').mockResolvedValue({
        tags: opts.betaTag ? { latest: opts.stable, beta: opts.betaTag } : { latest: opts.stable },
        versions: {},
      } as any)

      try {
        await (registry as any).checkForBetaUpdates(plugin, plugin.name, opts.preferBetas)
      } finally {
        versionsSpy.mockRestore()
      }

      return plugin
    }

    it('offers a newer beta even when a stable update is also available', async () => {
      // Regression: the beta preference used to be skipped entirely whenever a
      // stable update existed, so beta users were offered the stable version.
      const plugin = await check({
        installed: '11.29.0',
        stable: '11.29.3',
        betaTag: '11.30.0-beta.2',
        preferBetas: true,
      })

      expect(plugin.latestVersion).toBe('11.30.0-beta.2')
      expect(plugin.updateAvailable).toBe(true)
      expect(plugin.updateTag).toBe('beta')
    })

    it('keeps the stable when it has overtaken the beta line', async () => {
      // A prerelease sorts below its own release, so a beta user should not be
      // sent backwards from 11.30.0 to 11.30.0-beta.2.
      const plugin = await check({
        installed: '11.30.0-beta.1',
        stable: '11.30.0',
        betaTag: '11.30.0-beta.2',
        preferBetas: true,
      })

      expect(plugin.latestVersion).toBe('11.30.0')
      expect(plugin.updateTag).toBeNull()
    })

    it('offers a beta to a user on the current stable', async () => {
      const plugin = await check({
        installed: '11.29.3',
        stable: '11.29.3',
        betaTag: '11.30.0-beta.2',
        preferBetas: true,
      })

      expect(plugin.latestVersion).toBe('11.30.0-beta.2')
      expect(plugin.updateTag).toBe('beta')
    })

    it('does not offer betas when the preference is off', async () => {
      const plugin = await check({
        installed: '11.29.0',
        stable: '11.29.3',
        betaTag: '11.30.0-beta.2',
        preferBetas: false,
      })

      expect(plugin.latestVersion).toBe('11.29.3')
      expect(plugin.updateTag).toBeNull()
    })

    it('reports no update when already on the newest beta', async () => {
      const plugin = await check({
        installed: '11.30.0-beta.2',
        stable: '11.29.3',
        betaTag: '11.30.0-beta.2',
        preferBetas: true,
      })

      expect(plugin.updateAvailable).toBe(false)
    })

    it('keeps the stable when the requested tag does not exist (#2982)', async () => {
      // Most packages publish no beta tag, so the candidate is undefined. Only
      // beatsInstalled guarded it, leaving beatsStable to call gt(undefined) as
      // soon as a stable update existed, which aborted the whole npm lookup.
      const plugin = await check({
        installed: '11.29.0',
        stable: '11.29.3',
        preferBetas: true,
      })

      expect(plugin.latestVersion).toBe('11.29.3')
      expect(plugin.updateAvailable).toBe(true)
      expect(plugin.updateTag).toBeNull()
    })

    it('reports no update when the requested tag does not exist', async () => {
      const plugin = await check({
        installed: '11.29.3',
        stable: '11.29.3',
        preferBetas: true,
      })

      expect(plugin.latestVersion).toBe('11.29.3')
      expect(plugin.updateAvailable).toBe(false)
      expect(plugin.updateTag).toBeNull()
    })
  })

  describe('getAllowedInstallScripts (#2909)', () => {
    const call = (name: string, version: string) =>
      (installer as any).getAllowedInstallScripts(name, version) as Promise<{ allowed: string[], withScripts: string[] }>

    beforeEach(() => {
      // Prime the cached npm major version so the tests never shell out.
      ;(installer as any).npmMajorVersion = 12
    })

    it('returns empty lists on npm older than 12 without hitting the registry', async () => {
      ;(installer as any).npmMajorVersion = 10
      const getSpy = vi.spyOn(httpService, 'get')

      await expect(call('homebridge-mock-plugin', '1.0.0')).resolves.toEqual({ allowed: [], withScripts: [] })
      expect(getSpy).not.toHaveBeenCalled()
      getSpy.mockRestore()
    })

    it('allows the plugin itself plus map-form allowScripts entries, keys verbatim', async () => {
      const getSpy = vi.spyOn(httpService, 'get').mockReturnValue(of({
        data: {
          versions: {
            '1.0.0': {
              allowScripts: {
                '@stoprocent/noble@2.3.4': true,
                'ffmpeg-for-homebridge': true,
                'blocked-package': false,
              },
            },
          },
        },
      }) as any)

      // The plugin itself has no install script, so it is allowed but is not
      // expected to run anything.
      await expect(call('homebridge-mock-plugin', '1.0.0')).resolves.toEqual({
        allowed: [
          'homebridge-mock-plugin',
          '@stoprocent/noble@2.3.4',
          'ffmpeg-for-homebridge',
        ],
        withScripts: [
          '@stoprocent/noble@2.3.4',
          'ffmpeg-for-homebridge',
        ],
      })
      getSpy.mockRestore()
    })

    it('reports the plugin itself as script-running when its manifest has an install script', async () => {
      const getSpy = vi.spyOn(httpService, 'get').mockReturnValue(of({
        data: {
          versions: {
            '1.0.0': { scripts: { postinstall: 'node scripts/setup.js' } },
          },
        },
      }) as any)

      await expect(call('homebridge-mock-plugin', '1.0.0')).resolves.toEqual({
        allowed: ['homebridge-mock-plugin'],
        withScripts: ['homebridge-mock-plugin@1.0.0'],
      })
      getSpy.mockRestore()
    })

    it('honours the registry hasInstallScript flag when scripts are stripped', async () => {
      const getSpy = vi.spyOn(httpService, 'get').mockReturnValue(of({
        data: {
          versions: {
            '1.0.0': { hasInstallScript: true },
          },
        },
      }) as any)

      await expect(call('homebridge-mock-plugin', '1.0.0')).resolves.toEqual({
        allowed: ['homebridge-mock-plugin'],
        withScripts: ['homebridge-mock-plugin@1.0.0'],
      })
      getSpy.mockRestore()
    })

    it('allows array-form allowScripts entries', async () => {
      const getSpy = vi.spyOn(httpService, 'get').mockReturnValue(of({
        data: {
          versions: {
            '2.0.0': { allowScripts: ['ffmpeg-for-homebridge'] },
          },
        },
      }) as any)

      await expect(call('homebridge-mock-plugin', '2.0.0')).resolves.toEqual({
        allowed: ['homebridge-mock-plugin', 'ffmpeg-for-homebridge'],
        withScripts: ['ffmpeg-for-homebridge'],
      })
      getSpy.mockRestore()
    })

    it('still allows the plugin itself when it declares no allowScripts', async () => {
      const getSpy = vi.spyOn(httpService, 'get').mockReturnValue(of({
        data: { versions: { '1.0.0': {} } },
      }) as any)

      await expect(call('homebridge-mock-plugin', '1.0.0')).resolves.toEqual({
        allowed: ['homebridge-mock-plugin'],
        withScripts: [],
      })
      getSpy.mockRestore()
    })

    it('still allows the plugin itself when the registry lookup fails', async () => {
      const getSpy = vi.spyOn(httpService, 'get').mockImplementation(() => {
        throw new Error('registry unreachable')
      })

      await expect(call('homebridge-mock-plugin', '1.0.0')).resolves.toEqual({
        allowed: ['homebridge-mock-plugin'],
        withScripts: [],
      })
      getSpy.mockRestore()
    })
  })

  describe('getHomebridgeUiPackage - which install sets the version', () => {
    let shadowPath: string
    let runningPath: string

    beforeEach(async () => {
      runningPath = resolve(process.env.UIX_BASE_PATH)
      shadowPath = resolve(process.env.UIX_STORAGE_PATH, 'fake-ui', 'node_modules', '@mp-consulting/homebridge-config-glass-ui')
      await mkdir(shadowPath, { recursive: true })
      await writeFile(join(shadowPath, 'package.json'), JSON.stringify({
        name: '@mp-consulting/homebridge-config-glass-ui',
        version: '0.0.1-shadow',
      }))

      // customPluginPath is searched first by getBasePaths(), so a copy of the UI in
      // the plugin directory is returned before the one actually running
      vi.spyOn(installed as any, 'getInstalledModules').mockResolvedValue([
        { name: '@mp-consulting/homebridge-config-glass-ui', path: resolve(shadowPath, '..'), installPath: shadowPath },
        { name: '@mp-consulting/homebridge-config-glass-ui', path: resolve(runningPath, '..'), installPath: runningPath },
      ])
      // keep the npm lookup out of it - this is only about which package.json is read
      vi.spyOn(registry as any, 'getPluginFromNpm').mockImplementation(async (pkg: any) => {
        pkg.latestVersion = null
        return pkg
      })

      // the duplicate warning fires once per process, so clear it between tests
      ;(installed as any).warnedDuplicateUiInstall = false
    })

    // Regression: a second copy of the UI in the plugin directory shadowed the real
    // installation, so the UI reported that copy's version as its own. On a beta that
    // meant being offered an "update" to the version already running - and npm puts the
    // copy back on every plugin update, so it kept coming back.
    it('reports the version of the install that is actually running', async () => {
      const running = await readJson(join(runningPath, 'package.json'))

      const uiPackage = await pluginsService.getHomebridgeUiPackage()

      expect(uiPackage.installedVersion).toBe(running.version)
      expect(uiPackage.installedVersion).not.toBe('0.0.1-shadow')
    })

    it('still works when only one installation is found', async () => {
      vi.spyOn(installed as any, 'getInstalledModules').mockResolvedValue([
        { name: '@mp-consulting/homebridge-config-glass-ui', path: resolve(shadowPath, '..'), installPath: shadowPath },
      ])

      const uiPackage = await pluginsService.getHomebridgeUiPackage()

      expect(uiPackage.installedVersion).toBe('0.0.1-shadow')
    })

    it('falls back to the first match when none of them is the running install', async () => {
      const otherPath = resolve(process.env.UIX_STORAGE_PATH, 'fake-ui-2', 'node_modules', '@mp-consulting/homebridge-config-glass-ui')
      await mkdir(otherPath, { recursive: true })
      await writeFile(join(otherPath, 'package.json'), JSON.stringify({
        name: '@mp-consulting/homebridge-config-glass-ui',
        version: '0.0.2-other',
      }))
      vi.spyOn(installed as any, 'getInstalledModules').mockResolvedValue([
        { name: '@mp-consulting/homebridge-config-glass-ui', path: resolve(shadowPath, '..'), installPath: shadowPath },
        { name: '@mp-consulting/homebridge-config-glass-ui', path: resolve(otherPath, '..'), installPath: otherPath },
      ])

      // no throw, and a deterministic answer rather than whichever the scan happened to hit
      const uiPackage = await pluginsService.getHomebridgeUiPackage()

      expect(uiPackage.installedVersion).toBe('0.0.1-shadow')
    })

    // UIX_BASE_PATH can be set by the user through UIX_BASE_PATH_OVERRIDE, so it will not
    // always be normalised the way resolve() leaves it. Comparing raw strings would miss
    // the running install and quietly fall back to the shadow copy.
    it('matches the running install despite a trailing separator on UIX_BASE_PATH', async () => {
      const original = process.env.UIX_BASE_PATH
      process.env.UIX_BASE_PATH = `${original}${sep}`

      try {
        const running = await readJson(join(runningPath, 'package.json'))
        const uiPackage = await pluginsService.getHomebridgeUiPackage()

        expect(uiPackage.installedVersion).toBe(running.version)
      } finally {
        process.env.UIX_BASE_PATH = original
      }
    })

    describe('the duplicate-install warning', () => {
      let warnSpy: any

      beforeEach(() => {
        warnSpy = vi.spyOn((installed as any).logger, 'warn').mockImplementation(() => {})
      })

      it('names both installations so the stale one can be removed', async () => {
        await pluginsService.getHomebridgeUiPackage()

        expect(warnSpy).toHaveBeenCalledTimes(1)
        const message = warnSpy.mock.calls[0][0]
        expect(message).toContain(shadowPath)
        expect(message).toContain(runningPath)
      })

      // npm reinstates the duplicate on every plugin update, and this runs on every
      // plugin-list refresh - so warning each time would be a steady drip in the log
      it('warns only once, not on every refresh', async () => {
        await pluginsService.getHomebridgeUiPackage()
        await pluginsService.getHomebridgeUiPackage()
        await pluginsService.getHomebridgeUiPackage()

        expect(warnSpy).toHaveBeenCalledTimes(1)
      })

      it('stays quiet for the normal single-installation case', async () => {
        vi.spyOn(installed as any, 'getInstalledModules').mockResolvedValue([
          { name: '@mp-consulting/homebridge-config-glass-ui', path: resolve(runningPath, '..'), installPath: runningPath },
        ])

        await pluginsService.getHomebridgeUiPackage()

        expect(warnSpy).not.toHaveBeenCalled()
      })
    })

    // The fix above only worked because getInstalledModules() had been mocked to contain
    // the running install. On a real hb-service setup the running install sits outside
    // every scanned base path, and the safety net that adds it back only ran when no copy
    // of the UI was found at all - so the shadow copy suppressed it and became the only
    // candidate. That put a beta Pi back in exactly the original broken state, reporting
    // the shadow's stable version and offering an update to the beta already running.
    describe('when the running install is outside the scanned paths', () => {
      beforeEach(() => {
        vi.restoreAllMocks()
        // only the shadow copy is discoverable, as on a real Pi
        vi.spyOn(installed as any, 'getPaths').mockResolvedValue([resolve(shadowPath, '..')])
        // the module scan is reused for 60s - drop any taken with the real paths
        pluginsService.clearInstalledPluginsCache()
        vi.spyOn(registry as any, 'getPluginFromNpm').mockImplementation(async (pkg: any) => {
          pkg.latestVersion = null
          return pkg
        })
        ;(installed as any).warnedDuplicateUiInstall = false
      })

      afterEach(() => {
        // and don't leave the shadow-only scan behind for later tests
        pluginsService.clearInstalledPluginsCache()
      })

      it('still finds the running install in the module scan', async () => {
        const modules = await (installed as any).getInstalledModules()
        const uiModules = modules.filter((x: any) => x.name === '@mp-consulting/homebridge-config-glass-ui')

        expect(uiModules.map((x: any) => resolve(x.installPath))).toContain(runningPath)
      })

      it('reports the running version, not the shadow copy it happens to find', async () => {
        const running = await readJson(join(runningPath, 'package.json'))

        const uiPackage = await pluginsService.getHomebridgeUiPackage()

        expect(uiPackage.installedVersion).toBe(running.version)
        expect(uiPackage.installedVersion).not.toBe('0.0.1-shadow')
      })
    })
  })

  describe('manageUi - which install gets updated', () => {
    let npmSpy: any
    let runningParent: string
    let shadowParent: string

    beforeEach(async () => {
      runningParent = dirname(resolve(process.env.UIX_BASE_PATH))
      shadowParent = resolve(process.env.UIX_STORAGE_PATH, 'fake-ui-plugins', 'node_modules')

      // the plugin list dedupes in favour of the non-global copy, so the shadow
      // comes first - exactly the order manageUi used to take blindly
      ;(installed as any).installedPlugins = [
        { name: '@mp-consulting/homebridge-config-glass-ui', installPath: shadowParent, globalInstall: false },
        { name: '@mp-consulting/homebridge-config-glass-ui', installPath: runningParent, globalInstall: true },
      ]

      vi.spyOn(installed as any, 'getInstalledPlugins').mockResolvedValue([])
      vi.spyOn(installer as any, 'applyAllowScripts').mockResolvedValue(undefined)
      vi.spyOn(installer as any, 'cleanNpmCache').mockResolvedValue(undefined)
      npmSpy = vi.spyOn(installer as any, 'runNpmCommand').mockResolvedValue(undefined)
    })

    // Regression: the UI carries the 'homebridge-plugin' keyword, so it is deduped like
    // a plugin and the dedup prefers a non-global copy. A second copy of the UI under the
    // plugin path was therefore the one npm updated, leaving the install that is actually
    // running untouched - so the same update kept being offered after every restart.
    it('installs into the installation that is actually running', async () => {
      await (installer as any).manageUi(
        'install',
        { name: '@mp-consulting/homebridge-config-glass-ui', version: '9.9.9' },
        new EventEmitter(),
      )

      expect(npmSpy).toHaveBeenCalledTimes(1)
      const [, cwd] = npmSpy.mock.calls[0]
      expect(cwd).toBe(resolve(runningParent, '../'))
      expect(cwd).not.toBe(resolve(shadowParent, '../'))
    })

    it('falls back to the only installation when there is just one', async () => {
      ;(installed as any).installedPlugins = [
        { name: '@mp-consulting/homebridge-config-glass-ui', installPath: shadowParent, globalInstall: false },
      ]

      await (installer as any).manageUi(
        'install',
        { name: '@mp-consulting/homebridge-config-glass-ui', version: '9.9.9' },
        new EventEmitter(),
      )

      const [, cwd] = npmSpy.mock.calls[0]
      expect(cwd).toBe(resolve(shadowParent, '../'))
    })
  })

  describe('getHomebridgePackage - which install sets the version (#2897)', () => {
    let configService: ConfigService
    let fakeInstallPath: string

    beforeEach(async () => {
      configService = app.get(ConfigService)
      fakeInstallPath = resolve(process.env.UIX_STORAGE_PATH, 'fake-homebridge', 'node_modules', 'homebridge')
      await mkdir(fakeInstallPath, { recursive: true })
      await writeFile(join(fakeInstallPath, 'package.json'), JSON.stringify({ name: 'homebridge', version: '2.1.1' }))

      vi.spyOn(installed as any, 'getInstalledModules').mockResolvedValue([
        { name: 'homebridge', path: fakeInstallPath, installPath: fakeInstallPath },
      ])
      vi.spyOn(registry as any, 'parsePackageJson').mockResolvedValue({
        name: 'homebridge',
        installedVersion: '2.1.1',
        latestVersion: '2.2.0',
      })
      configService.ui.homebridgeUpdatePolicy = 'none'
    })

    it('does not let a discovered-but-not-running install overwrite the IPC version', async () => {
      // hb-service reported launching a copy that is not among the scanned paths
      // (the reporter had an apt install plus one under the plugin path). Without
      // the guard, this disk scan overwrote the real running version, so the UI
      // showed one version on load and another after a refresh.
      configService.runningHomebridgeModulePath = resolve(process.env.UIX_STORAGE_PATH, 'some-other-homebridge')
      configService.homebridgeVersion = '1.9.0'

      await pluginsService.getHomebridgePackage()

      expect(configService.homebridgeVersion).toBe('1.9.0')
    })

    it('uses the running install when two Homebridge installations are discovered', async () => {
      const runningInstallPath = resolve(process.env.UIX_STORAGE_PATH, 'running-homebridge', 'node_modules', 'homebridge')
      const runningModulePath = resolve(process.env.UIX_STORAGE_PATH, 'running-homebridge-link')
      await mkdir(runningInstallPath, { recursive: true })
      await writeFile(join(runningInstallPath, 'package.json'), JSON.stringify({ name: 'homebridge', version: '1.9.0' }))
      await remove(runningModulePath)
      await symlink(runningInstallPath, runningModulePath, 'junction')

      vi.mocked((installed as any).getInstalledModules).mockResolvedValue([
        { name: 'homebridge', path: fakeInstallPath, installPath: fakeInstallPath },
        { name: 'homebridge', path: runningInstallPath, installPath: runningInstallPath },
      ])
      vi.mocked((registry as any).parsePackageJson).mockImplementation(async (pkg: { version: string }) => ({
        name: 'homebridge',
        installedVersion: pkg.version,
        latestVersion: '2.2.0',
      }))
      // hb-service can report the symlinked path used to launch Homebridge,
      // while plugin discovery finds the real installation directory.
      homebridgeIpcService.setHomebridgeVersion('1.9.0', runningModulePath)

      const homebridge = await pluginsService.getHomebridgePackage()

      expect(homebridge.installedVersion).toBe('1.9.0')
      expect(homebridge.multipleInstances).toBe(true)
      expect(configService.homebridgeVersion).toBe('1.9.0')
    })

    it('sets the version from disk when hb-service has not reported a running module', async () => {
      configService.runningHomebridgeModulePath = undefined
      configService.homebridgeVersion = '1.9.0'

      await pluginsService.getHomebridgePackage()

      expect(configService.homebridgeVersion).toBe('2.1.1')
    })

    it('sets the version from disk when the discovered install is the running one', async () => {
      configService.runningHomebridgeModulePath = fakeInstallPath
      configService.homebridgeVersion = '1.9.0'

      await pluginsService.getHomebridgePackage()

      expect(configService.homebridgeVersion).toBe('2.1.1')
    })
  })

  describe('getInstalledModules - a running install outside the scanned paths (#2897)', () => {
    let configService: ConfigService
    let scannedPath: string
    let unscannedPath: string

    const getInstalledModules = () =>
      (installed as any).getInstalledModules() as Promise<Array<{ name: string, path: string, installPath: string }>>

    beforeEach(async () => {
      configService = app.get(ConfigService)

      // The copy the base path scan can see, standing in for the stale second install
      scannedPath = resolve(process.env.UIX_STORAGE_PATH, 'plugins', 'node_modules', 'homebridge')
      await mkdir(scannedPath, { recursive: true })
      await writeFile(join(scannedPath, 'package.json'), JSON.stringify({ name: 'homebridge', version: '2.1.1' }))

      // The one hb-service actually launched, in an /opt/homebridge style location
      // that is not among the scanned base paths
      unscannedPath = resolve(process.env.UIX_STORAGE_PATH, 'opt-homebridge', 'lib', 'node_modules', 'homebridge')
      await mkdir(unscannedPath, { recursive: true })
      await writeFile(join(unscannedPath, 'package.json'), JSON.stringify({ name: 'homebridge', version: '1.9.0' }))

      configService.runningHomebridgeModulePath = unscannedPath
      // the module scan is reused for 60s, and each test here changes what
      // it should find
      pluginsService.clearInstalledPluginsCache()
    })

    afterEach(async () => {
      configService.runningHomebridgeModulePath = undefined
      await remove(resolve(process.env.UIX_STORAGE_PATH, 'opt-homebridge'))
      await remove(scannedPath)
      pluginsService.clearInstalledPluginsCache()
    })

    // Regression: the scan only ever returned installs under the base paths, so the
    // apt and Pi image location was invisible. findRunningHomebridgeInstall then had
    // nothing to match and getHomebridgePackage fell back to the first discovered
    // install - the copy that is not running.
    it('includes the running install so it can be matched', async () => {
      const modules = await getInstalledModules()
      const homebridgeInstalls = modules.filter(x => x.name === 'homebridge')

      expect(homebridgeInstalls.some(x => x.installPath === unscannedPath)).toBe(true)
    })

    it('reports the running version rather than the discovered one', async () => {
      const homebridge = await pluginsService.getHomebridgePackage()

      expect(homebridge.installedVersion).toBe('1.9.0')
      expect(configService.homebridgeVersion).toBe('1.9.0')
    })

    it('resolves the running path through a symlink without listing it twice', async () => {
      const linkPath = resolve(process.env.UIX_STORAGE_PATH, 'opt-homebridge-link')
      await remove(linkPath)
      await symlink(unscannedPath, linkPath, 'junction')
      configService.runningHomebridgeModulePath = linkPath

      const modules = await getInstalledModules()
      const homebridgeInstalls = modules.filter(x => x.name === 'homebridge')

      expect(homebridgeInstalls.filter(x => x.installPath === unscannedPath)).toHaveLength(1)
      expect(homebridgeInstalls.some(x => x.installPath === linkPath)).toBe(false)
      await remove(linkPath)
    })

    it('leaves the scan alone when the running path has no package.json', async () => {
      const emptyPath = resolve(process.env.UIX_STORAGE_PATH, 'opt-homebridge', 'empty')
      await mkdir(emptyPath, { recursive: true })
      configService.runningHomebridgeModulePath = emptyPath

      const modules = await getInstalledModules()

      expect(modules.some(x => x.name === 'homebridge' && x.installPath === scannedPath)).toBe(true)
      expect(modules.some(x => x.installPath.endsWith('empty'))).toBe(false)
    })

    it('leaves the scan alone when the running path does not exist', async () => {
      configService.runningHomebridgeModulePath = resolve(process.env.UIX_STORAGE_PATH, 'does-not-exist', 'homebridge')

      const modules = await getInstalledModules()

      expect(modules.some(x => x.name === 'homebridge' && x.installPath === scannedPath)).toBe(true)
    })
  })

  describe('performPackageUpdate - the shared restart-free update path', () => {
    // The whole point of the extraction: the update itself must never restart
    // anything. It reports what restart it calls for; the caller (the single
    // package endpoint today, the Update All orchestrator later) decides when.
    const client = new EventEmitter()

    it('updates homebridge and asks for a homebridge restart, doing none itself', async () => {
      const update = vi.spyOn(uiUpdate, 'updateHomebridgePackage').mockResolvedValue(undefined as any)
      const restart = vi.spyOn(homebridgeIpcService, 'restartHomebridge').mockImplementation(() => undefined)
      const uiRestart = vi.spyOn(uiUpdate as any, 'scheduleUiRestart')

      const result = await pluginsService.performPackageUpdate('homebridge', '2.4.0', client)

      expect(update).toHaveBeenCalledWith({ version: '2.4.0' }, client)
      expect(result).toEqual({
        ok: true,
        name: 'homebridge',
        version: '2.4.0',
        restart: { homebridge: true, ui: false, childBridgeUsernames: [] },
      })
      expect(restart).not.toHaveBeenCalled()
      expect(uiRestart).not.toHaveBeenCalled()
    })

    it('updates the ui and asks for a ui restart, without arming the exit timer', async () => {
      const manage = vi.spyOn(installer, 'managePlugin').mockResolvedValue(true)
      const uiRestart = vi.spyOn(uiUpdate as any, 'scheduleUiRestart')

      const result = await pluginsService.performPackageUpdate('@mp-consulting/homebridge-config-glass-ui', '5.27.1', client)

      expect(manage).toHaveBeenCalledWith('install', { name: '@mp-consulting/homebridge-config-glass-ui', version: '5.27.1' }, client)
      expect(result.restart).toEqual({ homebridge: false, ui: true, childBridgeUsernames: [] })
      expect(uiRestart).not.toHaveBeenCalled()
    })

    it('updates a plugin on child bridges and names them instead of asking for a homebridge restart', async () => {
      vi.spyOn(installer, 'managePlugin').mockResolvedValue(true)
      vi.spyOn(metadata, 'getPluginChildBridgeUsernames').mockResolvedValue(['0E:11:22:33:44:55'])
      const bridgeRestart = vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue(undefined as any)

      const result = await pluginsService.performPackageUpdate('homebridge-mock-plugin', '1.1.0', client)

      expect(result.restart).toEqual({ homebridge: false, ui: false, childBridgeUsernames: ['0E:11:22:33:44:55'] })
      expect(bridgeRestart).not.toHaveBeenCalled()
    })

    it('updates a main-bridge plugin and asks for a homebridge restart', async () => {
      vi.spyOn(installer, 'managePlugin').mockResolvedValue(true)
      vi.spyOn(metadata, 'getPluginChildBridgeUsernames').mockResolvedValue([])

      const result = await pluginsService.performPackageUpdate('homebridge-mock-plugin', '1.1.0', client)

      expect(result.restart).toEqual({ homebridge: true, ui: false, childBridgeUsernames: [] })
    })

    it('reports a failed update instead of throwing, and asks for no restart', async () => {
      vi.spyOn(installer, 'managePlugin').mockRejectedValue(new Error('npm exploded'))

      const result = await pluginsService.performPackageUpdate('homebridge-mock-plugin', '1.1.0', client)

      expect(result.ok).toBe(false)
      expect(result.error).toBe('npm exploded')
      expect(result.restart).toEqual({ homebridge: false, ui: false, childBridgeUsernames: [] })
    })
  })

  describe('filterLocallyHandledScripts (#2909)', () => {
    const call = (scriptPackages: string[], localAllowScripts: unknown) =>
      (installer as any).filterLocallyHandledScripts(scriptPackages, localAllowScripts) as string[]

    it('keeps every package when there is no local allowScripts', () => {
      expect(call(['homebridge-mock-plugin@1.0.0', 'ffmpeg-for-homebridge'], undefined))
        .toEqual(['homebridge-mock-plugin@1.0.0', 'ffmpeg-for-homebridge'])
    })

    it('drops packages allowed with a bare name', () => {
      expect(call(['homebridge-mock-plugin@1.0.0'], { 'homebridge-mock-plugin': true }))
        .toEqual([])
    })

    it('drops packages allowed with the exact version pin', () => {
      expect(call(['homebridge-mock-plugin@1.0.0'], { 'homebridge-mock-plugin@1.0.0': true }))
        .toEqual([])
    })

    it('keeps a package whose true entry pins a different version', () => {
      // Updating 1.0.0 -> 1.1.0 with a stale pin still blocks the script, so
      // the warning must fire.
      expect(call(['homebridge-mock-plugin@1.1.0'], { 'homebridge-mock-plugin@1.0.0': true }))
        .toEqual(['homebridge-mock-plugin@1.1.0'])
    })

    it('drops explicitly denied packages whatever version the entry names', () => {
      expect(call(
        ['homebridge-mock-plugin@1.1.0', '@scarf/scarf'],
        { 'homebridge-mock-plugin@1.0.0': false, '@scarf/scarf': false },
      )).toEqual([])
    })

    it('handles scoped dependency keys with version pins', () => {
      expect(call(
        ['@stoprocent/noble@2.3.4', 'ffmpeg-for-homebridge'],
        { '@stoprocent/noble@2.3.4': true },
      )).toEqual(['ffmpeg-for-homebridge'])
    })

    it('treats array-form local entries as allowed', () => {
      expect(call(
        ['homebridge-mock-plugin@1.0.0', 'ffmpeg-for-homebridge'],
        ['ffmpeg-for-homebridge'],
      )).toEqual(['homebridge-mock-plugin@1.0.0'])
    })
  })

  describe('package name / version validation before npm', () => {
    // Not every path runs through a DTO: the update endpoint takes the version
    // from the query string, and a backup restore takes names and versions
    // from the uploaded archive. Unchecked, a URL version installs an
    // arbitrary tarball and a leading '-' is read by npm as a flag.
    let runNpmSpy: any

    beforeEach(() => {
      runNpmSpy = vi.spyOn(installer as any, 'runNpmCommand').mockResolvedValue(undefined)
    })

    it.each([
      'https://attacker.example/x.tgz',
      '--registry=https://attacker.example',
      '-1.0.0',
      'git+ssh://git@github.com/x/y.git',
      'file:../evil',
      '1.0.0; rm -rf /',
    ])('managePlugin rejects the version %s', async (version) => {
      await expect(pluginsService.managePlugin('install', { name: 'homebridge-mock-plugin', version }, new EventEmitter()))
        .rejects
        .toThrow('Invalid version.')
      expect(runNpmSpy).not.toHaveBeenCalled()
    })

    it.each([
      '--global-style',
      'evil-package',
      '../homebridge-x',
      'https://attacker.example/homebridge-x.tgz',
    ])('managePlugin rejects the name %s', async (name) => {
      await expect(pluginsService.managePlugin('install', { name, version: '1.0.0' }, new EventEmitter()))
        .rejects
        .toThrow('Invalid plugin name.')
      expect(runNpmSpy).not.toHaveBeenCalled()
    })

    it('updateHomebridgePackage rejects a URL or flag version', async () => {
      for (const version of ['https://attacker.example/homebridge.tgz', '--foo']) {
        await expect(pluginsService.updateHomebridgePackage({ version }, new EventEmitter()))
          .rejects
          .toThrow('Invalid version.')
      }
      expect(runNpmSpy).not.toHaveBeenCalled()
    })

    it('POST /plugins/update/:pluginName rejects a URL version from the query string', async () => {
      const performSpy = vi.spyOn(uiUpdate, 'performPackageUpdate')

      for (const pluginName of ['homebridge', 'homebridge-mock-plugin']) {
        const res = await app.inject({
          method: 'POST',
          path: `/plugins/update/${pluginName}?version=${encodeURIComponent('https://attacker.example/x.tgz')}`,
          headers: {
            authorization,
          },
        })
        expect(res.statusCode).toBe(400)
      }

      await new Promise(setImmediate)
      expect(performSpy).not.toHaveBeenCalled()
    })

    it('performPackageUpdate reports a leading "--" version as a failure without running npm', async () => {
      const result = await pluginsService.performPackageUpdate('homebridge-mock-plugin', '--ignore-scripts=false', new EventEmitter())

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Invalid version.')
      expect(runNpmSpy).not.toHaveBeenCalled()
    })

    it('the DTOs accept tags and semver ranges but not URLs or flags', async () => {
      for (const version of ['latest', 'beta', '1.2.3', '^2.0.0-beta.1', '>=1.0.0', '~1.2', '*']) {
        expect(await validate(plainToInstance(HomebridgeUpdateActionDto, { version }))).toHaveLength(0)
        expect(await validate(plainToInstance(PluginActionDto, { name: 'homebridge-mock-plugin', version }))).toHaveLength(0)
      }
      for (const version of ['https://attacker.example/x.tgz', '--foo', '-1']) {
        expect(await validate(plainToInstance(HomebridgeUpdateActionDto, { version }))).not.toHaveLength(0)
        expect(await validate(plainToInstance(PluginActionDto, { name: 'homebridge-mock-plugin', version }))).not.toHaveLength(0)
      }
    })
  })

  describe('getPluginAlias - forked extraction', () => {
    let children: Array<EventEmitter & { pluginPath: string }>

    beforeEach(() => {
      children = []
      vi.mocked(childProcess.fork).mockImplementation(((_script: string, options: any) => {
        const child = Object.assign(new EventEmitter(), { pluginPath: options.env.UIX_EXTRACT_PLUGIN_PATH })
        children.push(child)
        return child
      }) as any)
      ;(metadata as any).pluginAliasCache.flushAll()
      ;(installed as any).installedPlugins = ['a', 'b', 'c', 'd'].map(x => ({
        name: `homebridge-alias-${x}`,
        installPath: pluginsPath,
        settingsSchema: false,
      }))
    })

    afterEach(() => {
      ;(installed as any).installedPlugins = undefined
      ;(metadata as any).pluginAliasCache.flushAll()
    })

    const answer = (child: EventEmitter, alias: string) => {
      child.emit('message', { pluginAlias: alias, pluginType: 'platform' })
      child.emit('close', 0)
    }

    it('forks at most two at a time and shares an in-flight lookup for the same plugin', async () => {
      const lookups = [
        pluginsService.getPluginAlias('homebridge-alias-a'),
        pluginsService.getPluginAlias('homebridge-alias-a'),
        pluginsService.getPluginAlias('homebridge-alias-b'),
        pluginsService.getPluginAlias('homebridge-alias-c'),
        pluginsService.getPluginAlias('homebridge-alias-d'),
      ]
      await new Promise(setImmediate)

      // bounded, however many callers are waiting
      expect(childProcess.fork).toHaveBeenCalledTimes(2)

      while (children.some(c => !(c as any).answered)) {
        const child = children.find(c => !(c as any).answered)
        ;(child as any).answered = true
        answer(child, child.pluginPath.split('-').pop().toUpperCase())
        await new Promise(setImmediate)
        expect(children.filter(c => !(c as any).answered).length).toBeLessThanOrEqual(2)
      }

      const results = await Promise.all(lookups)
      // one fork per plugin - the duplicate lookup rode along
      expect(childProcess.fork).toHaveBeenCalledTimes(4)
      expect(results.map(x => x.pluginAlias)).toEqual(['A', 'A', 'B', 'C', 'D'])
      expect((metadata as any).pluginAliasLookups.size).toBe(0)
    })

    it('frees its slot when a fork fails to start', async () => {
      const first = pluginsService.getPluginAlias('homebridge-alias-a')
      const second = pluginsService.getPluginAlias('homebridge-alias-b')
      const third = pluginsService.getPluginAlias('homebridge-alias-c')
      await new Promise(setImmediate)

      children[0].emit('error', new Error('spawn EAGAIN'))
      await new Promise(setImmediate)
      expect(childProcess.fork).toHaveBeenCalledTimes(3)

      answer(children[1], 'B')
      answer(children[2], 'C')
      expect((await first).pluginAlias).toBeNull()
      expect((await second).pluginAlias).toBe('B')
      expect((await third).pluginAlias).toBe('C')
    })
  })

  describe('getPluginChildBridgeUsernames - a caller-supplied config', () => {
    it('uses the config it is handed instead of reading config.json again', async () => {
      vi.spyOn(metadata, 'getPluginAlias').mockResolvedValue({ pluginAlias: 'ExampleHomebridgePlugin', pluginType: 'platform' })

      const result = await pluginsService.getPluginChildBridgeUsernames('homebridge-mock-plugin', {
        platforms: [{ platform: 'ExampleHomebridgePlugin', _bridge: { username: '0E:12:34:56:78:9A' } }],
      } as any)

      expect(result).toEqual(['0E:12:34:56:78:9A'])
    })
  })

  describe('npm queries on request paths', () => {
    afterEach(() => {
      ;(installer as any).npmMajorVersion = null
      ;(installer as any).npmMajorVersionPromise = null
      ;(installed as any).npmGlobalRootPromise = null
    })

    it('asks npm for its version once, however many callers are waiting', async () => {
      ;(installer as any).npmMajorVersion = null
      const querySpy = vi.spyOn(installed as any, 'queryNpm').mockResolvedValue('12.1.0')

      const versions = await Promise.all([
        (installer as any).getNpmMajorVersion(),
        (installer as any).getNpmMajorVersion(),
      ])
      expect(await (installer as any).getNpmMajorVersion()).toBe(12)

      expect(versions).toEqual([12, 12])
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(['--version'])
    })

    it('treats an npm that cannot be queried as version 0', async () => {
      ;(installer as any).npmMajorVersion = null
      vi.spyOn(installed as any, 'queryNpm').mockRejectedValue(new Error('ENOENT'))

      expect(await (installer as any).getNpmMajorVersion()).toBe(0)
    })

    it('looks up the global root once and retries after a failure', async () => {
      const querySpy = vi.spyOn(installed as any, 'queryNpm')
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValue('/usr/local/lib/node_modules')

      expect(await (installed as any).getNpmGlobalRoot()).toBeNull()
      expect(await (installed as any).getNpmGlobalRoot()).toBe('/usr/local/lib/node_modules')
      expect(await (installed as any).getNpmGlobalRoot()).toBe('/usr/local/lib/node_modules')

      expect(querySpy).toHaveBeenCalledTimes(2)
      expect(querySpy).toHaveBeenCalledWith(['root', '-g'])
    })
  })

  describe('getInstalledModules - shared scan', () => {
    beforeEach(() => {
      pluginsService.clearInstalledPluginsCache()
    })

    afterEach(() => {
      pluginsService.clearInstalledPluginsCache()
    })

    it('reuses one scan across callers until something invalidates it', async () => {
      const scanSpy = vi.spyOn(installed as any, 'scanInstalledModules')

      const [first] = await Promise.all([
        (installed as any).getInstalledModules(),
        (installed as any).getInstalledModules(),
      ])
      await pluginsService.getHomebridgeUiPackage()
      expect(scanSpy).toHaveBeenCalledTimes(1)

      // each caller gets its own copy, so one cannot corrupt the next
      first.push({ name: 'homebridge-injected', path: '/', installPath: '/' })
      const again = await (installed as any).getInstalledModules()
      expect(again.some((x: any) => x.name === 'homebridge-injected')).toBe(false)

      pluginsService.clearInstalledPluginsCache()
      await (installed as any).getInstalledModules()
      expect(scanSpy).toHaveBeenCalledTimes(2)
    })

    it('expires after 60 seconds', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        const scanSpy = vi.spyOn(installed as any, 'scanInstalledModules')
        await (installed as any).getInstalledModules()
        vi.setSystemTime(Date.now() + 59_000)
        await (installed as any).getInstalledModules()
        expect(scanSpy).toHaveBeenCalledTimes(1)
        vi.setSystemTime(Date.now() + 2_000)
        await (installed as any).getInstalledModules()
        expect(scanSpy).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('is invalidated once an npm command finishes', async () => {
      const scanSpy = vi.spyOn(installed as any, 'scanInstalledModules')
      ;(installed as any).npmGlobalRootPromise = Promise.resolve(pluginsPath)
      vi.spyOn((installer as any).nodePtyService, 'spawn').mockImplementation(() => ({
        onData: vi.fn(),
        onExit: (cb: (e: { exitCode: number }) => void) => setImmediate(() => cb({ exitCode: 0 })),
        kill: vi.fn(),
      }))

      await (installed as any).getInstalledModules()
      await (installer as any).runNpmCommand(['npm', 'install', 'homebridge-mock-plugin@1.0.0'], pluginsPath, new EventEmitter())
      await (installed as any).getInstalledModules()

      expect(scanSpy).toHaveBeenCalledTimes(2)
      ;(installed as any).npmGlobalRootPromise = null
    })
  })

  it('bounds outgoing requests with an abort signal rather than a lingering timer', async () => {
    const handlers = (httpService.axiosRef.interceptors.request as any).handlers.filter(Boolean)
    const run = async (config: any) => {
      for (const handler of handlers) {
        config = await handler.fulfilled(config)
      }
      return config
    }

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const config = await run({ headers: {} })
    expect(config.signal).toBeInstanceOf(AbortSignal)
    expect(config.cancelToken).toBeUndefined()
    expect(timeoutSpy).not.toHaveBeenCalled()

    // a caller's own signal wins
    const own = new AbortController().signal
    expect((await run({ headers: {}, signal: own })).signal).toBe(own)
  })

  afterAll(async () => {
    // Close first: PluginsService.onModuleDestroy clears any restart still
    // pending, so nothing can fire once the spy is gone.
    await app.close()
    exitSpy.mockRestore()
  })

  describe('@homebridge-plugins/* lookups during a search', () => {
    let singleSpy: any
    const scoped = (suffix: string) => `@homebridge-plugins/homebridge-${suffix}`

    beforeEach(() => {
      ;(installed as any).installedPlugins = []
      ;(registry as any).scopedPluginNames = [
        ...Array.from({ length: 15 }, (_, i) => scoped(`foo-${i}`)),
        scoped('foo-bar'),
      ]
      vi.spyOn(httpService, 'get').mockImplementation((() => of({ data: { objects: [] } })) as any)
      singleSpy = vi.spyOn(registry, 'searchNpmRegistrySingle').mockResolvedValue([])
    })

    afterEach(() => {
      ;(registry as any).scopedPluginNames = []
      vi.restoreAllMocks()
    })

    it('fetches at most a capped number of packuments', async () => {
      await registry.searchNpmRegistry('foo', installed)

      expect(singleSpy).toHaveBeenCalledTimes(PluginRegistryService.MAX_SCOPED_LOOKUPS)
    })

    it('fetches the names matching the most terms first', async () => {
      await registry.searchNpmRegistry('foo bar', installed)

      expect(singleSpy).toHaveBeenCalledTimes(PluginRegistryService.MAX_SCOPED_LOOKUPS)
      expect(singleSpy.mock.calls[0][0]).toBe(scoped('foo-bar'))
    })

    it('does not look anything up for a term that is too short to be useful', async () => {
      await registry.searchNpmRegistry('fo', installed)

      expect(singleSpy).not.toHaveBeenCalled()
    })
  })

  describe('installed plugin scan', () => {
    let pluginRoot: string

    beforeEach(async () => {
      pluginRoot = resolve(process.env.UIX_STORAGE_PATH, 'scan-concurrency', 'node_modules')
      const modules = []
      for (let i = 0; i < 20; i += 1) {
        const name = `homebridge-scan-${i}`
        await mkdir(join(pluginRoot, name), { recursive: true })
        await writeFile(join(pluginRoot, name, 'package.json'), JSON.stringify({ name, version: '1.0.0', keywords: ['homebridge-plugin'] }))
        modules.push({ name, path: pluginRoot, installPath: join(pluginRoot, name) })
      }
      ;(installed as any).installedPluginsCache.flushAll()
      vi.spyOn(installed as any, 'getInstalledModules').mockResolvedValue(modules)
      vi.spyOn(installed as any, 'getDisabledPlugins').mockResolvedValue([])
    })

    afterEach(async () => {
      ;(installed as any).installedPluginsCache.flushAll()
      vi.restoreAllMocks()
      await remove(dirname(pluginRoot))
    })

    it('runs the registry lookups with their own, higher concurrency limit', async () => {
      let inFlight = 0
      let maxInFlight = 0
      vi.spyOn(registry, 'parsePackageJson').mockImplementation(async (pkgJson: any, installPath: string) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(res => setTimeout(res, 5))
        inFlight -= 1
        return { name: pkgJson.name, installPath, globalInstall: true } as any
      })

      const plugins = await installed.getInstalledPlugins()

      expect(plugins).toHaveLength(20)
      expect(maxInFlight).toBe(InstalledPluginsService.REGISTRY_CONCURRENCY)
    })

    it('serves the cached list by reference', async () => {
      vi.spyOn(registry, 'parsePackageJson').mockImplementation(async (pkgJson: any, installPath: string) =>
        ({ name: pkgJson.name, installPath, globalInstall: true }) as any)

      const first = await installed.getInstalledPlugins()
      const second = await installed.getInstalledPlugins()

      expect(second).toBe(first)
      expect(installed.getCachedInstalledPlugins()).toBe(first)
    })

    it('shares one load between concurrent callers on a cold cache', async () => {
      const parse = vi.spyOn(registry, 'parsePackageJson').mockImplementation(async (pkgJson: any, installPath: string) =>
        ({ name: pkgJson.name, installPath, globalInstall: true }) as any)

      const [a, b, c] = await Promise.all([
        installed.getInstalledPlugins(),
        installed.getInstalledPlugins(),
        installed.getInstalledPlugins(),
      ])

      expect(a).toHaveLength(20)
      expect(b).toBe(a)
      expect(c).toBe(a)
      expect(parse).toHaveBeenCalledTimes(20)
      expect((installed as any).getInstalledModules).toHaveBeenCalledTimes(1)
    })

    it('skips a module folder without a package.json quietly', async () => {
      vi.spyOn(registry, 'parsePackageJson').mockImplementation(async (pkgJson: any, installPath: string) =>
        ({ name: pkgJson.name, installPath, globalInstall: true }) as any)
      const errorSpy = vi.spyOn((installed as any).logger, 'error').mockImplementation(() => {})
      const modules = await (installed as any).getInstalledModules()
      await mkdir(join(pluginRoot, 'homebridge-no-package'), { recursive: true })
      ;(installed as any).getInstalledModules.mockResolvedValue([
        ...modules,
        { name: 'homebridge-no-package', path: pluginRoot, installPath: join(pluginRoot, 'homebridge-no-package') },
      ])

      const plugins = await installed.getInstalledPlugins()

      expect(plugins).toHaveLength(20)
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('does not cache a load that an invalidation overtook', async () => {
      let release!: () => void
      const gate = new Promise<void>((res) => {
        release = res
      })
      vi.spyOn(registry, 'parsePackageJson').mockImplementation(async (pkgJson: any, installPath: string) => {
        await gate
        return { name: pkgJson.name, installPath, globalInstall: true } as any
      })

      const stale = installed.getInstalledPlugins()
      await new Promise(res => setTimeout(res, 5))
      installed.clearInstalledPluginsCache()
      release()

      expect(await stale).toHaveLength(20)
      expect(installed.getCachedInstalledPlugins()).toBeUndefined()
    })
  })

  describe('npm registry document cache', () => {
    const name = 'homebridge-cache-collision'
    const abbreviated = {
      'name': name,
      'dist-tags': { latest: '1.0.0' },
      'versions': { '1.0.0': { version: '1.0.0', engines: { node: '>=22' } } },
    }
    const full = {
      ...abbreviated,
      keywords: ['homebridge-plugin'],
      description: 'A cached plugin',
      time: { modified: '2026-01-01T00:00:00.000Z' },
      maintainers: [{ name: 'someone' }],
    }

    beforeEach(() => {
      ;(registry as any).npmPluginCache.flushAll()
      ;(installed as any).installedPlugins = []
      // The abbreviated (install-v1) document lacks keywords, time, maintainers...
      vi.spyOn(httpService, 'get').mockImplementation(((_url: string, config?: any) => of({
        data: config?.headers?.accept?.includes('install-v1') ? abbreviated : full,
      })) as any)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('a version lookup does not poison a later single-plugin search', async () => {
      await pluginsService.getAvailablePluginVersions(name)
      const results = await pluginsService.searchNpmRegistrySingle(name)

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe(name)
    })

    it('a single-plugin search does not poison a later version lookup', async () => {
      await pluginsService.searchNpmRegistrySingle(name)
      await pluginsService.getAvailablePluginVersions(name)

      expect(httpService.get).toHaveBeenCalledTimes(2)
      expect(await pluginsService.getAvailablePluginVersions(name)).toEqual({
        tags: { latest: '1.0.0' },
        versions: { '1.0.0': { version: '1.0.0', engines: { node: '>=22' } } },
      })
      expect(httpService.get).toHaveBeenCalledTimes(2)
    })

    it('serves cached documents by reference instead of deep-cloning them', async () => {
      await pluginsService.searchNpmRegistrySingle(name)
      const cache = (registry as any).npmPluginCache

      expect(cache.get(`package-${name}`)).toBe(cache.get(`package-${name}`))
    })
  })
})
