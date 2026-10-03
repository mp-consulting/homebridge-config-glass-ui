import type { TerminalFactory } from './types'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'

import { provideTerminalFactory } from './deferred-terminal-factory'

// Here rather than in the global styles, so only the chunks that show a
// terminal download it
import '@xterm/xterm/css/xterm.css'

/** The real xterm factory. Specs pass a fake one (`fakeTerminals()` in `@/testing`). */
export const xtermFactory: TerminalFactory = {
  createTerminal: options => new Terminal(options),
  createFitAddon: () => new FitAddon(),
  createWebLinksAddon: handler => new WebLinksAddon(handler),
}

// Loading this module is what lets the shared services in `instances.ts`
// start a terminal (see `deferredTerminalFactory`)
provideTerminalFactory(xtermFactory)
