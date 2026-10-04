import type { OnGatewayDisconnect } from '@nestjs/websockets'

import type { WsClient } from '../../core/auth/guards/ws-auth.js'
import type { AgentEvent, ToolCall } from './ai-kit.js'

import { randomUUID } from 'node:crypto'

import { HttpException, Inject, UseGuards } from '@nestjs/common'
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { WsGuard } from '../../core/auth/guards/ws.guard.js'
import { devServerCorsConfig } from '../../core/cors.config.js'
import { Logger } from '../../core/logger/logger.service.js'
import { AI_CONFIRM_TIMEOUT_MS } from './ai.constants.js'
import { AiChatDto, AiDiagnoseLogsDto, AiPluginConfigDto } from './ai.dto.js'
import { AiService } from './ai.service.js'

/** Requests one socket may have running at once. */
const MAX_RUNNING_PER_SOCKET = 3

const RE_REQUEST_ID = /^[\w-]{1,64}$/

interface Running {
  abort: AbortController
  /** Destructive tool calls waiting for the user's answer, by confirmId. */
  confirms: Map<string, (allow: boolean) => void>
}

interface RequestPayload {
  requestId?: unknown
  body?: unknown
}

/** What a client sends with `confirm`. */
interface ConfirmPayload {
  requestId?: unknown
  confirmId?: unknown
  allow?: unknown
}

function errorMessage(error: unknown): { message: string, status?: number } {
  if (error instanceof HttpException) {
    const response = error.getResponse() as string | { message?: string | string[] }
    const message = typeof response === 'string' ? response : response?.message
    return { message: Array.isArray(message) ? message.join(', ') : message ?? error.message, status: error.getStatus() }
  }
  return { message: (error as Error)?.message ?? String(error) }
}

/**
 * The Assistant's streaming channel. A client emits a request with its own
 * `requestId` (acknowledged at once), then receives, tagged with that id:
 * `ai:chunk` { delta } as text streams, `ai:tool` { phase, id, name… } for the
 * chat's tool calls, `ai:confirm` { confirmId, tool } before a destructive
 * tool runs (answered with `confirm` { requestId, confirmId, allow }; no
 * answer within a minute is a no), then `ai:done` { result } or
 * `ai:error` { message, status }.
 *
 * Every message is guarded (any signed-in user); Log Doctor and Config Copilot
 * also need an administrator, and the chat's tools follow the user's rights.
 */
@UseGuards(WsGuard)
@WebSocketGateway({
  namespace: 'ai',
  allowEIO3: true,
  cors: devServerCorsConfig,
})
export class AiGateway implements OnGatewayDisconnect {
  private readonly running = new WeakMap<WsClient, Map<string, Running>>()

