import type { TerminalFactory } from './types'

let provided: TerminalFactory | undefined

/**
 * Hand the shared terminal services their xterm factory. `terminal.factory.ts`
 * calls this when it loads, so xterm (~90 kB gzipped) is only downloaded by the
 * chunks that actually show a terminal, not by every page that merely asks
 * "is a terminal session live?" (the navigation guard, the settings page).
 * @param factory - the factory to build terminals with
 */
export function provideTerminalFactory(factory: TerminalFactory): void {
  provided = factory
}

function current(): TerminalFactory {
  if (!provided) {
    throw new Error('xterm is not loaded: import `terminal.factory` (the terminal hooks do) before starting a terminal')
  }
  return provided
}

/**
 * The factory the app-wide terminal services are built with. It forwards to
 * whatever `provideTerminalFactory` was given, which is always set once a
 * component that starts a terminal (through the `useTerminal` / `useLog`
 * hooks, or `createLogService` from the terminal barrel) has been loaded.
 */
export const deferredTerminalFactory: TerminalFactory = {
  createTerminal: options => current().createTerminal(options),
  createFitAddon: () => current().createFitAddon(),
  createWebLinksAddon: handler => current().createWebLinksAddon(handler),
}
