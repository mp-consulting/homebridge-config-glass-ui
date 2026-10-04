/**
 * The one place the AI module imports `@mp-consulting/homebridge-ai-kit` from.
 * Glass UI holds no provider or MCP code of its own: prompts, providers,
 * redaction and the agent's tools all come from the kit.
 */
export {
  assessPluginUpdate,
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
  redactText,
  resolveAiConfig,
  runAgent,
  suggestOrganization,
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
export { createTrustedFetch, HomebridgeClient } from '@mp-consulting/homebridge-ai-kit/mcp'
export { mcpClientSnippets } from '@mp-consulting/homebridge-ai-kit/plugin'
export type { McpClientSnippets } from '@mp-consulting/homebridge-ai-kit/plugin'
