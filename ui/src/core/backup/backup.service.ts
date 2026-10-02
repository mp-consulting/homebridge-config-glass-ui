import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'

/**
 * Downloading a full backup archive. Shared by the backup modal and the
 * manage-plugin flow (which offers a backup before a risky update), hence its
 * place in core rather than in the settings module.
 */
export const backupService = {
  async downloadBackup(): Promise<void> {
    const res = await api.get<Blob>('/backup/download', {
      observe: 'response',
      responseType: 'blob',
    })
    const archiveName = res.headers.get('File-Name') || 'homebridge-backup.tar.gz'
    const sizeInBytes = res.body.size
    if (sizeInBytes > globalThis.backup.maxBackupSize) {
      const message = i18n.t('backup.backup_exceeds_max_size', {
        maxBackupSizeText: globalThis.backup.maxBackupSizeText,
        size: `${(sizeInBytes / (1024 * 1024)).toFixed(1)}MB`,
      })
      toast.warning(message, i18n.t('toast.title_warning'))
    }
    fileSaver.saveAs(res.body, archiveName)
  },
}
