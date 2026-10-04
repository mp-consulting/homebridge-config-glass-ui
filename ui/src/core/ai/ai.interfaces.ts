/** What `/ai/*` and the `ai` socket namespace answer with. */

export type AiProviderName = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible'

export const AI_PROVIDERS: AiProviderName[] = ['anthropic', 'openai', 'gemini', 'openai-compatible']

export interface AiUsageSummary {
  inputTokens: number
  outputTokens: number
  calls: number
  /** Null when a model's price is unknown. */
  costUsd: number | null
}

export interface AiSettings {
  configured: boolean
  enabled: boolean
  provider: AiProviderName
  /** Empty for the provider's default. */
  model: string
  hasApiKey: boolean
  baseUrl: string
  maxOutputTokens: number | null
  defaultModels: Record<AiProviderName, string>
  error: string | null
}

export interface AiStatus {
  enabled: boolean
  reason: 'not-configured' | 'disabled' | 'missing-api-key' | 'invalid-config' | null
  provider: AiProviderName | null
  model: string | null
  capabilities: { tools: boolean, streaming: boolean, contextTokens: number, jsonMode: boolean } | null
  usage: { total: AiUsageSummary, byModel: Record<string, AiUsageSummary> }
  /** Administrators only. */
  settings?: AiSettings
}

export interface AiSettingsUpdate {
  enabled?: boolean
  provider?: AiProviderName
  model?: string
  apiKey?: string
  clearApiKey?: boolean
  baseUrl?: string
  maxOutputTokens?: number
}

export interface AiTestResult {
  ok: boolean
  provider?: string
  model?: string
  latencyMs?: number
  reply?: string
  message?: string
}

export interface AiTextResult {
  text: string
}

export interface AiPluginConfigResult {
  config: Record<string, unknown>
  explanation: string
  current: Record<string, unknown> | null
  index: number
}

export interface AiChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AiToolCallSummary {
  id: string
  name: string
  arguments: Record<string, unknown>
  isError: boolean
}

export interface AiChatResult {
  text: string
  toolCalls: AiToolCallSummary[]
  truncated: boolean
  readOnly: boolean
}

/** `ai:tool`: a tool the chat called, then its outcome. */
export interface AiToolEvent {
  requestId: string
  phase: 'call' | 'result'
  id: string
  name: string
  arguments?: Record<string, unknown>
  isError?: boolean
}

/** `ai:confirm`: a destructive tool waiting for the user. */
export interface AiConfirmRequest {
  requestId: string
  confirmId: string
  tool: { name: string, arguments: Record<string, unknown> }
  timeoutMs: number
}

export type UpdateRiskLevel = 'low' | 'medium' | 'high'

export interface AiUpdateRisk {
  pluginName: string
  currentVersion: string
  targetVersion: string
  risk: UpdateRiskLevel
  summary: string
  breakingChanges: string[]
  hasChangelog: boolean
  cached: boolean
}

export interface AiOrganizationSuggestion {
  rooms: Array<{ name: string, accessories: string[] }>
  renames: Array<{ uniqueId: string, name: string, reason?: string }>
  orphans: Array<{ uniqueId: string, reason: string }>
}

export interface AiDigest {
  text: string
  generatedAt: string
  cached: boolean
}
