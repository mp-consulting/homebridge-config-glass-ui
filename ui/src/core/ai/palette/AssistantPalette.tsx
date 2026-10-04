import type { AiChatResult, AiChatTurn, AiConfirmRequest, AiToolEvent } from '@/core/ai/ai.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { FormEvent, KeyboardEvent } from 'react'

import type { Conversation, StoredMessage } from './chat-history'

import { useEffect, useRef, useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

import { buildAssistantContext } from '@/core/ai/ai-context'
import { isAbortError, runAiStream } from '@/core/ai/ai-stream'
import { useAiStore } from '@/core/ai/ai.store'
import { AiMarkdown } from '@/core/ai/AiMarkdown'
import { useAuthStore } from '@/core/auth'
import { useLatest } from '@/core/hooks/use-latest'
import { ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'
import { randomUuid } from '@/core/utilities/random-uuid'

import { conversationTitle, fileConversation, loadChatHistory, saveChatHistory } from './chat-history'
import { ConfirmToolDialog } from './ConfirmToolDialog'

type Message = StoredMessage

interface PendingConfirm {
  request: AiConfirmRequest
  answer: (allow: boolean) => void
}

/** How many earlier turns are sent with a question. */
const HISTORY_TURNS = 12

function persistChat({ username, conversationId, messages, recent }: { username?: string, conversationId: string, messages: Message[], recent: Conversation[] }) {
  saveChatHistory(username, { current: { id: conversationId, updatedAt: Date.now(), messages }, recent })
}

/**
 * The Assistant command palette (Cmd/Ctrl+K): a chat that can look things up
 * and, for an administrator, change them. Each destructive tool asks first
 * (`ConfirmToolDialog`); the page-edge glow shows while it works.
 *
 * The conversation survives closing the palette and reloading the page, and
 * the last few are kept (`chat-history.ts`, this browser, per user). Each
 * question goes with the page context (`ai-context.ts`).
 */
export function AssistantPalette({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const model = useAiStore(state => state.status?.model ?? null)
  const provider = useAiStore(state => state.status?.provider ?? null)
  const username = useAuthStore(state => state.user?.username)
  const location = useLocation()
  const [initial] = useState(() => loadChatHistory(username))
  const [conversationId, setConversationId] = useState(() => initial.current?.id ?? randomUuid())
  const [recent, setRecent] = useState<Conversation[]>(initial.recent)
  // An answer cut off by closing the palette mid-stream reads as stopped
  const [messages, setMessages] = useState<Message[]>(() => (initial.current?.messages ?? []).map(message =>
    message.role === 'assistant' && !message.content && !message.error ? { ...message, content: t('ai.chat.stopped') } : message))
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(Math.max(-1, ...messages.map(m => m.id)) + 1)
  const saved = useLatest({ username, conversationId, messages, recent })

  useEffect(() => {
    inputRef.current?.focus()
    // `saved` always holds the latest state (useLatest), which is what the cleanup wants
    const latest = saved
    return () => {
      abortRef.current?.abort()
      // Whatever was streamed so far is kept
      persistChat(latest.current)
    }
  }, [saved])

  // Saved between answers, not on every streamed chunk
  useEffect(() => {
    if (!running) {
      persistChat({ username, conversationId, messages, recent })
    }
  }, [username, conversationId, messages, recent, running])

  /** File the current conversation under recent ones and start another (or `next`). */
  const switchConversation = (next?: Conversation) => {
    if (running) {
      return
    }
    const current: Conversation = { id: conversationId, updatedAt: Date.now(), messages }
    setRecent(list => fileConversation(list.filter(c => c.id !== next?.id), current))
    setConversationId(next?.id ?? randomUuid())
    setMessages(next?.messages ?? [])
    nextIdRef.current = Math.max(-1, ...(next?.messages ?? []).map(m => m.id)) + 1
    setInput('')
    inputRef.current?.focus()
  }

  const clearHistory = () => {
    if (running) {
      return
    }
    setRecent([])
    setConversationId(randomUuid())
    setMessages([])
    inputRef.current?.focus()
  }

  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight })
  }, [messages])

  /** Update the assistant message being streamed (always the last one). */
  const updateLast = (change: (message: Message) => Message) => {
    setMessages(current => current.map((message, i) => (i === current.length - 1 ? change(message) : message)))
  }

  const onTool = (event: AiToolEvent) => {
    updateLast((message) => {
      const tools = message.tools ?? []
      if (event.phase === 'call') {
        return { ...message, tools: [...tools, { id: event.id, name: event.name, state: 'running' }] }
      }
      return { ...message, tools: tools.map(tool => (tool.id === event.id ? { ...tool, state: event.isError ? 'failed' : 'done' } : tool)) }
    })
  }

  const send = (event?: FormEvent) => {
    event?.preventDefault()
    const question = input.trim()
    if (!question || running) {
      return
    }
    const history: AiChatTurn[] = [...messages.filter(m => !m.error && m.content), { role: 'user' as const, content: question }]
      .slice(-HISTORY_TURNS)
      .map(({ role, content }) => ({ role, content }))
    const id = nextIdRef.current
    nextIdRef.current += 2
    setMessages(current => [...current, { id, role: 'user', content: question }, { id: id + 1, role: 'assistant', content: '' }])
    setInput('')
    setRunning(true)
    const abort = new AbortController()
    abortRef.current = abort
    let streamed = ''

    runAiStream<AiChatResult>('chat', { messages: history, context: buildAssistantContext(location.pathname) }, {
      signal: abort.signal,
      onChunk: (delta) => {
        streamed += delta
        updateLast(message => ({ ...message, content: streamed }))
      },
      onTool,
      onConfirm: request => new Promise<boolean>((resolve) => {
        setConfirm({
          request,
          answer: (allow) => {
            setConfirm(null)
            resolve(allow)
          },
        })
      }),
      onConfirmExpired: confirmId => setConfirm(current => (current?.request.confirmId === confirmId ? null : current)),
    }).then((result) => {
      updateLast(message => ({ ...message, content: result.text || streamed || t('ai.chat.no_answer') }))
    }, (error: unknown) => {
      updateLast(message => ({
        ...message,
        content: isAbortError(error) ? (streamed || t('ai.chat.stopped')) : (error as Error).message,
        error: !isAbortError(error),
      }))
    }).finally(() => {
      setConfirm(null)
      setRunning(false)
      inputRef.current?.focus()
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="modal-content hb-ai-palette">
      <ModalHeader title={t('ai.palette.title')} titleId="ai-palette-title" onClose={() => activeModal.dismiss('Dismiss')}>
        {/* The title already says Assistant: the badge names the model answering (and read-only for non-admins) */}
        <span className="d-flex gap-2 ms-2 me-auto">
          {model && <span className="mp-ai-badge hb-ai-palette-model" title={provider ?? undefined}>{model}</span>}
          {!isAdmin && <span className="mp-ai-badge">{t('ai.palette.read_only')}</span>}
        </span>
        <span className="d-flex gap-1 me-2">
          <button
            type="button"
            className="btn btn-elegant btn-sm m-0 hb-ai-palette-new"
            disabled={running || !messages.length}
            onClick={() => switchConversation()}
            title={t('ai.palette.new_chat')}
            aria-label={t('ai.palette.new_chat')}
          >
            <i className="fas fa-plus" aria-hidden="true"></i>
          </button>
          <Dropdown align="end">
            <Dropdown.Toggle
              variant="elegant"
              size="sm"
              className="btn-elegant m-0 hb-ai-palette-history"
              disabled={running}
              title={t('ai.palette.history')}
              aria-label={t('ai.palette.history')}
            >
              <i className="fas fa-clock-rotate-left" aria-hidden="true"></i>
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Header>{t('ai.palette.history')}</Dropdown.Header>
              {!recent.length && <Dropdown.ItemText className="grey-text small">{t('ai.palette.history_empty')}</Dropdown.ItemText>}
              {recent.map(conversation => (
                <Dropdown.Item key={conversation.id} as="button" type="button" onClick={() => switchConversation(conversation)}>
                  <span className="d-block text-truncate hb-ai-palette-history-title">{conversationTitle(conversation)}</span>
                  <small className="grey-text">{new Date(conversation.updatedAt).toLocaleString()}</small>
                </Dropdown.Item>
              ))}
              <Dropdown.Divider />
              <Dropdown.Item as="button" type="button" disabled={!recent.length && !messages.length} onClick={clearHistory}>
                <i className="fas fa-trash-can me-2" aria-hidden="true"></i>
                {t('ai.palette.clear_history')}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </span>
      </ModalHeader>
      <div className="modal-body p-0">
        <div className="mp-ai-chat border-0 rounded-0">
          <div ref={logRef} className="mp-ai-chat-log" role="log" aria-live="polite" aria-busy={running} aria-labelledby="ai-palette-title">
            {!messages.length && (
              <div className="mp-ai-chat-empty">
                <p className="mb-1">{t('ai.palette.empty')}</p>
                <small>{isAdmin ? t('ai.palette.hint_admin') : t('ai.palette.hint_read_only')}</small>
              </div>
            )}
            {messages.map(message => (
              <div key={message.id} className={cx('mp-ai-chat-msg', message.role === 'user' ? 'is-user' : 'is-assistant')}>
                <div className="mp-ai-chat-bubble">
                  <span className="visually-hidden">{message.role === 'user' ? t('ai.chat.you') : t('ai.chat.assistant')}</span>
                  {message.tools && message.tools.length > 0 && (
                    <ul className="hb-ai-tool-chips list-unstyled d-flex flex-wrap gap-1 mb-2" aria-label={t('ai.chat.tools_used')}>
                      {message.tools.map(tool => (
                        <li key={tool.id} className="mp-ai-badge">
                          <i
                            aria-hidden="true"
                            className={cx('fas', tool.state === 'running' && 'fa-circle-notch fa-spin', tool.state === 'done' && 'fa-check', tool.state === 'failed' && 'fa-xmark')}
                          >
                          </i>
                          <code>{tool.name}</code>
                          <span className="visually-hidden">
                            {tool.state === 'running' ? t('ai.chat.tool_running') : tool.state === 'done' ? t('ai.chat.tool_done') : t('ai.chat.tool_failed')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {message.role === 'user'
                    ? <span className="hb-ai-user-text">{message.content}</span>
                    : message.error
                      ? <p className="mp-ai-error m-0" role="alert">{message.content}</p>
                      : message.content
                        ? <AiMarkdown text={message.content} />
                        : <span className="mp-ai-thinking">{t('ai.thinking')}</span>}
                </div>
              </div>
            ))}
          </div>
          {confirm && (
            <ConfirmToolDialog request={confirm.request} onAnswer={confirm.answer} />
          )}
          <form className="mp-ai-chat-form" onSubmit={send}>
            <textarea
              ref={inputRef}
              className="mp-ai-chat-input"
              rows={1}
              value={input}
              maxLength={8000}
              aria-label={t('ai.palette.input')}
              placeholder={t('ai.palette.placeholder')}
              disabled={!!confirm}
              onChange={event => setInput(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {running
              ? (
                  <button type="button" className="btn btn-elegant m-0" onClick={() => abortRef.current?.abort()}>
                    {t('ai.chat.stop')}
                  </button>
                )
              : (
                  <button type="submit" className="mp-ai-button" disabled={!input.trim()}>
                    <i className="fas fa-paper-plane mp-ai-icon" aria-hidden="true"></i>
                    {t('ai.chat.send')}
                  </button>
                )}
          </form>
        </div>
        <p className="small grey-text px-3 py-2 m-0">{t('ai.disclaimer')}</p>
      </div>
    </div>
  )
}
