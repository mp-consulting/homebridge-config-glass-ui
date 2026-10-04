import { constants, statSync } from 'node:fs'
import { access, chmod, readdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import dayjs from 'dayjs'
import { copy, ensureDir, pathExists, remove } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { AppEventsService } from '../../core/events/app-events.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { RE_BACKUP_FILENAME, RE_BACKUP_ID } from '../../core/regex.constants.js'
import { SchedulerService } from '../../core/scheduler/scheduler.service.js'
import { BACKUP_DIR_MODE, BACKUP_FILE_MODE } from './backup.constants.js'
import { BackupDestinationsService } from './offsite/backup-destinations.service.js'

const JOB_NAME = 'instance-backup'

/** How long scheduled backups are kept */
const RETENTION_DAYS = 7

/** A finished archive in a temp directory (see BackupService.createBackup) */
export interface CreatedBackup {
  instanceId: string
  backupDir: string
  backupPath: string
}

/**
 * The scheduled instance backups: the daily job, the instance backup path,
 * the archives saved in it and their retention.
 */
@Injectable()
export class BackupScheduler {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(SchedulerService) private readonly schedulerService: SchedulerService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(AppEventsService) private readonly events: AppEventsService,
    @Inject(BackupDestinationsService) private readonly destinations: BackupDestinationsService,
  ) {}

  /**
   * Schedule the job to create an instance backup at recurring intervals
   * @param runJob - the job to run
   */
  schedule(runJob: () => Promise<void>) {
    // Always cancel any existing job first so this method is safe to
    // call from a runtime toggle. Without this, toggling
    // scheduledBackupDisable to true at runtime would leave the
    // previously scheduled job firing until the next UI restart.
    this.schedulerService.cancelJob(JOB_NAME)

    if (this.configService.ui.scheduledBackupDisable === true) {
      this.logger.debug('Scheduled backups disabled.')
      return
    }

    const scheduleRule = new this.schedulerService.RecurrenceRule()
    scheduleRule.hour = Math.floor(Math.random() * 7)
    scheduleRule.minute = Math.floor(Math.random() * 59)
    scheduleRule.second = Math.floor(Math.random() * 59)

    this.schedulerService.scheduleJob(JOB_NAME, scheduleRule, () => {
      this.logger.debug('Running scheduled instance backup...')
      runJob().catch((e) => {
        this.logger.error(`Scheduled instance backup failed as ${e?.message || e}.`)
        this.events.emit('backupFailed', { message: String(e?.message || e) })
      })
    })
  }

  /**
   * Runs the job to create a scheduled backup: save it in the instance backup
   * path, upload it to the off-site destinations, then apply the retention.
   * Never throws: a failure is logged and reported as `backupFailed`, a
   * success as `backupSucceeded`.
   * @param createBackup - builds the archive in a temp directory
   */
  async runJob(createBackup: () => Promise<CreatedBackup>) {
    // Ensure backup path exists
    try {
      await this.ensureScheduledBackupPath()
    } catch (e) {
      this.logger.warn(`Could not run scheduled backup as ${e.message}.`)
      this.events.emit('backupFailed', { message: String(e?.message || e) })
      return
    }

    // Create the backup
    let saved: { target: string, instanceId: string } | null = null
    try {
      const { backupDir, backupPath, instanceId } = await createBackup()
      saved = { target: await this.saveToInstanceBackupPath(backupPath, instanceId), instanceId }
      await remove(resolve(backupDir))
    } catch (e) {
      this.logger.warn(`Failed to create scheduled instance backup as ${e.message}.`)
      this.events.emit('backupFailed', { message: String(e?.message || e) })
    }

    // Copy it off-site
    if (saved) {
      const fileName = basename(saved.target)
      const uploads = await this.destinations.afterBackup(saved.target, fileName, saved.instanceId)
      const failed = uploads.filter(upload => !upload.ok)
      if (failed.length) {
        this.events.emit('backupFailed', { message: `the backup was saved, but the upload failed: ${failed.map(upload => `${upload.destination}: ${upload.error}`).join('; ')}` })
      } else {
        this.events.emit('backupSucceeded', { fileName, uploads })
      }
    }

    // Retention: the newest `keepLocal`, or the last RETENTION_DAYS days
    try {
      const keepLocal = await this.destinations.getKeepLocal()
      const backups = await this.listScheduledBackups()

      // Newest first; counted per instance (a shared custom path can hold several)
      const seen = new Map<string, number>()
      for (const backup of backups) {
        const index = seen.get(backup.instanceId) ?? 0
        seen.set(backup.instanceId, index + 1)
        const old = keepLocal ? index >= keepLocal : dayjs().diff(dayjs(backup.timestamp), 'day') >= RETENTION_DAYS
        if (old) {
          await remove(resolve(this.configService.instanceBackupPath, backup.fileName))
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to remove old backups as ${e.message}.`)
    }
  }

  /**
   * Get the time the next backup will run
   */
  getNextBackupTime() {
    if (this.configService.ui.scheduledBackupDisable === true) {
      return {
        next: false,
      }
    } else {
      return {
        next: this.schedulerService.scheduledJobs[JOB_NAME]?.nextInvocation() || false,
      }
    }
  }

  /**
   * Ensures the scheduled backup path exists and is writable
   */
  async ensureScheduledBackupPath() {
    if (this.configService.ui.scheduledBackupPath) {
      // If using a custom backup path, check it exists
      if (!await pathExists(this.configService.instanceBackupPath)) {
        throw new Error('Custom instance backup path does not exist')
      }

      try {
        await access(this.configService.instanceBackupPath, constants.W_OK | constants.R_OK)
      } catch (e) {
        throw new Error(`Custom instance backup path is not writable / readable by service: ${e.message}`)
      }
    } else {
      // When not using a custom backup path, ensure it exists and only the
      // service user can read the archives in it
      await ensureDir(this.configService.instanceBackupPath, { mode: BACKUP_DIR_MODE })
      await chmod(this.configService.instanceBackupPath, BACKUP_DIR_MODE).catch(() => undefined)
    }
  }

  /**
   * Copy a finished archive into the instance backup path, readable by the
   * service user only (a custom path may be a shared directory).
   */
  async saveToInstanceBackupPath(backupPath: string, instanceId: string): Promise<string> {
    const target = resolve(
      this.configService.instanceBackupPath,
      `homebridge-backup-${instanceId}.${Date.now().toString()}.tar.gz`,
    )
    await copy(backupPath, target)
    await chmod(target, BACKUP_FILE_MODE).catch(() => undefined)
    return target
  }

  /**
   * List the instance backups saved on disk
   */
  async listScheduledBackups() {
    // Ensure backup path exists
    try {
      await this.ensureScheduledBackupPath()

      const dirContents = await readdir(this.configService.instanceBackupPath, { withFileTypes: true })
      return dirContents
        .filter(x => x.isFile() && x.name.match(RE_BACKUP_FILENAME))
        .map((x) => {
          const split = x.name.split('.')
          const instanceId = split[0].split('-')[2]
          if (split.length === 4 && !Number.isNaN(split[1] as any)) {
            return {
              id: `${instanceId}.${split[1]}`,
              instanceId: split[0].split('-')[2],
              timestamp: new Date(Number.parseInt(split[1], 10)),
              fileName: x.name,
              size: (statSync(`${this.configService.instanceBackupPath}/${x.name}`).size / (1024 * 1024)).toFixed(1),
              maxBackupSize: globalThis.backup.maxBackupSize / (1024 * 1024),
              maxBackupSizeText: globalThis.backup.maxBackupSizeText,
            }
          } else {
            return null
          }
        })
        .filter(x => x !== null)
        .sort((a, b) => {
          if (a.id > b.id) {
            return -1
          } else if (a.id < b.id) {
            return 1
          } else {
            return 0
          }
        })
    } catch (e) {
      this.logger.warn(`Could not get scheduled backups as ${e.message}.`)
      throw new InternalServerErrorException(e.message)
    }
  }

  /**
   * The path of an existing scheduled backup. Throws for a malformed id, or
   * one that resolves outside the instance backup path, and when the file
   * does not exist.
   */
  async resolveScheduledBackup(backupId: string): Promise<string> {
    if (!RE_BACKUP_ID.test(backupId)) {
      throw new BadRequestException('Invalid backup ID.')
    }

    const backupPath = resolve(this.configService.instanceBackupPath, `homebridge-backup-${backupId}.tar.gz`)
    if (!backupPath.startsWith(this.configService.instanceBackupPath)) {
      throw new BadRequestException('Invalid backup ID.')
    }

    // Check the file exists
    if (!await pathExists(backupPath)) {
      throw new NotFoundException()
    }

    return backupPath
  }
}
