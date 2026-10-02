import type { ModalComponentProps } from '@/core/ui/modal'

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/** "A restart is needed": the restart button takes the user to the restart page. */
export function RestartHomebridge({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const onRestartHomebridgeClick = () => {
    void navigate('/restart')
    activeModal.close()
  }

  // Declining must not restart anything - the caller decides what to do
  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="restart-homebridge-modal-title">
      <div className="modal-header">
        <h5 className="modal-title" id="restart-homebridge-modal-title">
          {t('platform.version.service_restart_required')}
        </h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body text-center">
        <i className="fas fa-power-off primary-text mb-3 icon-xl"></i>
        <p className="mb-0">{t('plugins.settings.restart_required')}</p>
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start">
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
        <div className="text-center"></div>
        <div className="text-end">
          <button type="button" className="btn btn-primary" onClick={onRestartHomebridgeClick}>
            {t('menu.tooltip_restart')}
          </button>
        </div>
      </div>
    </div>
  )
}