  constructor(
    @Inject(AiService) private readonly aiService: AiService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  handleDisconnect(client: WsClient) {
    for (const run of this.running.get(client)?.values() ?? []) {
      run.abort.abort()
    }
    this.running.delete(client)
  }

  @SubscribeMessage('chat')
  chat(client: WsClient, payload: RequestPayload) {
    return this.start(client, payload, AiChatDto, false, (user, body: AiChatDto, run, requestId) =>
      this.aiService.chat(user, body.messages, {
        signal: run.abort.signal,
        onEvent: event => this.forward(client, requestId, event),
        confirm: call => this.askConfirmation(client, requestId, run, call),
      }))
  }

  @SubscribeMessage('diagnose-logs')
  diagnoseLogs(client: WsClient, payload: RequestPayload) {
    return this.start(client, payload, AiDiagnoseLogsDto, true, (user, body: AiDiagnoseLogsDto, run, requestId) =>
      this.aiService.diagnoseLogs(user, body.focus, {
        signal: run.abort.signal,
        onChunk: delta => client.emit('ai:chunk', { requestId, delta }),
      }))
  }

  @SubscribeMessage('plugin-config')
  pluginConfig(client: WsClient, payload: RequestPayload) {
    return this.start(client, payload, AiPluginConfigDto, true, (user, body: AiPluginConfigDto, run, requestId) =>
      this.aiService.pluginConfig(user, body, {
        signal: run.abort.signal,
        onChunk: delta => client.emit('ai:chunk', { requestId, delta }),
      }))
  }

  @SubscribeMessage('cancel')
  cancel(client: WsClient, payload: { requestId?: unknown }) {
    const run = typeof payload?.requestId === 'string' ? this.running.get(client)?.get(payload.requestId) : undefined
    run?.abort.abort()
    return { ok: Boolean(run) }
  }

  @SubscribeMessage('confirm')
  confirm(client: WsClient, payload: ConfirmPayload) {
    if (typeof payload?.requestId !== 'string' || typeof payload?.confirmId !== 'string') {
      return { error: 'requestId and confirmId are required.' }
    }
    const answer = this.running.get(client)?.get(payload.requestId)?.confirms.get(payload.confirmId)
    if (!answer) {
      return { error: 'Nothing is waiting for this confirmation.' }
    }
    // Only an explicit true allows the tool
    answer(payload.allow === true)
    return { ok: true }
  }

  /**
   * Validate the request, acknowledge it, then run it in the background and
   * report its outcome as `ai:done` / `ai:error`.
   */
  private async start<T extends object>(
    client: WsClient,
    payload: RequestPayload,
    dto: new () => T,
    adminOnly: boolean,
    work: (user: any, body: T, run: Running, requestId: string) => Promise<unknown>,
  ) {
    const requestId = payload?.requestId
    if (typeof requestId !== 'string' || !RE_REQUEST_ID.test(requestId)) {
      return { error: 'A requestId is required.' }
    }
    const user = client.data?.user
    if (adminOnly && !user?.admin) {
      return { error: 'Forbidden', status: 403 }
    }
    const body = plainToInstance(dto, payload?.body ?? {})
    const problems = await validate(body, { whitelist: true, forbidUnknownValues: false })
    if (problems.length) {
      return { error: problems.flatMap(p => Object.values(p.constraints ?? {})).join(', ') || 'Invalid request.', status: 400 }
    }

    let runs = this.running.get(client)
    if (!runs) {
      runs = new Map()
      this.running.set(client, runs)
    }
    if (runs.has(requestId)) {
      return { error: 'This requestId is already running.', status: 409 }
    }
    if (runs.size >= MAX_RUNNING_PER_SOCKET) {
      return { error: 'Too many Assistant requests are running.', status: 429 }
    }
    const run: Running = { abort: new AbortController(), confirms: new Map() }
    runs.set(requestId, run)

    void work(user, body, run, requestId)
      .then(result => client.emit('ai:done', { requestId, result }))
      .catch((error) => {
        const { message, status } = errorMessage(error)
        if (!status || status >= 500) {
          this.logger.warn(`Assistant request failed: ${message}`)
        }
        client.emit('ai:error', { requestId, message, status })
      })
      .finally(() => {
        for (const answer of run.confirms.values()) {
          answer(false)
        }
        runs.delete(requestId)
      })

    return { requestId, accepted: true }
  }

  private forward(client: WsClient, requestId: string, event: AgentEvent) {
    if (event.type === 'text') {
      client.emit('ai:chunk', { requestId, delta: event.delta })
    } else if (event.type === 'tool_call') {
      client.emit('ai:tool', { requestId, phase: 'call', id: event.call.id, name: event.call.name, arguments: event.call.arguments })
    } else if (event.type === 'tool_result') {
      client.emit('ai:tool', { requestId, phase: 'result', id: event.call.id, name: event.call.name, isError: event.isError })
    }
  }

  /** Ask the client before a destructive tool runs. No answer in time, a cancel or a disconnect is a no. */
  private askConfirmation(client: WsClient, requestId: string, run: Running, call: ToolCall): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const confirmId = randomUUID()
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = { onAbort: () => {} }
      const finish = (allow: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        run.confirms.delete(confirmId)
        run.abort.signal.removeEventListener('abort', cleanup.onAbort)
        resolve(allow)
      }
      const onAbort = () => finish(false)
      cleanup.onAbort = onAbort
      timer = setTimeout(() => {
        client.emit('ai:confirm-expired', { requestId, confirmId })
        finish(false)
      }, AI_CONFIRM_TIMEOUT_MS)
      run.confirms.set(confirmId, finish)
      run.abort.signal.addEventListener('abort', onAbort)
      client.emit('ai:confirm', { requestId, confirmId, tool: { name: call.name, arguments: call.arguments }, timeoutMs: AI_CONFIRM_TIMEOUT_MS })
    })
  }
}
