import type { ModalComponentProps } from '@/core/ui/modal'

import { useTranslation } from 'react-i18next'

import { SupportBanner } from '@/core/components/support-banner/SupportBanner'
import { SafeHtml } from '@/core/ui/SafeHtml'

/** "Help with plugins": what plugins are and where to ask about one. */
export function PluginSupport({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="plugin-support-modal-title">
      <form>
        <div className="modal-header">
          <h5 className="modal-title" id="plugin-support-modal-title">{t('support.title')}</h5>
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
          <div className="text-center mb-3">
            <i className="far fa-circle-question primary-text icon-xl"></i>
          </div>
          <ul className="mb-0">
            <SafeHtml as="li" html={t('plugins.support.list_1')} />
            <SafeHtml as="li" html={t('plugins.support.list_2')} />
            <SafeHtml as="li" html={t('plugins.support.list_3')} />
            <SafeHtml as="li" html={t('plugins.support.list_4')} />
          </ul>
          <SupportBanner />
        </div>
        <div className="modal-footer justify-content-between">
          <div className="text-start"></div>
          <div className="text-center">
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          </div>
          <div className="text-end"></div>
        </div>
      </form>
    </div>
  )
}
