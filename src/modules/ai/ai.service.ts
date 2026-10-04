import type { AgentEvent, AiConfig, AiProvider, ChatMessage, ProviderCapabilities, TokenUsage, ToolCall } from './ai-kit.js'
import type { AiHomebridgeClientFactory, AiProviderFactory } from './ai.constants.js'
import type { AiChatMessageDto, AiOrganizeDto, AiPluginConfigDto, AiSettingsDto, AiUpdateRiskDto } from './ai.dto.js'

import process from 'node:process'

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { AuthService } from '../../core/auth/auth.service.js'
import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { ConfigEditorService } from '../config-editor/config-editor.service.js'
import { isProtectedStoragePath } from '../config-editor/config-safety.js'
import { PluginsService } from '../plugins/plugins.service.js'
import {
  assessPluginUpdate,
  dailyDigest,
  DEFAULT_MODELS,
  diagnoseLogs,
  findAiBlock,
  generatePluginConfig,
  JsonGenerationError,
  PLATFORM_NAME,
  PROMPTS,
  ProviderError,
  redactText,
  resolveAiConfig,
  suggestOrganization,
  UsageTracker,
} from './ai-kit.js'
import { problemLines, readLogTail } from './ai-logs.js'
import {
  AI_AGENT_RUNNER,
  AI_DISABLED_MESSAGE,
  AI_HOMEBRIDGE_CLIENT_FACTORY,
  AI_LOG_TAIL_BYTES,
  AI_LOG_TAIL_LINES,
  AI_MAX_AGENT_STEPS,
  AI_PROVIDER_FACTORY,
  AI_RATE_LIMIT,
  AI_RATE_WINDOW_MS,
  AI_TOOL_TOKEN_TTL_SECONDS,
  AiAgentRunner,
} from './ai.constants.js'

/** The signed-in user an AI call runs for (`request.user` / `client.data.user`). */
export interface AiUser {
  username?: string
  admin?: boolean
  [key: string]: unknown
}

/** Why the Assistant is unavailable. */
export type AiUnavailableReason = 'not-configured' | 'disabled' | 'missing-api-key' | 'invalid-config'

/** Streaming hooks for the socket gateway. */
export interface AiStreamOptions {
  onChunk?: (delta: string) => void
  signal?: AbortSignal
}

export interface AiChatOptions {
  onEvent?: (event: AgentEvent) => void
  /** Asked before each destructive tool call; without it they are refused. */
  confirm?: (call: ToolCall) => Promise<boolean>
  signal?: AbortSignal
}

interface Ready {
  config: AiConfig
  provider: AiProvider
}

const DIGEST_TTL_MS = 6 * 60 * 60 * 1000
const RISK_TTL_MS = 24 * 60 * 60 * 1000

