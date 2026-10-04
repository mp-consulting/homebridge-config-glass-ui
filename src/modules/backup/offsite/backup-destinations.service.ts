import type { RemoteDestination } from './remote-destination.js'
import type { S3Config } from './s3-client.js'
import type { WebDavConfig } from './webdav-client.js'

import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable } from '@nestjs/common'

import { ConfigService } from '../../../core/config/config.service.js'
import { JsonFileStoreService } from '../../../core/fs/json-file-store.service.js'
import { Logger } from '../../../core/logger/logger.service.js'
import { RE_BACKUP_FILENAME } from '../../../core/regex.constants.js'
import { S3Client } from './s3-client.js'
import { WebDavClient } from './webdav-client.js'

export type DestinationName = 'webdav' | 's3'
export const DESTINATION_NAMES: DestinationName[] = ['webdav', 's3']

/** The most copies kept anywhere. */
export const MAX_KEEP = 365
export const DEFAULT_REMOTE_KEEP = 7

export interface BackupDestinationSettings {
  /**
   * Keep this many scheduled backups locally (the newest). Null keeps the
   * ones from the last 7 days, as before this setting.
   */
  keepLocal: number | null
  webdav: WebDavConfig & { enabled: boolean, keep: number }
  s3: S3Config & { enabled: boolean, keep: number }
}

export interface DestinationResult {
  destination: DestinationName
  ok: boolean
  error?: string
  /** The copies removed by the retention. */
  removed?: number
}

interface StoredFile extends BackupDestinationSettings {
  lastRun?: { at: string, fileName: string, results: DestinationResult[] }
}

