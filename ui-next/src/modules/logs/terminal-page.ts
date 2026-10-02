import type { ResizeSource } from '@/core/utilities/terminal'

import { settingsActions, useSettingsStore } from '@/core/settings'

/**
 * Behaviour shared by the two full-page terminals: the log page (`/logs`) and
 * the shell (`/platform-tools/terminal`). The Angular components carried a copy
 * each; here they share one, and the terminal-pages spec runs against both.
 */

const body = () => window.document.body

/**
 * xterm asks for an `assertive` live region, which interrupts a screen reader
 * for every line of output. Quieten it to a polite, atomic status.
 * @param host - the element the terminal was opened in
 */
export function patchXtermLiveRegion(host: HTMLElement | null | undefined): void {
  if (!host) {
    return
  }

  const live = host.querySelector('[aria-live]') as HTMLElement | null
  if (!live) {
    return
  }

  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')
}

/** Only when the main theme is light AND the terminal theme is dark. */
function needsTransition(terminalTheme: 'light' | 'dark'): boolean {
  return useSettingsStore.getState().actualLightingMode === 'light' && terminalTheme === 'dark'
}

/**
 * Paint the body to match the terminal on the way in, so the page is not
 * briefly white around a black terminal.
 * @param terminal - the terminal host element
 * @returns the effective terminal theme
 */
export function enterTerminalPage(terminal: HTMLElement | null): 'light' | 'dark' {
  // Get terminal theme (light or dark) - enforces dark mode override
  const terminalTheme = settingsActions.getEffectiveTerminalLightingMode()

  // Set body bg color based on terminal theme
  body().classList.add(terminalTheme === 'dark' ? 'bg-black' : 'bg-white')

  // Add transition class only when main theme is light AND terminal theme is dark
  // This creates smooth transitions when light mode users navigate to dark terminal pages
  if (needsTransition(terminalTheme)) {
    body().classList.add('theme-transition')
    terminal?.classList.add('theme-transition')
  }

  return terminalTheme
}

/**
 * The theme half of the pages' `canDeactivate`: fade the terminal (and, unless
 * the next page is a terminal too, the body background) before letting the
 * navigation through.
 * @param terminal - the terminal host element
 * @param nextPath - where the user is going
 * @param beforeFade - runs once a fade is going to happen (the log page hides its search bar)
 */
export function leaveTerminalPage(terminal: HTMLElement | null, nextPath: string | undefined, beforeFade?: () => void): Promise<boolean> {
  // Get terminal theme - enforces dark mode override
  const terminalTheme = settingsActions.getEffectiveTerminalLightingMode()

  // If no transition needed, navigate immediately
  if (!needsTransition(terminalTheme)) {
    body().classList.remove('bg-black')
    body().classList.remove('bg-white')
    return Promise.resolve(true)
  }

  beforeFade?.()

  // Remove theme-transition class from body
  body().classList.remove('theme-transition')

  return new Promise((resolve) => {
    // Check if we're navigating to another page with the same terminal theme
    const stayingSameTheme = nextPath && (
      nextPath.includes('/platform-tools/terminal')
      || nextPath.includes('/logs')
    )

    // Add fade-out class to terminal
    terminal?.classList.add('fade-out')

    if (stayingSameTheme) {
      // Just fade out the terminal, keep background the same
      setTimeout(() => {
        resolve(true)
      }, 250)
    } else {
      // Wait for fade-out animation (250ms) and body background transition (250ms)
      setTimeout(() => {
        // Remove body bg color to trigger background transition
        body().classList.remove('bg-black')
        body().classList.remove('bg-white')
      }, 250)

      // Wait for both animations to complete before allowing navigation
      setTimeout(() => {
        resolve(true)
      }, 500)
    }
  })
}

export interface ResizeEmitter extends ResizeSource {
  next: () => void
  complete: () => void
}

/** The `Subject<void>` the pages fed window resizes into. */
export function createResizeEmitter(): ResizeEmitter {
  const listeners = new Set<() => void>()
  return {
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    next() {
      for (const listener of listeners) {
        listener()
      }
    },
    complete() {
      listeners.clear()
    },
  }
}
