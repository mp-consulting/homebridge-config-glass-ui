import { redirect } from 'react-router'

/** What a guard loader receives (the part of react-router's LoaderFunctionArgs it reads). */
export interface GuardArgs {
  request: Request
}

/**
 * A guard loader: `null` lets the navigation through, a redirect Response
 * sends the user elsewhere. Kept as plain async functions so they can be used
 * as route `loader`s directly, or composed inside one.
 */
export type Guard = (args: GuardArgs) => Promise<Response | null>

/** The path part of `<base href>`, without a trailing slash ('' at the root). */
function basePath(): string {
  const href = document.querySelector('base')?.getAttribute('href') || '/'
  const path = new URL(href, window.location.origin).pathname
  return path.replace(/\/+$/, '')
}

/**
 * The url being navigated to, as the app's router sees it (what Angular called
 * `state.url`): path, query and hash, without the `<base href>` prefix.
 * @param request - the loader request
 */
export function routeUrl(request: Request): string {
  const url = new URL(request.url)
  const base = basePath()
  let path = url.pathname
  if (base && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length) || '/'
  }
  return `${path}${url.search}${url.hash}`
}

/**
 * Remember where the user was heading, so the login page can send them there.
 * @param request - the loader request
 */
export function rememberTargetRoute(request: Request): void {
  window.sessionStorage.setItem('target_route', routeUrl(request))
}

export { redirect }
