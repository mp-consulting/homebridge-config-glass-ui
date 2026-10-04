import type { AiConfirmRequest } from '@/core/ai/ai.interfaces'

import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Asks before the Assistant runs a tool that changes something (restart,
 * uninstall, a config write…). Focus starts on Deny, Escape denies, and no
 * answer at all is a no: the server refuses the tool when its wait runs out.
 */
export function ConfirmToolDialog({ request, onAnswer }: { request: AiConfirmRequest, onAnswer: (allow: boolean) => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const denyRef = useRef<HTMLButtonElement>(null)
  const args = JSON.stringify(request.tool.arguments ?? {}, null, 2)

  useEffect(() => {
    denyRef.current?.focus()
  }, [request.confirmId])

  return (
    <div
      className="hb-ai-confirm mp-ai-halo m-3 p-3"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // Answer here rather than closing the palette around it
          event.stopPropagation()
          onAnswer(false)
        }
      }}
    >
      <h6 id={titleId} className="mb-2">
        <i className="fas fa-triangle-exclamation orange-text me-2" aria-hidden="true"></i>
        {t('ai.confirm.title')}
      </h6>
      <p id={descriptionId} className="mb-2">
        {t('ai.confirm.message')}
        {' '}
        <code>{request.tool.name}</code>
      </p>
      {args !== '{}' && (
        <pre className="hb-ai-confirm-args small mb-3" aria-label={t('ai.confirm.arguments')}>{args}</pre>
      )}
      <div className="d-flex gap-2 justify-content-end">
        <button ref={denyRef} type="button" className="btn btn-elegant m-0" onClick={() => onAnswer(false)}>
          {t('ai.confirm.deny')}
        </button>
        <button type="button" className="btn btn-danger m-0" onClick={() => onAnswer(true)}>
          {t('ai.confirm.allow')}
        </button>
      </div>
    </div>
  )
}
