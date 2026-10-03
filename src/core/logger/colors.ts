import { styleText } from 'node:util'

type Colour = 'cyan' | 'green' | 'red' | 'white' | 'yellow'

/**
 * ANSI colour helpers (they replace the bash-color package). The colours are
 * always emitted, as they were before: most of this output is not written to
 * the process's own terminal but to the homebridge.log file or a browser
 * terminal over a socket, which both render ANSI, so styleText's check of
 * process.stdout (TTY, NO_COLOR, ...) would wrongly strip them.
 */
function colour(format: Colour) {
  return (text: unknown): string => styleText(format, String(text), { validateStream: false })
}

export const cyan = colour('cyan')
export const green = colour('green')
export const red = colour('red')
export const white = colour('white')
export const yellow = colour('yellow')
