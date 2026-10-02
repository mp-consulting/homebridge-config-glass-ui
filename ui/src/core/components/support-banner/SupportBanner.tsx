import { useTranslation } from 'react-i18next'

import { SafeHtml } from '@/core/ui/SafeHtml'

const linkGithub = '<a href="https://github.com/mp-consulting/homebridge-config-glass-ui/issues/new?template=feature-request.yml" target="_blank" rel="noopener noreferrer">GitHub</a>'
const linkDiscord = '<a href="https://discord.gg/kqNCe2D" target="_blank" rel="noopener noreferrer">Discord</a>'

/** The "something missing? tell us" note under some settings pages. */
export function SupportBanner() {
  const { t } = useTranslation()
  // <ngb-alert type="info" [dismissible]="false"> rendered exactly this
  return (
    <SafeHtml
      role="alert"
      className="mt-4 mb-0 grey-text small alert show alert-info fade"
      html={t('common.phrases.support', { github: linkGithub, discord: linkDiscord })}
    />
  )
}
