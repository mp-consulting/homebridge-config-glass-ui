import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { useLatest } from '@/core/hooks/use-latest'
import { MonacoDiffEditor } from '@/core/monaco'
import { formatDate } from '@/core/pipes/date'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'

import { BACKUP_DIFF_MODIFIED_URI, BACKUP_DIFF_ORIGINAL_URI, normaliseConfigText } from './backup-diff'

export interface ConfigBackupDiffProps extends ModalComponentProps<'load'> {
  backupId: string
  timestamp: string
  /** What the editor holds now (the right-hand side). */
  currentConfig: string
}

/**
 * A read-only side-by-side comparison of one automatic config.json backup
 * (left) against the current config (right). "Load into editor" closes with
 * `'load'`, which the backup list turns into the usual restore.
 */
export function ConfigBackupDiff({ activeModal, backupId, timestamp, currentConfig }: ConfigBackupDiffProps) {
  const { t } = useTranslation()
  const [backup, setBackup] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const modalRef = useLatest(activeModal)

  useEffect(() => {
    let active = true
    api.get(`/config-editor/backups/${backupId}`).then(
      (json) => {
        if (active) {
          setBackup(JSON.stringify(json, null, 4))
        }
      },
      (error) => {
        console.error(error)
        toastApiError(error, 'backup.load_error')
        modalRef.current.dismiss('Dismiss')
      },
    )
    return () => {
      active = false
    }
  }, [backupId, modalRef])

  const current = useMemo(() => normaliseConfigText(currentConfig), [currentConfig])
  const options = useMemo(() => ({ readOnly: true, originalEditable: false, renderSideBySide: sideBySide }), [sideBySide])
  const identical = backup !== null && backup === current

  return (
    <div className="modal-content hb-config-backup-diff">
      <ModalHeader title={t('config.restore.compare_title', { date: `${formatDate(timestamp, 'mediumDate')} ${formatDate(timestamp, 'shortTime')}` })} onClose={() => activeModal.dismiss('Dismiss')} />
      <div className="modal-body">
        <div className="d-flex justify-content-between small grey-text mb-2">
          <span>{t('config.restore.compare_backup')}</span>
          <span>{t('config.restore.compare_current')}</span>
        </div>
        {backup === null
          ? (
              <div className="text-center primary-text">
                <InlineSpinner className="mt-3 icon-xl" />
              </div>
            )
          : identical
            ? <p className="text-center mb-0" role="status">{t('config.restore.compare_identical')}</p>
            : (
                <MonacoDiffEditor
                  language="json"
                  original={backup}
                  modified={current}
                  originalModelPath={BACKUP_DIFF_ORIGINAL_URI}
                  modifiedModelPath={BACKUP_DIFF_MODIFIED_URI}
                  options={options}
                  wrapperProps={{ className: 'hb-config-backup-diff-editor', style: { height: '60vh' } }}
                />
              )}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button type="button" className="btn btn-elegant" onClick={() => activeModal.dismiss('Dismiss')}>
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center">
          {backup !== null && !identical && (
            <button type="button" className="btn btn-elegant" aria-pressed={sideBySide} onClick={() => setSideBySide(value => !value)}>
              <i aria-hidden="true" className={sideBySide ? 'fas fa-bars me-2' : 'fas fa-columns me-2'}></i>
              {sideBySide ? t('config.restore.view_inline') : t('config.restore.view_side_by_side')}
            </button>
          )}
        </div>
        <div className="text-end">
          <button type="button" className="btn btn-primary" disabled={backup === null} onClick={() => activeModal.close('load')}>
            {t('config.restore.copy_to_editor')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
