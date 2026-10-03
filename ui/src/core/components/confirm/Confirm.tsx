import type { ModalComponentProps } from '@/core/ui/modal'
import type { ConfirmModalData } from '@/core/ui/modal-data'

import { useTranslation } from 'react-i18next'

import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'

export type ConfirmProps = ConfirmModalData & ModalComponentProps

/**
 * The generic "are you sure?" dialog. Resolves (`close()`) when the user
 * agrees and rejects (`dismiss('Dismiss')`) when they back out — every caller
 * branches on that, so getting it the wrong way round turns a cancel into a
 * confirmation.
 */
export function Confirm({ activeModal, title, message, message2, message3, confirmButtonLabel, confirmButtonClass, faIconClass }: ConfirmProps) {
  const { t } = useTranslation()
  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close()

  return (
    <div className="modal-content">
      <ModalHeader title={title} titleId="confirm-modal-title" onClose={dismissModal} />
      <div className="modal-body text-center">
        {faIconClass && <i className={`fas ${faIconClass} mb-3 icon-xl`}></i>}
        <SafeHtml as="p" className="mb-0 text-center" html={message} />
        {message2 && <SafeHtml as="p" className="mt-2 mb-0 text-center" html={message2} />}
        {message3 && <SafeHtml as="p" className="mt-2 mb-0 text-center" html={message3} />}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_cancel')}
            onClick={dismissModal}
          >
            {t('form.button_cancel')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          {confirmButtonLabel && (
            <button
              type="button"
              data-bs-dismiss="modal"
              className={`btn ${confirmButtonClass || 'btn-primary'}`}
              onClick={closeModal}
            >
              {confirmButtonLabel}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
