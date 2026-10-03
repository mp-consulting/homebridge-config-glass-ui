import type { ModalComponentProps } from '@/core/ui/modal'
import type { RestartChildBridgesModalData } from '@/core/ui/modal-data'

import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { useSettingsStore } from '@/core/settings'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'

export type RestartChildBridgesProps = RestartChildBridgesModalData & ModalComponentProps

/** "A restart is needed" for a list of child bridges; restarts each of them. */
export function RestartChildBridges({ activeModal, bridges }: RestartChildBridgesProps) {
  const { t } = useTranslation()
  const isMatterSupported = useSettingsStore(state => state.env.featureFlags?.matterSupport ?? false)

  const onRestartChildBridgeClick = async () => {
    if (!bridges) {
      return
    }

    // Keep going when one bridge fails to restart - stopping at the first
    // failure used to leave the remaining bridges running old config
    let anyFailed = false
    for (const bridge of bridges) {
      try {
        await api.put(`/server/restart/${bridge.username}`, {})
      } catch (error) {
        console.error(error)
        anyFailed = true
      }
    }
    if (anyFailed) {
      toast.error(t('plugins.manage.child_bridge_restart_failed'), t('toast.title_error'))
    } else {
      toast.success(t('plugins.manage.child_bridge_restart'), t('toast.title_success'))
    }
    activeModal.close()
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <ModalHeader title={t('platform.version.service_restart_required')} onClose={dismissModal} />
      <div className="modal-body text-center">
        <i className="fas fa-power-off primary-text mb-3 icon-xl"></i>
        <p className="w-100">{t('restart.child_bridge_list')}</p>
        <div className="text-center">
          <ul className="list-group list-group-box mb-0 w-75 mx-auto">
            {bridges.map(bridge => (
              <li key={bridge.username} className="list-group-item d-flex justify-content-between align-items-center">
                <span className="me-3">
                  {isMatterSupported
                    ? (
                        <>
                          <i className="fas fa-lg fa-hap me-2"></i>
                          <i className={`fas fa-lg fa-matter${bridge.matterSerialNumber ? '' : ' opacity-muted'}`}></i>
                        </>
                      )
                    : <i className="fas fa-hap"></i>}
                </span>
                <span className="flex-grow-1 text-start">
                  {bridge.name}
                  <br />
                  <small className="grey-text font-monospace">{bridge.username}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <ModalFooter>
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
          <button type="button" className="btn btn-primary" onClick={() => void onRestartChildBridgeClick()}>
            {t('menu.tooltip_restart')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
