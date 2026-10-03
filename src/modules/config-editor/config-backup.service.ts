import { readdir, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Inject, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common'
import dayjs from 'dayjs'
import { ensureDir, move, pathExists, remove } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { RE_CONFIG_BACKUP } from '../../core/regex.constants.js'
import { SchedulerService } from '../../core/scheduler/scheduler.service.js'

/**
 * Owns the config.json backup lifecycle: the backup directory, the one-time
 * migration of legacy backups, listing/reading/deleting backups and the
 * scheduled cleanup of old ones.
 */
@Injectable()
export class ConfigBackupService implements OnApplicationBootstrap {
  // Resolves after start() has finished, so config saves can await it and
  // never race with the in-flight backup migration that start() runs at
  // boot.
  public readonly ready: Promise<void>
  private resolveReady!: () => void

  constructor(
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(SchedulerService) private readonly schedulerService: SchedulerService,
  ) {
    this.ready = new Promise((res) => {
      this.resolveReady = res
    })
    this.scheduleConfigBackupCleanup()
  }

  async onApplicationBootstrap(): Promise<void> {
    // Run start() through Nest's lifecycle so the migration completes
    // before any request-driven save can land. Otherwise the save's
    // backup-snapshot and migrateConfigBackups()'s move/remove pass could
    // touch the same files concurrently.
    await this.start()
    this.resolveReady()
  }

  /**
   * Executed when the UI starts
   */
  private async start() {
    await this.ensureBackupPathExists()
    await this.migrateConfigBackups()
  }

  /**
   * Schedule the job to clean up old config.json backup files
   */
  private scheduleConfigBackupCleanup() {
    const scheduleRule = new this.schedulerService.RecurrenceRule()
    scheduleRule.hour = 1
    scheduleRule.minute = 10
    scheduleRule.second = Math.floor(Math.random() * 59) + 1

    this.logger.debug(`Next config.json backup cleanup scheduled for ${scheduleRule.nextInvocationDate(new Date()).toString()}.`)

    this.schedulerService.scheduleJob('cleanup-config-backups', scheduleRule, () => {
      this.logger.debug('Running job to cleanup config.json backup files older than 60 days...')
      this.cleanupConfigBackups().catch((e) => {
        this.logger.error(`config.json backup cleanup failed as ${e?.message || e}.`)
      })
    })
  }

  /**
   * List config backups (newest first by timestamp suffix).
   */
  public async listConfigBackups() {
    const dirContents = await readdir(this.configService.configBackupPath)

    return dirContents
      .filter(x => x.match(RE_CONFIG_BACKUP))
      .map((x) => {
        const ext = x.split('.')
        if (ext.length === 3 && !Number.isNaN(ext[2] as any)) {
          return {
            id: ext[2],
            timestamp: new Date(Number.parseInt(ext[2], 10)),
            file: x,
          }
        } else {
          return null
        }
      })
      .filter(x => x && !Number.isNaN(x.timestamp.getTime()))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  /**
   * Returns a config backup
   * @param backupId
   */
  public async getConfigBackup(backupId: number) {
    const requestedBackupPath = resolve(this.configService.configBackupPath, `config.json.${backupId}`)

    // Check backup file exists
    if (!await pathExists(requestedBackupPath)) {
      throw new NotFoundException(`Backup ${backupId} Not Found`)
    }

    // Read source backup
    return await readFile(requestedBackupPath)
  }

  /**
   * Delete a config backup
   * @param backupId
   */
  public async deleteConfigBackup(backupId: number) {
    const requestedBackupPath = resolve(this.configService.configBackupPath, `config.json.${backupId}`)

    // Check backup file exists
    if (!await pathExists(requestedBackupPath)) {
      throw new NotFoundException(`Backup ${backupId} Not Found`)
    }

    // Delete the backup file
    await unlink(resolve(this.configService.configBackupPath, `config.json.${backupId}`))
  }

  /**
   * Delete all config backups
   */
  public async deleteAllConfigBackups() {
    const backups = await this.listConfigBackups()

    // Delete each backup file
    for (const backupFile of backups) {
      await unlink(resolve(this.configService.configBackupPath, backupFile.file))
    }
  }

  /**
   * Ensure the backup file path exists
   */
  public async ensureBackupPathExists() {
    try {
      await ensureDir(this.configService.configBackupPath)
    } catch (e) {
      this.logger.error(`Could not create directory for config backups ${this.configService.configBackupPath} as ${e.message}.`)
      this.logger.error(`Config backups will continue to use ${this.configService.storagePath}.`)
      this.configService.configBackupPath = this.configService.storagePath
    }
  }

  /**
   * Remove config.json backup files older than 60 days
   */
  public async cleanupConfigBackups() {
    try {
      const backups = await this.listConfigBackups()

      for (const backup of backups) {
        if (dayjs().diff(dayjs(backup.timestamp), 'day') >= 60) {
          await remove(resolve(this.configService.configBackupPath, backup.file))
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to cleanup old config.json backup files as ${e.message}`)
    }
  }

  /**
   * This is a one-time script to move config.json.xxxxx backup files to the new location ./backups/config
   */
  private async migrateConfigBackups() {
    try {
      if (this.configService.configBackupPath === this.configService.storagePath) {
        this.logger.error('Skipping migration of existing config.json backups...')
        return
      }

      const dirContents = await readdir(this.configService.storagePath)

      const backups = dirContents
        .filter(x => x.match(RE_CONFIG_BACKUP))
        .sort((a, b) => {
          const ta = Number.parseInt(a.split('.')[2], 10)
          const tb = Number.parseInt(b.split('.')[2], 10)
          return tb - ta
        })

      // Move the last 100 to the new location
      for (const backupFileName of backups.splice(0, 100)) {
        const sourcePath = resolve(this.configService.storagePath, backupFileName)
        const targetPath = resolve(this.configService.configBackupPath, backupFileName)
        await move(sourcePath, targetPath, { overwrite: true })
      }

      // Delete the rest
      for (const backupFileName of backups) {
        const sourcePath = resolve(this.configService.storagePath, backupFileName)
        await remove(sourcePath)
      }
    } catch (e) {
      this.logger.warn(`Migrating config.json backups to new location failed as ${e.message}.`)
    }
  }
}
