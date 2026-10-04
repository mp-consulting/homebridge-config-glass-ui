import { Buffer } from 'node:buffer'
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { redactSecrets, redactText } from '@mp-consulting/homebridge-ai-kit'
import { Inject, Injectable } from '@nestjs/common'

import { ConfigService } from '../config/config.service.js'
import { Logger } from '../logger/logger.service.js'

/** The directory, in the storage path, the audit log is kept in (owner-only). */
export const AUDIT_DIR = '.uix-audit'
export const AUDIT_FILE = 'audit.jsonl'
/** The current file is rotated once it would grow past this. */
export const AUDIT_MAX_BYTES = 2 * 1024 * 1024
/** Rotated files kept besides the current one (`audit.1.jsonl` is the newest). */
export const AUDIT_MAX_ROTATED = 4
/** Longest `details` kept per entry, as JSON. */
const MAX_DETAILS_CHARS = 4000

/** How the actor authenticated. */
export type AuditVia = 'session' | 'api-token' | 'service' | 'system'

export interface AuditActor {
  username: string
  via: AuditVia
  admin?: boolean
  /** The API token's id, for `via: 'api-token'`. */
  tokenId?: string
}

export interface AuditEntry {
  /** ISO time. */
  at: string
  /** Dotted action name, e.g. `config.save`, `plugin.install`, `assistant.tool`. */
  action: string
  actor: AuditActor
  ok: boolean
  /** What the action was about (a plugin name, a token id, a tool name). */
  target?: string
  /** Redacted, size-capped extra facts. */
  details?: Record<string, unknown>
  error?: string
  ip?: string
}

export type AuditRecord = Omit<AuditEntry, 'at'> & { at?: string }

export interface AuditQuery {
  page?: number
  limit?: number
  /** Only actions equal to, or under (`plugin` matches `plugin.install`), this. */
  action?: string
  username?: string
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  limit: number
}

/** The user the auth guards put on a request or a socket. */
export function auditActor(user: Record<string, unknown> | undefined | null): AuditActor {
  if (!user) {
    return { username: '(anonymous)', via: 'system' }
  }
  const username = typeof user.username === 'string' && user.username ? user.username : '(unknown)'
  if (typeof user.apiTokenId === 'string') {
    return { username, via: 'api-token', admin: user.admin === true, tokenId: user.apiTokenId }
  }
  if (user.service !== undefined) {
    return { username: typeof user.service === 'string' ? `service:${user.service}` : username, via: 'service', admin: user.admin === true }
  }
  return { username, via: 'session', admin: user.admin === true }
}

/** Secrets out (by key name and by shape), capped in size. */
export function redactDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details || !Object.keys(details).length) {
    return undefined
  }
  const redacted = redactStrings(redactSecrets(details)) as Record<string, unknown>
  const json = JSON.stringify(redacted) ?? '{}'
  if (json.length <= MAX_DETAILS_CHARS) {
    return redacted
  }
  return { truncated: true, json: json.slice(0, MAX_DETAILS_CHARS) }
}

/** Credential shapes out of every string, however deep. */
function redactStrings(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return redactText(value)
  }
  if (depth > 20 || value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => redactStrings(item, depth + 1))
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item, depth + 1)]))
}

/**
 * An append-only JSONL log of security-relevant actions: Assistant tool
 * calls, API token creation and revocation, writes made with an API token,
 * config saves, plugin installs, updates and removals, restarts and backup
 * restores. One JSON object a line in `<storage>/.uix-audit/audit.jsonl`,
 * rotated by size (AUDIT_MAX_BYTES, AUDIT_MAX_ROTATED older files). Writes
 * are queued so lines never interleave; a write that fails is logged and
 * never fails the action itself.
 */
@Injectable()
export class AuditService {
  public readonly dir: string
  public readonly file: string
  private queue: Promise<void> = Promise.resolve()
  /** Overridable in tests. */
  public maxBytes = AUDIT_MAX_BYTES

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.dir = resolve(this.configService.storagePath, AUDIT_DIR)
    this.file = join(this.dir, AUDIT_FILE)
  }

  /** Append an entry. Resolves once it is written (or failed and was logged). */
  record(record: AuditRecord): Promise<void> {
    let line: string
    try {
      line = this.serialize(record)
    } catch (e) {
      this.logger.warn(`Failed to write the audit log as ${(e as Error)?.message ?? e}.`)
      return this.queue
    }
    this.queue = this.queue.then(() => this.append(line)).catch((e) => {
      this.logger.warn(`Failed to write the audit log as ${e?.message ?? e}.`)
    })
    return this.queue
  }

  private serialize(record: AuditRecord): string {
    const entry: AuditEntry = {
      at: record.at ?? new Date().toISOString(),
      action: record.action,
      actor: record.actor,
      ok: record.ok,
      ...(record.target ? { target: String(record.target).slice(0, 300) } : {}),
      ...(record.details ? { details: redactDetails(record.details) } : {}),
      ...(record.error ? { error: redactText(String(record.error)).slice(0, 500) } : {}),
      ...(record.ip ? { ip: record.ip } : {}),
    }
    if (!entry.details) {
      delete entry.details
    }
    return `${JSON.stringify(entry)}\n`
  }

  private rotatedPath(n: number): string {
    return join(this.dir, `audit.${n}.jsonl`)
  }

  private async append(line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    let size = 0
    try {
      size = (await stat(this.file)).size
    } catch {
      // No file yet
    }
    if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) {
      await this.rotate()
    }
    await appendFile(this.file, line, { mode: 0o600 })
  }

  private async rotate(): Promise<void> {
    await rm(this.rotatedPath(AUDIT_MAX_ROTATED), { force: true })
    for (let n = AUDIT_MAX_ROTATED - 1; n >= 1; n--) {
      await rename(this.rotatedPath(n), this.rotatedPath(n + 1)).catch(() => undefined)
    }
    await rename(this.file, this.rotatedPath(1))
  }

  /** Every entry, newest first, across the current and rotated files. */
  private async readAll(): Promise<AuditEntry[]> {
    await this.queue
    const files = [this.file]
    for (let n = 1; n <= AUDIT_MAX_ROTATED; n++) {
      files.push(this.rotatedPath(n))
    }
    const entries: AuditEntry[] = []
    for (const file of files) {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n').filter(Boolean).reverse()
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line))
        } catch {
          // A torn line (crash mid-write) is skipped
        }
      }
    }
    return entries
  }

  /** A page of entries, newest first. */
  async list(query: AuditQuery = {}): Promise<AuditPage> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 500)
    const page = Math.max(Math.trunc(query.page ?? 1), 1)
    let entries = await this.readAll()
    if (query.action) {
      const action = query.action
      entries = entries.filter(entry => entry.action === action || entry.action?.startsWith(`${action}.`))
    }
    if (query.username) {
      const username = query.username.toLowerCase()
      entries = entries.filter(entry => entry.actor?.username?.toLowerCase() === username)
    }
    return { entries: entries.slice((page - 1) * limit, page * limit), total: entries.length, page, limit }
  }
}
