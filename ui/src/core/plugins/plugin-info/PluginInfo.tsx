import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginModalData } from '@/core/ui/modal-data'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_PLUGIN_ICON } from '@/core/constants/assets'
import { escapeHtml } from '@/core/helpers/html.helper'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { cx } from '@/core/utilities/cx'

import './plugin-info.scss'

export type PluginInfoProps = PluginModalData & ModalComponentProps

/** An icon-only wiki link, named for screen readers by `label` */
function wikiLink(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}"><i class="fas fa-external-link-alt primary-text" aria-hidden="true"></i></a>`
}

/** What the verified / scoped shields of a plugin mean. */
export function PluginInfo({ activeModal, plugin }: PluginInfoProps) {
  const { t } = useTranslation()
  const [iconError, setIconError] = useState(false)

  const pluginIcon = plugin?.icon && !iconError ? plugin.icon : DEFAULT_PLUGIN_ICON
  const verified = plugin.verifiedPlugin || plugin.verifiedPlusPlugin
  const hasLink = plugin.links.homepage || plugin.links.npm

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content hb-plugin-info">
      <ModalHeader title={t('plugins.manage.information')} onClose={dismissModal} />
      <div className="modal-body text-center">
        <img alt={t('plugins.manage.plugin_icon')} className="mb-3 plugin-icon-card" src={pluginIcon} onError={() => setIconError(true)} />
        <h4 className="mb-1">{plugin.displayName}</h4>
        <p className="grey-text mb-0 font-monospace">{plugin.name}</p>
        <p className="grey-text mb-1 font-monospace">
          @
          {plugin.author}
        </p>
        <p className="mb-3">{plugin.description}</p>
        <i
          aria-hidden="true"
          className={cx('fas fa-shield-alt mb-3 shield-icon', !verified && 'orange-text', verified && 'grey-text', verified && 'opacity-muted')}
        >
        </i>
        <i
          aria-hidden="true"
          className={cx(
            'fas fa-shield-alt mb-3 shield-icon',
            !plugin.isHbScoped && verified && 'green-text',
            (plugin.isHbScoped || !verified) && 'grey-text',
            (plugin.isHbScoped || !verified) && 'opacity-muted',
          )}
        >
        </i>
        <i
          aria-hidden="true"
          className={cx(
            'fas fa-shield-alt mb-3 shield-icon',
            plugin.isHbScoped && 'purple-text',
            !plugin.isHbScoped && 'grey-text',
            !plugin.isHbScoped && 'opacity-muted',
          )}
        >
        </i>
        {plugin.isHbScoped && (
          <>
            <h6 className="mb-2">{t('plugins.manage.scoped_subtitle')}</h6>
            <p className="mb-1 grey-text">{t('plugins.manage.scoped_message')}</p>
            <p className="mb-1 grey-text">{t('plugins.manage.verified_message')}</p>
          </>
        )}
        {!plugin.isHbScoped && verified && (
          <>
            <h6 className="mb-2">{t('plugins.manage.verified_subtitle')}</h6>
            <p className="mb-1 grey-text">{t('plugins.manage.verified_message')}</p>
          </>
        )}
        {!verified && (
          <>
            <h6 className="mb-2">{t('plugins.manage.unverified_subtitle')}</h6>
            <p className="mb-1 grey-text">{t('plugins.manage.unverified_message')}</p>
          </>
        )}
        <SafeHtml
          as="p"
          className="mb-0 grey-text"
          html={t('plugins.manage.more_info', {
            scopedLink: wikiLink('https://github.com/homebridge/plugins/wiki/Scoped-Plugins', t('plugins.manage.link_scoped_wiki')),
            verifiedLink: wikiLink('https://github.com/homebridge/plugins/wiki/Verified-Plugins', t('plugins.manage.link_verified_wiki')),
          })}
        />
      </div>
      <ModalFooter>
        <div className="text-start">
          {hasLink && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {!hasLink && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {hasLink && (
            <a
              className="btn btn-primary text-decoration-none"
              target="_blank"
              rel="noopener noreferrer"
              href={plugin.links.homepage || plugin.links.npm}
            >
              {t('plugins.button_homepage')}
              {' '}
              <i className="fas fa-external-link-alt" aria-hidden="true"></i>
            </a>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
