import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'

/**
 * Download the diagnostic dump of homebridge-hue or homebridge-deconz. The
 * endpoint, the file name and the error message all name the plugin.
 * @param plugin - `hue` or `deconz`
 */
export async function downloadDumpFile(plugin: 'hue' | 'deconz'): Promise<void> {
  try {
    const body = await api.get<Blob>(`/plugins/custom-plugins/homebridge-${plugin}/dump-file`, { responseType: 'blob' })
    fileSaver.saveAs(body, `homebridge-${plugin}.json.gz`)
  } catch (error) {
    console.error(error)
    toast.error(i18n.t(`plugins.settings.${plugin}.dump_no_exist`), i18n.t('toast.title_error'))
  }
}
