import type { ModalComponentProps } from '@/core/ui/modal'
import type { ConfigRestoreModalData } from '@/core/ui/modal-data'
import type { ConfigRestoreBackup } from '@/modules/config-editor/config-editor.interfaces'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { formatDate } from '@/core/pipes/date'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'
import { toToastMessage } from '@/core/utilities/http-error'

/** Closes with the id of the backup to load into the editor. */
export type ConfigRestoreProps = ConfigRestoreModalData & ModalComponentProps<string>

const t = (key: string) => i18n.t(key)

/** The list of config.json backups: load one into the editor, download or delete them. */
export function ConfigRestore({ activeModal, currentConfig, fromSettings: fromSettingsProp }: ConfigRestoreProps) {
  const { t: translate } = useTranslation()
  const navigate = useNavigate()
  const fromSettings = fromSettingsProp ?? false
  const [loading, setLoading] = useState(true)
  const [backupList, setBackupList] = useState<ConfigRestoreBackup[]>([])
  const [clicked, setClicked] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const dismissModal = (): void => {
    if (fromSettings) {
      void navigate('/settings')
    }
    activeModal.dismiss('Dismiss')
  }

  const getConfigBackups = async (): Promise<void> => {
    try {
      const data = await api.get<ConfigRestoreBackup[]>('/config-editor/backups')
      setLoading(false)
      setBackupList(data)
    } catch (error) {
      setLoading(false)
      console.error(error)
      toast.error(toToastMessage(error), t('toast.title_error'))
      dismissModal()
    }
  }

  useEffect(() => {
    void getConfigBackups()
    // eslint-disable-next-line react/exhaustive-deps -- load once, as ngOnInit did
  }, [])

  const restore = (backupId: string) => activeModal.close(backupId)

  const download = async (backupId: string): Promise<void> => {
    setClicked(true)
    try {
      const json = await api.get(`/config-editor/backups/${backupId}`)
      const formattedJson = JSON.stringify(json, null, 4)
      const blob = new Blob([formattedJson], { type: 'application/json' })
      fileSaver.saveAs(blob, `config-backup-${backupId}.json`)
      setClicked(false)
    } catch (error) {
      setClicked(false)
      toast.error(toToastMessage(error), t('toast.title_error'))
      console.error(error)
    }
  }

  const downloadCurrentConfig = (): void => {
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(currentConfig)}`
    const downloadAnchorNode = document.createElement('a')
    downloadAnchorNode.setAttribute('href', dataStr)
    downloadAnchorNode.setAttribute('download', 'config.json')
    document.body.appendChild(downloadAnchorNode) // required for firefox
    downloadAnchorNode.click()
    downloadAnchorNode.remove()
  }

  const deleteBackup = async (backupId: string): Promise<void> => {
    setDeleting(backupId)
    try {
      await api.delete(`/config-editor/backups/${backupId}`)
      await getConfigBackups()
      setDeleting(null)
    } catch (error) {
      setDeleting(null)
      toast.error(toToastMessage(error), t('toast.title_error'))
      console.error(error)
    }
  }

  const deleteAllBackups = async (): Promise<void> => {
    setDeleting('all')
    try {
      await api.delete('/config-editor/backups')
      toast.success(t('config.restore.toast_backups_deleted'), t('toast.title_success'))
      setBackupList([])
      setDeleting(null)
    } catch (error) {
      toast.error(toToastMessage(error), t('toast.title_error'))
      console.error(error)
      setDeleting(null)
    }
  }

  const busy = clicked || !!deleting
  const trashIcon = (id: string) => (id === deleting ? 'fas fa-circle-notch fa-spin' : 'fas fa-trash')

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{translate('config.restore.title')}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={translate('form.button_close')}
          disabled={busy}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body">
        <div className="text-center mb-3">
          <i className="fas fa-history primary-text icon-xl" aria-hidden="true"></i>
        </div>
        <ul className="mb-3">
          <li>{translate('config.restore.help_1')}</li>
          <li>{translate('config.restore.help_2')}</li>
        </ul>
        <ul className="list-group list-group-box mb-0">
          <li className="list-group-item d-flex justify-content-between align-items-center">
            <div aria-hidden="true">
              <span>{translate('form.button_download')}</span>
              <br />
              <small className="grey-text">{translate('config.restore.download')}</small>
            </div>
            <button
              type="button"
              className="btn btn-primary m-0 ms-3 py-1"
              disabled={busy}
              aria-label={translate('form.button_download')}
              onClick={downloadCurrentConfig}
            >
              <span className="visually-hidden" aria-hidden="true">{translate('form.button_download')}</span>
              <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </button>
          </li>
        </ul>
        {loading
          ? (
              <div className="text-center primary-text">
                <i className="fas fa-circle-notch fa-spin mt-3 icon-xl" aria-hidden="true"></i>
              </div>
            )
          : backupList.length > 0 && (
            <ul className="list-group list-group-box mt-3">
              {backupList.map(backup => (
                <li key={backup.id} className="list-group-item d-flex justify-content-between align-items-center">
                  <span>
                    {formatDate(backup.timestamp, 'mediumDate')}
                    <br />
                    <span className="grey-text small">{formatDate(backup.timestamp, 'shortTime')}</span>
                  </span>
                  <span className="d-flex flex-nowrap" role="group" aria-label={translate('backup.aria_actions')}>
                    <HoverTooltip text={translate('config.restore.copy_to_editor')} placement="bottom">
                      <button
                        type="button"
                        className="btn btn-primary m-0 ms-3 py-1"
                        disabled={busy}
                        aria-label={translate('config.restore.copy_to_editor')}
                        onClick={() => restore(backup.id)}
                      >
                        <i aria-hidden="true" className="fas fa-history"></i>
                      </button>
                    </HoverTooltip>
                    <HoverTooltip text={translate('form.button_download')} placement="bottom">
                      <button
                        type="button"
                        className="btn btn-primary m-0 ms-2"
                        disabled={busy}
                        aria-label={translate('form.button_download')}
                        onClick={() => void download(backup.id)}
                      >
                        <i aria-hidden="true" className="fas fa-download"></i>
                      </button>
                    </HoverTooltip>
                    <HoverTooltip text={translate('form.button_delete')} placement="bottom">
                      <button
                        type="button"
                        className="btn btn-danger m-0 ms-2"
                        disabled={busy}
                        aria-label={translate('form.button_delete')}
                        onClick={() => void deleteBackup(backup.id)}
                      >
                        <i aria-hidden="true" className={trashIcon(backup.id)}></i>
                      </button>
                    </HoverTooltip>
                  </span>
                </li>
              ))}
              <li className="list-group-item d-flex justify-content-between align-items-center">
                <span>
                  {translate('form.button_delete_all')}
                  <br />
                  <span className="grey-text small">{translate('common.labels.no_confirmation')}</span>
                </span>
                <span className="d-flex flex-nowrap">
                  <HoverTooltip text={translate('form.button_delete_all')} placement="bottom">
                    <button
                      type="button"
                      className="btn btn-danger m-0 ms-2"
                      disabled={busy}
                      aria-label={translate('form.button_delete_all')}
                      onClick={() => void deleteAllBackups()}
                    >
                      <i aria-hidden="true" className={trashIcon('all')}></i>
                    </button>
                  </HoverTooltip>
                </span>
              </li>
            </ul>
          )}
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start"></div>
        <div className="text-center">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            disabled={busy}
            aria-label={translate('form.button_close')}
            onClick={dismissModal}
          >
            {translate('form.button_close')}
          </button>
        </div>
        <div className="text-end"></div>
      </div>
    </div>
  )
}
