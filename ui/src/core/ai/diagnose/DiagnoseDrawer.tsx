import type { AiTextResult } from '@/core/ai/ai.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { FormEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isAbortError, runAiStream } from '@/core/ai/ai-stream'
import { AiMarkdown } from '@/core/ai/AiMarkdown'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'

export interface DiagnoseDrawerProps extends ModalComponentProps {
  /** What to look at first, e.g. a plugin name. */
  focus?: string
}

/**
 * Log Doctor: the Assistant reads the end of the Homebridge log and explains
 * what is wrong, streaming its answer into a halo panel. Opened as a side
 * drawer (`hb-ai-drawer`) from the Logs page and the logs widget.
 */
export function DiagnoseDrawer({ activeModal, focus: initialFocus = '' }: DiagnoseDrawerProps) {
  const { t } = useTranslation()
  const [focus, setFocus] = useState(initialFocus)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // Starts running: the drawer diagnoses as soon as it opens
  const [running, setRunning] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  /** Stream a diagnosis into the panel (the state is reset by the caller). */
  const run = () => {
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    let streamed = ''
    runAiStream<AiTextResult & { lines: number }>('diagnose-logs', { focus: focus.trim() || undefined }, {
      signal: abort.signal,
      onChunk: (delta) => {
        streamed += delta
        setText(streamed)
      },
    }).then((result) => {
      setText(result.text || streamed)
    }, (err: unknown) => {
      if (!isAbortError(err)) {
        setError((err as Error).message)
      }
    }).finally(() => {
      if (abortRef.current === abort) {
        setRunning(false)
      }
    })
  }

  const diagnose = () => {
    setText('')
    setError('')
    setRunning(true)
    run()
  }

  useEffect(() => {
    run()
    return () => abortRef.current?.abort()
    // Starts once, when the drawer opens
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    diagnose()
  }

  return (
    <div className="modal-content hb-ai-diagnose">
      <ModalHeader title={t('ai.log_doctor.title')} titleId="ai-diagnose-title" onClose={() => activeModal.dismiss('Dismiss')}>
        <span className="mp-ai-badge ms-2 me-auto">{t('ai.badge')}</span>
      </ModalHeader>
      <div className="modal-body">
        <form className="d-flex gap-2 mb-3" onSubmit={onSubmit}>
          <input
            type="text"
            className="form-control"
            value={focus}
            maxLength={500}
            aria-label={t('ai.log_doctor.focus')}
            placeholder={t('ai.log_doctor.focus_placeholder')}
            onChange={event => setFocus(event.target.value)}
          />
          <button type="submit" className="mp-ai-button text-nowrap" aria-busy={running || undefined} disabled={running}>
            <i className="fas fa-wand-magic-sparkles mp-ai-icon" aria-hidden="true"></i>
            {t('ai.log_doctor.diagnose')}
          </button>
        </form>
        <section
          className={cx('mp-ai-panel', running && 'is-streaming')}
          aria-labelledby="ai-diagnose-title"
          aria-live="polite"
          aria-busy={running}
        >
          {!text && running && <span className="mp-ai-thinking">{t('ai.thinking')}</span>}
          {text && <AiMarkdown text={text} />}
          {running && text && <span className="mp-ai-caret" aria-hidden="true"></span>}
          {error && <p className="mp-ai-error" role="alert">{error}</p>}
          {!running && !error && text && <p className="mp-ai-panel-note">{t('ai.disclaimer')}</p>}
        </section>
      </div>
      <ModalFooter>
        <button type="button" className="btn btn-elegant" onClick={() => activeModal.dismiss('Dismiss')}>
          {t('form.button_close')}
        </button>
        {running && (
          <button type="button" className="btn btn-elegant" onClick={() => abortRef.current?.abort()}>
            {t('form.button_cancel')}
          </button>
        )}
      </ModalFooter>
    </div>
  )
}
