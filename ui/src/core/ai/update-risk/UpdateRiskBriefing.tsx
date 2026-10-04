import type { AiUpdateRisk } from '@/core/ai/ai.interfaces'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAiEnabled } from '@/core/ai/ai.store'
import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth'
import { cx } from '@/core/utilities/cx'

const RISK_ICON: Record<AiUpdateRisk['risk'], string> = {
  low: 'fas fa-circle-check green-text',
  medium: 'fas fa-circle-exclamation orange-text',
  high: 'fas fa-triangle-exclamation red-text',
}

/**
 * The update risk briefing for one plugin update, on demand: a button, then a
 * risk badge with the Assistant's summary of the release notes and any
 * breaking changes. Renders nothing while the Assistant is off or for a
 * non-admin (who cannot update plugins).
 */
export function UpdateRiskBriefing({ pluginName, currentVersion, targetVersion, compact = false }: {
  pluginName: string
  currentVersion?: string
  targetVersion?: string
  /** One line (the Update All list): the summary goes into the badge's title. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const enabled = useAiEnabled()
  const isAdmin = useAuthStore(state => !!state.user?.admin)
  const [loading, setLoading] = useState(false)
  const [risk, setRisk] = useState<AiUpdateRisk | null>(null)
  const [error, setError] = useState('')

  if (!enabled || !isAdmin) {
    return null
  }

  const assess = async () => {
    setLoading(true)
    setError('')
    try {
      setRisk(await api.post<AiUpdateRisk>('/ai/update-risk', { pluginName, currentVersion, targetVersion }))
    } catch (err: any) {
      setError(err?.error?.message ?? err?.message ?? t('ai.update_risk.failed'))
    } finally {
      setLoading(false)
    }
  }

  const riskLabels: Record<AiUpdateRisk['risk'], string> = {
    low: t('ai.update_risk.low'),
    medium: t('ai.update_risk.medium'),
    high: t('ai.update_risk.high'),
  }

  if (!risk) {
    return (
      <span className={cx('hb-ai-update-risk', !compact && 'd-block my-2')}>
        <button
          type="button"
          className={cx('mp-ai-button', compact && 'mp-ai-button-sm')}
          aria-busy={loading || undefined}
          disabled={loading}
          onClick={() => void assess()}
        >
          <i className="fas fa-wand-magic-sparkles mp-ai-icon" aria-hidden="true"></i>
          {loading ? t('ai.thinking') : t('ai.update_risk.assess')}
        </button>
        {error && <span className="mp-ai-error d-block" role="alert">{error}</span>}
      </span>
    )
  }

  const badge = (
    <span className="mp-ai-badge" title={compact ? risk.summary : undefined}>
      <i className={RISK_ICON[risk.risk]} aria-hidden="true"></i>
      {riskLabels[risk.risk]}
    </span>
  )

  if (compact) {
    return <span className="hb-ai-update-risk" role="status">{badge}</span>
  }

  return (
    <section className="hb-ai-update-risk mp-ai-panel my-2" aria-label={t('ai.update_risk.title')} role="status">
      <div className="mp-ai-panel-header">
        {badge}
        <h6 className="mp-ai-panel-title">{t('ai.update_risk.title')}</h6>
      </div>
      <p className="mb-1">{risk.summary}</p>
      {risk.breakingChanges.length > 0 && (
        <>
          <p className="mb-1 fw-semibold">{t('ai.update_risk.breaking')}</p>
          <ul className="mb-0">
            {risk.breakingChanges.map(change => <li key={change}>{change}</li>)}
          </ul>
        </>
      )}
      <p className="mp-ai-panel-note">{risk.hasChangelog ? t('ai.disclaimer') : t('ai.update_risk.no_changelog')}</p>
    </section>
  )
}
