import { ConfirmedHostAction } from '@/modules/platform-tools/ConfirmedHostAction'

import { ContainerRestart } from './ContainerRestart'

/**
 * `/platform-tools/docker/restart-container`: only reached from a confirmed Power Options action (the page acts
 * on mount); a bare visit goes back to Power Options.
 */
export function Component() {
  return (
    <ConfirmedHostAction>
      <ContainerRestart />
    </ConfirmedHostAction>
  )
}
