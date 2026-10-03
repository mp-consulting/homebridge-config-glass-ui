import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { accessoryOverviewCache } from '@/core/caching'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'

/** Remove every cached accessory, HAP and (with matter support) Matter. */
export function RemoveAllAccessories({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [clicked, setClicked] = useState(false)
  const [cachedAccessories, setCachedAccessories] = useState<any[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { hapAccessories, matterAccessories } = await accessoryOverviewCache.get<any, any>()
        const matterEnabled = settingsActions.isFeatureEnabled('matterSupport')
        if (active) {
          setCachedAccessories([...hapAccessories, ...(matterEnabled ? matterAccessories : [])])
        }
      } catch (error) {
        console.error(error)
        toast.error(i18n.t('reset.error_message'), i18n.t('toast.title_error'))
        activeModal.close()
      }
    })()
    return () => {
      active = false
    }
  }, [activeModal])

  const onResetCachedAccessoriesClick = async () => {
    setClicked(true)
    try {
      await api.put('/server/reset-cached-accessories', {})
      accessoryOverviewCache.invalidate()
      toast.success(t('reset.delete_success'), t('toast.title_success'))
      activeModal.close()
      void navigate('/restart?restarting=true')
    } catch (error) {
      setClicked(false)
      console.error(error)
      toast.error(t('reset.failed_to_reset'), t('toast.title_error'))
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const empty = cachedAccessories.length === 0

  return (
    <div className="modal-content">
      <ModalHeader title={t('reset.accessory_all.title')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        {empty
          ? (
              <>
                <div className="text-center mb-3">
                  <i className="fas fa-circle-check primary-text icon-xl"></i>
                </div>
                <p className="mb-0 text-center">{t('reset.no_accessories')}</p>
              </>
            )
          : (
              <>
                <div className="text-center mb-3">
                  <i className="fas fa-network-wired primary-text icon-xl"></i>
                </div>
                <ul className="mb-3">
                  <li>{t('reset.accessory_all.list_1')}</li>
                  <li>{t('reset.accessory_all.list_2')}</li>
                  <li>{t('reset.accessory_all.list_3')}</li>
                </ul>
                {/* ngb-alert type="error", not dismissible */}
                <div role="alert" className="alert alert-error mb-0 show fade">
                  <p className="text-center mb-0">{t('reset.action_is_irreversible')}</p>
                </div>
              </>
            )}
      </div>
      <ModalFooter>
        <div className="text-start">
          {!empty && (
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
          )}
        </div>
        <div className="text-center">
          {empty && (
            <button
              type="button"
              className="btn btn-elegant"
              data-bs-dismiss="modal"
              aria-label={t('form.button_close')}
              onClick={dismissModal}
            >
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {!empty && (
            <button
              type="button"
              className="btn btn-danger"
              data-bs-dismiss="modal"
              disabled={clicked}
              onClick={() => void onResetCachedAccessoriesClick()}
            >
              {!clicked ? t('form.button_remove') : <i className="fas fa-circle-notch fa-spin"></i>}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
