import type { MultipartFile } from '@fastify/multipart'
import type { FastifyReply } from 'fastify'
import type { Readable } from 'node:stream'

import type { CreatedBackup } from './backup-scheduler.js'

import { EventEmitter } from 'node:events'
import { createReadStream, statSync } from 'node:fs'
import { lstat, mkdtemp, realpath } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common'
import { copy, pathExists, remove, writeJson } from 'fs-extra/esm'
import { create } from 'tar'

import { ConfigService } from '../../core/config/config.service.js'
import { green } from '../../core/logger/colors.js'
import { Logger } from '../../core/logger/logger.service.js'
import { RE_COLON } from '../../core/regex.constants.js'
import { PluginsService } from '../plugins/plugins.service.js'
import { assertUploadComplete, extractTarSafely, extractZipSafely } from './archive-safety.js'
import { BackupRestoreService } from './backup-restore.service.js'
import { BackupScheduler } from './backup-scheduler.js'
import { BACKUP_EXCLUDED_NAMES, BACKUP_FILE_MODE } from './backup.constants.js'

// Sentinel value placed in `restoreDirectory` between the moment an upload
// reserves the slot and the moment the temp dir is actually created. Lets
// concurrent requests detect a pending upload before `mkdtemp` resolves.
const RESTORE_PENDING = '__pending__'

/**
 * Backups of this instance: creating and downloading them, the scheduled
 * ones (BackupScheduler), and restoring one. A restore is staged in a single
 * temp directory (the restore slot) by an upload, then run by
 * BackupRestoreService.
 */
@Injectable()
export class BackupService {
  private restoreDirectory: string

