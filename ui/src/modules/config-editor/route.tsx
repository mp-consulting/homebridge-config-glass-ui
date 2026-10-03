import type { ShouldRevalidateFunctionArgs } from 'react-router'

import { redirect } from 'react-router'

import { api } from '@/core/api'
import { toastApiError } from '@/core/utilities/http-error'

import { ConfigEditor } from './ConfigEditor'

/**
 * The config editor's resolver: config.json, formatted with 4 spaces. A
 * failure goes back to the status page, so the editor never mounts without it.
 */

export async function loader(): Promise<string> {
  try {
    const json = await api.get('/config-editor')
    return JSON.stringify(json, null, 4)
  } catch (error) {
    console.error(error)
    toastApiError(error)
    throw redirect('/')
  }
}

/**
 * Angular resolvers re-run only when the path params change, and this route
 * has none: clearing `?action=restore`, or anything else on the same path,
 * must not reload config.json over unsaved edits.
 */

export function shouldRevalidate({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs): boolean {
  return currentUrl.pathname !== nextUrl.pathname
}

/** `/config` (guard: `requireAdmin`, owned by the router). The page owns its canDeactivate. */
export function Component() {
  return <ConfigEditor />
}
