import type { ModalComponentProps } from '@/core/ui/modal'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { ttlCache } from '@/core/caching'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'

/**
 * Reset the main bridge: new username and pin, every pairing gone. Takes a
 * second click on a confirm step, since nothing about it can be undone.
 */
export function ResetAllBridges({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [clicked, setClicked] = useState(false)
  const [confirmMode, setConfirmMode] = useState(false)

  const toggleConfirmMode = (event: MouseEvent<HTMLButtonElement>) => {
    setConfirmMode(mode => !mode)
    event.currentTarget.blur()
  }

  const onResetHomebridgeAccessoryClick = async () => {
    setClicked(true)
    try {
      await api.put('/server/reset-homebridge-accessory', {})
      ttlCache.invalidateAll()
      toast.success(t('reset.accessory_reset'), t('toast.title_success'))
      activeModal.close()
      void navigate('/restart')
    } catch (error) {
      console.error(error)
      setClicked(false)
      toast.error(t('reset.failed_to_reset'), t('toast.title_error'))
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <ModalHeader title={t('reset.bridge_all.title')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        <div className="text-center mb-4"><i className="fas fa-bridge primary-text icon-xl"></i></div>
        <ul className={confirmMode ? 'opacity-muted mb-4' : 'mb-0'}>
          <li>{t('reset.bridge_all.list_1')}</li>
          <li>{t('reset.bridge_all.list_2')}</li>
          <li>{t('reset.bridge_all.list_3')}</li>
          <li>{t('reset.bridge_all.list_4')}</li>
        </ul>
        {confirmMode && (
          <div className="alert alert-warning mb-0">
            <div className="text-center">
              {t('reset.action_is_irreversible')}
            </div>
          </div>
        )}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            disabled={clicked}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          {confirmMode
            ? (
                <>
                  <button type="button" className="btn btn-elegant me-2" disabled={clicked} onClick={toggleConfirmMode}>
                    <i className="fas fa-undo"></i>
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    data-bs-dismiss="modal"
                    disabled={clicked}
                    onClick={() => void onResetHomebridgeAccessoryClick()}
                  >
                    {!clicked ? t('form.button_reset') : <i className="fas fa-circle-notch fa-spin"></i>}
                  </button>
                </>
              )
            : (
                <button type="button" className="btn btn-primary" onClick={toggleConfirmMode}>
                  {t('form.button_continue')}
                </button>
              )}
        </div>
      </ModalFooter>
    </div>
  )
}
