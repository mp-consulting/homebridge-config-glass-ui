import type { ModalComponentProps } from '@/core/ui/modal'
import type { SplitPairings } from '@/modules/settings/reset-individual-bridges/split-pairings'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { accessoryOverviewCache } from '@/core/caching'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { splitPairings } from '@/modules/settings/reset-individual-bridges/split-pairings'
import { titleCase } from '@/modules/settings/title-case'

import './reset-individual-bridges.scss'

/**
 * Unpair chosen bridges: their pairing information is deleted, so every
 * accessory on them has to be added to the Home app again.
 */
export function ResetIndividualBridges({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isMatterSupported] = useState(() => settingsActions.isFeatureEnabled('matterSupport'))
  const [clicked, setClicked] = useState(false)
  const [lists, setLists] = useState<SplitPairings>({ pairingsChildActive: [], pairingsNonChild: [], pairingsChildStale: [] })
  const [toDelete, setToDelete] = useState<{ id: string, resetPairingInfo: boolean }[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { pairings } = await accessoryOverviewCache.get<any, any, any>()
        if (active) {
          setLists(splitPairings(pairings))
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

  const toggleList = (id: string, resetPairingInfo: boolean = false) => {
    setToDelete(list => list.some(item => item.id === id)
      ? list.filter(item => item.id !== id)
      : [...list, { id, resetPairingInfo }])
  }

  const isInList = (id: string) => toDelete.some(item => item.id === id)

  const removeBridges = async () => {
    setClicked(true)
    try {
      await api.delete('/server/pairings', {
        body: toDelete,
      })
      accessoryOverviewCache.invalidate()
      activeModal.close()
      void navigate('/restart?restarting=true')
      toast.success(t('reset.bridge_ind.done'), t('toast.title_success'))
    } catch (error) {
      setClicked(false)
      console.error(error)
      toast.error(t('reset.bridge_ind.fail'), t('toast.title_error'))
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const { pairingsChildActive, pairingsNonChild, pairingsChildStale } = lists
  const any = pairingsChildActive.length > 0 || pairingsChildStale.length > 0 || pairingsNonChild.length > 0

  /** The unpair toggle of one bridge. */
  const unpairButton = (item: any, resetPairingInfo: boolean, idleIcon: string) => {
    const inList = isInList(item._id)
    return (
      <button
        type="button"
        className={`btn m-0 ms-3 ${inList ? 'btn-elegant' : 'btn-danger'}`}
        disabled={clicked}
        aria-label={t('form.button_unpair')}
        onClick={() => toggleList(item._id, resetPairingInfo)}
      >
        <i className={`fas ${!inList ? idleIcon : clicked ? 'fa-circle-notch fa-spin' : 'fa-undo'}`}></i>
      </button>
    )
  }

  /** The HAP / Matter icons of a child bridge. */
  const childIcons = (item: any) => (
    <span className="me-3">
      {isMatterSupported
        ? (
            <>
              <i className="fas fa-lg fa-hap me-2"></i>
              <i className={`fas fa-lg fa-matter${!item._matter ? ' opacity-muted' : ''}`}></i>
            </>
          )
        : <i className="fas fa-lg fa-hap"></i>}
    </span>
  )

  return (
    <div className="modal-content hb-reset-individual-bridges">
      <div className="modal-header">
        <h5 className="modal-title">{t('reset.bridge_ind.title')}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          disabled={clicked}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body">
        {!any && (
          <>
            <div className="text-center mb-3">
              <i className="fas fa-circle-check primary-text icon-xl"></i>
            </div>
            <p className="text-center mb-0">{t('reset.bridges.empty')}</p>
          </>
        )}
        {any && (
          <>
            <div className="text-center mb-3"><i className="fas fa-bridge primary-text icon-xl"></i></div>
            {pairingsNonChild.length > 0 && (
              <ul className="list-group list-group-box mt-3 mb-0">
                <li className="list-group-item">
                  <h6 className="mb-1 text-center">{t('reset.bridge_ind.head_non_child')}</h6>
                  <p className="mb-0 small grey-text text-center">{t('reset.bridge_ind.desc_non_child')}</p>
                </li>
                {pairingsNonChild.map(item => (
                  <li key={item._id} className="list-group-item d-flex justify-content-between align-items-center">
                    <span className="me-3">
                      {isMatterSupported
                        ? (
                            <>
                              <i className={`fas fa-lg fa-hap me-2${item._matterOnly ? ' opacity-muted' : ''}`}></i>
                              <i className={`fas fa-lg fa-matter${!item._matter ? ' opacity-muted' : ''}`}></i>
                            </>
                          )
                        : <i className="fas fa-lg fa-hap"></i>}
                    </span>
                    <span className="flex-grow-1">
                      {item.name}
                      <br />
                      <span className="grey-text">{item._main ? 'Homebridge' : titleCase(item._category)}</span>
                      <br />
                      <small className="grey-text font-monospace">{item._username}</small>
                    </span>
                    {unpairButton(item, false, 'fa-refresh')}
                  </li>
                ))}
              </ul>
            )}
            {pairingsChildActive.length > 0 && (
              <ul className="list-group list-group-box mt-3 mb-0">
                <li className="list-group-item">
                  <h6 className="mb-1 text-center">{t('reset.bridge_ind.head_child_active')}</h6>
                  <p className="mb-0 small grey-text text-center">{t('reset.bridge_ind.desc_child_active')}</p>
                </li>
                {pairingsChildActive.map(item => (
                  <li key={item._id} className="list-group-item d-flex justify-content-between align-items-center">
                    {childIcons(item)}
                    <span className="flex-grow-1">
                      {item.name}
                      <br />
                      <small className="grey-text font-monospace">{item._username}</small>
                    </span>
                    {unpairButton(item, true, 'fa-refresh')}
                  </li>
                ))}
              </ul>
            )}
            {pairingsChildStale.length > 0 && (
              <ul className="list-group list-group-box mt-3 mb-0">
                <li className="list-group-item">
                  <h6 className="mb-1 text-center">{t('reset.bridge_ind.head_child_stale')}</h6>
                  <p className="mb-0 small grey-text text-center">{t('reset.bridge_ind.desc_child_stale')}</p>
                </li>
                {pairingsChildStale.map(item => (
                  <li key={item._id} className="list-group-item d-flex justify-content-between align-items-center">
                    {childIcons(item)}
                    <span className="flex-grow-1">
                      {item.name}
                      <br />
                      <small className="grey-text font-monospace">{item._username}</small>
                    </span>
                    {unpairButton(item, false, 'fa-trash')}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start">
          {any && (
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
          {!any && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {any && (
            <button
              type="button"
              className="btn btn-danger"
              data-bs-dismiss="modal"
              disabled={!toDelete.length || clicked}
              onClick={() => void removeBridges()}
            >
              {!clicked
                ? `${t('form.button_reset')}${toDelete.length > 0 ? ` (${toDelete.length})` : ''}`
                : <i className="fas fa-circle-notch fa-spin"></i>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
