import type { ModalComponentProps } from '@/core/ui/modal'
import type { AccessoryControlListsModalData } from '@/core/ui/modal-data'
import type { Pairing } from '@/modules/settings/accessory-control-lists/accessory-control-lists.interfaces'

import { useEffect, useState } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { accessoryOverviewCache } from '@/core/caching'
import { settingsActions } from '@/core/settings'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'
import { titleCase } from '@/modules/settings/title-case'

export type AccessoryControlListsProps = AccessoryControlListsModalData & ModalComponentProps

/** The pairing link icon with its paired / unpaired tooltip (ngbTooltip: hover, left, 150ms). */
function PairedIcon({ paired }: { paired?: boolean }) {
  const { t } = useTranslation()
  return (
    <OverlayTrigger
      placement="left"
      trigger={['hover']}
      delay={{ show: 150, hide: 0 }}
      overlay={<Tooltip>{t(paired ? 'status.widget.qr_paired' : 'status.widget.qr_unpaired')}</Tooltip>}
    >
      <i className={`fas fa-link ${paired ? 'green-text' : 'grey-text'}`}></i>
    </OverlayTrigger>
  )
}

/** The HAP / Matter icons of a bridge. */
function ProtocolIcons({ pairing, isMatterSupported }: { pairing: Pairing, isMatterSupported: boolean }) {
  return (
    <span className="me-3 flex-shrink-0">
      {isMatterSupported
        ? (
            <>
              <i className={`fas fa-lg fa-hap me-2${pairing._matterOnly ? ' opacity-muted' : ''}`}></i>
              <i className={`fas fa-lg fa-matter${!pairing._matter ? ' opacity-muted' : ''}`}></i>
            </>
          )
        : <i className="fas fa-lg fa-hap"></i>}
    </span>
  )
}

function normalise(list: string[]): string[] {
  return list
    .map(x => x.trim().toUpperCase())
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Which bridges the UI may control accessories on. The list stored is a
 * blacklist: a bridge switched off here is added to it.
 */
export function AccessoryControlLists({ activeModal, existingBlacklist }: AccessoryControlListsProps) {
  const { t } = useTranslation()
  const [isMatterSupported] = useState(() => settingsActions.isFeatureEnabled('matterSupport'))
  const [originalBlacklist] = useState(() => normalise(existingBlacklist))
  const [updatedBlacklist, setUpdatedBlacklist] = useState(() => normalise(existingBlacklist))
  const [clicked, setClicked] = useState(false)
  const [mainPairing, setMainPairing] = useState<Pairing | undefined>(undefined)
  const [pairings, setPairings] = useState<Pairing[]>([])

  const blacklistHasUpdated = updatedBlacklist.join(',') !== originalBlacklist.join(',')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { pairings } = await accessoryOverviewCache.get<any, any, Pairing>()
        if (active) {
          setMainPairing(pairings.find((p: Pairing) => p._main))
          setPairings(pairings
            .filter((p: Pairing) => !p._main)
            .sort((a: Pairing, b: Pairing) => a.name.localeCompare(b.name)))
        }
      } catch (error) {
        console.error(error)
        toastApiError(error)
        activeModal.close()
      }
    })()
    return () => {
      active = false
    }
  }, [activeModal])

  const toggleList = (username: string) => {
    setUpdatedBlacklist(list => list.includes(username)
      ? list.filter(x => x !== username)
      : [...list, username].sort((a, b) => a.localeCompare(b)))
  }

  const isInList = (username: string) => updatedBlacklist.includes(username)

  const updateBlacklist = async () => {
    setClicked(true)
    try {
      await api.put('/config-editor/ui/accessory-control/instance-blacklist', {
        body: updatedBlacklist,
      })
      settingsActions.setEnvItem('accessoryControl.instanceBlacklist', updatedBlacklist)
      activeModal.close()
    } catch (error) {
      setClicked(false)
      console.error(error)
      toastApiError(error)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <ModalHeader title={t('settings.security.ui_control')} closeDisabled={clicked} onClose={dismissModal} />
      <div className="modal-body">
        <div className="text-center mb-3"><i className="fas fa-list-check primary-text icon-xl"></i></div>
        <ul className="mb-3">
          <li>{t('settings.security.ui_control_desc')}</li>
          <li>{t('settings.security.ui_control_desc_2')}</li>
        </ul>

        <ul className="list-group list-group-box mt-3 mb-0">
          {mainPairing && (
            <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
              <div className="d-flex align-items-center text-start flex-grow-1 me-3">
                <ProtocolIcons pairing={mainPairing} isMatterSupported={isMatterSupported} />
                <div>
                  {mainPairing.name}
                  <br />
                  <small className="grey-text">
                    <PairedIcon paired={mainPairing._isPaired} />
                    {' · '}
                    <span className="font-monospace">{mainPairing._username}</span>
                    {' · Homebridge'}
                  </small>
                </div>
              </div>
              <div className="text-end grey-text d-flex align-items-center">
                <input
                  type="checkbox"
                  className="rendux-input"
                  id="controlMainBridge"
                  checked={!isInList(mainPairing._username!)}
                  disabled={clicked}
                  aria-label={t('plugins.manage.hide_updates')}
                  onChange={() => toggleList(mainPairing._username!)}
                />
                <label htmlFor="controlMainBridge" className="rendux-label ms-3"></label>
              </div>
            </li>
          )}
          {pairings.map(item => (
            <li key={item._username} className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
              <div className="d-flex align-items-center text-start flex-grow-1 me-3">
                <ProtocolIcons pairing={item} isMatterSupported={isMatterSupported} />
                <div>
                  {item.name}
                  <br />
                  <small className="grey-text">
                    <PairedIcon paired={item._isPaired} />
                    {' · '}
                    <span className="font-monospace">{item._username}</span>
                    {` · ${titleCase(item._category)}`}
                  </small>
                </div>
              </div>
              <div className="text-end grey-text d-flex align-items-center">
                <input
                  type="checkbox"
                  className="rendux-input"
                  id={`hidePluginUpdates_${item._username}`}
                  checked={!isInList(item._username!)}
                  disabled={clicked}
                  aria-label={`${t('form.button_allow')} ${item.name}`}
                  onChange={() => toggleList(item._username!)}
                />
                <label className="rendux-label ms-3" htmlFor={`hidePluginUpdates_${item._username}`}></label>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            disabled={clicked}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button
            type="button"
            className="btn btn-primary"
            data-bs-dismiss="modal"
            disabled={!blacklistHasUpdated || clicked}
            aria-busy={clicked}
            onClick={() => void updateBlacklist()}
          >
            {!clicked
              ? t('form.button_save')
              : (
                  <>
                    <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
                    <span className="visually-hidden">{t('form.button_save')}</span>
                  </>
                )}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
