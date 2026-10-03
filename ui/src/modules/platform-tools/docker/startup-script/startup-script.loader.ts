import { redirect } from 'react-router'

import { api } from '@/core/api'
import { toastApiError } from '@/core/utilities/http-error'

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
    toastApiError(error)
    return redirect('/')
  }
}
