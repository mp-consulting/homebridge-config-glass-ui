import type { TerminalFactory } from './types'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'

/** The real xterm factory. Specs pass a fake one (`fakeTerminals()` in `@/testing`). */
export const xtermFactory: TerminalFactory = {
  createTerminal: options => new Terminal(options),
  createFitAddon: () => new FitAddon(),
  createWebLinksAddon: handler => new WebLinksAddon(handler),
}
