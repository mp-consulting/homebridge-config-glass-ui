import type { ModalComponentProps } from '@/core/ui/modal'
import type { BridgeEntry, Protocol } from '@/modules/settings/remove-bridge-accessories/bridge-entries'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { accessoryOverviewCache } from '@/core/caching'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { bridgeEntries } from '@/modules/settings/remove-bridge-accessories/bridge-entries'

/** Clear the cached accessories of chosen child bridges. */
export function RemoveBridgeAccessories({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [clicked, setClicked] = useState(false)
  const [pairings, setPairings] = useState<BridgeEntry[]>([])
  const [toDelete, setToDelete] = useState<{ id: string, protocol: Protocol }[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { pairings } = await accessoryOverviewCache.get<any, any, any>()
        if (active) {
          setPairings(bridgeEntries(pairings, settingsActions.isFeatureEnabled('matterSupport')))
        }
      } catch (error) {
        console.error(error)
        toast.error(i18n.t('settings.unpair_bridge.load_error'), i18n.t('toast.title_error'))
        activeModal.close()
      }
    })()
    return () => {
      active = false
    }
  }, [activeModal])

  const isInList = (id: string, protocol: Protocol) => toDelete.some(item => item.id === id && item.protocol === protocol)

  const toggleList = (id: string, protocol: Protocol) => {
    setToDelete(list => list.some(item => item.id === id && item.protocol === protocol)
      ? list.filter(item => item.id !== id || item.protocol !== protocol)
      : [...list, { id, protocol }])
  }

  const cleanBridges = async () => {
    setClicked(true)
    try {
      await api.delete('/server/pairings/accessories', {
        body: toDelete,
      })
      accessoryOverviewCache.invalidate()
      toast.success(t('reset.accessory_ind.done'), t('toast.title_success'))
      activeModal.close()
      void navigate('/restart?restarting=true')
    } catch (error) {
      setClicked(false)
      console.error(error)
      toast.error(t('reset.accessory_ind.fail'), t('toast.title_error'))
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const empty = pairings.length === 0

  return (
    <div className="modal-content">
      <ModalHeader title={t('reset.bridge_accessories.title')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        {empty
          ? (
              <>
                <div className="text-center mb-3">
                  <i className="fas fa-circle-check primary-text icon-xl"></i>
                </div>
                <p className="mb-0 text-center">{t('reset.bridge_accessories.empty')}</p>
              </>
            )
          : (
              <>
                <div className="text-center mb-3">
                  <i className="fas fa-broom primary-text icon-xl"></i>
                </div>
                <ul className="mb-3">
                  <li>{t('reset.bridge_accessories.list_1')}</li>
                  <li>{t('reset.clear_cache_single.list_3')}</li>
                  <li>{t('reset.bridge_accessories.list_2')}</li>
                </ul>
                <ul className="list-group list-group-box">
                  {pairings.map((item) => {
                    const inList = isInList(item._id, item._protocol)
                    return (
                      <li key={`${item._id}-${item._protocol}`} className="list-group-item d-flex justify-content-between align-items-center">
                        <span className="me-3">
                          <i className={`fas fa-lg ${item._protocol === 'matter' ? 'fa-matter' : 'fa-hap'}`}></i>
                        </span>
                        <span className="flex-grow-1">
                          {item.name}
                          <br />
                          <small className="grey-text">
                            <span className="font-monospace">{item._username}</span>
                          </small>
                        </span>
                        <button
                          type="button"
                          className={`btn m-0 ms-3 ${inList ? 'btn-elegant' : 'btn-danger'}`}
                          disabled={clicked}
                          aria-label={t('form.button_delete')}
                          onClick={() => toggleList(item._id, item._protocol)}
                        >
                          <i className={`fas ${!inList ? 'fa-broom' : clicked ? 'fa-circle-notch fa-spin' : 'fa-undo'}`}></i>
                        </button>
                      </li>
                    )
                  })}
                </ul>
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
              disabled={clicked}
              onClick={dismissModal}
            >
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {empty && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
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
              disabled={!toDelete.length || clicked}
              onClick={() => void cleanBridges()}
            >
              {clicked
                ? <i className="fas fa-circle-notch fa-spin"></i>
                : `${t('form.button_remove')}${toDelete.length > 0 ? ` (${toDelete.length})` : ''}`}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
