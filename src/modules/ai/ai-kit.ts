/**
 * The one place the AI module imports `@mp-consulting/homebridge-ai-kit` from.
 * Glass UI holds no provider or MCP code of its own: prompts, providers,
 * redaction and the agent's tools all come from the kit, and so do the
 * server helpers (rate limiter, TTL cache, confirmation broker, log tail,
 * pairing-code redaction, certificate fingerprints) other modules use.
 */
export {
  assessPluginUpdate,
  ConfirmationBroker,
  costOf,
  createProvider,
  dailyDigest,
  DEFAULT_MCP_HTTP_HOST,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MODELS,
  diagnoseLogs,
  findAiBlock,
  generatePluginConfig,
  JsonGenerationError,
  PLATFORM_NAME,
  PROMPTS,
  PROVIDER_NAMES,
  ProviderError,
  readLogTail,
  redactPairing,
  redactText,
  resolveAiConfig,
  runAgent,
  SlidingWindowRateLimiter,
  suggestOrganization,
  TtlCache,
  UsageTracker,
} from '@mp-consulting/homebridge-ai-kit'
export type {
  AgentEvent,
  AgentResult,
  AiConfig,
  AiProvider,
  ChatMessage,
  ProviderCapabilities,
  ProviderName,
  TokenUsage,
  ToolCall,
  UsageSummary,
} from '@mp-consulting/homebridge-ai-kit'
export { createTrustedFetch, HomebridgeClient, normalizeFingerprint, pemFingerprints } from '@mp-consulting/homebridge-ai-kit/mcp'
export type { AuditEntry as AgentAuditEntry, AuditSink as AgentAuditSink } from '@mp-consulting/homebridge-ai-kit/mcp'
export { mcpClientSnippets } from '@mp-consulting/homebridge-ai-kit/plugin'
export type { McpClientSnippets } from '@mp-consulting/homebridge-ai-kit/plugin'
