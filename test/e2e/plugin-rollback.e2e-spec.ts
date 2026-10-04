import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove, writeJson } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditService } from '../../src/core/audit/audit.service.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { AppEventsService } from '../../src/core/events/app-events.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { ChildBridgeHealthService } from '../../src/modules/child-bridges/child-bridge-health.service.js'
import { InstalledPluginsService } from '../../src/modules/plugins/installed-plugins.service.js'
import { PluginInstallerService } from '../../src/modules/plugins/plugin-installer.service.js'
import { PluginJobsService } from '../../src/modules/plugins/plugin-jobs.service.js'
import { PluginMetadataService } from '../../src/modules/plugins/plugin-metadata.service.js'
import { HOMEBRIDGE_CRASH_LOOP_DOWNS, PluginRollbackService, ROLLBACK_DAYS, ROLLBACK_SUSPECT_WINDOW_MS } from '../../src/modules/plugins/plugin-rollback.service.js'
import { PluginsModule } from '../../src/modules/plugins/plugins.module.js'
import { testStoragePath } from '../storage-path.js'

describe('Plugin rollback (e2e)', () => {
  let app: NestFastifyApplication
  let authorization: string
  let rollback: PluginRollbackService
  let installer: PluginInstallerService

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    process.env.UIX_CUSTOM_PLUGIN_PATH = resolve(testStoragePath, 'plugins/node_modules')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PluginsModule, AuthModule],
    }).overrideProvider(HttpService).useValue(new HttpService()).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    rollback = app.get(PluginRollbackService)
    installer = app.get(PluginInstallerService)
  })

  beforeEach(async () => {
    await remove(rollback.filePath)
    ;(rollback as any).homebridgeDowns = []
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

  /** Stand in for npm, and for what is installed before it runs. */
  function fakeInstall(installedBefore: string | undefined) {
    const installed = app.get(InstalledPluginsService)
    vi.spyOn(installed, 'getInstalledPlugins').mockResolvedValue([])
    vi.spyOn(installed, 'loadedPlugins', 'get').mockReturnValue(installedBefore ? [{ name: 'homebridge-mock-plugin', installedVersion: installedBefore }] as any : [])
    return vi.spyOn(installer as any, 'doManagePlugin').mockResolvedValue(true)
  }

  const list = async () => (await app.inject({ method: 'GET', path: '/plugins/rollback', headers: { authorization } })).json()

  it('records the replaced version when a plugin update finishes', async () => {
    fakeInstall('1.0.0')
    await installer.managePlugin('install', { name: 'homebridge-mock-plugin', version: '1.2.0' }, { emit: () => true } as any)

    const entries = await list()
    expect(entries).toEqual([expect.objectContaining({ name: 'homebridge-mock-plugin', fromVersion: '1.0.0', toVersion: '1.2.0', suspect: null })])
    expect(Date.parse(entries[0].expiresAt) - Date.parse(entries[0].updatedAt)).toBe(ROLLBACK_DAYS * 86_400_000)
  })

  it('records nothing for a fresh install, a reinstall, or a failed install', async () => {
    fakeInstall(undefined)
    await installer.managePlugin('install', { name: 'homebridge-mock-plugin', version: '1.2.0' }, { emit: () => true } as any)
    vi.restoreAllMocks()
    fakeInstall('1.2.0')
    await installer.managePlugin('install', { name: 'homebridge-mock-plugin', version: '1.2.0' }, { emit: () => true } as any)
    vi.restoreAllMocks()
    fakeInstall('1.0.0').mockRejectedValue(new Error('npm failed'))
    await expect(installer.managePlugin('install', { name: 'homebridge-mock-plugin', version: '1.2.0' }, { emit: () => true } as any)).rejects.toThrow('npm failed')

    expect(await list()).toEqual([])
  })

  it('clears the record once the previous version is installed again, or the plugin is uninstalled', async () => {
    await rollback.recordInstall('homebridge-mock-plugin', '1.0.0', '1.2.0')
    await rollback.recordInstall('homebridge-mock-plugin', '1.2.0', '1.0.0')
    expect(await list()).toEqual([])

    await rollback.recordInstall('homebridge-mock-plugin', '1.0.0', '1.2.0')
    fakeInstall('1.2.0')
    await installer.managePlugin('uninstall', { name: 'homebridge-mock-plugin' }, { emit: () => true } as any)
    expect(await list()).toEqual([])
  })

  it('never records the UI or Homebridge, and forgets records past the rollback window', async () => {
    await rollback.recordInstall('homebridge', '1.8.0', '2.0.0')
    await rollback.recordInstall('homebridge-old', '1.0.0', '2.0.0', Date.now() - (ROLLBACK_DAYS + 1) * 86_400_000)
    expect(await list()).toEqual([])
  })

  it('starts the rollback as a plugin job', async () => {
    await rollback.recordInstall('homebridge-mock-plugin', '1.0.0', '1.2.0')
    const start = vi.spyOn(app.get(PluginJobsService), 'start').mockReturnValue({ id: 'job-1' } as any)

    const res = await app.inject({ method: 'POST', path: '/plugins/rollback', headers: { authorization }, payload: { name: 'homebridge-mock-plugin' } })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: 'job-1', version: '1.0.0' })
    expect(start).toHaveBeenCalledWith('install', { name: 'homebridge-mock-plugin', version: '1.0.0' })
    await vi.waitFor(async () => {
      const { entries } = await app.get(AuditService).list({ action: 'plugin.rollback' })
      expect(entries[0]).toMatchObject({ action: 'plugin.rollback', ok: true, target: 'homebridge-mock-plugin', details: { version: '1.0.0' } })
    })
  })

  it('answers 404 with nothing to roll back, and 400 for a bad name', async () => {
    expect((await app.inject({ method: 'POST', path: '/plugins/rollback', headers: { authorization }, payload: { name: 'homebridge-nothing' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', path: '/plugins/rollback', headers: { authorization }, payload: { name: '--global' } })).statusCode).toBe(400)
  })

  it('needs a login', async () => {
    expect((await app.inject({ method: 'GET', path: '/plugins/rollback' })).statusCode).toBe(401)
  })

  it('marks the rollback as suspect when the plugin\'s child bridge crash loops soon after the update', async () => {
    await rollback.recordInstall('homebridge-mock-plugin', '1.0.0', '1.2.0')
    const events: unknown[] = []
    app.get(AppEventsService).on('pluginRollbackSuggested', e => events.push(e))

    app.get(ChildBridgeHealthService).emit('crashLoop', { name: 'Mock Bridge', plugin: 'homebridge-mock-plugin', username: 'AA' } as any)

    await vi.waitFor(async () => expect((await list())[0].suspect).toMatchObject({ reason: 'childBridgeCrashLoop', bridge: 'Mock Bridge' }))
    expect(events).toEqual([expect.objectContaining({ reason: 'childBridgeCrashLoop', plugins: [expect.objectContaining({ name: 'homebridge-mock-plugin', fromVersion: '1.0.0' })] })])
    expect(await rollback.describeSuggestion('homebridge-mock-plugin')).toContain('Roll back to 1.0.0')
    app.get(AppEventsService).removeAllListeners('pluginRollbackSuggested')
  })

  it('does not suspect an update older than the suspect window', async () => {
    await rollback.recordInstall('homebridge-mock-plugin', '1.0.0', '1.2.0', Date.now() - ROLLBACK_SUSPECT_WINDOW_MS - 60_000)
    app.get(ChildBridgeHealthService).emit('crashLoop', { name: 'Mock Bridge', plugin: 'homebridge-mock-plugin', username: 'AA' } as any)
    await new Promise(r => setTimeout(r, 50))

    expect((await list())[0].suspect).toBeNull()
    expect(await rollback.describeSuggestion('homebridge-mock-plugin')).toBeNull()
  })

  it('suspects plugins on the main bridge when Homebridge crash loops', async () => {
    await rollback.recordInstall('homebridge-main', '2.0.0', '3.0.0')
    await rollback.recordInstall('homebridge-child', '1.0.0', '1.1.0')
    vi.spyOn(app.get(PluginMetadataService), 'getPluginChildBridgeUsernames').mockImplementation(async name => (name === 'homebridge-child' ? ['AA'] : []))
    const ipc = app.get(HomebridgeIpcService)

    for (let i = 0; i < HOMEBRIDGE_CRASH_LOOP_DOWNS; i++) {
      ipc.emit('serverStatusUpdate', { status: 'ok' })
      ipc.emit('serverStatusUpdate', { status: 'down' })
    }

    await vi.waitFor(async () => {
      const entries = await list()
      expect(entries.find((e: any) => e.name === 'homebridge-main').suspect).toMatchObject({ reason: 'homebridgeCrashLoop' })
      expect(entries.find((e: any) => e.name === 'homebridge-child').suspect).toBeNull()
    })
  })

  it('reads a damaged record file as empty', async () => {
    await writeJson(rollback.filePath, { entries: 'nope' })
    expect(await list()).toEqual([])
    await rollback.recordInstall('homebridge-mock-plugin', '1.0.0', '1.2.0')
    expect((await readJson(rollback.filePath)).entries).toHaveLength(1)
  })
})
