import { ConfirmedHostAction } from '@/modules/platform-tools/ConfirmedHostAction'

import { ShutdownLinux } from './ShutdownLinux'

/**
 * `/platform-tools/linux/shutdown-server`: only reached from a confirmed Power Options action (the page acts
 * on mount); a bare visit goes back to Power Options.
 */
export function Component() {
  return (
    <ConfirmedHostAction>
      <ShutdownLinux />
    </ConfirmedHostAction>
  )
}
