import { useLoaderData } from 'react-router'

import { Login } from './Login'

/**
 * Where to go after signing in. Read and removed in one go, so a failed or
 * abandoned login doesn't leave a stale target_route in session storage for
 * the next attempt.
 */

export function loader(): string {
  const targetRoute = window.sessionStorage.getItem('target_route') || '/'
  window.sessionStorage.removeItem('target_route')
  return targetRoute
}

/** `/login` (guard: `requireLoggedOut`, owned by the router). */
export function Component() {
  const targetRoute = useLoaderData<typeof loader>()
  return <Login targetRoute={targetRoute} />
}
