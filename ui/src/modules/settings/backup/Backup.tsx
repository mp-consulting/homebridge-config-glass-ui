import type { ScheduledBackup } from '@/core/backup'
import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { backupService } from '@/core/backup'
import { Confirm } from '@/core/components/confirm/Confirm'
import { formatMegabytes } from '@/core/pipes/bytes'
import { formatDate } from '@/core/pipes/date'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { t } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'
import { toastApiError } from '@/core/utilities/http-error'

export type BackupProps = ModalComponentProps

/** How long each schedule field waits for the user to stop before writing config.json. */
const ENABLED_DEBOUNCE_MS = 500
const PATH_DEBOUNCE_MS = 1500

/**
 * The backup modal: download a backup now, manage the scheduled ones, and hand
 * over to the restore modal.
 */
export function Backup({ activeModal }: BackupProps) {
  const { t: translate } = useTranslation()
  const [clicked, setClicked] = useState(false)
  const [scheduledBackups, setScheduledBackups] = useState<ScheduledBackup[]>([])
  // The stored backups list: loading on open, or failed to load
  const [listState, setListState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [backupTime, setBackupTime] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  // The config key is a negative (`scheduledBackupDisable`) and the switch is a positive
  const [enabledValue, setEnabledValue] = useState(() => !useSettingsStore.getState().env.scheduledBackupDisable)
  const [pathValue, setPathValue] = useState(() => useSettingsStore.getState().env.scheduledBackupPath ?? '')
  const enabledTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pathTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const maxBackupSize: number = globalThis.backup.maxBackupSize
  const maxBackupSizeText: string = globalThis.backup.maxBackupSizeText

  const getScheduledBackups = async (): Promise<void> => {
    try {
      const data = await api.get<ScheduledBackup[]>('/backup/scheduled-backups')
      setScheduledBackups(data)
      setListState('loaded')
    } catch (error) {
      console.error(error)
      setListState('error')
    }
  }

  const getNextBackup = async (): Promise<void> => {
    try {
      const data = await api.get<{ next: string }>('/backup/scheduled-backups/next')
      setBackupTime(data.next)
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    void getScheduledBackups()
    void getNextBackup()
    return () => {
      // A pending write is dropped with the modal, as takeUntilDestroyed did
      clearTimeout(enabledTimerRef.current)
      clearTimeout(pathTimerRef.current)
    }
  }, [])

  const saveUiSettingChange = async (key: string, value: unknown): Promise<void> => {
    try {
      await api.patch('/config-editor/ui', { [key]: value })

      // Update the environment variable in the settings store
      settingsActions.setEnvItem(key, value)

      settingsActions.showRestartToast()
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
  }

  const onEnabledChange = (value: boolean): void => {
    setEnabledValue(value)
    clearTimeout(enabledTimerRef.current)
    enabledTimerRef.current = setTimeout(() => {
      void saveUiSettingChange('scheduledBackupDisable', !value)
    }, ENABLED_DEBOUNCE_MS)
  }

  const onPathChange = (value: string): void => {
    setPathValue(value)
    clearTimeout(pathTimerRef.current)
    pathTimerRef.current = setTimeout(() => {
      void saveUiSettingChange('scheduledBackupPath', value)
    }, PATH_DEBOUNCE_MS)
  }

  const download = async (backup: ScheduledBackup): Promise<void> => {
    try {
      const res = await api.get<Blob>(`/backup/scheduled-backups/${backup.id}`, { observe: 'response', responseType: 'blob' })
      const archiveName = backup.fileName || 'homebridge-backup.tar.gz'
      const sizeInBytes = res.body.size
      if (sizeInBytes > maxBackupSize) {
        const message = t('backup.backup_exceeds_max_size', {
          maxBackupSizeText,
          size: formatMegabytes(sizeInBytes),
        })
        toast.warning(message, t('toast.title_warning'))
      }
      fileSaver.saveAs(res.body, archiveName)
    } catch (error) {
      console.error(error)
      toast.error(t('backup.backup_download_failed'), t('toast.title_error'))
    }
  }

  const restore = (backup: ScheduledBackup | null): void => {
    // Close the backup modal and open the restore modal
    activeModal.close()
    // Loaded on demand: the restore log brings xterm (~90 kB gzipped) with it
    import('@/modules/settings/backup/restore/Restore')
      .then(({ Restore }) => openModal(Restore, { selectedBackup: backup }, {
        size: 'lg',
        backdrop: 'static',
      }))
      .catch(error => console.error(error))
  }

  const retryScheduledBackups = (): void => {
    setListState('loading')
    void getScheduledBackups()
  }

  const deleteBackup = async (backup: ScheduledBackup): Promise<void> => {
    const ref = openModal(Confirm, {
      title: t('form.button_delete'),
      message: t('backup.delete_confirm', { date: `${formatDate(backup.timestamp, 'mediumDate')} ${formatDate(backup.timestamp, 'shortTime')}` }),
      message2: t('common.phrases.are_you_sure'),
      confirmButtonLabel: t('form.button_delete'),
      confirmButtonClass: 'btn-danger',
      faIconClass: 'fas fa-trash primary-text',
    })
    try {
      await ref.result
    } catch {
      // Called off
      return
    }

    setDeleting(backup.id)
    try {
      await api.delete(`/backup/scheduled-backups/${backup.id}`)
      void getScheduledBackups()
    } catch (error) {
      console.error(error)
      toast.error(t('backup.backup_delete_failed'), t('toast.title_error'))
    } finally {
      setDeleting(null)
    }
  }

  const onDownloadBackupClick = async (): Promise<void> => {
    setClicked(true)
    try {
      await backupService.downloadBackup()
      setClicked(false)
    } catch (error) {
      setClicked(false)
      console.error(error)
      toastApiError(error)
    }
  }

  const onCreateBackupClick = async (): Promise<void> => {
    setClicked(true)
    try {
      await api.post('/backup', {})
      void getScheduledBackups()
    } catch (error) {
      console.error(error)
      toastApiError(error)
    } finally {
      setClicked(false)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const busy = clicked || !!deleting
  const spinnerIcon = clicked ? 'fas fa-circle-notch fa-spin' : 'fas fa-arrow-right'

  let scheduleText: string
  if (enabledValue) {
    scheduleText = backupTime
      ? translate('backup.scheduled_backup_time', { backupTime: formatDate(backupTime, 'shortTime'), dayCount: 7 })
      : translate('plugins.settings.restart_required')
  } else {
    scheduleText = translate(backupTime ? 'plugins.settings.restart_required' : 'backup.scheduled_backup_disabled')
  }

  return (
    <div className="modal-content">
      <ModalHeader title={translate('backup.title_backup')} closeDisabled={busy} onClose={dismissModal} />
      <div className="modal-body">
        <div className="text-center mb-3">
          <i aria-hidden="true" className="fas fa-hard-drive primary-text icon-xl"></i>
        </div>
        <ul className="mb-3">
          <li>{translate('backup.backup_help_one')}</li>
          <li>{translate('backup.backup_help_two')}</li>
          <li>{translate('backup.backup_warning')}</li>
        </ul>
        <ul className="list-group list-group-box mb-0">
          <li className="list-group-item">
            <h6 className="mb-0 text-center">{translate('backup.settings_title')}</h6>
          </li>
          <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
            <div className="mb-2 mb-md-0 w-100 w-md-50">
              {translate('backup.settings_path')}
              <br />
              <span className="grey-text small">{translate('backup.settings_path_desc')}</span>
            </div>
            <div className="text-start text-md-end w-100 w-md-50">
              <input
                type="text"
                className="form-control custom-input font-monospace"
                placeholder="/home/pi/homebridge-backups"
                value={pathValue}
                aria-label={translate('backup.settings_path')}
                onChange={event => onPathChange(event.target.value)}
              />
            </div>
          </li>
          <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
            <div className="text-start">
              {translate('backup.settings_enable')}
              <br />
              <span className="small grey-text">{scheduleText}</span>
            </div>
            <div className="text-end grey-text d-flex align-items-center">
              <input
                type="checkbox"
                id="disableScheduledBackups"
                className="rendux-input"
                checked={enabledValue}
                aria-label={translate('backup.settings_enable')}
                onChange={event => onEnabledChange(event.target.checked)}
              />
              <label htmlFor="disableScheduledBackups" className="rendux-label" aria-hidden="true"></label>
            </div>
          </li>
          <li className="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <span>{translate('backup.backup_now')}</span>
              <br />
              <small className="grey-text">{translate('backup.backup_now_desc')}</small>
            </div>
            <button
              type="button"
              className="btn btn-primary m-0 ms-3 py-1"
              disabled={clicked}
              aria-label={translate('form.button_download')}
              onClick={() => void onDownloadBackupClick()}
            >
              <i aria-hidden="true" className={spinnerIcon}></i>
            </button>
          </li>
          <li className="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <span>{translate('backup.backup_now')}</span>
              <br />
              <small className="grey-text">{translate('backup.backup_now_save_desc')}</small>
            </div>
            <button
              type="button"
              className="btn btn-primary m-0 ms-3 py-1"
              disabled={clicked}
              aria-label={translate('backup.backup_now')}
              onClick={() => void onCreateBackupClick()}
            >
              <i aria-hidden="true" className={spinnerIcon}></i>
            </button>
          </li>
          <li className="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <span>{translate('backup.restore_now')}</span>
              <br />
              <small className="grey-text">{translate('backup.restore_now_desc')}</small>
            </div>
            <button
              type="button"
              className="btn btn-primary m-0 ms-3 py-1"
              aria-label={translate('backup.restore_now')}
              disabled={clicked}
              onClick={() => restore(null)}
            >
              <i aria-hidden="true" className="fas fa-arrow-right"></i>
            </button>
          </li>
        </ul>
        <ul className="list-group list-group-box mt-3 mb-0">
          <li className="list-group-item">
            <h6 className="mb-0 text-center">{translate('backup.files_auto')}</h6>
          </li>
          {listState === 'loading' && (
            <li className="list-group-item text-center primary-text" role="status" aria-label={translate('common.a11y.loading')}>
              <i aria-hidden="true" className="fas fa-circle-notch fa-spin"></i>
            </li>
          )}
          {listState === 'error' && (
            <li className="list-group-item d-flex justify-content-between align-items-center">
              <span className="grey-text">{translate('backup.files_load_error')}</span>
              <button type="button" className="btn btn-primary m-0 ms-3 py-1" onClick={retryScheduledBackups}>
                {translate('form.button_retry')}
              </button>
            </li>
          )}
          {listState === 'loaded' && scheduledBackups.length === 0 && (
            <li className="list-group-item text-center grey-text">{translate('backup.files_none')}</li>
          )}
          {scheduledBackups.map(backup => (
            <li key={backup.id} className="list-group-item d-flex justify-content-between align-items-center">
              <span>
                <HoverTooltip text={backup.fileName}>
                  {/* Focusable, so the file name can be reached from the keyboard too */}
                  <span tabIndex={0}>{formatDate(backup.timestamp, 'mediumDate')}</span>
                </HoverTooltip>
                <br />
                <small className="grey-text">
                  {formatDate(backup.timestamp, 'shortTime')}
                  {' '}
                  &middot;
                  {' '}
                  {backup.size > maxBackupSize
                    ? (
                        <HoverTooltip text={translate('backup.backup_exceeds_max_size', { backupSize: `${backup.size}MB`, maxBackupSizeText })}>
                          <span className="red-text" tabIndex={0}>
                            <i aria-hidden="true" className="fas fa-exclamation-circle"></i>
                            {' '}
                            {backup.size}
                            MB
                          </span>
                        </HoverTooltip>
                      )
                    : (
                        <span>
                          {backup.size}
                          MB
                        </span>
                      )}
                </small>
              </span>
              <span className="d-flex flex-nowrap" role="group" aria-label={translate('backup.aria_actions')}>
                <HoverTooltip text={translate('form.button_restore')} placement="bottom">
                  <button
                    type="button"
                    className="btn btn-primary m-0 ms-3 py-1"
                    disabled={busy || backup.size > maxBackupSize}
                    aria-label={translate('form.button_restore')}
                    onClick={() => restore(backup)}
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
                    onClick={() => void download(backup)}
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
                    onClick={() => void deleteBackup(backup)}
                  >
                    <i aria-hidden="true" className={backup.id === deleting ? 'fas fa-circle-notch fa-spin' : 'fas fa-trash'}></i>
                  </button>
                </HoverTooltip>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ModalFooter>
        <div className="text-start"></div>
        <div className="text-center">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            disabled={busy}
            onClick={dismissModal}
          >
            {translate('form.button_close')}
          </button>
        </div>
        <div className="text-end"></div>
      </ModalFooter>
    </div>
  )
}
