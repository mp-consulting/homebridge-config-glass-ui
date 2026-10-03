import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * The router state Power Options navigates with once the user has confirmed a
 * host restart, a container restart or a shutdown. The pages behind those
 * routes fire their request on mount, so they only do so when they are reached
 * this way: a bookmark, a typed URL, a reload or a step through the browser
 * history must not restart or power off the machine.
 */
export const HOST_ACTION_CONFIRMED = { hostActionConfirmed: true } as const

function isConfirmed(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { hostActionConfirmed?: unknown }).hostActionConfirmed === true
}

/**
 * Whether this page was reached from a confirmed Power Options action. The flag
 * is read once and then cleared from the history entry (browsers keep
 * `history.state` across reloads and back/forward), so it is good for one visit.
 */
export function useConfirmedHostAction(): boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const [confirmed] = useState(() => isConfirmed(location.state))

  useEffect(() => {
    if (confirmed && isConfirmed(location.state)) {
      void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null })
    }
  }, [confirmed, location, navigate])

  return confirmed
}
