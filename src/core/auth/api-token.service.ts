import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { ConfigService } from '../config/config.service.js'
import { JsonFileStoreService } from '../fs/json-file-store.service.js'
import { Logger } from '../logger/logger.service.js'
import { API_TOKEN_MAX_EXPIRY_DAYS, API_TOKEN_PREFIX, API_TOKEN_SCOPES, ApiTokenScope, isApiToken } from './api-token.constants.js'
import { revalidateWsClients } from './guards/ws-auth.js'

/** What the store keeps: the token itself is never written, only its sha256. */
interface StoredApiToken {
  id: string
  name: string
  scope: ApiTokenScope
  hash: string
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdBy?: string
}

/** A token as listed to administrators */
export interface ApiTokenView {
  id: string
  name: string
  scope: ApiTokenScope
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdBy?: string
}

/** The one response that carries the token in clear */
export interface CreatedApiToken {
  id: string
  name: string
  scope: ApiTokenScope
  token: string
  createdAt: string
  expiresAt: string | null
}

/**
 * The `req.user` / `client.data.user` an API token authenticates as. It names
 * no account in auth.json, so session refresh, logout and the "own account"
 * endpoints have nothing to act on.
 */
export interface ApiTokenUser {
  username: string
  name: string
  admin: boolean
  apiTokenId: string
  apiTokenScope: ApiTokenScope
}

/** How often a token's `lastUsedAt` is written back, at most */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000

/** How long the token file is cached for per-request validation (edits made outside this process) */
const CACHE_TTL_MS = 5 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toView(token: StoredApiToken): ApiTokenView {
  return {
    id: token.id,
    name: token.name,
    scope: token.scope,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    ...(token.createdBy ? { createdBy: token.createdBy } : {}),
  }
}

/**
 * Long-lived API tokens (`hbg_…`) for scripts and the Assistant's MCP server.
 *
 * Stored hashed in `<storagePath>/.uix-api-tokens.json` through the same
 * locked, atomic JSON store as auth.json. A `read` token authenticates as a
 * non-admin user limited to GET/HEAD; an `admin` token as an administrator.
 */
@Injectable()
export class ApiTokenService {
  public readonly tokensPath: string

  private cache: { tokens: StoredApiToken[], loadedAt: number } | undefined

  // When each token's lastUsedAt was last persisted (epoch ms)
  private readonly lastUsedWrites = new Map<string, number>()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.tokensPath = resolve(this.configService.storagePath, '.uix-api-tokens.json')
  }

  /**
   * Every token, newest first, without their hashes
   */
  async list(): Promise<ApiTokenView[]> {
    const tokens = await this.readTokens()
    return tokens
      .map(toView)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Create a token. The clear value is returned once and never stored.
   */
  async create(
    input: { name: string, scope: ApiTokenScope, expiresInDays?: number | null },
    createdBy?: string,
  ): Promise<CreatedApiToken> {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) {
      throw new BadRequestException('Token name is required.')
    }
    if (!API_TOKEN_SCOPES.includes(input.scope)) {
      throw new BadRequestException('Token scope must be "read" or "admin".')
    }
    const days = input.expiresInDays
    if (days !== undefined && days !== null
      && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > API_TOKEN_MAX_EXPIRY_DAYS)) {
      throw new BadRequestException(`expiresInDays must be a whole number between 1 and ${API_TOKEN_MAX_EXPIRY_DAYS}, or null.`)
    }

    const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const now = new Date()
    const stored: StoredApiToken = {
      id: randomUUID(),
      name,
      scope: input.scope,
      hash: hashToken(token),
      createdAt: now.toISOString(),
      expiresAt: typeof days === 'number' ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString() : null,
      lastUsedAt: null,
      ...(createdBy ? { createdBy } : {}),
    }

    await this.mutate((tokens) => {
      tokens.push(stored)
    })
    this.logger.warn(`Created API token "${name}" (${stored.scope}${createdBy ? `, by ${createdBy}` : ''}).`)

    return {
      id: stored.id,
      name: stored.name,
      scope: stored.scope,
      token,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    }
  }

  /**
   * Revoke (delete) a token. Sockets standing on it are disconnected.
   */
  async revoke(id: string): Promise<void> {
    let removed: StoredApiToken | undefined
    await this.mutate((tokens) => {
      const index = tokens.findIndex(x => x.id === id)
      if (index < 0) {
        throw new NotFoundException('API token not found.')
      }
      removed = tokens.splice(index, 1)[0]
    })
    this.lastUsedWrites.delete(id)
    this.logger.warn(`Revoked API token "${removed?.name}".`)
    void revalidateWsClients()
  }

  /**
   * Resolve a bearer value to the user it authenticates as, or null when it is
   * unknown, revoked or expired.
   */
  async validate(token: string): Promise<ApiTokenUser | null> {
    if (!isApiToken(token)) {
      return null
    }
    const hash = hashToken(token)
    const stored = (await this.readTokens(true)).find(x => x.hash === hash)
    if (!stored) {
      return null
    }
    if (stored.expiresAt && Date.parse(stored.expiresAt) <= Date.now()) {
      return null
    }

    this.touch(stored)

    return {
      username: `api-token:${stored.id}`,
      name: stored.name,
      admin: stored.scope === 'admin',
      apiTokenId: stored.id,
      apiTokenScope: stored.scope,
    }
  }

  /**
   * Record that a token was used, writing it back at most once a minute per
   * token so a busy client does not rewrite the file on every request.
   */
  private touch(stored: StoredApiToken) {
    const now = Date.now()
    const lastWrite = this.lastUsedWrites.get(stored.id)
      ?? (stored.lastUsedAt ? Date.parse(stored.lastUsedAt) : 0)
    if (now - lastWrite < LAST_USED_WRITE_INTERVAL_MS) {
      return
    }
    this.lastUsedWrites.set(stored.id, now)
    const lastUsedAt = new Date(now).toISOString()
    stored.lastUsedAt = lastUsedAt
    this.mutate((tokens) => {
      const current = tokens.find(x => x.id === stored.id)
      if (current) {
        current.lastUsedAt = lastUsedAt
      }
    }).catch((e) => {
      this.logger.warn(`Could not record the use of API token "${stored.name}": ${e.message}`)
    })
  }

  private async readTokens(cached = false): Promise<StoredApiToken[]> {
    if (cached && this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.tokens
    }
    let tokens: StoredApiToken[]
    try {
      const data = await this.jsonStore.read<StoredApiToken[]>(this.tokensPath)
      tokens = Array.isArray(data) ? data : []
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.error(`Could not read the API tokens file ${this.tokensPath}: ${e.message}. API tokens will be rejected until it is fixed.`)
      }
      tokens = []
    }
    this.cache = { tokens, loadedAt: Date.now() }
    return tokens
  }

  private async mutate(mutator: (tokens: StoredApiToken[]) => void): Promise<void> {
    await this.jsonStore.mutate<StoredApiToken[]>(this.tokensPath, (current) => {
      const tokens = Array.isArray(current) ? current : []
      mutator(tokens)
      return tokens
    }, { spaces: 4 })
    this.cache = undefined
  }
}
