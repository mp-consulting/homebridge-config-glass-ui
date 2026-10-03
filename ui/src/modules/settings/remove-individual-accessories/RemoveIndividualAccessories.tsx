import type { ModalComponentProps } from '@/core/ui/modal'
import type { RemoveIndividualAccessoriesModalData } from '@/core/ui/modal-data'
import type { DeleteEntry, Protocol } from '@/modules/settings/remove-individual-accessories/group-accessories'
import type { CachedAccessory, Pairing } from '@/modules/settings/settings.interfaces'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { accessoryOverviewCache } from '@/core/caching'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { groupAccessories, splitDeletions } from '@/modules/settings/remove-individual-accessories/group-accessories'

export type RemoveIndividualAccessoriesProps = RemoveIndividualAccessoriesModalData & ModalComponentProps

/**
 * Remove chosen accessories from the cache. HAP accessories are identified by
 * uuid and cache file (the same uuid can sit under several bridges), Matter
 * ones by uuid and device.
 */
export function RemoveIndividualAccessories({ activeModal, selectedBridge: selectedBridgeProp, highlightUuid, highlightCacheFile }: RemoveIndividualAccessoriesProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isMatterSupported] = useState(() => settingsActions.isFeatureEnabled('matterSupport'))
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [clicked, setClicked] = useState(false)
  const [currentSelectedBridge, setCurrentSelectedBridge] = useState(selectedBridgeProp)
  const [selectedBridgeAccessories, setSelectedBridgeAccessories] = useState<CachedAccessory[]>([])
  const [accessoriesExist, setAccessoriesExist] = useState(false)
  const [toDelete, setToDelete] = useState<DeleteEntry[]>([])
  const propsRef = useRef({ selectedBridgeProp, highlightUuid, isMatterSupported, activeModal })

  useEffect(() => {
    let destroyed = false
    let scrollTimeout: ReturnType<typeof setTimeout> | undefined
    const { selectedBridgeProp: selectedBridge, highlightUuid, isMatterSupported, activeModal } = propsRef.current

    void (async () => {
      try {
        const overview = await accessoryOverviewCache.get<CachedAccessory, CachedAccessory, Pairing>()
        if (destroyed) {
          return
        }
        const pairingsList = groupAccessories(overview, selectedBridge, isMatterSupported)
        setPairings(pairingsList)
        const selectedBridgeId = selectedBridge || pairingsList[0]?._id
        if (selectedBridgeId) {
          const accessories = pairingsList.find(pairing => pairing._id === selectedBridgeId)?.accessories || []
          setCurrentSelectedBridge(selectedBridgeId)
          setAccessoriesExist(true)
          setSelectedBridgeAccessories(accessories)

          // Wait for the list to render and the modal fade-in (~150ms) before scrolling.
          // ⚠️ Held so it can be cancelled. Left running, it fires 250ms after a
          // modal that may already be gone, and scrolls whichever highlighted row
          // it finds by then - in tests, after the DOM itself has been torn down.
          // The destroyed check matters as much as the cancel: this runs after an
          // await, so the modal can already be gone by the time we get here.
          if (highlightUuid && accessories.length > 1) {
            scrollTimeout = setTimeout(() => document.querySelector('.list-group-item-highlight')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
          }
        }
      } catch (error) {
        console.error(error)
        toast.error(i18n.t('reset.error_message'), i18n.t('toast.title_error'))
        activeModal.close()
      }
    })()

    return () => {
      destroyed = true
      clearTimeout(scrollTimeout)
    }
  }, [])

  const onBridgeChange = (value: string) => {
    setCurrentSelectedBridge(value)
    setSelectedBridgeAccessories(pairings.find(pairing => pairing._id === value)?.accessories || [])
  }

  const currentlySelected = pairings.find(pairing => pairing._id === currentSelectedBridge)
  const currentlySelectedLabel = currentlySelected ? `${currentlySelected.name} - ${currentlySelected._username}` : ''

  const isInList = (id: string, cacheFile: string, protocol: Protocol) =>
    toDelete.some(item => item.uuid === id && item.cacheFile === cacheFile && item.protocol === protocol)

  const toggleList = (uuid: string, cacheFile: string, protocol: Protocol, deviceId?: string) => {
    setToDelete(list => list.some(item => item.uuid === uuid && item.cacheFile === cacheFile && item.protocol === protocol)
      ? list.filter(item => item.uuid !== uuid || item.cacheFile !== cacheFile || item.protocol !== protocol)
      : [...list, { cacheFile, uuid, protocol, deviceId }])
  }

  // Only highlight when there's more than one item to disambiguate from.
  const shouldHighlight = (uuid: string, cacheFile: string) => !!highlightUuid
    && selectedBridgeAccessories.length > 1
    && uuid === highlightUuid
    && cacheFile === highlightCacheFile

  const removeAccessories = async () => {
    setClicked(true)

    // Separate HAP and Matter accessories
    const { hapAccessories, matterAccessories } = splitDeletions(toDelete)

    // Build requests array
    const requests: Promise<unknown>[] = []
    if (hapAccessories.length > 0) {
      requests.push(api.delete('/server/cached-accessories', { body: hapAccessories }))
    }
    if (isMatterSupported && matterAccessories.length > 0) {
      requests.push(api.delete('/server/matter-accessories', { body: matterAccessories }))
    }

    if (requests.length === 0) {
      setClicked(false)
      return
    }

    try {
      await Promise.all(requests)
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

  return (
    <div className="modal-content">
      <ModalHeader title={t('reset.accessory_ind.title')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        {!accessoriesExist
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
                  <li>{t('reset.accessory_ind.list_1')}</li>
                  <li>{t('reset.accessory_ind.list_2')}</li>
                  <li>{t('reset.accessory_ind.list_3')}</li>
                </ul>
                <ul className="list-group list-group-box mb-0">
                  {pairings.length > 1 && (
                    <>
                      <li className="list-group-item text-center grey-text small">{t('form.label.changes_kept')}</li>
                      <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                        <label htmlFor="bridgeSelect" className="mb-2 mb-md-0 w-100 w-md-50">{t('reset.accessory_ind.bridge')}</label>
                        <div className="text-start text-md-end w-100 w-md-50">
                          <select
                            className="custom-select"
                            id="bridgeSelect"
                            value={currentSelectedBridge}
                            onChange={event => onBridgeChange(event.target.value)}
                          >
                            {pairings.map(bridge => (
                              <option key={bridge._id} value={bridge._id}>{`${bridge.name} (${bridge._username})`}</option>
                            ))}
                          </select>
                        </div>
                      </li>
                    </>
                  )}
                  {pairings.length === 1 && (
                    <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                      <span className="mb-2 mb-md-0 w-100 w-md-50">{t('reset.accessory_ind.bridge')}</span>
                      <div className="text-start text-md-end w-100 w-md-50 grey-text font-monospace">
                        {currentlySelectedLabel}
                      </div>
                    </li>
                  )}
                  {selectedBridgeAccessories.map((item) => {
                    const uuid = (item.UUID || item.uuid)!
                    const inList = isInList(uuid, item.$cacheFile!, item.$protocol!)
                    return (
                      <li
                        key={`${item.$protocol}-${item.$cacheFile}-${uuid}`}
                        className={cx('list-group-item d-flex justify-content-between align-items-center', shouldHighlight(uuid, item.$cacheFile!) && 'list-group-item-highlight')}
                      >
                        <span className="me-3">
                          <i className={cx('fas fa-lg', item.$protocol === 'matter' ? 'fa-matter' : 'fa-hap')}></i>
                        </span>
                        <span className="flex-grow-1">
                          {item.displayName}
                          <br />
                          <small><span className="font-monospace grey-text">{uuid}</span></small>
                        </span>
                        <button
                          type="button"
                          className={cx('btn m-0 ms-3', inList ? 'btn-elegant' : 'btn-danger')}
                          disabled={clicked}
                          aria-label={t('form.button_delete')}
                          onClick={() => toggleList(uuid, item.$cacheFile!, item.$protocol!, item.$deviceId)}
                        >
                          <i className={`fas ${!inList ? 'fa-trash' : clicked ? 'fa-circle-notch fa-spin' : 'fa-undo'}`} aria-hidden="true"></i>
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
          {accessoriesExist && (
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
          {!accessoriesExist && (
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {accessoriesExist && (
            <button
              type="button"
              className="btn btn-danger"
              data-bs-dismiss="modal"
              disabled={!toDelete.length || clicked}
              aria-busy={clicked}
              onClick={() => void removeAccessories()}
            >
              {!clicked
                ? `${t('form.button_remove')}${toDelete.length > 0 ? ` (${toDelete.length})` : ''}`
                : (
                    <>
                      <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
                      <span className="visually-hidden">{t('form.button_remove')}</span>
                    </>
                  )}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
