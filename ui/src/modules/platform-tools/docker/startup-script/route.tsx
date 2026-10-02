import type { StartupScriptResponse } from './startup-script.loader'

import { startupScriptLoader } from './startup-script.loader'
import { StartupScript } from './StartupScript'

/** `/platform-tools/docker/startup-script`, with the script resolved by the loader. */
export function Component() {
  return <StartupScript />
}

/** The Angular `startupScriptResolver`. */

export async function loader(): Promise<StartupScriptResponse | Response> {
  return startupScriptLoader()
}