  /** The path-validating .hbfx (zip) extractor - see archive-safety.ts */
  private readonly extractZipSafely = extractZipSafely

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(BackupScheduler) private readonly scheduler: BackupScheduler,
    @Inject(BackupRestoreService) private readonly restorer: BackupRestoreService,
  ) {
    this.scheduleInstanceBackups()
  }

  /**
   * Atomic check-and-set for the singleton restore slot. If another restore
   * already holds it (or is mid-upload), throw `ConflictException`. The set
   * happens synchronously before any `await`, so two concurrent uploads
   * cannot both pass this gate.
   */
  private reserveRestoreSlot(): void {
    if (this.restoreDirectory !== undefined) {
      throw new ConflictException('Another restore is already pending. Trigger or cancel it first.')
    }
    this.restoreDirectory = RESTORE_PENDING
  }

  /**
   * Take the restore slot, then extract an archive into a fresh temp
   * directory that becomes the pending restore. On any failure the slot is
   * released and the directory removed.
   * @param extractInto - extracts the archive into the directory, and
   * checks the result
   */
  private async stageRestore(extractInto: (dir: string) => Promise<void>): Promise<void> {
    // Reserve the singleton restore slot before any await so a concurrent
    // upload loses the race and 409s.
    this.reserveRestoreSlot()

    let restoreDir: string | undefined
    try {
      // Prepare a temp working directory
      restoreDir = await mkdtemp(join(tmpdir(), 'homebridge-backup-'))

      await extractInto(restoreDir)

      this.restoreDirectory = restoreDir
    } catch (err) {
      this.restoreDirectory = undefined
      if (restoreDir) {
        await remove(restoreDir).catch(() => undefined)
      }
      throw err
    }
  }

  /**
   * The extracted archive waiting to be restored. Throws when there is none.
   */
  private pendingRestoreDirectory(): string {
    if (!this.restoreDirectory || this.restoreDirectory === RESTORE_PENDING) {
      throw new BadRequestException()
    }
    return this.restoreDirectory
  }

  /**
   * Schedule the job to create an instance backup at recurring intervals
   */
  public scheduleInstanceBackups() {
    this.scheduler.schedule(() => this.runScheduledBackupJob())
  }

  /**
   * Re-register the scheduled-backup job — call after the
   * `scheduledBackupDisable` flag is mutated at runtime so the schedule
   * reflects the new setting without waiting for a UI restart.
   */
  public refreshBackupSchedule() {
    this.scheduleInstanceBackups()
  }

  /**
   * Creates the .tar.gz instance backup of the current Homebridge instance
   */
  private async createBackup(): Promise<CreatedBackup & { backupFileName: string }> {
    // Prepare a temp working directory
    const instanceId = this.configService.homebridgeConfig.bridge.username.replace(RE_COLON, '')
    const backupDir = await mkdtemp(join(tmpdir(), 'homebridge-backup-'))
    const backupFileName = `homebridge-backup-${instanceId}.${Date.now().toString()}.tar.gz`
    const backupPath = resolve(backupDir, backupFileName)

    this.logger.debug(`Creating temporary backup archive at ${backupPath}.`)

    try {
      // Resolve the real path of the storage directory (in case it's a symbolic link)
      const storagePath = await realpath(this.configService.storagePath)

      // Create a copy of the storage directory in the temp path
      await copy(storagePath, resolve(backupDir, 'storage'), {
        filter: async (filePath) => {
          // Files not to include in the archive (secrets, runtime and
          // packaging files - see BACKUP_EXCLUDED_NAMES)
          if (BACKUP_EXCLUDED_NAMES.includes(basename(filePath))) {
            return false
          }

          // Check each item is a real directory or real file (no symlinks, pipes, unix sockets etc.)
          try {
            const stat = await lstat(filePath)
            return (stat.isDirectory() || stat.isFile())
          } catch {
            // Gone or unreadable - nothing to archive
            return false
          }
        },
      })

      // Get full list of installed plugins
      const installedPlugins = await this.pluginsService.getInstalledPlugins()
      await writeJson(resolve(backupDir, 'plugins.json'), installedPlugins)

      // Create an info.json
      await writeJson(resolve(backupDir, 'info.json'), {
        timestamp: new Date().toISOString(),
        platform: platform(),
        uix: this.configService.package.version,
        node: process.version,
      })

      // Create a tarball of storage and plugins list
      await create({
        portable: true,
        gzip: true,
        file: backupPath,
        // The archive holds auth.json, HAP pairing keys and any SSL key
        mode: BACKUP_FILE_MODE,
        cwd: backupDir,
        filter: (filePath, stat) => {
          if (stat.size > globalThis.backup.maxBackupFileSize) {
            this.logger.warn(`Backup is skipping ${filePath} because it is larger than ${globalThis.backup.maxBackupFileSizeText}.`)
            return false
          }
          return true
        },
      }, [
        'storage',
        'plugins.json',
        'info.json',
      ])
      if (statSync(backupPath).size > globalThis.backup.maxBackupSize) {
        this.logger.error(`Backup file exceeds maximum restore file size (${globalThis.backup.maxBackupSizeText}) ${(statSync(backupPath).size / (1024 * 1024)).toFixed(1)}MB.`)
      }
    } catch (e) {
      this.logger.log(`Backup failed, removing ${backupDir}.`)
      await remove(resolve(backupDir))
      throw e
    }

    return {
      instanceId,
      backupDir,
      backupPath,
      backupFileName,
    }
  }

  /**
   * Ensures the scheduled backup path exists and is writable
   */
  async ensureScheduledBackupPath() {
    return this.scheduler.ensureScheduledBackupPath()
  }

  /**
   * Runs the job to create a scheduled backup
   */
  async runScheduledBackupJob() {
    return this.scheduler.runJob(() => this.createBackup())
  }

  /**
   * Get the time the next backup will run
   */
  async getNextBackupTime() {
    return this.scheduler.getNextBackupTime()
  }

  /**
   * List the instance backups saved on disk
   */
  async listScheduledBackups() {
    return this.scheduler.listScheduledBackups()
  }

  /**
   * Downloads a scheduled backup .tar.gz
   */
  async getScheduledBackup(backupId: string): Promise<StreamableFile> {
    const backupPath = await this.scheduler.resolveScheduledBackup(backupId)
    return new StreamableFile(createReadStream(backupPath))
  }

  /**
   * Removes a scheduled backup .tar.gz
   */
  async deleteScheduledBackup(backupId: string): Promise<void> {
    const backupPath = await this.scheduler.resolveScheduledBackup(backupId)

    try {
      await remove(backupPath)
      this.logger.warn(`Scheduled backup ${backupId} deleted by request.`)
    } catch (e) {
      this.logger.warn(`Failed to delete scheduled backup by request as ${e.message}.`)
      throw new InternalServerErrorException(e.message)
    }
  }

  /**
   * Restore a scheduled backup .tar.gz
   */
  async restoreScheduledBackup(backupId: string): Promise<void> {
    const backupPath = await this.scheduler.resolveScheduledBackup(backupId)

    // Pipe the data to the temp directory
    await this.stageRestore(dir => extractTarSafely(createReadStream(backupPath), dir))
  }

  /**
   * Create and download backup archive of the current homebridge instance
   */
  async downloadBackup(reply: FastifyReply): Promise<StreamableFile> {
    const { backupDir, backupPath, backupFileName } = await this.createBackup()

    // Set download headers
    reply.raw.setHeader('Content-type', 'application/octet-stream')
    reply.raw.setHeader('Content-disposition', `attachment; filename=${backupFileName}`)
    reply.raw.setHeader('File-Name', backupFileName)

    // For dev only
    if (reply.request.hostname === 'localhost:8080') {
      reply.raw.setHeader('access-control-allow-origin', 'http://localhost:4200')
    }

    return new StreamableFile(createReadStream(backupPath).on('close', () => remove(resolve(backupDir))))
  }

  /**
   * Create a backup file and save it in the backup directory
   */
  async createBackupInDirectory(): Promise<void> {
    // Ensure backup path exists
    try {
      await this.ensureScheduledBackupPath()
    } catch (error) {
      this.logger.error(`Create backup failed: ${error.message}`)
      throw new NotFoundException()
    }

    try {
      const { backupDir, backupPath, instanceId } = await this.createBackup()

      await this.scheduler.saveToInstanceBackupPath(backupPath, instanceId)

      await remove(resolve(backupDir))
    } catch (error) {
      this.logger.error(`Create backup failed: ${error.message}`)
      throw new InternalServerErrorException(error.message)
    }
  }

  /**
   * Restore a backup file
   * File upload handler
   */
  async uploadBackupRestore(data: MultipartFile) {
    // Pipe the data to the temp directory
    await this.stageRestore(async (dir) => {
      await extractTarSafely(data.file as Readable, dir)
      assertUploadComplete(data)
    })
  }

  /**
   * Removes the temporary directory used for the restore and releases the
   * singleton restore slot so a subsequent upload can succeed.
   */
  async removeRestoreDirectory() {
    const dir = this.restoreDirectory
    this.restoreDirectory = undefined
    if (dir && dir !== RESTORE_PENDING) {
      return await remove(dir)
    }
  }

  /**
   * Do an offline restore
   */
  async triggerHeadlessRestore() {
    if (
      !this.restoreDirectory
      || this.restoreDirectory === RESTORE_PENDING
      || !await pathExists(this.restoreDirectory)
    ) {
      throw new BadRequestException('No backup file uploaded')
    }

    const client = new EventEmitter()

    client.on('stdout', (data) => {
      this.logger.log(data)
    })
    client.on('stderr', (data) => {
      this.logger.log(data)
    })

    await this.restoreFromBackup(client, true)

    return { status: 0 }
  }

  /**
   * Restores the uploaded backup
   */
  async restoreFromBackup(client: EventEmitter, autoRestart = false) {
    const dir = this.pendingRestoreDirectory()

    await this.restorer.restoreInstanceBackup(dir, client, () => this.removeRestoreDirectory())
    await this.finishRestore(client)

    // Auto restart if told to
    if (autoRestart) {
      this.postBackupRestoreRestart()
    }

    return { status: 0 }
  }

  /**
   * Upload a .hbfx backup file
   */
  async uploadHbfxRestore(data: MultipartFile) {
    await this.stageRestore(async (dir) => {
      this.logger.log(`Extracting .hbfx file to ${dir}.`)

      // Pipe the data through a path-validating extractor so a crafted .hbfx
      // can't write outside the restore directory (Zip Slip).
      await this.extractZipSafely(data.file as Readable, dir)
      assertUploadComplete(data)
    })
  }

  /**
   * Restore .hbfx backup file
   */
  async restoreHbfxBackup(client: EventEmitter) {
    const dir = this.pendingRestoreDirectory()

    await this.restorer.restoreHbfxBackup(dir, client, () => this.removeRestoreDirectory())
    await this.finishRestore(client)

    return { status: 0 }
  }

  /**
   * The last step of every restore: release the slot and its temp files, and
   * have hb-service restart the UI with the restored setup
   */
  private async finishRestore(client: EventEmitter) {
    // Remove temp files
    await this.removeRestoreDirectory()

    client.emit('stdout', green('\r\nRestore Complete!\r\n'))

    // Ensure ui is restarted on next restart
    this.configService.hbServiceUiRestartRequired = true
  }

  /**
   * Send SIGKILL to Homebridge to prevent accessory cache being re-generated on shutdown
   */
  postBackupRestoreRestart() {
    return this.restorer.restartAfterRestore()
  }
}
