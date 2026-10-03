import type { ScheduledBackup } from '@/core/backup'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { RestoreModalData } from '@/core/ui/modal-data'
import type { IoNamespace } from '@/core/ws'
import type { Terminal } from '@xterm/xterm'
import type { ChangeEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { t } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'
import { hideXtermInputFromScreenReader } from '@/core/utilities/terminal/log.service'
import { ws } from '@/core/ws'
import { Backup } from '@/modules/settings/backup/Backup'

import { restoreDeps } from './restore.deps'

export type RestoreProps = RestoreModalData & ModalComponentProps<boolean>

/**
 * The restore modal: replaces the whole Homebridge storage directory from an
 * uploaded .tar.gz, an uploaded .hbfx, a scheduled backup, or (from the setup
 * wizard) an archive already uploaded, then restarts the service.
 */
export function Restore({ activeModal, setupWizardRestore: setupWizardRestoreProp, selectedBackup: selectedBackupProp }: RestoreProps) {
  const { t: translate } = useTranslation()
  const navigate = useNavigate()
  const setupWizardRestore = setupWizardRestoreProp ?? false
  const selectedBackup: ScheduledBackup | null = selectedBackupProp ?? null

  const [clicked, setClicked] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [restoreInProgress, setRestoreInProgress] = useState(false)
  const [restoreStarted, setRestoreStarted] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [restoreArchiveType, setRestoreArchiveType] = useState<'homebridge' | 'hbfx'>('homebridge')
  const [uploadPercent, setUploadPercent] = useState(0)
  const isLightTerminalTheme = useSettingsStore(() => settingsActions.getEffectiveTerminalLightingMode()) === 'light'
  const maxFileSizeText = globalThis.backup.maxBackupSizeText

  const termTargetRef = useRef<HTMLDivElement>(null)
  const ioRef = useRef<IoNamespace | null>(null)
  const termRef = useRef<Terminal | null>(null)
  // The wizard's restore starts on open; StrictMode's second mount must not send it again
  const autoStartedRef = useRef(false)

  const postBackupRestart = async (): Promise<void> => {
    try {
      await api.put('/backup/restart', {})
      activeModal.close(true)
      void navigate('/')
    } catch (error) {
      toastApiError(error)
    }
  }

  const startRestore = (): void => {
    ioRef.current!.request('do-restore').then(() => {
      setRestoreInProgress(false)
      toast.success(t('backup.backup_restored'), t('toast.title_success'))
      if (setupWizardRestore) {
        void postBackupRestart()
      }
    }, (error) => {
      setRestoreFailed(true)
      console.error(error)
      toast.error(t('backup.restore_failed'), t('toast.title_error'))
    })
  }

  const startHbfxRestore = (): void => {
    ioRef.current!.request('do-restore-hbfx').then(() => {
      setRestoreInProgress(false)
      toast.success(t('backup.backup_restored'), t('toast.title_success'))
    }, (error) => {
      setRestoreFailed(true)
      console.error(error)
      toast.error(t('backup.restore_failed'), t('toast.title_error'))
    })
  }

  useEffect(() => {
    const io = ws.connectToNamespace('backup')
    ioRef.current = io
    const termTarget = termTargetRef.current!

    const fitAddon = restoreDeps.terminals.createFitAddon()
    const webLinksAddon = restoreDeps.terminals.createWebLinksAddon()
    const term = restoreDeps.terminals.createTerminal(settingsActions.getTerminalOptions({ disableStdin: true }))
    termRef.current = term
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(termTarget)
    const xtermA11yDisposer = hideXtermInputFromScreenReader(termTarget)
    // Defer fit() to the next tick — modal host can be zero-sized
    // on first paint, leaving the terminal at 0×0 until next resize.
    const fitTimer = setTimeout(() => fitAddon.fit(), 0)

    const stdoutHandler = (data: string) => {
      term.write(data)
    }
    io.socket.on('stdout', stdoutHandler)

    if (setupWizardRestore && !autoStartedRef.current) {
      autoStartedRef.current = true
      setRestoreStarted(true)
      setRestoreInProgress(true)
      startRestore()
    }

    return () => {
      clearTimeout(fitTimer)
      // The backup namespace is cached and shared, and `end()` keeps its
      // listeners, so detach ours before ending the session
      io.socket.off('stdout', stdoutHandler)
      io.end?.()
      xtermA11yDisposer()
      term.dispose()
    }
    // eslint-disable-next-line react/exhaustive-deps -- set up once per mount, as ngOnInit did
  }, [])

  const reportUploadError = (error: any) => {
    console.error(error)
    toastApiError(error, 'backup.restore_failed')
  }

  const uploadHomebridgeArchive = async (): Promise<void> => {
    termRef.current?.reset()
    setClicked(true)
    const formData = new FormData()
    formData.append('restoreArchive', selectedFile!, selectedFile?.name)
    try {
      await api.post('/backup/restore', formData)
      setRestoreStarted(true)
      setRestoreInProgress(true)
      setTimeout(startRestore, 500)
    } catch (error) {
      reportUploadError(error)
    } finally {
      setClicked(false)
    }
  }

  const restoreScheduledBackup = async (): Promise<void> => {
    termRef.current?.reset()
    setClicked(true)
    try {
      await api.post(`/backup/scheduled-backups/${selectedBackup!.id}/restore`, {})
      setRestoreStarted(true)
      setRestoreInProgress(true)
      setTimeout(startRestore, 500)
    } catch (error) {
      reportUploadError(error)
    } finally {
      setClicked(false)
    }
  }

  const uploadHbfxArchive = async (): Promise<void> => {
    termRef.current?.reset()
    setClicked(true)
    const formData = new FormData()
    formData.append('restoreArchive', selectedFile!, selectedFile?.name)
    // The upload is resolved on the response, not the first progress event:
    // resolving early is how the hbfx restore once looked fine while never starting
    try {
      await restoreDeps.uploadWithProgress('/backup/restore/hbfx', formData, (loaded, total) => {
        setUploadPercent(Math.round(100 * loaded / total))
      })
      setRestoreStarted(true)
      setRestoreInProgress(true)
      setTimeout(startHbfxRestore, 500)
    } catch (error) {
      reportUploadError(error)
    } finally {
      setClicked(false)
    }
  }

  const onRestoreBackupClick = (): void => {
    if (selectedBackup) {
      // Prepopulated with a backup from the backup modal
      void restoreScheduledBackup()
    } else if (restoreArchiveType === 'homebridge') {
      // Restore from uploaded file
      void uploadHomebridgeArchive()
    } else if (restoreArchiveType === 'hbfx') {
      void uploadHbfxArchive()
    }
  }

  const handleRestoreFileInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files
    if (files?.length) {
      setSelectedFile(files[0])
      setRestoreArchiveType(files[0].name.endsWith('.hbfx') ? 'hbfx' : 'homebridge')
    } else {
      setSelectedFile(null)
    }
  }

  const reopenBackupModal = (): void => {
    activeModal.dismiss()
    openModal(Backup, {}, {
      size: 'lg',
      backdrop: 'static',
    })
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className={`modal-content${isLightTerminalTheme ? ' terminal-light-theme' : ''}`}>
      <ModalHeader title={translate('backup.title_backup')} closeDisabled={restoreInProgress} onClose={dismissModal} />
      {!restoreStarted && !setupWizardRestore && (
        <div className="modal-body">
          <div className="text-center mb-3">
            <i className="fas fa-hard-drive primary-text icon-xl" aria-hidden="true"></i>
          </div>
          <ul className="mb-3">
            <li>{translate('backup.restore_help_one')}</li>
            <li>{translate('backup.restore_help_two')}</li>
            <li>{translate('backup.restore_max_size', { maxBackupSizeText: maxFileSizeText })}</li>
            <li>{translate('backup.restore_warning')}</li>
          </ul>
          {selectedBackup
            ? <input className="form-control custom-input" type="text" disabled aria-label={translate('backup.label_backup_file')} defaultValue={selectedBackup.fileName} />
            : (
                <input
                  type="file"
                  className="form-control"
                  id="restoreFileUpload"
                  aria-label={translate('backup.label_backup_file')}
                  accept="application/gzip, .gz, .hbfx"
                  onChange={handleRestoreFileInput}
                />
              )}
        </div>
      )}

      <div
        ref={termTargetRef}
        id="plugin-log-output"
        className={`modal-body ${isLightTerminalTheme ? 'terminal-light-bg' : 'terminal-dark-bg'}`}
        hidden={!restoreStarted}
      >
      </div>

      {(!restoreStarted || restoreFailed) && (
        <ModalFooter>
          <div className="text-start">
            {setupWizardRestore
              ? (
                  <button
                    type="button"
                    className="btn btn-elegant"
                    data-bs-dismiss="modal"
                    aria-label={translate('form.button_close')}
                    disabled={clicked}
                    onClick={dismissModal}
                  >
                    {translate('form.button_close')}
                  </button>
                )
              : (
                  <button
                    type="button"
                    className="btn btn-elegant"
                    data-bs-dismiss="modal"
                    aria-label={translate('form.button_back')}
                    disabled={clicked}
                    onClick={reopenBackupModal}
                  >
                    {translate('form.button_back')}
                  </button>
                )}
          </div>
          <div className="text-center"></div>
          <div className="text-end">
            <button
              type="button"
              className="btn btn-primary"
              data-bs-dismiss="modal"
              disabled={(!selectedBackup && !selectedFile) || clicked}
              onClick={onRestoreBackupClick}
            >
              {clicked
                ? (
                    <span>
                      {(!uploadPercent || uploadPercent === 100) && <InlineSpinner />}
                      {!!uploadPercent && uploadPercent !== 100 && (
                        <span>
                          {uploadPercent}
                          % -
                          {' '}
                        </span>
                      )}
                      {uploadPercent === 100
                        ? <span>{translate('backup.label_extracting')}</span>
                        : <span>{translate('backup.label_uploading')}</span>}
                    </span>
                  )
                : translate('form.button_restore')}
            </button>
          </div>
        </ModalFooter>
      )}
      {!restoreInProgress && restoreStarted && (
        <ModalFooter>
          <div className="text-start"></div>
          <div className="text-center">
            <button type="button" className="btn btn-primary" data-bs-dismiss="modal" onClick={() => void postBackupRestart()}>
              {translate('menu.hbrestart.title')}
            </button>
          </div>
          <div className="text-end"></div>
        </ModalFooter>
      )}
    </div>
  )
}
