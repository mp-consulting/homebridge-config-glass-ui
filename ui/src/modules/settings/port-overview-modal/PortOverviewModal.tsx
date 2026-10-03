import type { ModalComponentProps } from '@/core/ui/modal'
import type { NetworkOverviewEntry } from '@/modules/settings/port-overview-modal/port-overview'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'
import { displayName, sortEntries } from '@/modules/settings/port-overview-modal/port-overview'

/** Every port in use: the bridge, the UI and each child bridge, with any conflicts. */
export function PortOverviewModal({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<NetworkOverviewEntry[]>([])
  const [conflicts, setConflicts] = useState<string[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await api.get('/server/network/overview')
        if (active) {
          setEntries(sortEntries(data.entries))
          setConflicts(data.conflicts)
        }
      } catch (error) {
        console.error(error)
        toastApiError(error)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <ModalHeader title={t('settings.ports.title')} onClose={dismissModal} />
      <div className="modal-body">
        {loading
          ? (
              <div className="text-center py-4">
                <i className="fas fa-spinner fa-spin fa-2x primary-text"></i>
              </div>
            )
          : (
              <>
                {conflicts.length > 0 && (
                  <div className="alert alert-warning small py-2 px-3 mb-3">
                    <i className="fas fa-exclamation-triangle me-1"></i>
                    {' '}
                    {t('settings.ports.conflict_warning')}
                  </div>
                )}
                {entries.map((entry, index) => (
                  <ul key={`${entry.service}-${entry.bridge}-${entry.port}`} className={`list-group list-group-box ${index === entries.length - 1 ? 'mb-0' : 'mb-3'}`}>
                    <li className="list-group-item">
                      <h6 className="mb-0 text-center">{displayName(entry)}</h6>
                    </li>
                    <li className="list-group-item d-flex justify-content-between align-items-center flex-column flex-md-row">
                      <span className="text-start">{t('settings.ports.status')}</span>
                      <span className="text-start text-md-end grey-text">
                        {entry.status === 'ok'
                          ? <i className="fas fa-xl fa-check-circle primary-text" aria-hidden="true"></i>
                          : <i className="fas fa-xl fa-times-circle red-text" aria-hidden="true"></i>}
                      </span>
                    </li>
                    <li className="list-group-item d-flex justify-content-between align-items-center flex-column flex-md-row">
                      <span className="text-start">{t('settings.ports.hap_port')}</span>
                      <span className="text-start text-md-end grey-text font-monospace">{entry.port}</span>
                    </li>
                    <li className="list-group-item d-flex justify-content-between align-items-center flex-column flex-md-row">
                      <span className="text-start">{t('settings.ports.matter_port')}</span>
                      <span className="text-start text-md-end grey-text font-monospace">{entry.matterPort ?? '—'}</span>
                    </li>
                    <li className="list-group-item d-flex justify-content-between align-items-center flex-column flex-md-row">
                      <span className="text-start">{t('settings.ports.commissioned')}</span>
                      <span className="text-start text-md-end grey-text">
                        {entry.matterPort
                          ? (entry.commissioned
                              ? <i className="fas fa-xl fa-check-circle primary-text" aria-hidden="true"></i>
                              : <i className="fas fa-xl fa-times-circle red-text" aria-hidden="true"></i>)
                          : <span className="font-monospace">—</span>}
                      </span>
                    </li>
                  </ul>
                ))}
              </>
            )}
      </div>
      <ModalFooter justify="center">
        <button type="button" className="btn btn-elegant" onClick={dismissModal}>
          {t('form.button_close')}
        </button>
      </ModalFooter>
    </div>
  )
}
