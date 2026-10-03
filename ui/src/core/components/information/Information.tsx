import type { ModalComponentProps } from '@/core/ui/modal'
import type { InformationModalData } from '@/core/ui/modal-data'

import { useTranslation } from 'react-i18next'

import { Markdown } from '@/core/components/markdown/Markdown'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'

export type InformationProps = InformationModalData & ModalComponentProps

/** A read-only notice. There is nothing to agree to, so it only ever dismisses. */
export function Information({ activeModal, title, subtitle, message, markdownMessage2, ctaButtonLabel, ctaButtonLink, faIconClass }: InformationProps) {
  const { t } = useTranslation()
  const dismissModal = () => activeModal.dismiss('Dismiss')

  const closeButton = (
    <button
      type="button"
      className="btn btn-elegant"
      data-bs-dismiss="modal"
      aria-label={t('form.button_close')}
      onClick={dismissModal}
    >
      {t('form.button_close')}
    </button>
  )

  return (
    <div className="modal-content">
      <ModalHeader title={title} titleId="information-modal-title" onClose={dismissModal} />
      <div className="modal-body text-center">
        {faIconClass && <i aria-hidden="true" className={`fas ${faIconClass} mb-3 icon-xl`}></i>}
        {subtitle && <SafeHtml as="h5" className="mb-3" html={subtitle} />}
        <SafeHtml as="p" className="mb-0" html={message} />
        {markdownMessage2 && (
          <div className="alert p-3 mt-3">
            <Markdown className="plugin-md" data={markdownMessage2} />
          </div>
        )}
      </div>
      <ModalFooter>
        <div className="text-start">
          {ctaButtonLink && closeButton}
        </div>
        <div className="text-center">
          {!ctaButtonLink && closeButton}
        </div>
        <div className="text-end">
          {ctaButtonLink && (
            <a
              className="btn btn-primary text-decoration-none"
              target="_blank"
              rel="noopener noreferrer"
              href={ctaButtonLink}
            >
              {ctaButtonLabel}
              {' '}
              <i className="fas fa-external-link-alt" aria-hidden="true"></i>
            </a>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
