import type { McpClientSnippets } from './ai-kit.js'
import type { AiMcpSettingsDto } from './ai.dto.js'
import type { AiUser } from './ai.service.js'

import { randomBytes } from 'node:crypto'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { ApiTokenService } from '../../core/auth/api-token.service.js'
import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { ConfigEditorService } from '../config-editor/config-editor.service.js'
import { PluginsService } from '../plugins/plugins.service.js'
import { DEFAULT_MCP_HTTP_HOST, DEFAULT_MCP_HTTP_PORT, findAiBlock, mcpClientSnippets, PLATFORM_NAME, resolveAiConfig } from './ai-kit.js'
import { uiCertificateFingerprint } from './ai-loopback.js'
import { AiService } from './ai.service.js'

/** The plugin that runs the HTTP MCP server. */
export const AI_KIT_PLUGIN = '@mp-consulting/homebridge-ai-kit'

/** The name of the Glass UI API token the MCP server calls this UI with. */
export const MCP_API_TOKEN_NAME = 'MCP server'

const WILDCARD_HOSTS = ['0.0.0.0', '::', '[::]', '']

/** What the UI is told about the MCP server: never a secret. */
export interface McpStatus {
  /** The AI Kit plugin's state, when the installed plugins have been read (null otherwise). */
  pluginInstalled: boolean | null
  http: {
    enabled: boolean
    host: string
    port: number
    /** Where clients connect (a wildcard bind address shows as this UI's host name). */
    url: string
    hasToken: boolean
    homebridgeUrl: string
    defaultHomebridgeUrl: string
    homebridgeToken: {
      set: boolean
      /** The API token it is, when Glass UI created it. */
      id: string | null
      scope: 'read' | 'admin' | null
      /** False when that API token was revoked (Users, API Tokens) or has expired from the list. */
      exists: boolean | null
    }
  }
  /** Client snippets with placeholders: `http` for the HTTP server, `stdio` to launch the server locally. */
  snippets: { http: McpClientSnippets, stdio: McpClientSnippets }
}

/** A client token, shown once. */
export interface McpGeneratedToken {
  token: string
  /** The HTTP snippets with this token in them. */
  snippets: McpClientSnippets
  status: McpStatus
}

/**
 * The HTTP MCP server's settings in the `mcp.http` part of the
 * `HomebridgeAiKit` block (the Homebridge AI Kit plugin reads them and runs
 * the server): bind address and port, the bearer token clients send, and the
 * Glass UI API token the server's tools act with. Secrets are written, never
 * read back.
 */
