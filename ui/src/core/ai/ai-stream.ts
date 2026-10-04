import type { AiConfirmRequest, AiToolEvent } from './ai.interfaces'

import { randomUuid } from '@/core/utilities/random-uuid'
import { ws } from '@/core/ws'

import { aiActions } from './ai.store'

/** What the `ai` socket namespace streams for one request. */
export type AiStreamKind = 'chat' | 'diagnose-logs' | 'plugin-config'

export interface AiStreamHandlers {
  /** Text as it streams. */
  onChunk?: (delta: string) => void
  /** The chat's tool calls and their outcomes. */
  onTool?: (event: AiToolEvent) => void
  /**
   * A destructive tool waiting for the user. Resolve true to allow it. Left
   * unanswered, the server refuses it when its timeout runs out.
   */
  onConfirm?: (request: AiConfirmRequest) => Promise<boolean>
  /** The server gave up waiting for an answer. */
  onConfirmExpired?: (confirmId: string) => void
  signal?: AbortSignal
}

/** A request the server refused or that failed. `status` is the HTTP status it maps to. */
export class AiRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AiRequestError'
  }
}

/**
 * Run one Assistant request over the `ai` socket namespace and resolve with
 * its result. The page-edge glow shows while it runs; an abort cancels it on
 * the server.
 * @param kind - which request
 * @param body - its body (as for the matching `/ai/*` route)
 * @param handlers - streaming callbacks and an abort signal
 */
export function runAiStream<T>(kind: AiStreamKind, body: unknown, handlers: AiStreamHandlers = {}): Promise<T> {
  const io = ws.connectToNamespace('ai')
  const requestId = randomUuid()
  const endRun = aiActions.beginRun()
  const socket = io.socket
  const listeners: Array<[string, (...args: any[]) => void]> = []
  const on = (event: string, listener: (payload: any) => void) => {
    const filtered = (payload: any) => {
      if (payload?.requestId === requestId) {
        listener(payload)
      }
    }
    listeners.push([event, filtered])
    socket.on(event, filtered)
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    function finish(error: unknown, result?: T) {
      if (settled) {
        return
      }
      settled = true
      for (const [event, listener] of listeners) {
        socket.off(event, listener)
      }
      socket.off('disconnect', onDisconnect)
      handlers.signal?.removeEventListener('abort', onAbort)
      endRun()
      io.end()
      if (error) {
        reject(error)
      } else {
        resolve(result as T)
      }
    }
    function onDisconnect() {
      finish(new AiRequestError('The connection to the server was lost.'))
    }
    function onAbort() {
      socket.emit('cancel', { requestId })
      finish(new DOMException('The request was cancelled.', 'AbortError'))
    }

    if (handlers.signal?.aborted) {
      finish(new DOMException('The request was cancelled.', 'AbortError'))
      return
    }
    handlers.signal?.addEventListener('abort', onAbort)
    socket.on('disconnect', onDisconnect)

    on('ai:chunk', payload => handlers.onChunk?.(String(payload.delta ?? '')))
    on('ai:tool', payload => handlers.onTool?.(payload as AiToolEvent))
    on('ai:confirm-expired', payload => handlers.onConfirmExpired?.(payload.confirmId))
    on('ai:confirm', (payload: AiConfirmRequest) => {
      const answer = handlers.onConfirm ? handlers.onConfirm(payload) : Promise.resolve(false)
      answer.then(
        allow => socket.emit('confirm', { requestId, confirmId: payload.confirmId, allow: allow === true }),
        () => socket.emit('confirm', { requestId, confirmId: payload.confirmId, allow: false }),
      )
    })
    on('ai:done', payload => finish(null, payload.result as T))
    on('ai:error', payload => finish(new AiRequestError(String(payload.message ?? 'The Assistant failed.'), payload.status)))

    io.request(kind, { requestId, body }).catch((error: any) => {
      finish(new AiRequestError(String(error?.error ?? error?.message ?? 'The Assistant failed.'), error?.status))
    })
  })
}

/** Whether an error is the user's own cancel. */
export function isAbortError(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError'
}
