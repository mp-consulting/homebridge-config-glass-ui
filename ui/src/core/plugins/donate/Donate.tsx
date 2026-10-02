import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginModalData } from '@/core/ui/modal-data'

import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getIconClass, normaliseFunding } from '@/core/plugins/donate/funding'

import './donate.scss'

export type DonateProps = PluginModalData & ModalComponentProps

/** The ways to fund a plugin's author. */
export function Donate({ activeModal, plugin }: DonateProps) {
  const { t } = useTranslation()
  const hasFunding = Boolean(plugin?.funding)

  useEffect(() => {
    if (!hasFunding) {
      activeModal.close()
    }
  }, [hasFunding, activeModal])

  // Override author for @mp-consulting/homebridge-config-glass-ui
  const authorName = !hasFunding
    ? ''
    : plugin.name === '@mp-consulting/homebridge-config-glass-ui' ? 'MP Consulting' : plugin.author
  const fundingOptions = useMemo(() => (hasFunding ? normaliseFunding(plugin.funding) : []), [hasFunding, plugin])

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content hb-donate">
      <div className="modal-header">
        <h5 className="modal-title">{t('plugins.donate.tile_donate_to', { author: `@${authorName}` })}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body">
        <div className="text-center pink-text mb-3">
          <i className="fas fa-heart icon-xl"></i>
        </div>
        <ul className="mb-3">
          <li>{t('plugins.donate.message_1')}</li>
          <li>{t('plugins.donate.message_2')}</li>
        </ul>
        <ul className="list-group list-group-box">
          {fundingOptions.map((option, index) => (
            // eslint-disable-next-line react/no-array-index-key -- urls may repeat; Angular tracked by object identity
            <li key={index} className="list-group-item d-flex align-items-center">
              <i className={`me-3 my-4 primary-text fa-2xl ${getIconClass(option.type)}`}></i>
              <a target="_blank" rel="noopener noreferrer" className="text-break-all fs-6" href={option.url}>{option.url}</a>
            </li>
          ))}
        </ul>
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start"></div>
        <div className="text-center">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-end"></div>
      </div>
    </div>
  )
}
