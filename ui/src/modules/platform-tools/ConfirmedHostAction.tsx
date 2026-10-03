import type { ReactNode } from 'react'

import { Navigate } from 'react-router'

import { useConfirmedHostAction } from '@/modules/platform-tools/host-action'

/**
 * Renders a host action page only when it was reached from a confirmed Power
 * Options action; anything else goes back to Power Options without firing it.
 */
export function ConfirmedHostAction({ children }: { children: ReactNode }) {
  const confirmed = useConfirmedHostAction()
  if (!confirmed) {
    return <Navigate to="/power-options" replace />
  }
  return children
}
