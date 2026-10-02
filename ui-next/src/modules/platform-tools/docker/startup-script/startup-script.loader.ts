import { redirect } from 'react-router'

import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { toToastMessage } from '@/core/utilities/http-error'

export interface StartupScriptResponse {
  script: string
}

/**
 * The Angular `startupScriptResolver`: fetch the script before the page opens,
 * so the editor never shows an empty box first. On failure, toast and go home.
 */
export async function startupScriptLoader(): Promise<StartupScriptResponse | Response> {
  try {
    return await api.get<StartupScriptResponse>('/platform-tools/docker/startup-script')
  } catch (error) {
    console.error(error)
    toast.error(toToastMessage(error), i18n.t('toast.title_error'))
    return redirect('/')
  }
}
