import type { TestingModule } from '@nestjs/testing'

import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { Test } from '@nestjs/testing'
import { copy, emptyDir, ensureDir, outputFile, pathExists, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigModule } from '../../src/core/config/config.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { LoggerModule } from '../../src/core/logger/logger.module.js'
import { Logger } from '../../src/core/logger/logger.service.js'
import { SchedulerModule } from '../../src/core/scheduler/scheduler.module.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { ConfigBackupService } from '../../src/modules/config-editor/config-backup.service.js'
import { testStoragePath } from '../storage-path.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-06-15T12:00:00Z').getTime()

describe('ConfigBackupService rotation (e2e)', () => {
  let moduleRef: TestingModule
  let service: ConfigBackupService
  let configService: ConfigService
  let scheduler: SchedulerService

  const storage = testStoragePath
  const backupDir = resolve(storage, 'backups/config-backups')

  const build = async () => {
    const ref = await Test.createTestingModule({
      imports: [ConfigModule, LoggerModule, SchedulerModule],
      providers: [ConfigBackupService],
    }).compile()
    await ref.init()
    const svc = ref.get(ConfigBackupService)
    await svc.ready
    return { ref, svc }
  }

  const backupsIn = async (dir: string) => (await readdir(dir)).filter(f => f.startsWith('config.json.')).sort()

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = storage
    process.env.UIX_CONFIG_PATH = resolve(storage, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Legacy backups in the storage root, from before backups/config-backups
    // existed: 105 of them, so the migration keeps the newest 100
    for (let i = 0; i < 105; i++) {
      await outputFile(resolve(storage, `config.json.${NOW - i * 1000}`), `{"n":${i}}`)
    }
    // Not a backup: must survive the migration
    await outputFile(resolve(storage, 'config.json.bak'), '{}')

    ;({ ref: moduleRef, svc: service } = await build())
    configService = moduleRef.get(ConfigService)
    scheduler = moduleRef.get(SchedulerService)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await moduleRef.close()
  })

  describe('migration of legacy backups', () => {
    it('moves the newest 100 into backups/config-backups and deletes the rest', async () => {
      const moved = await backupsIn(backupDir)
      expect(moved).toHaveLength(100)
      expect(moved).toContain(`config.json.${NOW}`)
      expect(moved).toContain(`config.json.${NOW - 99_000}`)
      expect(moved).not.toContain(`config.json.${NOW - 100_000}`)

      const leftInRoot = (await backupsIn(storage)).filter(f => f !== 'config.json.bak')
      expect(leftInRoot).toEqual([])
      expect(await pathExists(resolve(storage, 'config.json.bak'))).toBe(true)
    })

    it('lists the migrated backups newest first', async () => {
      const list = await service.listConfigBackups()

      expect(list).toHaveLength(100)
      expect(list[0]).toEqual({ id: `${NOW}`, timestamp: new Date(NOW), file: `config.json.${NOW}` })
      expect(list.map(b => b.timestamp.getTime())).toEqual([...list.map(b => b.timestamp.getTime())].sort((a, b) => b - a))
    })
  })

  describe('cleanup of old backups', () => {
    beforeEach(async () => {
      await emptyDir(backupDir)
    })

    it('removes backups 60 days old or more and keeps newer ones', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
      const ages = [0, 1, 59, 60, 61, 365]
      for (const age of ages) {
        await outputFile(resolve(backupDir, `config.json.${NOW - age * DAY}`), '{}')
      }
      // A file that only looks like a backup
      await outputFile(resolve(backupDir, 'config.json.notatimestamp'), '{}')

      await service.cleanupConfigBackups()

      expect(await backupsIn(backupDir)).toEqual([
        'config.json.notatimestamp',
        ...[0, 1, 59].map(age => `config.json.${NOW - age * DAY}`),
      ].sort())
    })

    it('runs from the 01:10 scheduled job', async () => {
      const job = scheduler.scheduledJobs['cleanup-config-backups']
      expect(job).toBeDefined()
      const next = job.nextInvocation()
      expect([next.getHours(), next.getMinutes()]).toEqual([1, 10])

      const cleanup = vi.spyOn(service, 'cleanupConfigBackups').mockResolvedValue()
      job.invoke()
      expect(cleanup).toHaveBeenCalledTimes(1)
    })

    it('logs instead of throwing when the backup directory is gone', async () => {
      const warn = vi.spyOn(moduleRef.get(Logger), 'warn')
      const original = configService.configBackupPath
      configService.configBackupPath = resolve(storage, 'does-not-exist')
      try {
        await expect(service.cleanupConfigBackups()).resolves.toBeUndefined()
      } finally {
        configService.configBackupPath = original
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to cleanup old config.json backup files'))
    })
  })

  describe('get / delete', () => {
    beforeEach(async () => {
      await emptyDir(backupDir)
      await outputFile(resolve(backupDir, `config.json.${NOW}`), '{"a":1}')
      await outputFile(resolve(backupDir, `config.json.${NOW - 1000}`), '{"b":1}')
    })

    it('reads a backup by id and 404s an unknown one', async () => {
      expect((await service.getConfigBackup(NOW)).toString()).toBe('{"a":1}')
      await expect(service.getConfigBackup(123)).rejects.toMatchObject({ status: 404 })
    })

    it('deletes one backup, then all of them', async () => {
      await service.deleteConfigBackup(NOW)
      expect(await backupsIn(backupDir)).toEqual([`config.json.${NOW - 1000}`])
      await expect(service.deleteConfigBackup(NOW)).rejects.toMatchObject({ status: 404 })

      await outputFile(resolve(backupDir, 'unrelated.txt'), 'x')
      await service.deleteAllConfigBackups()
      expect(await readdir(backupDir)).toEqual(['unrelated.txt'])
    })
  })

  describe('when the backup directory cannot be created', () => {
    it('falls back to the storage path and skips the migration', async () => {
      // A second instance, whose backups/config-backups path is blocked by a file
      const blockedStorage = resolve(storage, 'blocked')
      await ensureDir(blockedStorage)
      await copy(resolve(__dirname, '../mocks', 'config.json'), resolve(blockedStorage, 'config.json'))
      await outputFile(resolve(blockedStorage, 'backups'), 'not a directory')
      await outputFile(resolve(blockedStorage, `config.json.${NOW}`), '{}')

      const env = { storage: process.env.UIX_STORAGE_PATH, config: process.env.UIX_CONFIG_PATH }
      process.env.UIX_STORAGE_PATH = blockedStorage
      process.env.UIX_CONFIG_PATH = resolve(blockedStorage, 'config.json')
      const { ref, svc } = await build()
      process.env.UIX_STORAGE_PATH = env.storage
      process.env.UIX_CONFIG_PATH = env.config
      try {
        expect(ref.get(ConfigService).configBackupPath).toBe(blockedStorage)
        // The legacy backup stays where it is and is listed from there
        expect(await pathExists(resolve(blockedStorage, `config.json.${NOW}`))).toBe(true)
        expect((await svc.listConfigBackups()).map(b => b.file)).toEqual([`config.json.${NOW}`])
      } finally {
        ref.get(SchedulerService).cancelJob('cleanup-config-backups')
        await ref.close()
        await remove(blockedStorage)
      }
    })
  })
})
