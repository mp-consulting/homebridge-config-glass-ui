import type { AiChatTurn } from '@/core/ai/ai.interfaces'

/**
 * The Assistant chat's conversations, kept in this browser per user: the
 * current one (so closing the palette or reloading the page does not lose
 * it) and a few recent ones. Storage can be missing or full (a private
 * window, blocked site data): every access is guarded, and the chat then
 * simply keeps nothing.
 */

export interface StoredToolChip {
  id: string
  name: string
  state: 'running' | 'done' | 'failed'
}

export interface StoredMessage extends AiChatTurn {
  id: number
  tools?: StoredToolChip[]
  error?: boolean
}

export interface Conversation {
  id: string
  /** When it was last changed (ms since the epoch) */
  updatedAt: number
  messages: StoredMessage[]
}

export interface ChatHistory {
  current: Conversation | null
  /** Earlier conversations, newest first */
  recent: Conversation[]
}

/** Earlier conversations kept. */
export const MAX_RECENT_CONVERSATIONS = 10
/** Messages kept per conversation (the newest). */
export const MAX_STORED_MESSAGES = 60
/** Characters kept per message. */
const MAX_STORED_CONTENT = 20000

const KEY_PREFIX = 'hb-ai-chat:'

function storageKey(username: string | undefined): string {
  return `${KEY_PREFIX}${username || 'anonymous'}`
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isConversation(value: any): value is Conversation {
  return !!value && typeof value.id === 'string' && Array.isArray(value.messages)
}

function sanitizeMessages(messages: unknown[]): StoredMessage[] {
  return messages
    .filter((m: any): m is StoredMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && typeof m.id === 'number')
    .map(m => ({
      ...m,
      // A tool still running when the palette closed never finished here
      tools: m.tools?.map(tool => (tool.state === 'running' ? { ...tool, state: 'failed' as const } : tool)),
    }))
}

/**
 * Read the stored conversations of a user.
 * @param username - the signed-in user
 */
export function loadChatHistory(username: string | undefined): ChatHistory {
  const empty: ChatHistory = { current: null, recent: [] }
  try {
    const raw = storage()?.getItem(storageKey(username))
    if (!raw) {
      return empty
    }
    const parsed = JSON.parse(raw)
    const current = isConversation(parsed?.current) ? { ...parsed.current, messages: sanitizeMessages(parsed.current.messages) } : null
    const recent = Array.isArray(parsed?.recent)
      ? parsed.recent.filter(isConversation).map((c: Conversation) => ({ ...c, messages: sanitizeMessages(c.messages) })).slice(0, MAX_RECENT_CONVERSATIONS)
      : []
    return { current, recent }
  } catch {
    return empty
  }
}

function trimConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.slice(-MAX_STORED_MESSAGES).map(m => (m.content.length > MAX_STORED_CONTENT ? { ...m, content: m.content.slice(0, MAX_STORED_CONTENT) } : m)),
  }
}

/**
 * Store a user's conversations (best effort).
 * @param username - the signed-in user
 * @param history - what to keep
 */
export function saveChatHistory(username: string | undefined, history: ChatHistory): void {
  const value: ChatHistory = {
    current: history.current?.messages.length ? trimConversation(history.current) : null,
    recent: history.recent.filter(c => c.messages.length).slice(0, MAX_RECENT_CONVERSATIONS).map(trimConversation),
  }
  try {
    const store = storage()
    if (!value.current && !value.recent.length) {
      store?.removeItem(storageKey(username))
    } else {
      store?.setItem(storageKey(username), JSON.stringify(value))
    }
  } catch {
    // Full or blocked storage: the conversation is just not kept
  }
}

/**
 * Put a conversation at the top of the recent list (replacing an older copy
 * of it), keeping at most {@link MAX_RECENT_CONVERSATIONS}.
 * @param recent - the recent list
 * @param conversation - the conversation to file
 */
export function fileConversation(recent: Conversation[], conversation: Conversation | null): Conversation[] {
  if (!conversation?.messages.length) {
    return recent
  }
  return [conversation, ...recent.filter(c => c.id !== conversation.id)].slice(0, MAX_RECENT_CONVERSATIONS)
}

/**
 * A short title for a conversation: its first question.
 * @param conversation - the conversation
 */
export function conversationTitle(conversation: Conversation): string {
  const first = conversation.messages.find(m => m.role === 'user')?.content.trim() ?? ''
  const line = first.split('\n')[0]
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}
