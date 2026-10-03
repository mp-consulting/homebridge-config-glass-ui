import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { ResetAccessoriesDeleteItem, ResetAccessoriesPairing } from '@/core/plugins/reset-accessories/reset-accessories.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { ResetAccessoriesModalData } from '@/core/ui/modal-data'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { accessoryOverviewCache } from '@/core/caching'
import { buildResetPairings } from '@/core/plugins/reset-accessories/reset-accessories.helpers'
import { useSettingsStore } from '@/core/settings'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'

import './reset-accessories.scss'

export type ResetAccessoriesProps = ResetAccessoriesModalData & ModalComponentProps

/** Pick child bridges (per protocol) of a plugin and reset their pairings. */
export function ResetAccessories({ activeModal, childBridges: childBridgesProp }: ResetAccessoriesProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMatterSupported = useSettingsStore(state => state.env.featureFlags?.matterSupport ?? false)
  const [clicked, setClicked] = useState(false)
  const [pairings, setPairings] = useState<ResetAccessoriesPairing[]>([])
  const [toDelete, setToDelete] = useState<ResetAccessoriesDeleteItem[]>([])

  useEffect(() => {
    const childBridges: ChildBridge[] = childBridgesProp ?? []
    let cancelled = false
    const load = async () => {
      try {
        const { pairings: allPairings } = await accessoryOverviewCache.get<any, any, any>()
        if (!cancelled) {
          setPairings(buildResetPairings(allPairings, childBridges, isMatterSupported))
        }
      } catch (error) {
        console.error(error)
        toastApiError(error)
        activeModal.close()
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // Loaded once, when the modal opens
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  const isInList = (id: string, protocol: 'hap' | 'matter') =>
    toDelete.some(item => item.id === id && item.protocol === protocol)

  const toggleList = (id: string, protocol: 'hap' | 'matter') => {
    setToDelete(current => current.some(item => item.id === id && item.protocol === protocol)
      ? current.filter(item => item.id !== id || item.protocol !== protocol)
      : [...current, { id, protocol }])
  }

  const cleanBridges = async () => {
    setClicked(true)
    try {
      await api.delete('/server/pairings/accessories', { body: toDelete })
      accessoryOverviewCache.invalidate()
      toast.success(t('reset.accessory_ind.done'), t('toast.title_success'))
      activeModal.close()
      void navigate('/restart?restarting=true')
    } catch (error) {
      setClicked(false)
      console.error(error)
      toastApiError(error)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content hb-reset-accessories">
      <ModalHeader title={t('child_bridge.reset_accessories')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        {pairings.length === 0
          ? (
              <>
                <div className="text-center mb-3">
                  <i className="fas fa-circle-check primary-text icon-xl" aria-hidden="true"></i>
                </div>
                <p className="mb-0 text-center">{t('reset.bridge_accessories.empty')}</p>
              </>
            )
          : (
              <>
                <div className="text-center mb-3"><i className="fas fa-broom primary-text icon-xl" aria-hidden="true"></i></div>
                <ul className="mb-3">
                  <li>{t('reset.bridge_accessories.list_1')}</li>
                  <li>{t('reset.clear_cache_single.list_3')}</li>
                </ul>
                <ul className="list-group list-group-box mb-0">
                  {pairings.map((item) => {
                    const inList = isInList(item._id, item._protocol)
                    return (
                      <li key={`${item._id}-${item._protocol}`} className="list-group-item d-flex justify-content-between align-items-center">
                        <span className="me-3">
                          {isMatterSupported
                            ? (
                                <>
                                  <i className={cx('fas fa-lg fa-hap me-2', item._protocol === 'matter' && 'opacity-muted')} aria-hidden="true"></i>
                                  <i className={cx('fas fa-lg fa-matter', item._protocol !== 'matter' && 'opacity-muted')} aria-hidden="true"></i>
                                </>
                              )
                            : <i className="fas fa-lg fa-hap" aria-hidden="true"></i>}
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
                          className={cx('btn', !inList && 'btn-danger', 'm-0 ms-3', inList && 'btn-elegant')}
                          disabled={clicked}
                          aria-label={t('form.button_delete')}
                          onClick={() => toggleList(item._id, item._protocol)}
                        >
                          <i
                            className={cx(
                              'fas',
                              !inList && 'fa-broom',
                              inList && !clicked && 'fa-undo',
                              inList && clicked && 'fa-circle-notch',
                              inList && clicked && 'fa-spin',
                            )}
                            aria-hidden="true"
                          >
                          </i>
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
          {pairings.length > 0 && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" disabled={clicked} onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {pairings.length === 0 && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {pairings.length > 0 && (
            <button
              type="button"
              className="btn btn-danger"
              data-bs-dismiss="modal"
              disabled={!toDelete.length || clicked}
              onClick={() => void cleanBridges()}
            >
              {!clicked
                ? (
                    <>
                      {t('form.button_reset')}
                      {toDelete.length > 0 && ` (${toDelete.length})`}
                    </>
                  )
                : <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
