import type { ITerminalOptions } from '@xterm/xterm'
import type { RefObject } from 'react'

import type { LogService } from './log.service'
import type { TerminalNavigationGuard } from './terminal-navigation-guard'
import type { TerminalService } from './terminal.service'
import type { ResizeSource } from './types'

import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router'

import { createLogService, getTerminalSettings, terminalNavigationGuard, terminalService } from './instances'

/** Keep the latest value in a ref, so effects that run once still see it. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export interface UseTerminalOptions {
  /** xterm options, usually `getTerminalOptions(...)` from the settings store. Read once, at mount. */
  options?: ITerminalOptions
  /** Fires when the host element changes size; the terminal refits (debounced 100ms). */
  resize?: ResizeSource
  /** Take keyboard focus when the session starts. The dashboard widget passes false. */
  autoFocus?: boolean
  /**
   * `page` (the full-page terminal): starts clean, and without persistence tells
   * the server to drop the session on unmount. `widget` (dashboard): reuses a
   * terminal that is already up, and only ends its own socket on unmount.
   */
  variant?: 'page' | 'widget'
  /** For specs; defaults to the app-wide instance. */
  service?: TerminalService
}

/**
 * Attach the shared interactive terminal to `ref.current` for the lifetime of
 * the component. Mirrors the ngOnInit / ngOnDestroy of the Angular terminal
 * page and terminal widget.
 */
export function useTerminal(ref: RefObject<HTMLElement | null>, opts: UseTerminalOptions = {}): TerminalService {
  const service = opts.service ?? terminalService
  const latest = useLatest(opts)

  useEffect(() => {
    const target = ref.current
    if (!target) {
      return undefined
    }
    const { options = {}, resize, autoFocus = true, variant = 'page' } = latest.current
    const persistence = Boolean(getTerminalSettings()?.persistence)

    if (variant === 'widget') {
      // If terminal is already ready, use reconnectTerminal for proper session management
      if (service.isTerminalReady() || (persistence && service.hasActiveSession())) {
        service.reconnectTerminal(target, options, resize, autoFocus)
      } else {
        service.startTerminal(target, options, resize, autoFocus)
      }
    } else {
      // Always ensure clean state when the page initialises, so event
      // handlers are not duplicated
      if (service.isTerminalReady()) {
        service.destroyTerminal()
      }
      if (persistence && service.hasActiveSession()) {
        service.reconnectTerminal(target, options, resize, autoFocus)
      } else {
        // If persistence is disabled but there's still an active session, destroy it first
        if (!persistence && service.hasActiveSession()) {
          void service.destroyPersistentSession()
        }
        service.startTerminal(target, options, resize, autoFocus)
      }
    }

    return () => {
      // Read again: the user may have changed the setting while on the page
      if (getTerminalSettings()?.persistence) {
        // Detach the terminal but keep the session alive
        service.detachTerminal()
      } else if (variant === 'page') {
        // Destroy the terminal completely and ensure any persistent session is destroyed
        void service.destroyPersistentSession()
      } else {
        service.destroyTerminal()
      }
    }
  }, [ref, service, latest])

  return service
}

export interface UseLogOptions {
  /** xterm options; `disableStdin` is forced on. Read at (re)start. */
  options?: ITerminalOptions
  resize?: ResizeSource
  /** Show only this plugin's lines (plugin logs modal). Changing it restarts the terminal. */
  pluginName?: string
  /** For specs; defaults to a fresh LogService per component. */
  service?: LogService
}

/**
 * Attach a read-only log terminal (the `log` namespace) to `ref.current`.
 * Each component gets its own LogService.
 */
export function useLog(ref: RefObject<HTMLElement | null>, opts: UseLogOptions = {}): LogService {
  const [owned] = useState(() => opts.service ?? createLogService())
  const service = opts.service ?? owned
  const latest = useLatest(opts)
  const { pluginName } = opts

  useEffect(() => {
    const target = ref.current
    if (!target) {
      return undefined
    }
    const { options = {}, resize } = latest.current
    service.startTerminal(target, options, resize, pluginName)
    return () => service.destroyTerminal()
  }, [ref, service, latest, pluginName])

  return service
}

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

export interface UseTerminalNavigationGuardOptions {
  /**
   * Runs after the guard allowed leaving, e.g. the terminal page's fade-out.
   * Return false to stay.
   */
  onLeave?: (nextPath: string) => boolean | Promise<boolean>
  /** For specs; defaults to the app-wide guard. */
  guard?: TerminalNavigationGuard
}

/**
 * Warn before leaving a terminal with a live, used session: a confirm modal
 * for in-app navigation (`useBlocker`) and the browser prompt on tab close
 * (`beforeunload`).
 */
export function useTerminalNavigationGuard(opts: UseTerminalNavigationGuardOptions = {}): TerminalNavigationGuard {
  const guard = opts.guard ?? terminalNavigationGuard
  const latest = useLatest(opts)

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => guard.handleBeforeUnload(event)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [guard])

  useCanDeactivate(async (nextPath) => {
    if (!await guard.canDeactivate()) {
      return false
    }
    const onLeave = latest.current.onLeave
    return onLeave ? onLeave(nextPath) : true
  })

  return guard
}