@Injectable()
export class AiService {
  private readonly usage = new UsageTracker()
  private readonly requests = new Map<string, number[]>()
  private providerCache: { key: string, provider: AiProvider } | undefined
  private digestCache: { key: string, at: number, value: { text: string, generatedAt: string } } | undefined
  private readonly riskCache = new Map<string, { at: number, value: Record<string, unknown> }>()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AI_PROVIDER_FACTORY) private readonly providerFactory: AiProviderFactory,
    @Inject(AI_AGENT_RUNNER) private readonly runAgent: AiAgentRunner,
    @Inject(AI_HOMEBRIDGE_CLIENT_FACTORY) private readonly clientFactory: AiHomebridgeClientFactory,
  ) {}

  // ── Settings ─────────────────────────────────────────────────────

  /** The raw `HomebridgeAiKit` block of config.json, or undefined. */
  private async readBlock(): Promise<Record<string, any> | undefined> {
    return findAiBlock(await this.configEditorService.getConfigFile())
  }

  /** The resolved config, or why the Assistant cannot run. */
  private describe(block: Record<string, any> | undefined): { config?: AiConfig, reason?: AiUnavailableReason, error?: string } {
    if (!block) {
      return { reason: 'not-configured' }
    }
    let config: AiConfig
    try {
      config = resolveAiConfig(block)
    } catch (error) {
      return { reason: 'invalid-config', error: (error as Error).message }
    }
    if (!config.enabled) {
      return { config, reason: 'disabled' }
    }
    if (!config.apiKey && config.provider !== 'openai-compatible') {
      return { config, reason: 'missing-api-key' }
    }
    return { config }
  }

  private provider(config: AiConfig): AiProvider {
    const key = JSON.stringify(config)
    if (this.providerCache?.key !== key) {
      this.providerCache = { key, provider: this.providerFactory(config) }
    }
    return this.providerCache.provider
  }

  /**
   * What the UI needs to know: whether the Assistant is on, and with what.
   * The API key is never returned; administrators get `settings` with
   * `hasApiKey` instead.
   */
  async getStatus(user: AiUser | undefined) {
    const block = await this.readBlock()
    const { config, reason, error } = this.describe(block)
    let capabilities: ProviderCapabilities | null = null
    if (config && !reason) {
      try {
        capabilities = this.provider(config).capabilities
      } catch (e) {
        this.logger.warn(`Assistant: cannot create the ${config.provider} provider: ${(e as Error).message}`)
      }
    }
    return {
      enabled: !reason && capabilities !== null,
      reason: reason ?? null,
      provider: config?.provider ?? null,
      model: config?.model ?? null,
      capabilities,
      usage: { total: this.usage.total, byModel: this.usage.byModel() },
      ...(user?.admin
        ? {
            settings: {
              configured: Boolean(block),
              enabled: block ? block.enabled !== false : false,
              provider: config?.provider ?? (typeof block?.provider === 'string' ? block.provider : 'anthropic'),
              model: typeof block?.model === 'string' ? block.model : '',
              hasApiKey: typeof block?.apiKey === 'string' && block.apiKey.trim() !== '',
              baseUrl: typeof block?.baseUrl === 'string' ? block.baseUrl : '',
              maxOutputTokens: config?.maxOutputTokens ?? null,
              defaultModels: DEFAULT_MODELS,
              error: error ?? null,
            },
          }
        : {}),
    }
  }

  /**
   * Write the `HomebridgeAiKit` block (created when missing). An empty or
   * missing API key keeps the stored one; `clearApiKey` removes it.
   */
  async updateSettings(dto: AiSettingsDto, user: AiUser) {
    await this.configEditorService.updatePlatformBlock(PLATFORM_NAME, (block) => {
      const next: Record<string, any> = block ?? { name: 'AI Kit', enabled: true }
      if (dto.enabled !== undefined) {
        next.enabled = dto.enabled
      }
      if (dto.provider !== undefined) {
        next.provider = dto.provider
      }
      const text: Array<[string, string | undefined]> = [['model', dto.model], ['baseUrl', dto.baseUrl]]
      for (const [key, value] of text) {
        if (value !== undefined) {
          if (value.trim()) {
            next[key] = value.trim()
          } else {
            delete next[key]
          }
        }
      }
      if (dto.clearApiKey) {
        delete next.apiKey
      } else if (dto.apiKey?.trim()) {
        next.apiKey = dto.apiKey.trim()
      }
      if (dto.maxOutputTokens !== undefined) {
        next.maxOutputTokens = dto.maxOutputTokens
      }
      try {
        resolveAiConfig(next)
      } catch (error) {
        throw new BadRequestException((error as Error).message)
      }
      return next
    })
    this.providerCache = undefined
    this.digestCache = undefined
    this.riskCache.clear()
    this.logger.log(`Assistant settings updated by ${user?.username ?? 'an administrator'}.`)
    return this.getStatus(user)
  }

  /** Send a one-word prompt with the saved settings, enabled or not. */
  async testConnection(user: AiUser) {
    this.consume(user)
    const block = await this.readBlock()
    if (!block) {
      throw new ConflictException(AI_DISABLED_MESSAGE)
    }
    const started = Date.now()
    try {
      const config = resolveAiConfig({ ...block, enabled: true })
      const provider = this.providerFactory(config)
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        maxOutputTokens: 16,
      })
      this.usage.add(config.model, result.usage)
      return { ok: true, provider: config.provider, model: result.model || config.model, latencyMs: Date.now() - started, reply: result.text.slice(0, 200) }
    } catch (error) {
      return { ok: false, message: redactText((error as Error).message || String(error)) }
    }
  }

  // ── Guards ───────────────────────────────────────────────────────

  /** The provider to use, or 409 while the Assistant is off. */
  async requireReady(): Promise<Ready> {
    const { config, reason } = this.describe(await this.readBlock())
    if (reason || !config) {
      throw new ConflictException(AI_DISABLED_MESSAGE)
    }
    return { config, provider: this.provider(config) }
  }

  /** Count one request against the user's rate limit (429 when over it). */
  consume(user: AiUser | undefined): void {
    const key = user?.username ?? '(anonymous)'
    const now = Date.now()
    const recent = (this.requests.get(key) ?? []).filter(at => now - at < AI_RATE_WINDOW_MS)
    if (recent.length >= AI_RATE_LIMIT) {
      this.requests.set(key, recent)
      throw new HttpException('Too many Assistant requests. Wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS)
    }
    recent.push(now)
    this.requests.set(key, recent)
  }

  /** Run a feature: rate limit, ready check, usage accounting and provider errors as 502. */
  private async run<T extends { usage: TokenUsage }>(user: AiUser | undefined, work: (ready: Ready) => Promise<T>): Promise<T> {
    const ready = await this.requireReady()
    this.consume(user)
    try {
      const result = await work(ready)
      this.usage.add(ready.config.model, result.usage)
      return result
    } catch (error) {
      throw this.toHttpError(error)
    }
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof HttpException) {
      return error
    }
    if (error instanceof ProviderError || error instanceof JsonGenerationError) {
      return new BadGatewayException(redactText(error.message))
    }
    if ((error as Error)?.name === 'AbortError') {
      return new HttpException('The request was cancelled.', 499)
    }
    this.logger.error(`Assistant: ${(error as Error)?.message ?? error}`)
    return new BadGatewayException(redactText((error as Error)?.message ?? 'The Assistant failed.'))
  }

  // ── Log Doctor ───────────────────────────────────────────────────

  /** The end of the Homebridge log file, without colour codes. */
  async recentLogLines(): Promise<string[]> {
    const log = this.configService.ui.log
    if (!log || !['file', 'native'].includes(log.method) || !log.path) {
      throw new BadRequestException('Log Doctor reads the Homebridge log file, but the log is not set up to come from a file.')
    }
    if (isProtectedStoragePath(log.path, this.configService.storagePath)) {
      throw new BadRequestException('Log Doctor cannot read this log path.')
    }
    try {
      return await readLogTail(log.path, AI_LOG_TAIL_BYTES, AI_LOG_TAIL_LINES)
    } catch (error) {
      throw new BadRequestException(`Cannot read the log file: ${(error as { code?: string }).code ?? (error as Error).message}`)
    }
  }

  async diagnoseLogs(user: AiUser, focus: string | undefined, stream: AiStreamOptions = {}) {
    // Off is reported before anything is read
    await this.requireReady()
    const logs = await this.recentLogLines()
    if (!logs.length) {
      throw new BadRequestException('The log is empty.')
    }
    return this.run(user, async ({ config, provider }) => {
      const result = await diagnoseLogs({ provider, logs, focus, maxOutputTokens: config.maxOutputTokens, ...stream })
      return { text: result.text, lines: logs.length, usage: result.usage }
    })
  }

  // ── Config Copilot ───────────────────────────────────────────────

  async pluginConfig(user: AiUser, dto: AiPluginConfigDto, stream: AiStreamOptions = {}) {
    await this.requireReady()
    const schema = await this.pluginsService.getPluginConfigSchema(dto.pluginName) as Record<string, any>
    const index = dto.index ?? 0
    let current = dto.current
    if (current === undefined) {
      const blocks = await this.configEditorService.getConfigForPlugin(dto.pluginName)
      current = blocks[index]
    }
    return this.run(user, async ({ config, provider }) => {
      const result = await generatePluginConfig({
        provider,
        schema,
        request: dto.request,
        current,
        pluginName: dto.pluginName,
        maxOutputTokens: config.maxOutputTokens,
        ...stream,
      })
      const generated = { ...result.config }
      // Keep the block attached to the plugin whatever the model wrote
      if (schema.pluginAlias && (schema.pluginType === 'platform' || schema.pluginType === 'accessory')) {
        generated[schema.pluginType] = schema.pluginAlias
      }
      return { config: generated, explanation: result.explanation, current: current ?? null, index, usage: result.usage }
    })
  }

  // ── Chat ─────────────────────────────────────────────────────────

  /**
   * One chat turn through the agent. Its tools call this server's API as the
   * user, with a short-lived token minted per request, so every permission
   * check (admin routes, accessory control lists) applies; a non-admin gets
   * the read-only tools only.
   */
  async chat(user: AiUser, messages: AiChatMessageDto[], options: AiChatOptions = {}) {
    if (!messages.length || messages.at(-1)!.role !== 'user') {
      throw new BadRequestException('The last message must be from the user.')
    }
    const mint = () => {
      try {
        return this.authService.mintShortLivedToken(user, AI_TOOL_TOKEN_TTL_SECONDS)
      } catch {
        throw new ForbiddenException('The Assistant chat needs a signed-in user account.')
      }
    }
    // Fail now rather than on the first tool call
    mint()
    const readOnly = !user?.admin
    const client = this.clientFactory({ url: this.localApiUrl(), getToken: async () => mint() })
    const history: ChatMessage[] = messages.map(m => ({ role: m.role, content: redactText(m.content) }))
    const system = `${PROMPTS.ask.system}\n\nYou run inside Homebridge Glass UI for ${user?.username ?? 'the user'}, who ${readOnly
      ? 'is not an administrator: only read-only tools are available, so explain what an administrator would need to do for any change.'
      : 'is an administrator. Changes that restart, remove or reconfigure something are confirmed by the user before they run.'} Answer in Markdown, briefly.`

    return this.run(user, async ({ config, provider }) => {
      const result = await this.runAgent({
        provider,
        client,
        readOnly,
        system,
        messages: history,
        maxSteps: AI_MAX_AGENT_STEPS,
        maxOutputTokens: config.maxOutputTokens,
        signal: options.signal,
        onEvent: options.onEvent,
        confirm: options.confirm,
      })
      return {
        text: result.text,
        toolCalls: result.toolCalls.map(call => ({ id: call.id, name: call.name, arguments: call.arguments, isError: call.isError })),
        truncated: result.truncated,
        readOnly,
        usage: result.usage,
      }
    })
  }

  /** Where the agent's tools reach this server. */
  localApiUrl(): string {
    if (process.env.UIX_AI_LOCAL_URL) {
      return process.env.UIX_AI_LOCAL_URL.replace(/\/+$/, '')
    }
    const ui = this.configService.ui
    const ssl = ui.ssl as Record<string, unknown> | undefined
    const https = Boolean(ssl && ((ssl.key && ssl.cert) || ssl.pfx || ssl.selfSigned)) && !this.configService.sslStartupError
    const host = !ui.host || ['0.0.0.0', '::', '[::]'].includes(ui.host) ? '127.0.0.1' : ui.host
    return `${https ? 'https' : 'http'}://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${ui.port}`
  }

  // ── Update risk ──────────────────────────────────────────────────

  async updateRisk(user: AiUser, dto: AiUpdateRiskDto) {
    await this.requireReady()
    const installed = (await this.pluginsService.getInstalledPlugins()).find(p => p.name === dto.pluginName)
    const currentVersion = dto.currentVersion ?? installed?.installedVersion
    if (!currentVersion) {
      throw new NotFoundException(`${dto.pluginName} is not installed.`)
    }
    const targetVersion = dto.targetVersion ?? installed?.latestVersion ?? 'latest'
    const key = `${dto.pluginName}@${currentVersion}->${targetVersion}`
    const cached = this.riskCache.get(key)
    if (cached && Date.now() - cached.at < RISK_TTL_MS) {
      return { ...cached.value, cached: true }
    }

    const parts: string[] = []
    try {
      const release = await this.pluginsService.getPluginRelease(dto.pluginName, targetVersion) as { notes?: string | null, changelog?: string | null }
      parts.push(...[release?.notes, release?.changelog].filter((x): x is string => typeof x === 'string' && x.trim() !== ''))
    } catch {
      // Fall back to the installed package's CHANGELOG.md
    }
    if (!parts.length) {
      try {
        parts.push((await this.pluginsService.getPluginChangeLog(dto.pluginName)).changelog)
      } catch {
        // No changelog anywhere
      }
    }
    const changelog = parts.join('\n\n') || 'No changelog or release notes could be found for this update.'

    const value = await this.run(user, async ({ config, provider }) => {
      const result = await assessPluginUpdate({
        provider,
        pluginName: dto.pluginName,
        currentVersion,
        targetVersion,
        changelog,
        maxOutputTokens: config.maxOutputTokens,
      })
      return {
        pluginName: dto.pluginName,
        currentVersion,
        targetVersion,
        risk: result.risk,
        summary: result.summary,
        breakingChanges: result.breakingChanges,
        hasChangelog: parts.length > 0,
        usage: result.usage,
      }
    })
    this.riskCache.set(key, { at: Date.now(), value })
    return { ...value, cached: false }
  }

  // ── Organiser ────────────────────────────────────────────────────

  async organize(user: AiUser, dto: AiOrganizeDto) {
    if (!dto.accessories.length) {
      throw new BadRequestException('There are no accessories to organise.')
    }
    return this.run(user, async ({ config, provider }) => {
      const result = await suggestOrganization({ provider, accessories: dto.accessories, rooms: dto.rooms, maxOutputTokens: config.maxOutputTokens })
      return result
    })
  }

  // ── Daily digest ─────────────────────────────────────────────────

  async digest(user: AiUser, refresh = false) {
    const ready = await this.requireReady()
    const date = new Date().toISOString().slice(0, 10)
    const key = `${date}:${ready.config.provider}:${ready.config.model}`
    if (!refresh && this.digestCache?.key === key && Date.now() - this.digestCache.at < DIGEST_TTL_MS) {
      return { ...this.digestCache.value, cached: true }
    }

    let updates: unknown
    try {
      updates = (await this.pluginsService.getOutOfDatePlugins())
        .map(p => ({ name: p.name, installedVersion: p.installedVersion, latestVersion: p.latestVersion }))
    } catch {
      updates = undefined
    }
    let logs: string[] | undefined
    try {
      logs = problemLines(await this.recentLogLines()).slice(-150)
    } catch {
      logs = undefined
    }
    const status = {
      glassUiVersion: this.configService.package.version,
      homebridgeVersion: this.configService.homebridgeVersion ?? null,
      nodeVersion: process.version,
      platform: process.platform,
      uiUptimeSeconds: Math.round(process.uptime()),
    }

    const result = await this.run(user, async ({ config, provider }) =>
      dailyDigest({ provider, status, updates, logs, date, maxOutputTokens: config.maxOutputTokens }))
    const value = { text: result.text, generatedAt: new Date().toISOString() }
    this.digestCache = { key, at: Date.now(), value }
    return { ...value, cached: false }
  }
}
