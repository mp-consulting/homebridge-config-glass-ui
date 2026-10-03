import type { ModalComponentProps } from '@/core/ui/modal'

import { useTranslation } from 'react-i18next'

import { SupportBanner } from '@/core/components/support-banner/SupportBanner'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'

/** The help modal of the accessories page. */
export function AccessorySupport({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <form>
        <ModalHeader title={t('support.title')} onClose={dismissModal} />
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="far fa-circle-question primary-text icon-xl"></i>
          </div>
          <h5 className="ms-2">{t('menu.label_accessories')}</h5>
          <ul className="mb-4">
            <li>{t('accessories.support.acc_1')}</li>
            <li>{t('accessories.support.acc_2')}</li>
          </ul>
          <h5 className="ms-2">{t('accessories.title_rooms')}</h5>
          <ul className="mb-0">
            <li>{t('accessories.support.rooms_1')}</li>
            <li>{t('accessories.support.rooms_2')}</li>
            <li>{t('accessories.support.rooms_3')}</li>
          </ul>
          <SupportBanner />
        </div>
        <ModalFooter>
          <div className="text-start"></div>
          <div className="text-center">
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          </div>
          <div className="text-end"></div>
        </ModalFooter>
      </form>
    </div>
  )
}
