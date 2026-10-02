import type { ModalComponentProps } from '@/core/ui/modal'

import { useTranslation } from 'react-i18next'

import { SupportBanner } from '@/core/components/support-banner/SupportBanner'

/** What the two account types can do. */
export function UsersSupport({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <form>
        <div className="modal-header">
          <h5 className="modal-title">{t('support.title')}</h5>
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
          <h5 className="ms-2">{t('users.title_users')}</h5>
          <ul className="mb-0">
            <li>{t('users.support.acc_1')}</li>
            <ul className="mb-2 grey-text">
              <li>{t('menu.label_status')}</li>
              <li>{t('menu.label_plugins')}</li>
              <li>
                {t('menu.label_accessories')}
                {' ('}
                {t('users.support.control')}
                )
              </li>
              <li>{t('menu.linux.label_logs')}</li>
              <li>{t('support.title')}</li>
            </ul>
            <li>{t('users.support.acc_2')}</li>
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
