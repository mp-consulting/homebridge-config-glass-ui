import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'

import { swaggerUrl } from './swagger-url'

interface SupportLink {
  /** i18n key of the label */
  key: string
  /** i18n key of the line under it (written out, so lang-sync sees it used) */
  sub: string
  href: string
}

const generalLinks: SupportLink[] = [
  { key: 'support.links.documentation', sub: 'support.links.documentation_sub', href: 'https://github.com/homebridge/homebridge/wiki' },
  { key: 'support.links.issue', sub: 'support.links.issue_sub', href: 'https://github.com/mp-consulting/homebridge-config-glass-ui/issues/new/choose' },
  { key: 'support.links.discord', sub: 'support.links.discord_sub', href: 'https://discord.gg/C87Pvq3' },
  { key: 'support.links.reddit', sub: 'support.links.reddit_sub', href: 'https://www.reddit.com/r/homebridge/' },
]

/**
 * @param swaggerEnabled - whether the server serves /swagger. It only does in
 * development: unauthenticated api docs map the whole api for anyone.
 */
function devLinks(swaggerEnabled: boolean): SupportLink[] {
  return [
    ...(swaggerEnabled ? [{ key: 'support.dev.item_swagger', sub: 'support.dev.item_swagger_sub', href: swaggerUrl() }] : []),
    { key: 'support.dev.api', sub: 'support.dev.api_sub', href: 'https://developers.homebridge.io/#/' },
    { key: 'support.dev.api_hap', sub: 'support.dev.api_hap_sub', href: 'https://developers.homebridge.io/HAP-NodeJS/' },
    { key: 'support.dev.template', sub: 'support.dev.template_sub', href: 'https://github.com/homebridge/homebridge-plugin-template' },
    { key: 'support.dev.verified', sub: 'support.dev.verified_sub', href: 'https://github.com/homebridge/homebridge/wiki/Verified-Plugins' },
    { key: 'support.dev.unmaintained', sub: 'support.dev.unmaintained_sub', href: 'https://github.com/homebridge/plugins/wiki/Unmaintained-Plugins#%E2%80%8D%EF%B8%8F-want-to-help-maintain-a-plugin' },
  ]
}

type Section = 'general' | 'dev'

function LinkList({ id, links }: { id: string, links: SupportLink[] }) {
  const { t } = useTranslation()
  return (
    <ul className="list-group list-group-box mt-2 mx-0" id={id}>
      {links.map(link => (
        <li key={link.key} className="list-group-item d-flex justify-content-between align-items-center">
          <span className="pe-2">
            {t(link.key)}
            <br />
            <small className="grey-text pe-2">{t(link.sub)}</small>
          </span>
          <a
            className="btn btn-primary waves-effect m-0 min-w-50"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(link.key)}
          >
            <i className="fas fa-external-link-alt" aria-hidden="true"></i>
          </a>
        </li>
      ))}
    </ul>
  )
}

function DisclosureToggle({ open, controls, label, onToggle }: { open: boolean, controls: string, label: string, onToggle: () => void }) {
  return (
    <h5 className="primary-text mt-3">
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={controls}
        onClick={onToggle}
      >
        <i className={`fa ${open ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
        {' '}
        {label}
      </button>
    </h5>
  )
}

/** The support page: links out to docs, issues, Discord, Reddit and the developer resources. */
export function Support() {
  const { t } = useTranslation()
  const [showFields, setShowFields] = useState<Record<Section, boolean>>({ general: true, dev: true })
  const swaggerEnabled = useSettingsStore(s => s.env.swaggerEnabled === true)

  useEffect(() => {
    // Set page title
    settingsActions.setPageTitle(i18n.t('support.title'))
  }, [])

  const toggleSection = (section: Section) => {
    setShowFields(fields => ({ ...fields, [section]: !fields[section] }))
  }

  return (
    <>
      <div className="d-flex justify-content-between">
        <h3 className="primary-text m-0">{t('support.title')}</h3>
      </div>

      <div className="mb-4">
        <DisclosureToggle open={showFields.general} controls="fieldsGeneral" label={t('support.links.title')} onToggle={() => toggleSection('general')} />
        {showFields.general && <LinkList id="fieldsGeneral" links={generalLinks} />}
      </div>
      <div className="pb-3">
        <DisclosureToggle open={showFields.dev} controls="fieldsDev" label={t('support.dev.title')} onToggle={() => toggleSection('dev')} />
        {showFields.dev && <LinkList id="fieldsDev" links={devLinks(swaggerEnabled)} />}
      </div>
    </>
  )
}
