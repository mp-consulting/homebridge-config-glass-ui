import type { Monaco } from '@monaco-editor/react'

import { loader } from '@monaco-editor/react'

/**
 * Where vite.config.ts copies Monaco's AMD build (`min/vs`), relative to the
 * app root. The Angular app used `./assets/monaco/min/vs` (ui-libraries.providers.ts).
 */
export const MONACO_VS_PATH = 'assets/monaco/min/vs'

/**
 * Resolve the AMD `vs` path against the document base, so the editor still
 * loads when the UI is served from a reverse-proxy subpath.
 *
 * The result is absolute and has no trailing slash. It has to be absolute
 * because Monaco's AMD loader turns it into `<script src>`, worker URLs and the
 * `editor.main.css` `<link>`, and the custom plugin UI code forwards that link
 * into iframes that have a different base URL.
 *
 * @param baseURI - the document base URL (defaults to `document.baseURI`)
 */
export function resolveMonacoVsPath(baseURI: string = document.baseURI): string {
  return new URL(MONACO_VS_PATH, baseURI).href.replace(/\/+$/, '')
}

let configuredFor: string | undefined

/**
 * Point `@monaco-editor/loader` at our copied AMD files instead of its default
 * CDN. Safe to call repeatedly. It has to run before the first editor mounts,
 * because the loader reads the config when `init()` is first called.
 *
 * @param baseURI - the document base URL (defaults to `document.baseURI`)
 */
export function configureMonacoLoader(baseURI: string = document.baseURI): void {
  const vs = resolveMonacoVsPath(baseURI)
  if (configuredFor === vs) {
    return
  }
  configuredFor = vs
  loader.config({ paths: { vs } })
}

type ReadyListener = (monaco: Monaco) => void

let loadPromise: Promise<Monaco> | undefined
const readyListeners = new Set<ReadyListener>()

/**
 * Load Monaco (once) and resolve with the `monaco` namespace. This is the same
 * instance the AMD build puts on `window.monaco`, so code ported from Angular
 * that reads `window.monaco` keeps working once this has resolved.
 */
export function loadMonaco(): Promise<Monaco> {
  if (!loadPromise) {
    configureMonacoLoader()
    loadPromise = loader.init().then((monaco) => {
      for (const listener of readyListeners) {
        listener(monaco)
      }
      readyListeners.clear()
      return monaco
    })
    // Allow a retry after a failed load (e.g. a deploy replaced the assets).
    loadPromise.catch(() => {
      loadPromise = undefined
    })
  }
  return loadPromise
}

/**
 * Return the loaded Monaco namespace, or `undefined` before it has loaded.
 * Replaces the Angular code's `(window as any).monaco` checks.
 */
export function getMonaco(): Monaco | undefined {
  const fromWindow = (window as { monaco?: Monaco }).monaco
  return fromWindow?.editor ? fromWindow : undefined
}

/**
 * The Angular `MonacoEditorService.readyEvent`: call `listener` once Monaco
 * has loaded (straight away when it already has). Does not start loading by
 * itself; mounting an editor or calling `loadMonaco()` does.
 *
 * @param listener - called with the Monaco namespace
 * @returns an unsubscribe function
 */
export function onMonacoReady(listener: ReadyListener): () => void {
  const monaco = getMonaco()
  if (monaco) {
    listener(monaco)
    return () => {}
  }
  readyListeners.add(listener)
  return () => {
    readyListeners.delete(listener)
  }
}

/** Test-only: forget the cached load state. */
export function resetMonacoLoaderForTests(): void {
  configuredFor = undefined
  loadPromise = undefined
  readyListeners.clear()
}
