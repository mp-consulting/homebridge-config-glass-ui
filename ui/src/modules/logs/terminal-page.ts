import type { ResizeSource } from '@/core/utilities/terminal'

import { settingsActions, useSettingsStore } from '@/core/settings'
import { createEmitter } from '@/core/utilities/emitter'
import { prefersReducedMotion } from '@/core/utilities/motion'

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

/** The body background's fade back after leaving (base/background.scss). */
const BACKGROUND_FADE_MS = 150

let backgroundFadeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Paint the body to match the terminal on the way in, so the page is not
 * briefly white around a black terminal.
 * @param terminal - the terminal host element
 * @returns the effective terminal theme
 */
export function enterTerminalPage(terminal: HTMLElement | null): 'light' | 'dark' {
  // A fade left running by the page just left must not strip this one's class
  clearTimeout(backgroundFadeTimer)

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
 * The theme half of the pages' `canDeactivate`. The navigation goes through at
 * once - it used to wait half a second for a fade - and the body background,
 * unless the next page is a terminal too, eases back while the next page fades in.
 * @param nextPath - where the user is going
 */
export function leaveTerminalPage(nextPath: string | undefined): Promise<boolean> {
  // Get terminal theme - enforces dark mode override
  const terminalTheme = settingsActions.getEffectiveTerminalLightingMode()

  // Check if we're navigating to another page with the same terminal theme
  const stayingSameTheme = needsTransition(terminalTheme) && nextPath && (
    nextPath.includes('/platform-tools/terminal')
    || nextPath.includes('/logs')
  )

  if (stayingSameTheme) {
    // Keep the background: fading to white only to blacken it again would flash
    body().classList.remove('theme-transition')
    return Promise.resolve(true)
  }

  body().classList.remove('bg-black')
  body().classList.remove('bg-white')

  // Let the background transition run before taking its transition away
  clearTimeout(backgroundFadeTimer)
  if (needsTransition(terminalTheme) && !prefersReducedMotion()) {
    backgroundFadeTimer = setTimeout(() => body().classList.remove('theme-transition'), BACKGROUND_FADE_MS)
  } else {
    body().classList.remove('theme-transition')
  }

  return Promise.resolve(true)
}

export interface ResizeEmitter extends ResizeSource {
  next: () => void
  complete: () => void
}

/** The `Subject<void>` the pages fed window resizes into. */
export function createResizeEmitter(): ResizeEmitter {
  const resizes = createEmitter()
  return {
    subscribe: resizes.subscribe,
    next: () => resizes.emit(),
    complete: resizes.clear,
  }
}