@Injectable()
export class AiMcpService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(ApiTokenService) private readonly apiTokens: ApiTokenService,
    @Inject(AiService) private readonly aiService: AiService,
  ) {}

  /**
   * @param origin - the address the browser reached this UI at, so the
   * snippets point a client on another machine at it
   */
  async getStatus(origin?: string): Promise<McpStatus> {
    const block = findAiBlock(await this.configEditorService.getConfigFile())
    const http = (block?.mcp as any)?.http ?? {}
    const host = typeof http.host === 'string' && http.host.trim() ? http.host.trim() : DEFAULT_MCP_HTTP_HOST
    const port = Number.isInteger(http.port) ? http.port as number : DEFAULT_MCP_HTTP_PORT
    const defaultHomebridgeUrl = this.aiService.localApiUrl()
    const homebridgeUrl = typeof http.homebridgeUrl === 'string' ? http.homebridgeUrl : ''
    const tokenId = typeof http.homebridgeTokenId === 'string' ? http.homebridgeTokenId : null
    const stored = tokenId ? (await this.apiTokens.list()).find(x => x.id === tokenId) : undefined
    const browserHost = this.originHost(origin)
    const clientHost = WILDCARD_HOSTS.includes(host) && browserHost ? browserHost : host
    const httpSnippets = mcpClientSnippets({ homebridgeUrl: origin ?? defaultHomebridgeUrl, http: { host: clientHost, port } })
    const installed = this.pluginsService.getCachedInstalledPlugins()
    return {
      pluginInstalled: installed ? installed.some(p => p.name === AI_KIT_PLUGIN) : null,
      http: {
        enabled: http.enabled === true,
        host,
        port,
        url: `http://${WILDCARD_HOSTS.includes(clientHost) ? '127.0.0.1' : clientHost.includes(':') ? `[${clientHost}]` : clientHost}:${port}/mcp`,
        hasToken: typeof http.token === 'string' && http.token !== '',
        homebridgeUrl,
        defaultHomebridgeUrl,
        homebridgeToken: {
          set: typeof http.homebridgeToken === 'string' && http.homebridgeToken !== '',
          id: tokenId,
          scope: stored?.scope ?? null,
          exists: tokenId ? Boolean(stored) : null,
        },
      },
      snippets: {
        http: httpSnippets,
        stdio: mcpClientSnippets({ homebridgeUrl: origin ?? defaultHomebridgeUrl }),
      },
    }
  }

  /** Enable/disable, bind address, port, the UI address, or a client token of the user's own. */
  async updateSettings(dto: AiMcpSettingsDto, user: AiUser, origin?: string): Promise<McpStatus> {
    if (dto.port !== undefined && dto.port === Number(this.configService.ui.port)) {
      throw new BadRequestException(`Port ${dto.port} is the one Glass UI listens on. Pick another port for the MCP server.`)
    }
    await this.updateHttp((http) => {
      if (dto.enabled !== undefined) {
        http.enabled = dto.enabled
      }
      if (dto.host !== undefined) {
        http.host = dto.host.trim()
      }
      if (dto.port !== undefined) {
        http.port = dto.port
      }
      if (dto.homebridgeUrl !== undefined) {
        const url = dto.homebridgeUrl.trim().replace(/\/+$/, '')
        if (url) {
          http.homebridgeUrl = url
        } else {
          delete http.homebridgeUrl
        }
      }
      if (dto.token !== undefined) {
        http.token = dto.token
      }
    })
    this.logger.log(`MCP server settings updated by ${user?.username ?? 'an administrator'}${dto.token !== undefined ? ' (new client token)' : ''}.`)
    return this.getStatus(origin)
  }

  /** A new random client token, replacing any stored one. Returned this once. */
  async generateToken(user: AiUser, origin?: string): Promise<McpGeneratedToken> {
    const token = randomBytes(32).toString('base64url')
    await this.updateHttp((http) => {
      http.token = token
    })
    this.logger.warn(`MCP client token generated by ${user?.username ?? 'an administrator'}. Clients using the old one must be updated.`)
    const status = await this.getStatus(origin)
    const browserHost = this.originHost(origin)
    const clientHost = WILDCARD_HOSTS.includes(status.http.host) && browserHost ? browserHost : status.http.host
    return {
      token,
      snippets: mcpClientSnippets({ homebridgeUrl: origin ?? status.http.defaultHomebridgeUrl, http: { host: clientHost, port: status.http.port, token }, includeToken: true }),
      status,
    }
  }

  async clearToken(user: AiUser, origin?: string): Promise<McpStatus> {
    await this.updateHttp((http) => {
      delete http.token
    })
    this.logger.warn(`MCP client token removed by ${user?.username ?? 'an administrator'}.`)
    return this.getStatus(origin)
  }

  /**
   * Create the Glass UI API token the MCP server's tools act with and store it
   * (with its id, and this UI's address when none is set). One created before
   * is revoked.
   */
  async createHomebridgeToken(scope: 'read' | 'admin', user: AiUser, origin?: string): Promise<McpStatus> {
    const previous = await this.currentHomebridgeTokenId()
    const created = await this.apiTokens.create({ name: MCP_API_TOKEN_NAME, scope, expiresInDays: null }, user?.username)
    const localUrl = this.aiService.localApiUrl()
    // On this UI's own HTTPS (often self-signed), the MCP server pins its certificate
    const fingerprint = localUrl.startsWith('https:')
      ? await uiCertificateFingerprint(this.configService.ui.ssl as Record<string, unknown> | undefined, this.configService.storagePath)
      : null
    try {
      await this.updateHttp((http) => {
        http.homebridgeToken = created.token
        http.homebridgeTokenId = created.id
        if (typeof http.homebridgeUrl !== 'string' || !http.homebridgeUrl) {
          http.homebridgeUrl = localUrl
        }
        if (http.homebridgeUrl === localUrl) {
          if (fingerprint) {
            http.homebridgeCertFingerprint = fingerprint
          } else {
            delete http.homebridgeCertFingerprint
          }
        }
      })
    } catch (error) {
      // Not stored anywhere: do not leave a usable token behind
      await this.apiTokens.revoke(created.id).catch(() => {})
      throw error
    }
    await this.revokeQuietly(previous)
    return this.getStatus(origin)
  }

  /** Remove the MCP server's API token from the block and revoke it. */
  async removeHomebridgeToken(user: AiUser, origin?: string): Promise<McpStatus> {
    const previous = await this.currentHomebridgeTokenId()
    await this.updateHttp((http) => {
      delete http.homebridgeToken
      delete http.homebridgeTokenId
    })
    await this.revokeQuietly(previous)
    this.logger.warn(`MCP server API token removed by ${user?.username ?? 'an administrator'}.`)
    return this.getStatus(origin)
  }

  private async currentHomebridgeTokenId(): Promise<string | undefined> {
    const block = findAiBlock(await this.configEditorService.getConfigFile())
    const id = (block?.mcp as any)?.http?.homebridgeTokenId
    return typeof id === 'string' ? id : undefined
  }

  private async revokeQuietly(id: string | undefined) {
    if (!id) {
      return
    }
    try {
      await this.apiTokens.revoke(id)
    } catch (error) {
      // Already revoked under Users, API Tokens
      if (!(error instanceof NotFoundException)) {
        throw error
      }
    }
  }

  /**
   * Edit `mcp.http` of the block, creating the block (with the Assistant off)
   * when there is none, and check the result the way the plugin will.
   */
  private async updateHttp(edit: (http: Record<string, any>) => void) {
    await this.configEditorService.updatePlatformBlock(PLATFORM_NAME, (block) => {
      const next: Record<string, any> = block ?? { name: 'AI Kit', enabled: false }
      const mcp = next.mcp && typeof next.mcp === 'object' && !Array.isArray(next.mcp) ? next.mcp : {}
      const http = mcp.http && typeof mcp.http === 'object' && !Array.isArray(mcp.http) ? mcp.http : {}
      edit(http)
      next.mcp = { ...mcp, http }
      try {
        resolveAiConfig(next)
      } catch (error) {
        throw new BadRequestException((error as Error).message)
      }
      return next
    })
  }

  /** The host name in a browser origin, or undefined when it is not a usable http(s) origin. */
  private originHost(origin: string | undefined): string | undefined {
    if (!origin) {
      return undefined
    }
    try {
      const url = new URL(origin)
      return ['http:', 'https:'].includes(url.protocol) ? url.hostname.replace(/^\[|\]$/g, '') : undefined
    } catch {
      return undefined
    }
  }
}
