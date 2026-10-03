import { useTranslation } from 'react-i18next'

import { Markdown } from '@/core/components/markdown/Markdown'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { SafeHtml } from '@/core/ui/SafeHtml'

function Spinner() {
  return (
    <div className="w-100 text-center primary-text mt-3 mb-4">
      <InlineSpinner className="icon-xl" />
    </div>
  )
}

/** The "Release Notes" tab of the manage plugin modal: the target version's notes, or why there are none. */
export function ReleaseNotesPane({ loading, notes, showNone, targetVersion, pluginDisplayName }: {
  /** Still fetching (an update whose notes have not arrived). */
  loading: boolean
  notes: string
  /** Say "no notes" rather than the pre-release / latest hint. */
  showNone: boolean
  targetVersion: string
  pluginDisplayName: string
}) {
  const { t } = useTranslation()
  const isPrereleaseTarget = targetVersion.includes('beta') || targetVersion.includes('alpha') || targetVersion.includes('next')
  return (
    <div className="alert release-notes p-3 pb-1 my-0">
      {loading
        ? <Spinner />
        : notes
          ? <Markdown className="plugin-md" data={notes} />
          : showNone
            ? <div className="w-100 text-center grey-text mt-3 mb-4">{t('plugins.manage.notes_none')}</div>
            : isPrereleaseTarget
              ? (
                  <div className="w-100 text-center grey-text mt-3 mb-4">
                    {t('plugins.manage.notes_beta_1', { pluginName: pluginDisplayName })}
                    <br />
                    {t('plugins.manage.notes_beta_2')}
                    <br />
                    {t('plugins.manage.notes_beta_3')}
                    <br />
                  </div>
                )
              : <div className="w-100 text-center grey-text mt-3 mb-4">{t('plugins.manage.notes_latest')}</div>}
    </div>
  )
}

/** The "Changelog" tab of the manage plugin modal. */
export function ChangelogPane({ loading, changelog }: { loading: boolean, changelog: string }) {
  const { t } = useTranslation()
  return (
    <div className="alert release-notes p-3 pb-1 my-0">
      {loading
        ? <Spinner />
        : changelog
          ? <Markdown className="plugin-md" data={changelog} />
          : <SafeHtml className="w-100 text-center grey-text mt-3 mb-4" html={t('plugins.manage.changelog_none')} />}
    </div>
  )
}
