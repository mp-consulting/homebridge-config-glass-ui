import type { ManagePluginStore } from '@/core/plugins/manage-plugin/manage-plugin.store'
import type { RefObject } from 'react'
import type { StoreApi } from 'zustand'

import { useEffect } from 'react'

import { settingsActions } from '@/core/settings'
import { xtermFactory } from '@/core/utilities/terminal/terminal.factory'
import { ws } from '@/core/ws'

// eslint-disable-next-line no-control-regex
const RE_ANSI = /\x1B\[(\d{1,3}(;\d{1,2})?)?[mGK]/g

/**
 * Make the xterm in `host` quiet for screen readers: its textarea is for
 * stdin, which this terminal does not use, and its per-line live region is
 * replaced by the store's curated announcements.
 * @param host - the element the terminal was opened in
 */
function applyXtermA11yPatches(host: HTMLElement | null): void {
  if (!host) {
    return
  }

  const xtermRoot = host.querySelector('.xterm') as HTMLElement | null
  if (!xtermRoot) {
    return
  }

  // The xterm textarea is for stdin which this terminal does not use
  const ta = xtermRoot.querySelector('textarea')
  if (ta) {
    // Blur first: a disabled element can no longer be blurred
    if (document.activeElement === ta) {
      ta.blur()
    }
    ta.disabled = true
    ta.setAttribute('aria-hidden', 'true')
    ta.setAttribute('tabindex', '-1')
    ta.setAttribute('readonly', 'true')
  }

  // Silence xterm's per-line live region — speakAction() drives announcements instead
  for (const el of Array.from(xtermRoot.querySelectorAll<HTMLElement>('[aria-live]'))) {
    el.setAttribute('aria-live', 'off')
    el.setAttribute('aria-atomic', 'false')
  }
}

/**
 * The npm output terminal of the manage plugin modal: an xterm in `targetRef`
 * fed by the `plugins` namespace's stdout, handed to the store, which then
 * runs the modal's action. Once per mount, like ngOnInit/ngOnDestroy.
 * @param store - the modal's store
 * @param targetRef - the element the terminal opens in
 */
export function useManagePluginTerminal(store: StoreApi<ManagePluginStore>, targetRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const terminal = xtermFactory.createTerminal(settingsActions.getTerminalOptions({ disableStdin: true }))
    const fitAddon = xtermFactory.createFitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(xtermFactory.createWebLinksAddon())

    const handle = ws.connectToNamespace('plugins')
    store.getState().attach(handle, () => ({ cols: terminal.cols, rows: terminal.rows }))
    terminal.open(targetRef.current!)
    fitAddon.fit()

    const patch = () => applyXtermA11yPatches(targetRef.current)

    const stdoutHandler = (data: string | Uint8Array) => {
      terminal.write(data)
      // xterm recreates the textarea/live-region as it renders, so re-patch on every write
      patch()
      const dataCleaned = data
        .toString()
        .replace(RE_ANSI, '')
        .trimEnd()
      if (dataCleaned) {
        store.getState().appendLog(dataCleaned)
      }
    }
    handle.socket.on('stdout', stdoutHandler)

    // Initial patches — xterm's internal accessibility DOM is created lazily
    patch()
    const patchTimer0 = setTimeout(patch, 0)
    const patchTimer50 = setTimeout(patch, 50)
    const patchTimer250 = setTimeout(patch, 250)

    // Start the action one task later, so the throwaway first mount of
    // StrictMode (mount, unmount, mount) never runs npm twice
    const start = setTimeout(() => store.getState().start(), 0)

    return () => {
      store.getState().detach()
      clearTimeout(start)
      clearTimeout(patchTimer0)
      clearTimeout(patchTimer50)
      clearTimeout(patchTimer250)
      // The plugins namespace is cached and shared, and `end()` keeps its
      // listeners, so detach ours before ending the session
      handle.socket.off('stdout', stdoutHandler)
      handle.end()
      terminal.dispose()
    }
  }, [store, targetRef])
}
