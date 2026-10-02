import { useTranslation } from 'react-i18next'

import { downloadDumpFile } from '@/core/plugins/custom-plugins/dump-file'

/** The extra button homebridge-deconz's settings get: download its diagnostic dump. */
export function HomebridgeDeconz() {
  const { t } = useTranslation()
  return (
    <button type="button" className="btn btn-elegant m-0" data-bs-dismiss="modal" onClick={() => void downloadDumpFile('deconz')}>
      <i className="fas fa-download"></i>
      {' '}
      {t('plugins.settings.custom.download_dump_file')}
    </button>
  )
}
