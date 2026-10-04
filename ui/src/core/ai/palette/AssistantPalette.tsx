import type { AiChatResult, AiChatTurn, AiConfirmRequest, AiToolEvent } from '@/core/ai/ai.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { FormEvent, KeyboardEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isAbortError, runAiStream } from '@/core/ai/ai-stream'
import { AiMarkdown } from '@/core/ai/AiMarkdown'
import { useAuthStore } from '@/core/auth'
import { ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'

import { ConfirmToolDialog } from './ConfirmToolDialog'

interface ToolChip {
  id: string
  name: string
  state: 'running' | 'done' | 'failed'
}

interface Message extends AiChatTurn {
  id: number
  tools?: ToolChip[]
  error?: boolean
}

interface PendingConfirm {
  request: AiConfirmRequest
  answer: (allow: boolean) => void
}

/** How many earlier turns are sent with a question. */
const HISTORY_TURNS = 12

/**
 * The Assistant command palette (Cmd/Ctrl+K): a chat that can look things up
 * and, for an administrator, change them. Each destructive tool asks first
 * (`ConfirmToolDialog`); the page-edge glow shows while it works.
 */
export function AssistantPalette({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
    return () => abortRef.current?.abort()
  }, [])

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

    runAiStream<AiChatResult>('chat', { messages: history }, {
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
        <span className="mp-ai-badge ms-2 me-auto">{isAdmin ? t('ai.badge') : t('ai.palette.read_only')}</span>
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
