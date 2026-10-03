import type { FitAddon } from '@xterm/addon-fit'
import type { WebLinksAddon } from '@xterm/addon-web-links'
import type { ITerminalOptions, Terminal } from '@xterm/xterm'

/**
 * The slice of `IoNamespace` (`@/core/ws`) the terminal services use. Declared
 * structurally here so these services, and their specs, do not depend on the
 * ws module's full type.
 */
export interface TerminalSocket {
  connected: boolean
  on: (event: string, handler: (...args: any[]) => void) => unknown
  off: (event: string, handler?: (...args: any[]) => void) => unknown
  emit: (event: string, ...args: any[]) => unknown
  removeAllListeners: (event?: string) => unknown
}

export interface TerminalNamespace {
  socket: TerminalSocket
  connected: { subscribe: (cb: () => void) => () => void }
  end: () => void
}

export interface TerminalWs {
  connectToNamespace: (namespace: string) => TerminalNamespace
}

/** The `api` methods the services call (`api` from `@/core/api` satisfies it). */
export interface TerminalApi {
  get: (path: string, options: { observe: 'response', responseType: 'blob' }) => Promise<{ body: Blob }>
  post: (path: string, body?: unknown) => Promise<unknown>
  put: (path: string, body?: unknown) => Promise<unknown>
}

/**
 * Anything that signals "the element I sit in changed size". Accepts both an
 * rxjs Subject (`subscribe` returns a Subscription) and a plain emitter whose
 * `subscribe` returns an unsubscribe function.
 */
export interface ResizeSource {
  subscribe: (cb: () => void) => (() => void) | { unsubscribe: () => void }
}

/**
 * How the terminal and its addons get built. A seam so specs can substitute a
 * fake terminal without mocking `@xterm/xterm`.
 */
export interface TerminalFactory {
  createTerminal: (options: ITerminalOptions) => Terminal
  createFitAddon: () => FitAddon
  createWebLinksAddon: (handler?: (event: MouseEvent, uri: string) => void) => WebLinksAddon
}

/** Data for the confirm modal (same fields as Angular's CONFIRM_MODAL_DATA). */
export interface ConfirmData {
  title: string
  message: string
  message2?: string
  message3?: string
  confirmButtonLabel: string
  confirmButtonClass?: string
  faIconClass?: string
}

/** Opens the confirm modal; resolves true on confirm, false on dismiss. */
export type ConfirmFn = (data: ConfirmData) => Promise<boolean>

export type TranslateFn = (key: string) => string

export type SaveAs = (data: Blob | string, filename?: string) => void

export interface ToastFn {
  success: (message: string, title?: string) => unknown
  error: (message: string, title?: string) => unknown
}

/** Subscribe to a ResizeSource and hand back a plain teardown. */
export function subscribeResize(source: ResizeSource, cb: () => void): () => void {
  const sub = source.subscribe(cb)
  return typeof sub === 'function' ? sub : () => sub.unsubscribe()
}
