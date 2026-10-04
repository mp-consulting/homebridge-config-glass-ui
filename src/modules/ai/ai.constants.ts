import type { AiConfig, AiProvider, HomebridgeClient, runAgent } from './ai-kit.js'

/**
 * Seams the AI module is built on, so the e2e specs can swap the provider (no
 * real LLM calls) and observe what the agent is handed.
 */

/** Builds the provider for a resolved `HomebridgeAiKit` block (ai-kit's `createProvider`). */
export const AI_PROVIDER_FACTORY = Symbol('AI_PROVIDER_FACTORY')
export type AiProviderFactory = (config: AiConfig) => AiProvider

/** Runs the tool-using agent loop (ai-kit's `runAgent`). */
export const AI_AGENT_RUNNER = Symbol('AI_AGENT_RUNNER')
export type AiAgentRunner = typeof runAgent

/** Builds the HTTP client the agent's tools call this server with (ai-kit's `HomebridgeClient`). */
export const AI_HOMEBRIDGE_CLIENT_FACTORY = Symbol('AI_HOMEBRIDGE_CLIENT_FACTORY')
export type AiHomebridgeClientFactory = (options: { url: string, getToken: () => Promise<string> }) => HomebridgeClient

/** Requests one user may start in a window, across every AI route and socket message. */
export const AI_RATE_LIMIT = 20
export const AI_RATE_WINDOW_MS = 60_000

/** How long the per-user token the agent's tools use stays valid. */
export const AI_TOOL_TOKEN_TTL_SECONDS = 300

/** How long a destructive tool call waits for the user's answer before it is refused. */
export const AI_CONFIRM_TIMEOUT_MS = 60_000

/** Model calls one chat turn may make. */
export const AI_MAX_AGENT_STEPS = 8

/** How much of the end of the log file Log Doctor reads. */
export const AI_LOG_TAIL_BYTES = 256 * 1024
export const AI_LOG_TAIL_LINES = 500

/** The message every AI route answers with (409) while the Assistant is off. */
export const AI_DISABLED_MESSAGE = 'The Assistant is not enabled. An administrator can turn it on in Settings > Assistant.'
