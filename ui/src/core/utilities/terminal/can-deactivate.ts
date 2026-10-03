import { useEffect } from 'react'
import { useBlocker } from 'react-router'

import { useLatest } from '@/core/hooks/use-latest'

/**
 * The `canDeactivate` of a route component, on react-router's `useBlocker`.
 * Every navigation to another path is held while `canDeactivate(nextPath)`
 * decides; true lets it through, false keeps the user on the page.
 *
 * Needs a data router (`createBrowserRouter` / `createMemoryRouter`).
 */
export function useCanDeactivate(canDeactivate: (nextPath: string) => boolean | Promise<boolean>): void {
  const latest = useLatest(canDeactivate)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname)
  // The blocker object can change identity between renders; key the effect on
  // its state only, or one blocked navigation would ask twice (two modals)
  const blockerRef = useLatest(blocker)

  useEffect(() => {
    const current = blockerRef.current
    if (current.state !== 'blocked') {
      return undefined
    }
    let cancelled = false
    const nextPath = current.location.pathname
    void (async () => {
      let allowed = false
      try {
        allowed = await latest.current(nextPath)
      } catch (error) {
        console.error(error)
      }
      if (cancelled) {
        return
      }
      if (allowed) {
        current.proceed()
      } else {
        current.reset()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [blocker.state, blockerRef, latest])
}
