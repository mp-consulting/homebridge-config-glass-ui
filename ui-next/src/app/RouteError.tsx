import { useEffect } from 'react'
import { useRouteError } from 'react-router'

import { isChunkLoadError } from '@/app/chunk-error'

/**
 * The root error boundary.
 *
 * Recover from chunk-load failures after a deploy: the router tries to fetch a
 * hashed JS file that no longer exists on the server, the route's `lazy`
 * promise rejects, and the user is stuck on a blank page with a console error.
 * Detect that case and force a full reload so the browser pulls the new
 * index.html and the fresh chunk hashes it points at. Any other error is left
 * alone (a reload would loop), as Angular left an ordinary NavigationError.
 */
export function RouteError() {
  const error = useRouteError()
  const chunkError = isChunkLoadError(error)

  useEffect(() => {
    if (chunkError) {
      window.location.reload()
    } else {
      console.error(error)
    }
  }, [chunkError, error])

  return null
}