export const SECRET_PLACEHOLDER = '********'
const SECRETS: { [D in DestinationName]: string[] } = { webdav: ['password'], s3: ['secretAccessKey'] }
const HTTP_URL = /^https?:\/\/[^\s/?#]\S*$/i

export function defaultDestinationSettings(): BackupDestinationSettings {
  return {
    keepLocal: null,
    webdav: { enabled: false, url: '', username: '', password: '', keep: DEFAULT_REMOTE_KEEP },
    s3: { enabled: false, endpoint: '', region: 'us-east-1', bucket: '', prefix: 'homebridge/', accessKeyId: '', secretAccessKey: '', forcePathStyle: true, keep: DEFAULT_REMOTE_KEEP },
  }
}

/**
 * Off-site copies of the scheduled backups, and how many copies are kept.
 * The settings live in `.uix-backup-destinations.json` in the storage
 * directory (owner-only); the WebDAV password and S3 secret key are never
 * sent back to the browser. After each scheduled backup the archive is
 * uploaded to every enabled destination, then each keeps its `keep` newest
 * backups (of this instance's file names only).
 */
@Injectable()
export class BackupDestinationsService {
  public readonly filePath: string
  private cached: StoredFile | null = null

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly store: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.filePath = resolve(this.configService.storagePath, '.uix-backup-destinations.json')
  }

  private async load(): Promise<StoredFile> {
    if (this.cached) {
      return this.cached
    }
    const defaults = defaultDestinationSettings()
    let stored: Partial<StoredFile> | null = null
    try {
      stored = await this.store.read<StoredFile>(this.filePath)
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read the backup destinations as ${e.message}.`)
      }
    }
    this.cached = {
      keepLocal: Number.isInteger(stored?.keepLocal) && stored!.keepLocal! >= 1 ? Math.min(stored!.keepLocal!, MAX_KEEP) : null,
      webdav: { ...defaults.webdav, ...(stored?.webdav ?? {}) },
      s3: { ...defaults.s3, ...(stored?.s3 ?? {}) },
      lastRun: stored?.lastRun,
    }
    return this.cached
  }

  private async save(next: StoredFile): Promise<void> {
    await this.store.write(this.filePath, next, { spaces: 2 })
    this.cached = next
  }

  private redact(settings: BackupDestinationSettings): BackupDestinationSettings {
    const copy = structuredClone(settings)
    for (const name of DESTINATION_NAMES) {
      for (const field of SECRETS[name]) {
        const target = copy[name] as unknown as Record<string, string>
        target[field] = target[field] ? SECRET_PLACEHOLDER : ''
      }
    }
    return copy
  }

  /** The settings as the browser sees them, with the last run's results. */
  public async getSettings(): Promise<BackupDestinationSettings & { lastRun: StoredFile['lastRun'] | null }> {
    const { lastRun, ...settings } = await this.load()
    return { ...this.redact(settings), lastRun: lastRun ?? null }
  }

  public async getKeepLocal(): Promise<number | null> {
    return (await this.load()).keepLocal
  }

  /**
   * Merge the given settings over the stored ones (a secret sent back as
   * `********` keeps the stored value) and validate them.
   */
  private merge(current: BackupDestinationSettings, input: unknown): BackupDestinationSettings {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Expected an object.')
    }
    const body = input as Record<string, unknown>
    const next = structuredClone(current)

    if (body.keepLocal !== undefined) {
      if (body.keepLocal !== null && (!Number.isInteger(body.keepLocal) || (body.keepLocal as number) < 1 || (body.keepLocal as number) > MAX_KEEP)) {
        throw new BadRequestException(`keepLocal must be null or a whole number from 1 to ${MAX_KEEP}.`)
      }
      next.keepLocal = body.keepLocal as number | null
    }

    for (const name of DESTINATION_NAMES) {
      const given = body[name]
      if (given === undefined) {
        continue
      }
      if (!given || typeof given !== 'object') {
        throw new BadRequestException(`Invalid ${name} settings.`)
      }
      const target = next[name] as unknown as Record<string, unknown>
      for (const [field, value] of Object.entries(given as Record<string, unknown>)) {
        // A DTO instance carries the fields it was not given as undefined
        if (!(field in target) || value === undefined) {
          continue
        }
        const expected = typeof target[field]
        if (expected === 'boolean' || expected === 'number') {
          const matches = expected === 'boolean' ? typeof value === 'boolean' : typeof value === 'number'
          if (!matches) {
            throw new BadRequestException(`${name}.${field} must be a ${expected}.`)
          }
          target[field] = value
          continue
        }
        if (typeof value !== 'string' || value.length > 2048) {
          throw new BadRequestException(`Invalid ${name}.${field}.`)
        }
        if (SECRETS[name].includes(field) && value === SECRET_PLACEHOLDER) {
          continue
        }
        target[field] = field === 'password' || field === 'secretAccessKey' ? value : value.trim()
      }
    }
    this.validate(next)
    return next
  }

  private validate(settings: BackupDestinationSettings): void {
    const fail = (message: string) => {
      throw new BadRequestException(message)
    }
    const { webdav, s3 } = settings
    for (const [name, keep] of [['webdav', webdav.keep], ['s3', s3.keep]] as const) {
      if (!Number.isInteger(keep) || keep < 1 || keep > MAX_KEEP) {
        fail(`${name}.keep must be a whole number from 1 to ${MAX_KEEP}.`)
      }
    }
    if (webdav.url && !HTTP_URL.test(webdav.url)) {
      fail('The WebDAV URL must be an http(s) URL.')
    }
    if (webdav.enabled && !webdav.url) {
      fail('WebDAV is enabled but has no URL.')
    }
    if (s3.endpoint && !HTTP_URL.test(s3.endpoint)) {
      fail('The S3 endpoint must be an http(s) URL.')
    }
    if (s3.bucket && !/^[a-z0-9][\w.-]{1,62}$/i.test(s3.bucket)) {
      fail('Invalid S3 bucket name.')
    }
    if (s3.region && !/^[\w-]{1,64}$/.test(s3.region)) {
      fail('Invalid S3 region.')
    }
    if (s3.prefix && (s3.prefix.includes('..') || !/^[\w./ -]{0,256}$/.test(s3.prefix))) {
      fail('Invalid S3 folder (prefix).')
    }
    if (s3.enabled && !(s3.endpoint && s3.bucket && s3.region && s3.accessKeyId && s3.secretAccessKey)) {
      fail('S3 is enabled but not fully set up (endpoint, region, bucket and both keys).')
    }
  }

  public async updateSettings(input: unknown) {
    const current = await this.load()
    const next = this.merge(current, input)
    await this.save({ ...next, lastRun: current.lastRun })
    return this.getSettings()
  }

  private client(name: DestinationName, settings: BackupDestinationSettings): RemoteDestination {
    return name === 'webdav' ? new WebDavClient(settings.webdav) : new S3Client(settings.s3)
  }

  /** Error text without the destination's secrets. */
  private scrub(message: string, settings: BackupDestinationSettings): string {
    let text = String(message)
    for (const secret of [settings.webdav.password, settings.s3.secretAccessKey]) {
      if (secret) {
        text = text.split(secret).join(SECRET_PLACEHOLDER)
      }
    }
    return text.slice(0, 300)
  }

  /**
   * Check a destination can be reached, with the stored settings or the
   * given (unsaved) ones merged over them.
   */
  public async test(destination: unknown, settings?: unknown): Promise<DestinationResult> {
    if (!DESTINATION_NAMES.includes(destination as DestinationName)) {
      throw new BadRequestException('Unknown destination.')
    }
    const name = destination as DestinationName
    const current = await this.load()
    const merged = settings === undefined ? current : this.merge(current, { [name]: settings })
    if (name === 'webdav' ? !merged.webdav.url : !(merged.s3.endpoint && merged.s3.bucket && merged.s3.accessKeyId && merged.s3.secretAccessKey)) {
      throw new BadRequestException(`The ${name} destination is not set up.`)
    }
    try {
      await this.client(name, merged).test()
      return { destination: name, ok: true }
    } catch (e) {
      return { destination: name, ok: false, error: this.scrub(e?.cause?.message ? `${e.message}: ${e.cause.message}` : e?.message ?? e, merged) }
    }
  }

  /**
   * After a scheduled backup: upload the archive to every enabled
   * destination and apply its retention. Never throws.
   * @param localPath - the archive in the instance backup path
   * @param fileName - its name, also used remotely
   * @param instanceId - only this instance's backups are counted and pruned
   */
  public async afterBackup(localPath: string, fileName: string, instanceId: string): Promise<DestinationResult[]> {
    const settings = await this.load()
    const results: DestinationResult[] = []
    for (const name of DESTINATION_NAMES) {
      if (!settings[name].enabled) {
        continue
      }
      const client = this.client(name, settings)
      try {
        await client.upload(localPath, fileName)
        const removed = await this.prune(client, settings[name].keep, instanceId)
        this.logger.log(`Uploaded the scheduled backup to ${name}${removed ? ` (removed ${removed} older)` : ''}.`)
        results.push({ destination: name, ok: true, removed })
      } catch (e) {
        const error = this.scrub(e?.cause?.message ? `${e.message}: ${e.cause.message}` : e?.message ?? e, settings)
        this.logger.warn(`Failed to upload the scheduled backup to ${name} as ${error}.`)
        results.push({ destination: name, ok: false, error })
      }
    }
    if (results.length) {
      try {
        await this.save({ ...(await this.load()), lastRun: { at: new Date().toISOString(), fileName, results } })
      } catch (e) {
        this.logger.warn(`Failed to save the backup upload results as ${e.message}.`)
      }
    }
    return results
  }

  /** Delete all but the `keep` newest of this instance's backups at a destination. */
  private async prune(client: RemoteDestination, keep: number, instanceId: string): Promise<number> {
    const ours = (await client.list())
      .filter(file => RE_BACKUP_FILENAME.test(file.name) && file.name.startsWith(`homebridge-backup-${instanceId}.`))
      .sort((a, b) => backupTime(b.name) - backupTime(a.name))
    let removed = 0
    for (const file of ours.slice(keep)) {
      await client.delete(file.name)
      removed++
    }
    return removed
  }
}

/** The timestamp in `homebridge-backup-<id>.<ms>.tar.gz`. */
export function backupTime(name: string): number {
  return Number(name.split('.')[1]) || 0
}
