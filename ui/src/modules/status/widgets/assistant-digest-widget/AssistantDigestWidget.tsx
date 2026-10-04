import type { AiDigest } from '@/core/ai/ai.interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { SyntheticEvent } from 'react'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAiEnabled } from '@/core/ai/ai.store'
import { AiMarkdown } from '@/core/ai/AiMarkdown'
import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { cx } from '@/core/utilities/cx'

/** Keep a press on the refresh button from starting a grid drag. */
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

/**
 * The daily digest: the Assistant's short summary of what needs attention
 * (updates, warnings in the log, status). The server caches it for a few
 * hours; the refresh button asks for a new one.
 */
export function AssistantDigestWidget({ widget }: WidgetProps) {
  const { t } = useTranslation()
  const enabled = useAiEnabled()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const [digest, setDigest] = useState<AiDigest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      setDigest(await api.get<AiDigest>('/ai/digest', { params: refresh ? { refresh: true } : undefined }))
    } catch (err: any) {
      setError(err?.error?.message ?? err?.message ?? t('ai.digest.failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (enabled && isAdmin) {
      void load()
    }
  }, [enabled, isAdmin, load])

  return (
    <div className="hb-ai-digest-widget flex-column d-flex align-items-stretch h-100 w-100">
      <div className={cx('drag-handler p-2 d-flex align-items-center justify-content-between', widget.draggable && 'widget-cursor')}>
        <span>
          <i className="fas fa-wand-magic-sparkles me-1" aria-hidden="true"></i>
          {t('ai.digest.title')}
        </span>
        {enabled && isAdmin && (
          <HoverTooltip text={t('ai.digest.refresh')} placement="bottom">
            <button
              type="button"
              className="widget-toolbar-button"
              aria-label={t('ai.digest.refresh')}
              disabled={loading}
              onMouseDown={stopPropagation}
              onTouchStart={stopPropagation}
              onClick={() => void load(true)}
            >
              <i className={cx('fas fa-arrows-rotate', loading && 'fa-spin')} aria-hidden="true"></i>
            </button>
          </HoverTooltip>
        )}
      </div>
      <div className="hb-ai-digest-body gridster-item-content flex-grow-1 px-2 pb-2" aria-live="polite" aria-busy={loading}>
        {!enabled || !isAdmin
          ? <p className="grey-text small m-0">{t('ai.digest.unavailable')}</p>
          : (
              <div className={cx('mp-ai-panel', loading && 'is-streaming')}>
                {loading && !digest && <span className="mp-ai-thinking">{t('ai.thinking')}</span>}
                {digest && <AiMarkdown text={digest.text} />}
                {error && <p className="mp-ai-error" role="alert">{error}</p>}
                {digest && (
                  <p className="mp-ai-panel-note">
                    {t('ai.digest.generated', { date: new Date(digest.generatedAt).toLocaleString() })}
                  </p>
                )}
              </div>
            )}
      </div>
    </div>
  )
}
