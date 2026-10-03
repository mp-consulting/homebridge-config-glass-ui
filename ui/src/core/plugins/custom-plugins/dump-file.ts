import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { fileSaver } from '@/core/utilities/file-saver'

/**
 * Download the diagnostic dump of homebridge-hue or homebridge-deconz. The
 * endpoint, the file name and the error message all name the plugin.
 * @param plugin - `hue` or `deconz`
 */
// Written out, so lang-sync sees the keys used
const NO_DUMP = {
  hue: 'plugins.settings.hue.dump_no_exist',
  deconz: 'plugins.settings.deconz.dump_no_exist',
} as const

export async function downloadDumpFile(plugin: 'hue' | 'deconz'): Promise<void> {
  try {
    const body = await api.get<Blob>(`/plugins/custom-plugins/homebridge-${plugin}/dump-file`, { responseType: 'blob' })
    fileSaver.saveAs(body, `homebridge-${plugin}.json.gz`)
  } catch (error) {
    console.error(error)
    toast.error(i18n.t(NO_DUMP[plugin]), i18n.t('toast.title_error'))
  }
}
